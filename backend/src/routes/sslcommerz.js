// SSLCommerz Payment Gateway Integration
// Reads credentials from system_settings table (api_payment_ssl)
// Admin Panel → Settings → API Integrations → SSLCommerz

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

let cachedConfig = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getSSLConfig() {
  if (cachedConfig && Date.now() - cacheTime < CACHE_TTL) return cachedConfig;
  try {
    const [rows] = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'api_payment_ssl'");
    if (rows.length === 0 || !rows[0].setting_value) return null;
    const cfg = JSON.parse(rows[0].setting_value);
    if (cfg.enabled !== 'true' && cfg.enabled !== true) return null;
    if (!cfg.store_id || !cfg.store_password) return null;

    const isProd = cfg.environment === 'production';
    cachedConfig = {
      storeId: cfg.store_id,
      storePassword: cfg.store_password,
      baseUrl: isProd ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com',
      environment: cfg.environment,
    };
    cacheTime = Date.now();
    return cachedConfig;
  } catch (err) {
    console.error('[SSLCommerz] Config error:', err.message);
    return null;
  }
}

function clearSSLConfigCache() { cachedConfig = null; cacheTime = 0; }

// POST /payments/ssl/init — Initialize a payment session
router.post('/init', authenticate, async (req, res) => {
  try {
    const config = await getSSLConfig();
    if (!config) return res.status(503).json({ message: 'SSLCommerz not configured. Enable it in Admin → Settings → API Integrations.', status: 503 });

    const { bookingId, amount, customerName, customerEmail, customerPhone, productName, productCategory } = req.body;
    if (!amount || !customerEmail) return res.status(400).json({ message: 'Amount and email are required', status: 400 });

    const tranId = `ST-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const frontendUrl = process.env.FRONTEND_URL || 'https://seventrip.net';

    const params = new URLSearchParams({
      store_id: config.storeId,
      store_passwd: config.storePassword,
      total_amount: String(amount),
      currency: 'BDT',
      tran_id: tranId,
      success_url: `${process.env.FRONTEND_URL || ''}/api/payments/ssl/success`,
      fail_url: `${process.env.FRONTEND_URL || ''}/api/payments/ssl/fail`,
      cancel_url: `${process.env.FRONTEND_URL || ''}/api/payments/ssl/cancel`,
      ipn_url: `${process.env.FRONTEND_URL || ''}/api/payments/ssl/ipn`,
      cus_name: customerName || 'Customer',
      cus_email: customerEmail,
      cus_phone: customerPhone || '01700000000',
      cus_add1: 'Dhaka, Bangladesh',
      cus_city: 'Dhaka',
      cus_country: 'Bangladesh',
      shipping_method: 'NO',
      product_name: productName || 'Seven Trip Booking',
      product_category: productCategory || 'Travel',
      product_profile: 'non-physical-goods',
      value_a: bookingId || '', // Pass booking ID for IPN callback
      value_b: req.user.sub, // User ID
    });

    const response = await fetch(`${config.baseUrl}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();

    if (data.status === 'SUCCESS' && data.GatewayPageURL) {
      // Store pending transaction
      await db.query(
        `INSERT INTO transactions (id, user_id, booking_id, type, amount, status, payment_method, reference, description, meta)
         VALUES (?, ?, ?, 'payment', ?, 'pending', 'sslcommerz', ?, ?, ?)`,
        [uuidv4(), req.user.sub, bookingId || null, amount, tranId, `SSLCommerz payment init`, JSON.stringify({ sessionKey: data.sessionkey, tranId })]
      );
      res.json({ gatewayUrl: data.GatewayPageURL, tranId, sessionKey: data.sessionkey });
    } else {
      console.error('[SSLCommerz] Init failed:', data);
      res.status(400).json({ message: data.failedreason || 'Payment initialization failed', status: 400 });
    }
  } catch (err) {
    console.error('[SSLCommerz] Init error:', err);
    res.status(500).json({ message: 'Payment service error', status: 500 });
  }
});

// POST /payments/ssl/ipn — Instant Payment Notification (server-to-server callback)
router.post('/ipn', async (req, res) => {
  try {
    const { tran_id, val_id, amount, status, card_type, value_a: bookingId, value_b: userId } = req.body;
    if (!tran_id) return res.status(400).send('Missing tran_id');

    const config = await getSSLConfig();
    if (!config) return res.status(503).send('Not configured');

    // Validate transaction with SSLCommerz
    const validateUrl = `${config.baseUrl}/validator/api/validationserverAPI.php?val_id=${val_id}&store_id=${config.storeId}&store_passwd=${config.storePassword}&format=json`;
    const valRes = await fetch(validateUrl, { signal: AbortSignal.timeout(15000) });
    const valData = await valRes.json();

    if (valData.status === 'VALID' || valData.status === 'VALIDATED') {
      // Update transaction
      await db.query(
        `UPDATE transactions SET status = 'completed', meta = JSON_SET(COALESCE(meta, '{}'), '$.val_id', ?, '$.card_type', ?, '$.validated_at', ?) WHERE reference = ?`,
        [val_id, card_type || '', new Date().toISOString(), tran_id]
      );

      // Auto-ticket booking if linked
      if (bookingId) {
        await db.query(`UPDATE bookings SET payment_method = ? WHERE id = ?`, [card_type || 'sslcommerz', bookingId]);
        try {
          const { autoTicketAfterPayment } = require('../services/auto-ticket');
          const ticketResult = await autoTicketAfterPayment(bookingId);
          console.log(`[SSLCommerz] Auto-ticket result for ${bookingId}:`, ticketResult);
        } catch (ticketErr) {
          console.error(`[SSLCommerz] Auto-ticket error for ${bookingId}:`, ticketErr.message);
          // Fallback: at least confirm the booking
          await db.query(`UPDATE bookings SET status = 'confirmed', payment_status = 'paid' WHERE id = ?`, [bookingId]);
        }
      }

      console.log(`[SSLCommerz] IPN validated: ${tran_id}, amount: ${amount}, card: ${card_type}`);
      res.send('IPN_RECEIVED');
    } else {
      console.warn('[SSLCommerz] IPN validation failed:', valData);
      await db.query(`UPDATE transactions SET status = 'failed' WHERE reference = ?`, [tran_id]);
      res.send('IPN_VALIDATION_FAILED');
    }
  } catch (err) {
    console.error('[SSLCommerz] IPN error:', err);
    res.status(500).send('IPN_ERROR');
  }
});

// POST /payments/ssl/success — Redirect after successful payment
router.post('/success', (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://seventrip.net';
  res.redirect(`${frontendUrl}/dashboard/payments?status=success&tran_id=${req.body.tran_id || ''}`);
});

// POST /payments/ssl/fail
router.post('/fail', async (req, res) => {
  const { tran_id } = req.body;
  if (tran_id) await db.query(`UPDATE transactions SET status = 'failed' WHERE reference = ?`, [tran_id]).catch(console.error);
  const frontendUrl = process.env.FRONTEND_URL || 'https://seventrip.net';
  res.redirect(`${frontendUrl}/dashboard/payments?status=failed&tran_id=${tran_id || ''}`);
});

// POST /payments/ssl/cancel
router.post('/cancel', async (req, res) => {
  const { tran_id } = req.body;
  if (tran_id) await db.query(`UPDATE transactions SET status = 'cancelled' WHERE reference = ?`, [tran_id]).catch(console.error);
  const frontendUrl = process.env.FRONTEND_URL || 'https://seventrip.net';
  res.redirect(`${frontendUrl}/dashboard/payments?status=cancelled&tran_id=${tran_id || ''}`);
});

// GET /payments/ssl/status — Check if SSLCommerz is enabled
router.get('/status', async (req, res) => {
  const config = await getSSLConfig();
  res.json({ enabled: !!config, environment: config?.environment || null });
});

module.exports = { router, getSSLConfig, clearSSLConfigCache };
