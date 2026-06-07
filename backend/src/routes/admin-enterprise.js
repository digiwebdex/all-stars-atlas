/**
 * Admin Enterprise extra routes — partial deadlines, per-user commission,
 * route restrictions, deposit-approver permission, agent ID creation.
 * Mounted from admin.js: router.use('/', require('./admin-enterprise'));
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { safeJsonParse } = require('../utils/json');

const router = express.Router();

// Helper: ensure table exists (graceful)
async function safe(q, params = []) {
  try { return await db.query(q, params); }
  catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') return [[]];
    throw err;
  }
}

// ============= 1. Partial Payment Deadline =============
router.put('/bookings/:id/payment-deadline', async (req, res) => {
  try {
    const { paymentDeadline, partialOverride, partialSplitPct } = req.body;
    const sets = []; const params = [];
    if (paymentDeadline !== undefined) { sets.push('payment_deadline = ?'); params.push(paymentDeadline ? new Date(paymentDeadline) : null); }
    if (partialOverride !== undefined) { sets.push('partial_override = ?'); params.push(partialOverride ? 1 : 0); }
    if (partialSplitPct !== undefined) { sets.push('partial_split_pct = ?'); params.push(partialSplitPct || null); }
    if (!sets.length) return res.status(400).json({ message: 'Nothing to update' });
    params.push(req.params.id);
    await db.query(`UPDATE bookings SET ${sets.join(', ')} WHERE id = ?`, params);
    res.json({ success: true });
  } catch (err) {
    console.error('[admin-enterprise] set-deadline', err);
    res.status(500).json({ message: 'Failed to update' });
  }
});

// ============= 2. Per-Client Commission =============
router.get('/users/:id/commission', async (req, res) => {
  try {
    const [rows] = await safe('SELECT * FROM user_commission_overrides WHERE user_id = ?', [req.params.id]);
    res.json({ override: rows[0] || null });
  } catch (err) { res.status(500).json({ message: 'Failed' }); }
});

router.put('/users/:id/commission', async (req, res) => {
  try {
    const { discountPct, aitPct, markupPct, notes } = req.body;
    await db.query(
      `INSERT INTO user_commission_overrides (user_id, discount_pct, ait_pct, markup_pct, notes, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE discount_pct = VALUES(discount_pct), ait_pct = VALUES(ait_pct), markup_pct = VALUES(markup_pct), notes = VALUES(notes), updated_by = VALUES(updated_by)`,
      [req.params.id, discountPct ?? null, aitPct ?? null, markupPct ?? null, notes || null, req.user.sub]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[admin-enterprise] commission', err);
    res.status(500).json({ message: 'Failed' });
  }
});

router.delete('/users/:id/commission', async (req, res) => {
  try {
    await db.query('DELETE FROM user_commission_overrides WHERE user_id = ?', [req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ message: 'Failed' }); }
});

// ============= 3. Agent ID Create (full admin-created user) =============
router.post('/users', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password, role, canApproveDeposits, initialWalletBalance } = req.body;
    if (!firstName || !email || !password) {
      return res.status(400).json({ message: 'firstName, email, password required' });
    }
    const [exists] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (exists.length) return res.status(409).json({ message: 'Email already registered' });

    const userId = uuidv4();
    const hashed = await bcrypt.hash(password, 10);
    await db.query(
      `INSERT INTO users (id, first_name, last_name, email, phone, password, role, email_verified, phone_verified, can_approve_deposits, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, NOW())`,
      [userId, firstName, lastName || '', email, phone || null, hashed, role || 'customer', canApproveDeposits ? 1 : 0]
    );

    if (initialWalletBalance && Number(initialWalletBalance) > 0) {
      try {
        await db.query(
          `INSERT INTO transactions (id, user_id, type, amount, status, payment_method, reference, description)
           VALUES (?, ?, 'deposit', ?, 'completed', 'admin_credit', ?, ?)`,
          [uuidv4(), userId, Number(initialWalletBalance), `INIT-${Date.now()}`, `Initial balance set by admin ${req.user.email}`]
        );
      } catch (e) { console.warn('[admin-enterprise] initial wallet skipped:', e.message); }
    }

    res.status(201).json({ success: true, userId, email, tempPassword: password });
  } catch (err) {
    console.error('[admin-enterprise] create user', err);
    res.status(500).json({ message: 'Failed to create user' });
  }
});

// ============= 4. Deposit Approver Permission =============
router.put('/users/:id/permissions', async (req, res) => {
  try {
    const { canApproveDeposits } = req.body;
    await db.query('UPDATE users SET can_approve_deposits = ? WHERE id = ?', [canApproveDeposits ? 1 : 0, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: 'Failed' }); }
});

// ============= 5. Airline Route Restrictions =============
router.get('/airline-restrictions', async (req, res) => {
  try {
    const [rows] = await safe('SELECT * FROM airline_route_restrictions ORDER BY airline_code');
    res.json({ restrictions: rows });
  } catch { res.json({ restrictions: [] }); }
});

router.post('/airline-restrictions', async (req, res) => {
  try {
    const { airlineCode, blockedOriginCountry, blockedDestCountry, allowedOriginCountry, allowedDestCountry, notes } = req.body;
    if (!airlineCode) return res.status(400).json({ message: 'airlineCode required' });
    const id = uuidv4();
    await db.query(
      `INSERT INTO airline_route_restrictions (id, airline_code, blocked_origin_country, blocked_dest_country, allowed_origin_country, allowed_dest_country, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, airlineCode.toUpperCase(), blockedOriginCountry || null, blockedDestCountry || null, allowedOriginCountry || null, allowedDestCountry || null, notes || null]
    );
    res.status(201).json({ success: true, id });
  } catch (err) {
    console.error('[admin-enterprise] add restriction', err);
    res.status(500).json({ message: 'Failed' });
  }
});

router.delete('/airline-restrictions/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM airline_route_restrictions WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ message: 'Failed' }); }
});

module.exports = router;
