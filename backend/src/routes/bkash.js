// bKash Payment Gateway Integration
// Reads credentials from system_settings table (api_payment_bkash)
// Admin Panel → Settings → API Integrations → bKash

const db = require('../config/db');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

let cachedConfig = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getBkashConfig() {
  if (cachedConfig && Date.now() - cacheTime < CACHE_TTL) return cachedConfig;
  try {
    const [rows] = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'api_payment_bkash'");
    if (rows.length === 0 || !rows[0].setting_value) return null;
    const cfg = JSON.parse(rows[0].setting_value);
    if (cfg.enabled !== 'true' && cfg.enabled !== true) return null;
    if (!cfg.app_key || !cfg.app_secret) return null;

    const isProd = cfg.environment === 'production';
    cachedConfig = {
      appKey: cfg.app_key,
      appSecret: cfg.app_secret,
      username: cfg.username,
      password: cfg.password,
      baseUrl: isProd ? 'https://tokenized.pay.bka.sh/v1.2.0-beta' : 'https://tokenized.sandbox.bka.sh/v1.2.0-beta',
      environment: cfg.environment,
    };
    cacheTime = Date.now();
    return cachedConfig;
  } catch (err) {
    console.error('[bKash] Config error:', err.message);
    return null;
  }
}

function clearBkashConfigCache() { cachedConfig = null; cacheTime = 0; }

// Get grant token
let tokenCache = { token: null, refreshToken: null, expiresAt: 0 };

async function getGrantToken() {
  const config = await getBkashConfig();
  if (!config) throw new Error('bKash not configured');

  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const res = await fetch(`${config.baseUrl}/tokenized/checkout/token/grant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      username: config.username,
      password: config.password,
    },
    body: JSON.stringify({ app_key: config.appKey, app_secret: config.appSecret }),
    signal: AbortSignal.timeout(15000),
  });

  const data = await res.json();
  if (data.id_token) {
    tokenCache = { token: data.id_token, refreshToken: data.refresh_token, expiresAt: Date.now() + 55 * 60 * 1000 };
    return data.id_token;
  }
  throw new Error(data.msg || 'bKash grant token failed');
}

// POST /payments/bkash/create — Create payment
router.post('/create', authenticate, async (req, res) => {
  try {
    const config = await getBkashConfig();
    if (!config) return res.status(503).json({ message: 'bKash not configured', status: 503 });

    const { bookingId, amount, payerReference } = req.body;
    if (!amount) return res.status(400).json({ message: 'Amount is required', status: 400 });

    const token = await getGrantToken();
    const invoiceNumber = `ST-BK-${Date.now()}`;
    const frontendUrl = process.env.FRONTEND_URL || 'https://seventrip.net';

    const response = await fetch(`${config.baseUrl}/tokenized/checkout/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: token,
        'X-APP-Key': config.appKey,
      },
      body: JSON.stringify({
        mode: '0011',
        payerReference: payerReference || req.user.sub,
        callbackURL: `${frontendUrl}/api/payments/bkash/callback`,
        amount: String(amount),
        currency: 'BDT',
        intent: 'sale',
        merchantInvoiceNumber: invoiceNumber,
      }),
      signal: AbortSignal.timeout(20000),
    });

    const data = await response.json();
    if (data.bkashURL) {
      // Store pending
      await db.query(
        `INSERT INTO transactions (id, user_id, booking_id, type, amount, status, payment_method, reference, description, meta) VALUES (?, ?, ?, 'payment', ?, 'pending', 'bkash', ?, ?, ?)`,
        [uuidv4(), req.user.sub, bookingId || null, amount, invoiceNumber, 'bKash payment', JSON.stringify({ paymentID: data.paymentID })]
      );
      res.json({ bkashURL: data.bkashURL, paymentID: data.paymentID });
    } else {
      res.status(400).json({ message: data.statusMessage || 'bKash payment creation failed', status: 400 });
    }
  } catch (err) {
    console.error('[bKash] Create error:', err);
    res.status(500).json({ message: 'bKash service error', status: 500 });
  }
});

// GET /payments/bkash/callback — bKash redirects here after payment
router.get('/callback', async (req, res) => {
  try {
    const { paymentID, status: paymentStatus } = req.query;
    const frontendUrl = process.env.FRONTEND_URL || 'https://seventrip.net';

    if (paymentStatus === 'success' && paymentID) {
      const config = await getBkashConfig();
      const token = await getGrantToken();

      // Execute payment
      const execRes = await fetch(`${config.baseUrl}/tokenized/checkout/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token, 'X-APP-Key': config.appKey },
        body: JSON.stringify({ paymentID }),
        signal: AbortSignal.timeout(15000),
      });
      const execData = await execRes.json();

      if (execData.transactionStatus === 'Completed') {
        // Update transaction
        await db.query(
          `UPDATE transactions SET status = 'completed', meta = JSON_SET(COALESCE(meta, '{}'), '$.trxID', ?, '$.customerMsisdn', ?) WHERE meta LIKE ?`,
          [execData.trxID, execData.customerMsisdn || '', `%${paymentID}%`]
        );

        // Auto-ticket linked booking
        const [txns] = await db.query(`SELECT booking_id FROM transactions WHERE meta LIKE ?`, [`%${paymentID}%`]);
        if (txns.length > 0 && txns[0].booking_id) {
          await db.query(`UPDATE bookings SET payment_method = 'bkash' WHERE id = ?`, [txns[0].booking_id]);
          try {
            const { autoTicketAfterPayment } = require('../services/auto-ticket');
            const ticketResult = await autoTicketAfterPayment(txns[0].booking_id);
            console.log(`[bKash] Auto-ticket result:`, ticketResult);
          } catch (ticketErr) {
            console.error(`[bKash] Auto-ticket error:`, ticketErr.message);
            await db.query(`UPDATE bookings SET status = 'confirmed', payment_status = 'paid' WHERE id = ?`, [txns[0].booking_id]);
          }
        }

        res.redirect(`${frontendUrl}/dashboard/payments?status=success&method=bkash`);
      } else {
        res.redirect(`${frontendUrl}/dashboard/payments?status=failed&method=bkash`);
      }
    } else {
      res.redirect(`${frontendUrl}/dashboard/payments?status=${paymentStatus || 'failed'}&method=bkash`);
    }
  } catch (err) {
    console.error('[bKash] Callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL || 'https://seventrip.net'}/dashboard/payments?status=error&method=bkash`);
  }
});

// GET /payments/bkash/status
router.get('/status', async (req, res) => {
  const config = await getBkashConfig();
  res.json({ enabled: !!config, environment: config?.environment || null });
});

module.exports = { router, getBkashConfig, clearBkashConfigCache };
