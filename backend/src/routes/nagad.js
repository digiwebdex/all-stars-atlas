// Nagad Payment Gateway Integration
// Reads credentials from system_settings table (api_payment_nagad)
// Admin Panel → Settings → API Integrations → Nagad

const crypto = require('crypto');
const db = require('../config/db');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

let cachedConfig = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getNagadConfig() {
  if (cachedConfig && Date.now() - cacheTime < CACHE_TTL) return cachedConfig;
  try {
    const [rows] = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'api_payment_nagad'");
    if (rows.length === 0 || !rows[0].setting_value) return null;
    const cfg = JSON.parse(rows[0].setting_value);
    if (cfg.enabled !== 'true' && cfg.enabled !== true) return null;
    if (!cfg.merchant_id || !cfg.api_key) return null;

    const isProd = cfg.environment === 'production';
    cachedConfig = {
      merchantId: cfg.merchant_id,
      publicKey: cfg.api_key,
      privateKey: cfg.api_secret,
      baseUrl: isProd ? 'https://api.mynagad.com/api/dfs' : 'http://sandbox.mynagad.com:10080/remote-payment-gateway-1.0/api/dfs',
      environment: cfg.environment,
    };
    cacheTime = Date.now();
    return cachedConfig;
  } catch (err) {
    console.error('[Nagad] Config error:', err.message);
    return null;
  }
}

function clearNagadConfigCache() { cachedConfig = null; cacheTime = 0; }

// POST /payments/nagad/init
router.post('/init', authenticate, async (req, res) => {
  try {
    const config = await getNagadConfig();
    if (!config) return res.status(503).json({ message: 'Nagad not configured. Enable it in Admin → Settings.', status: 503 });

    const { bookingId, amount } = req.body;
    if (!amount) return res.status(400).json({ message: 'Amount is required', status: 400 });

    const orderId = `ST-NG-${Date.now()}`;
    const datetime = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const frontendUrl = process.env.FRONTEND_URL || 'https://seventrip.net';

    // Step 1: Initialize payment
    const initBody = {
      merchantId: config.merchantId,
      orderId,
      datetime,
      challenge: crypto.randomBytes(16).toString('hex'),
    };

    const initRes = await fetch(
      `${config.baseUrl}/check-out/initialize/${config.merchantId}/${orderId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-KM-Api-Version': 'v-0.2.0', 'X-KM-IP-V4': '127.0.0.1', 'X-KM-Client-Type': 'PC_WEB' },
        body: JSON.stringify(initBody),
        signal: AbortSignal.timeout(20000),
      }
    );

    const initData = await initRes.json();

    if (initData.sensitiveData || initData.paymentReferenceId) {
      // Store pending transaction
      await db.query(
        `INSERT INTO transactions (id, user_id, booking_id, type, amount, status, payment_method, reference, description, meta) VALUES (?, ?, ?, 'payment', ?, 'pending', 'nagad', ?, ?, ?)`,
        [uuidv4(), req.user.sub, bookingId || null, amount, orderId, 'Nagad payment init', JSON.stringify({ paymentReferenceId: initData.paymentReferenceId || '' })]
      );

      // Step 2: Complete initialization → get redirect URL
      const completeBody = {
        merchantId: config.merchantId,
        orderId,
        currencyCode: '050',
        amount: String(amount),
        challenge: initBody.challenge,
      };

      const completeRes = await fetch(
        `${config.baseUrl}/check-out/complete/${initData.paymentReferenceId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KM-Api-Version': 'v-0.2.0', 'X-KM-IP-V4': '127.0.0.1', 'X-KM-Client-Type': 'PC_WEB' },
          body: JSON.stringify(completeBody),
          signal: AbortSignal.timeout(20000),
        }
      );

      const completeData = await completeRes.json();
      if (completeData.callBackUrl) {
        res.json({ redirectUrl: completeData.callBackUrl, orderId });
      } else {
        res.status(400).json({ message: completeData.reason || 'Nagad payment init failed', status: 400 });
      }
    } else {
      res.status(400).json({ message: initData.reason || initData.message || 'Nagad init failed', status: 400 });
    }
  } catch (err) {
    console.error('[Nagad] Init error:', err);
    res.status(500).json({ message: 'Nagad service error', status: 500 });
  }
});

// GET /payments/nagad/callback
router.get('/callback', async (req, res) => {
  try {
    const { payment_ref_id, status: nagadStatus, order_id } = req.query;
    const frontendUrl = process.env.FRONTEND_URL || 'https://seventrip.net';

    if (nagadStatus === 'Success' && payment_ref_id) {
      // Verify with Nagad
      const config = await getNagadConfig();
      const verifyRes = await fetch(
        `${config.baseUrl}/verify/payment/${payment_ref_id}`,
        { headers: { 'X-KM-Api-Version': 'v-0.2.0', 'X-KM-IP-V4': '127.0.0.1', 'X-KM-Client-Type': 'PC_WEB' }, signal: AbortSignal.timeout(15000) }
      );
      const verifyData = await verifyRes.json();

      if (verifyData.status === 'Success') {
        await db.query(`UPDATE transactions SET status = 'completed' WHERE reference = ?`, [order_id]);
        const [txns] = await db.query(`SELECT booking_id FROM transactions WHERE reference = ?`, [order_id]);
        if (txns.length > 0 && txns[0].booking_id) {
          await db.query(`UPDATE bookings SET payment_method = 'nagad' WHERE id = ?`, [txns[0].booking_id]);
          try {
            const { autoTicketAfterPayment } = require('../services/auto-ticket');
            const ticketResult = await autoTicketAfterPayment(txns[0].booking_id);
            console.log(`[Nagad] Auto-ticket result:`, ticketResult);
          } catch (ticketErr) {
            console.error(`[Nagad] Auto-ticket error:`, ticketErr.message);
            await db.query(`UPDATE bookings SET status = 'confirmed', payment_status = 'paid' WHERE id = ?`, [txns[0].booking_id]);
          }
        }
        res.redirect(`${frontendUrl}/dashboard/payments?status=success&method=nagad`);
      } else {
        res.redirect(`${frontendUrl}/dashboard/payments?status=failed&method=nagad`);
      }
    } else {
      res.redirect(`${frontendUrl}/dashboard/payments?status=${nagadStatus || 'failed'}&method=nagad`);
    }
  } catch (err) {
    console.error('[Nagad] Callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL || 'https://seventrip.net'}/dashboard/payments?status=error&method=nagad`);
  }
});

router.get('/status', async (req, res) => {
  const config = await getNagadConfig();
  res.json({ enabled: !!config, environment: config?.environment || null });
});

module.exports = { router, getNagadConfig, clearNagadConfigCache };
