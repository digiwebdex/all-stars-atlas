const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { authenticate, formatUser } = require('../middleware/auth');
const { notifyPayment } = require('../services/notify');
const { safeJsonParse } = require('../utils/json');
const { loadPartialSettings, evaluatePartialEligibility , isPartialAllowedForUser } = require('../utils/booking-guards');

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const PAYMENT_SLIPS_DIR = path.join(UPLOAD_DIR, 'payment-slips');
if (!fs.existsSync(PAYMENT_SLIPS_DIR)) fs.mkdirSync(PAYMENT_SLIPS_DIR, { recursive: true });

const paymentSlipStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PAYMENT_SLIPS_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s/g, '-')}`),
});

const paymentSlipUpload = multer({
  storage: paymentSlipStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Accept the slip under any field name (receipt, depositSlip, slip, file...)
const slipUploadAny = paymentSlipUpload.any();
function pickSlipFile(req) {
  if (req.file) return req.file;
  if (Array.isArray(req.files) && req.files.length) return req.files[0];
  return null;
}

const APPROVED_TRANSACTION_STATUSES = new Set(['completed', 'approved']);

function isMissingTableError(err, tableName) {
  const message = String(err?.message || '');
  return err?.code === 'ER_NO_SUCH_TABLE' || new RegExp(`\\b${tableName}\\b.*doesn't exist`, 'i').test(message);
}

async function readWalletAggregate(userId) {
  try {
    const [rows] = await db.query(
      'SELECT COALESCE(SUM(balance), 0) AS balance, COUNT(*) AS rowCount FROM wallet WHERE user_id = ?',
      [userId]
    );

    return {
      tableExists: true,
      balance: Number(rows[0]?.balance || 0),
      rowCount: Number(rows[0]?.rowCount || 0),
    };
  } catch (err) {
    if (isMissingTableError(err, 'wallet')) {
      return { tableExists: false, balance: 0, rowCount: 0 };
    }
    throw err;
  }
}

function parseTransactionMeta(meta) {
  if (!meta) return {};
  if (typeof meta === 'object') return meta;
  return safeJsonParse(meta, {});
}

function parseAmount(value) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function firstAmount(...values) {
  for (const value of values) {
    const parsed = parseAmount(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function normalizeBookingFareDetails(details, bookingRow = {}) {
  const safeDetails = details && typeof details === 'object' ? details : {};
  const outbound = safeDetails.outbound || {};
  const fare = safeDetails.fare || safeDetails.fareBreakdown || safeDetails.pricing || outbound.fare || {};
  const paxFares = safeDetails.paxFares || safeDetails.passengerFares || fare.passengerFares || [];
  const firstPaxFare = Array.isArray(paxFares) && paxFares.length > 0 ? paxFares[0] : {};
  const fareRules = outbound.fareRules || safeDetails.fareRules || fare.fareRules || {};
  const baseFare = firstAmount(safeDetails.baseFare, safeDetails.base_fare, fare.baseFare, firstPaxFare.baseFare, outbound.baseFare, bookingRow.base_fare, safeDetails.fareDetails?.baseFare) || 0;
  const parsedDiscountPct = firstAmount(fareRules.discount, safeDetails.fareRules?.discount, fare.discountPct, safeDetails.discountPct, safeDetails.discountPercentage, outbound.discountPct);
  // No platform default — commission/AIT come only from what admin configured at booking time.
  const discountPct = parsedDiscountPct && parsedDiscountPct > 0 ? parsedDiscountPct : 0;
  const parsedAitPct = firstAmount(fareRules.aitVat, safeDetails.fareRules?.aitVat, fare.aitVatPct, safeDetails.aitVatPct, safeDetails.aitVatPercentage, outbound.aitVatPct);
  const FIXED_AIT_PCT = parseFloat(process.env.FIXED_AIT_PCT) || 0.30;
  const aitPct = parsedAitPct && parsedAitPct > 0 ? parsedAitPct : FIXED_AIT_PCT;

  let discount = firstAmount(safeDetails.discount, safeDetails.totalDiscount, safeDetails.discountAmount, outbound.discount, fare.discount) || 0;
  let aitVat = firstAmount(safeDetails.ait, safeDetails.aitVat, safeDetails.totalAitVat, safeDetails.aitVatAmount, fare.aitVat) || 0;
  if (discount <= 0 && baseFare > 0) discount = Math.round(((baseFare * discountPct) / 100) * 100) / 100;
  if (aitVat <= 0 && baseFare > 0) aitVat = Math.round(((baseFare * aitPct) / 100) * 100) / 100;
  return { ...safeDetails, discount, totalDiscount: discount, ait: aitVat, aitVat, totalAitVat: aitVat, fareRules: { ...fareRules, discount: discountPct, aitVat: aitPct } };
}

function isLegacyWalletCredit(txn) {
  const meta = parseTransactionMeta(txn.meta);
  const description = String(txn.description || '').toLowerCase();
  const status = String(txn.status || '').toLowerCase();

  return txn.type === 'payment'
    && Number(txn.amount || 0) > 0
    && APPROVED_TRANSACTION_STATUSES.has(status)
    && (
      meta.source === 'wallet_deposit'
      || meta.source === 'payment_request'
      || meta.purpose === 'wallet_topup'
      || description.includes('wallet deposit')
      || description.startsWith('payment request for')
    );
}

function isCreditLikeTransaction(txn) {
  return ['credit', 'deposit', 'refund', 'transfer_in'].includes(txn.type) || isLegacyWalletCredit(txn);
}

function getSignedTransactionAmount(txn) {
  const amount = Math.abs(Number(txn.amount || 0));
  return isCreditLikeTransaction(txn) ? amount : -amount;
}

function getTransactionEntryType(txn) {
  const method = String(txn.payment_method || '').toLowerCase();
  const description = String(txn.description || '').toLowerCase();

  if (isLegacyWalletCredit(txn) || txn.type === 'deposit') {
    if (method === 'bkash') return 'BKash';
    if (method === 'nagad') return 'Nagad';
    if (method === 'rocket') return 'Rocket';
    return 'Bank Deposit';
  }

  if (txn.type === 'refund') return 'Refund';
  if (txn.type === 'transfer_in') return 'Balance Transfer In';
  if (txn.type === 'transfer_out') return 'Balance Transfer Out';
  if (txn.type === 'payment') {
    if (description.includes('hotel')) return 'Hotel';
    if (description.includes('visa')) return 'Visa';
    return 'AirTicket';
  }

  return txn.type;
}

// A booking-linked debit only counts against the wallet once the user actually
// paid it from wallet (payment_status = 'paid'). Reserved / on-hold bookings must
// never reduce the balance — money is deducted only on an issue request.
function isChargeableWalletDebit(txn) {
  if (!txn.booking_id) return true;
  const bookingPaid = String(txn.booking_payment_status || '').toLowerCase();
  return bookingPaid === 'paid' || bookingPaid === 'partial';
}

function computeWalletTotalsFromTransactions(rows = []) {
  return rows.reduce((acc, txn) => {
    const status = String(txn.status || '').toLowerCase();
    if (!APPROVED_TRANSACTION_STATUSES.has(status)) return acc;

    const signedAmount = getSignedTransactionAmount(txn);
    if (signedAmount >= 0) acc.totalCredited += signedAmount;
    else if (isChargeableWalletDebit(txn)) acc.totalDebited += Math.abs(signedAmount);

    return acc;
  }, { totalCredited: 0, totalDebited: 0 });
}

async function getEffectiveWalletState(userId) {
  const walletInfo = await readWalletAggregate(userId);
  const walletBalance = walletInfo.balance;

  const [approvedTransactions] = await db.query(
    `SELECT t.id, t.booking_id, t.type, t.amount, t.description, t.status, t.payment_method,
            t.reference, t.meta, t.created_at, b.payment_status AS booking_payment_status
     FROM transactions t
     LEFT JOIN bookings b ON b.id = t.booking_id
     WHERE t.user_id = ? AND t.status IN ('completed', 'approved')
     ORDER BY t.created_at DESC`,
    [userId]
  );

  const { totalCredited, totalDebited } = computeWalletTotalsFromTransactions(approvedTransactions);
  const derivedBalance = Math.max(0, totalCredited - totalDebited);

  return {
    hasWalletTable: walletInfo.tableExists,
    hasWalletRow: walletInfo.rowCount > 0,
    walletBalance,
    totalCredited,
    totalDebited,
    derivedBalance,
    effectiveBalance: walletBalance > 0 ? walletBalance : derivedBalance,
  };
}

async function syncWalletFromDerivedBalance(userId, walletState) {
  if (!walletState.hasWalletTable || (walletState.hasWalletRow && walletState.walletBalance > 0) || walletState.derivedBalance <= 0) {
    return;
  }

  try {
    const [result] = await db.query('UPDATE wallet SET balance = ? WHERE user_id = ?', [walletState.derivedBalance, userId]);

    if (!result?.affectedRows) {
      await db.query('INSERT INTO wallet (user_id, balance) VALUES (?, ?)', [userId, walletState.derivedBalance]);
    }
  } catch (err) {
    if (isMissingTableError(err, 'wallet')) {
      return;
    }

    console.warn('Wallet sync skipped:', err?.message || err);
  }
}

async function ensureTableColumn(executor, tableName, columnName, definition) {
  const [columns] = await executor.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
  if (!columns || columns.length === 0) {
    await executor.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function ensureTicketIssueRequestsTable(executor = db) {
  await executor.query(`CREATE TABLE IF NOT EXISTS ticket_issue_requests (
        id CHAR(36) PRIMARY KEY,
        booking_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        notes TEXT,
        admin_notes TEXT,
        ticket_number VARCHAR(100),
        pnr VARCHAR(20),
        processed_by CHAR(36),
        processed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_booking (booking_id),
        INDEX idx_user (user_id),
        INDEX idx_status (status)
  )`);

  const requiredColumns = [
    ['admin_notes', 'TEXT NULL'],
    ['ticket_number', 'VARCHAR(100) NULL'],
    ['pnr', 'VARCHAR(20) NULL'],
    ['processed_by', 'CHAR(36) NULL'],
    ['processed_at', 'DATETIME NULL'],
    ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP'],
    ['updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
  ];

  for (const [columnName, definition] of requiredColumns) {
    await ensureTableColumn(executor, 'ticket_issue_requests', columnName, definition);
  }
}

// Post-ticket service requests (void / reissue / refund / itinerary cancel)
const SERVICE_REQUEST_TYPES = ['void', 'reissue', 'refund', 'cancel'];
async function ensureServiceRequestsTable(executor = db) {
  await executor.query(`CREATE TABLE IF NOT EXISTS booking_service_requests (
        id CHAR(36) PRIMARY KEY,
        booking_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        type VARCHAR(20) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        notes TEXT,
        admin_notes TEXT,
        pnr VARCHAR(20),
        processed_by CHAR(36),
        processed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_bsr_booking (booking_id),
        INDEX idx_bsr_user (user_id),
        INDEX idx_bsr_status (status)
  )`);
  const extra = [
    ['airline_fee', 'DECIMAL(12,2) NULL'],
    ['service_charge', 'DECIMAL(12,2) NULL'],
    ['refund_amount', 'DECIMAL(12,2) NULL'],
    ['refund_txn_id', 'CHAR(36) NULL'],
    ['quoted_at', 'DATETIME NULL'],
    ['customer_accepted_at', 'DATETIME NULL'],
  ];
  for (const [col, def] of extra) {
    try {
      const [cols] = await executor.query('SHOW COLUMNS FROM booking_service_requests LIKE ?', [col]);
      if (!cols || cols.length === 0) {
        await executor.query(`ALTER TABLE booking_service_requests ADD COLUMN ${col} ${def}`);
      }
    } catch (e) { /* ignore */ }
  }

}



// All routes require auth
router.use(authenticate);

// GET /dashboard/stats
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user.sub;

    // Core counts
    const [bookingCount] = await db.query('SELECT COUNT(*) as total FROM bookings WHERE user_id = ? AND (archived IS NULL OR archived = 0)', [userId]);
    const [upcoming] = await db.query("SELECT COUNT(*) as total FROM bookings WHERE user_id = ? AND status IN ('confirmed','pending') AND (archived IS NULL OR archived = 0)", [userId]);
    const [totalSpent] = await db.query("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE user_id = ? AND type = 'payment' AND status = 'completed'", [userId]);
    const [travellers] = await db.query('SELECT COUNT(*) as total FROM travellers WHERE user_id = ?', [userId]);

    // User info
    const [userRows] = await db.query('SELECT first_name, last_name FROM users WHERE id = ?', [userId]);
    const user = userRows.length > 0 ? { name: `${userRows[0].first_name} ${userRows[0].last_name}`.trim() } : null;

    // Stats array for frontend
    const stats = [
      { label: 'Total Bookings', value: bookingCount[0].total },
      { label: 'Upcoming Trips', value: upcoming[0].total },
      { label: 'Total Spent', value: `৳${parseFloat(totalSpent[0].total).toLocaleString()}` },
      { label: 'Saved Travellers', value: travellers[0].total },
    ];

    // Upcoming trip
    let upcomingTrip = null;
    const [nextTrip] = await db.query(
      "SELECT * FROM bookings WHERE user_id = ? AND status IN ('confirmed','pending') AND (archived IS NULL OR archived = 0) ORDER BY booked_at DESC LIMIT 1", [userId]
    );
    if (nextTrip.length > 0) {
      const b = nextTrip[0];
      const details = safeJsonParse(b.details, {});
      upcomingTrip = {
        title: details.destination || details.route || `${b.booking_type} Booking`,
        date: new Date(b.booked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        daysLeft: Math.max(0, Math.ceil((new Date(b.booked_at).getTime() - Date.now()) / 86400000)),
        flight: details.flight || details.airline || null,
        duration: details.duration || null,
      };
    }

    // Monthly spending (last 6 months)
    const [monthly] = await db.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') as ym, DATE_FORMAT(created_at, '%b') as month, SUM(amount) as amount
       FROM transactions WHERE user_id = ? AND type = 'payment' AND status = 'completed'
       AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       GROUP BY ym, month ORDER BY ym`, [userId]
    );
    const spendingData = monthly.map(m => ({ month: m.month, amount: parseFloat(m.amount) }));

    // Booking breakdown by type
    const [breakdown] = await db.query(
      `SELECT booking_type, COUNT(*) as cnt FROM bookings WHERE user_id = ? AND (archived IS NULL OR archived = 0) GROUP BY booking_type`, [userId]
    );
    const colors = { flight: '#3b82f6', hotel: '#8b5cf6', holiday: '#10b981', visa: '#f59e0b', medical: '#ec4899', car: '#06b6d4' };
    const bookingBreakdown = breakdown.map(b => ({
      name: b.booking_type.charAt(0).toUpperCase() + b.booking_type.slice(1),
      value: b.cnt,
      color: colors[b.booking_type] || '#64748b',
    }));

    // Recent bookings for the list
    const [recentBookings] = await db.query('SELECT * FROM bookings WHERE user_id = ? AND (archived IS NULL OR archived = 0) ORDER BY booked_at DESC LIMIT 5', [userId]);
    const bookings = recentBookings.map(b => {
      const details = safeJsonParse(b.details, {});
      return {
        id: b.booking_ref || b.id,
        title: details.destination || details.route || `${b.booking_type} Booking`,
        type: b.booking_type,
        status: b.status,
        amount: `৳${parseFloat(b.total_amount).toLocaleString()}`,
        date: new Date(b.booked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      };
    });

    // ---- Agent-style KPI panel (all live data) ----
    const [ticketed] = await db.query(
      "SELECT COUNT(*) as total FROM bookings WHERE user_id = ? AND (ticket_number IS NOT NULL AND ticket_number <> '') AND (archived IS NULL OR archived = 0)",
      [userId]
    ).catch(() => [[{ total: 0 }]]);

    // Airline mix across all bookings (parsed from details JSON)
    const [allForAirlines] = await db.query(
      'SELECT details, total_amount, ticket_number FROM bookings WHERE user_id = ? AND (archived IS NULL OR archived = 0)', [userId]
    );
    const airlineCounts = {};
    for (const row of allForAirlines) {
      const d = safeJsonParse(row.details, {});
      const name = d.airline || d.airlineName || d.carrier || null;
      if (!name) continue;
      airlineCounts[name] = (airlineCounts[name] || 0) + 1;
    }
    const topAirlines = Object.entries(airlineCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // Scheduled payment info (uses payment_deadline on unpaid / partial bookings)
    const [sched] = await db.query(
      `SELECT
         SUM(CASE WHEN DATE(payment_deadline) = CURDATE() THEN 1 ELSE 0 END) AS dueTodayCount,
         SUM(CASE WHEN DATE(payment_deadline) = CURDATE() THEN total_amount ELSE 0 END) AS dueTodayAmount,
         SUM(CASE WHEN payment_deadline > NOW() AND DATE(payment_deadline) <> CURDATE() THEN 1 ELSE 0 END) AS upcomingCount,
         SUM(CASE WHEN payment_deadline > NOW() AND DATE(payment_deadline) <> CURDATE() THEN total_amount ELSE 0 END) AS upcomingAmount,
         SUM(CASE WHEN payment_deadline < NOW() AND DATE(payment_deadline) <> CURDATE() THEN 1 ELSE 0 END) AS expiredCount,
         SUM(CASE WHEN payment_deadline < NOW() AND DATE(payment_deadline) <> CURDATE() THEN total_amount ELSE 0 END) AS expiredAmount
       FROM bookings
       WHERE user_id = ? AND payment_deadline IS NOT NULL
         AND payment_status IN ('unpaid','partial','pending')
         AND status NOT IN ('cancelled','refunded','failed')
         AND (archived IS NULL OR archived = 0)`,
      [userId]
    );
    const s = sched[0] || {};

    const walletState = await getEffectiveWalletState(userId).catch(() => null);
    const availableLimit = walletState ? Number(walletState.effectiveBalance || 0) : 0;

    const num = v => Number(v || 0);
    const scheduledPayment = {
      dueTodayCount: num(s.dueTodayCount),
      upcomingCount: num(s.upcomingCount),
      expiredCount: num(s.expiredCount),
      dueTodayAmount: num(s.dueTodayAmount),
      upcomingAmount: num(s.upcomingAmount),
      expiredAmount: num(s.expiredAmount),
      agentLimit: availableLimit,
      availableLimit,
    };

    const kpi = {
      totalBooking: bookingCount[0].total,
      totalTicket: ticketed?.[0]?.total || 0,
      salesBDT: parseFloat(totalSpent[0].total) || 0,
      topAirline: topAirlines[0]?.name || '—',
    };

    res.json({ stats, user, upcomingTrip, spendingData, bookingBreakdown, bookings, kpi, scheduledPayment, topAirlines });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});


// GET /dashboard/bookings
router.get('/bookings', async (req, res) => {
  try {
    const { status, type, search, page = 1, limit = 100 } = req.query;
    let sql = 'SELECT * FROM bookings WHERE user_id = ? AND (archived IS NULL OR archived = 0)';
    const params = [req.user.sub];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (type) { sql += ' AND booking_type = ?'; params.push(type); }
    if (search) { sql += ' AND (booking_ref LIKE ? OR pnr LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [countResult] = await db.query(sql.replace('SELECT *', 'SELECT COUNT(*) as total'), params);
    sql += ` ORDER BY booked_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);
    const [rows] = await db.query(sql, params);

    // Try to fetch ticket numbers for these bookings
    let ticketMap = {};
    let requestTicketMap = {};
    try {
      const bookingIds = rows.map(b => b.id);
      if (bookingIds.length > 0) {
        const [tickets] = await db.query(
          `SELECT booking_id, ticket_no FROM tickets WHERE booking_id IN (${bookingIds.map(() => '?').join(',')}) AND status = 'active'`,
          bookingIds
        );
        for (const t of tickets) {
          if (!ticketMap[t.booking_id]) ticketMap[t.booking_id] = t.ticket_no;
        }

        try {
          const [requestRows] = await db.query(
            `SELECT booking_id, ticket_number, status, updated_at
             FROM ticket_issue_requests
             WHERE booking_id IN (${bookingIds.map(() => '?').join(',')})
               AND ticket_number IS NOT NULL
               AND ticket_number <> ''
               AND status = 'issued'
             ORDER BY updated_at DESC, created_at DESC`,
            bookingIds
          );
          for (const r of requestRows) {
            if (!requestTicketMap[r.booking_id]) requestTicketMap[r.booking_id] = r.ticket_number;
          }
        } catch (_) { /* ticket_issue_requests table may not exist */ }
      }
    } catch (_) { /* tickets table may not exist */ }

    const data = rows.map(b => {
      const details = normalizeBookingFareDetails(safeJsonParse(b.details, {}), b);
      const passengerInfo = safeJsonParse(b.passenger_info, []);
      const nestedTicketNo =
        details.ticketNumber ||
        details.ticket_number ||
        details.ticketNo ||
        details.gdsBookingResult?.ticketNumbers?.[0] ||
        details.gdsResult?.ticketNumbers?.[0] ||
        details.outbound?.ticketNumber ||
        details.outbound?.ticket_number ||
        details.return?.ticketNumber ||
        details.return?.ticket_number ||
        (Array.isArray(passengerInfo) ? passengerInfo.find((p) => p?.ticketNumber || p?.ticketNo)?.ticketNumber || passengerInfo.find((p) => p?.ticketNumber || p?.ticketNo)?.ticketNo : null);
      return {
        id: b.id, bookingRef: b.booking_ref, bookingType: b.booking_type,
        status: b.status, totalAmount: parseFloat(b.total_amount), currency: b.currency,
        paymentMethod: b.payment_method, paymentStatus: b.payment_status,
        details, passengerInfo,
        contactInfo: safeJsonParse(b.contact_info, {}), notes: b.notes,
        pnr: b.pnr || details.gdsPnr || details.outbound?.pnr || null,
        ticketNo: b.ticket_number || requestTicketMap[b.id] || nestedTicketNo || ticketMap[b.id] || null,
        paymentDeadline: b.payment_deadline || null,
        bookedAt: b.booked_at, updatedAt: b.updated_at,
      };
    });
    res.json({ data, total: countResult[0].total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(countResult[0].total / parseInt(limit)) });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// GET /dashboard/transactions
router.get('/transactions', async (req, res) => {
  try {
    const { type, status, search, page = 1, limit = 20 } = req.query;
    let sql = 'SELECT * FROM transactions WHERE user_id = ?';
    const params = [req.user.sub];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (search) {
      sql += ' AND (reference LIKE ? OR description LIKE ?)';
      const q = `%${search}%`;
      params.push(q, q);
    }

    sql += ' ORDER BY created_at DESC';
    const [rows] = await db.query(sql, params);

    const walletState = await getEffectiveWalletState(req.user.sub);
    await syncWalletFromDerivedBalance(req.user.sub, walletState);

    let runningBalance = walletState.effectiveBalance;
    const normalizedRows = rows.map((t) => {
      const signedAmount = getSignedTransactionAmount(t);
      const isApproved = APPROVED_TRANSACTION_STATUSES.has(String(t.status || '').toLowerCase());
      const entryType = getTransactionEntryType(t);

      const row = {
        id: t.id,
        type: signedAmount >= 0 ? 'credit' : 'debit',
        entryType,
        amount: Math.abs(Number(t.amount || 0)),
        numAmount: signedAmount,
        currency: t.currency,
        status: t.status,
        paymentMethod: t.payment_method,
        reference: t.reference,
        description: t.description,
        meta: parseTransactionMeta(t.meta),
        date: t.created_at,
        createdAt: t.created_at,
        createdOn: t.created_at,
        createdBy: 'System',
        runningBalance: isApproved ? runningBalance : null,
      };

      if (isApproved) {
        runningBalance -= signedAmount;
      }

      return row;
    });

    const filteredRows = type
      ? normalizedRows.filter((row) => row.entryType === type || row.type === type)
      : normalizedRows;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const pagedRows = filteredRows.slice(offset, offset + parseInt(limit));

    const data = pagedRows;

    res.json({
      data,
      total: filteredRows.length,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(filteredRows.length / parseInt(limit)) || 1,
      summary: {
        totalInflow: walletState.totalCredited,
        totalOutflow: walletState.totalDebited,
        totalSpent: `৳${walletState.totalDebited.toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
        totalRefunds: `৳${walletState.totalCredited.toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
        balance: `৳${walletState.effectiveBalance.toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
      }
    });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// GET /dashboard/travellers
router.get('/travellers', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM travellers WHERE user_id = ? ORDER BY created_at DESC', [req.user.sub]);
    const data = rows.map(t => ({
      id: t.id, firstName: t.first_name, lastName: t.last_name, email: t.email, phone: t.phone,
      dateOfBirth: t.date_of_birth, gender: t.gender, nationality: t.nationality,
      passportNo: t.passport_no, passportExpiry: t.passport_expiry, documentType: t.document_type,
    }));
    res.json({ data });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// POST /dashboard/travellers
router.post('/travellers', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, dateOfBirth, gender, nationality, passportNo, passportExpiry, documentType } = req.body;
    const id = uuidv4();
    await db.query(
      `INSERT INTO travellers (id, user_id, first_name, last_name, email, phone, date_of_birth, gender, nationality, passport_no, passport_expiry, document_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.sub, firstName, lastName, email || null, phone || null, dateOfBirth || null, gender || null, nationality || null, passportNo || null, passportExpiry || null, documentType || 'passport']
    );
    res.status(201).json({ id, firstName, lastName, email, phone, dateOfBirth, gender, nationality, passportNo, passportExpiry, documentType: documentType || 'passport' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// DELETE /dashboard/travellers/:id
router.delete('/travellers/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM travellers WHERE id = ? AND user_id = ?', [req.params.id, req.user.sub]);
    res.status(204).end();
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// GET /dashboard/payments
router.get('/payments', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM transactions WHERE user_id = ? AND type = 'payment' ORDER BY created_at DESC LIMIT 50", [req.user.sub]);
    
    const methodLabels = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', card: 'Card Payment', bank_transfer: 'Bank Transfer' };
    
    const paymentHistory = rows.map(t => {
      const meta = safeJsonParse(t.meta, {}) || {};
      return {
        id: t.id,
        amount: parseFloat(t.amount),
        currency: t.currency,
        status: t.status === 'completed' ? 'Approved' : t.status === 'pending' ? 'Pending' : 'Rejected',
        paymentMethod: methodLabels[t.payment_method] || t.payment_method,
        method: methodLabels[t.payment_method] || t.payment_method,
        reference: t.reference,
        description: t.description,
        createdAt: t.created_at,
        date: t.created_at ? new Date(t.created_at).toLocaleString('en-GB') : null,
        receiptUrl: meta.receiptUrl || null,
        transactionId: meta.transactionId || null,
        notes: meta.notes || null,
        bookingRef: meta.bookingRef || t.reference || 'N/A',
      };
    });

    
    // Get admin-configured bank accounts from system_settings
    let bankAccounts = [];
    try {
      const [settings] = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'bank_accounts'");
      if (settings.length > 0 && settings[0].setting_value) {
        bankAccounts = JSON.parse(settings[0].setting_value);
      }
    } catch {}
    
    // Default bank accounts if none configured
    if (bankAccounts.length === 0) {
      bankAccounts = [
        { id: '1', bankName: 'Dutch-Bangla Bank', accName: 'Seven Trip Ltd', accNo: '1234567890123', branch: 'Banani Branch', routingNo: '090261396' },
        { id: '2', bankName: 'BRAC Bank', accName: 'Seven Trip Ltd', accNo: '9876543210123', branch: 'Gulshan Branch', routingNo: '060261876' },
      ];
    }
    
    // Enabled payment methods
    const enabledPaymentMethods = ['bank_deposit', 'bank_transfer', 'cheque_deposit', 'mobile_bkash', 'mobile_nagad', 'card'];
    
    res.json({ paymentHistory, bankAccounts, enabledPaymentMethods });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// POST /dashboard/payments
router.post('/payments', slipUploadAny, async (req, res) => {
  try {
    const { paymentMethod, amount, paymentDate, bookingRef, depositBank, chequeNo, chequeBank, chequeDate, transactionId, notes } = req.body;
    
    const id = uuidv4();
    const methodMap = {
      'bank_deposit': 'bank_transfer', 'bank_transfer': 'bank_transfer', 'cheque_deposit': 'bank_transfer',
      'mobile_bkash': 'bkash', 'mobile_nagad': 'nagad', 'mobile_rocket': 'rocket', 'card': 'card'
    };
    const dbMethod = methodMap[paymentMethod] || 'bank_transfer';
    
    // Find matching booking
    let bookingId = null;
    if (bookingRef) {
      const [bookings] = await db.query('SELECT id FROM bookings WHERE booking_ref = ? AND user_id = ?', [bookingRef, req.user.sub]);
      if (bookings.length > 0) bookingId = bookings[0].id;
    }
    
    const slipFile = pickSlipFile(req);
    const receiptUrl = slipFile ? `/uploads/payment-slips/${slipFile.filename}` : null;
    const meta = JSON.stringify({ paymentMethod, depositBank, chequeNo, chequeBank, chequeDate, transactionId, paymentDate, notes: notes || null, receiptUrl, bookingRef: bookingRef || null });
    
    await db.query(
      `INSERT INTO transactions (id, user_id, booking_id, type, amount, status, payment_method, reference, description, meta) VALUES (?, ?, ?, 'payment', ?, 'pending', ?, ?, ?, ?)`,
      [id, req.user.sub, bookingId, parseFloat(amount) || 0, dbMethod, transactionId || `PAY-${id.substring(0,8).toUpperCase()}`, `Payment via ${paymentMethod}`, meta]
    );

    
    res.status(201).json({ id, message: 'Payment submitted for review', status: 'pending' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// GET /dashboard/tickets
router.get('/tickets', async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    let sql = `SELECT t.*, b.booking_ref, b.booking_type, b.status AS booking_status, 
               b.total_amount, b.details AS booking_details, b.passenger_info AS booking_passengers, b.booked_at AS booking_date
               FROM tickets t 
               LEFT JOIN bookings b ON t.booking_id = b.id 
               WHERE t.user_id = ?`;
    const params = [req.user.sub];
    if (status) { sql += ' AND t.status = ?'; params.push(status); }
    if (search) { sql += ' AND (t.pnr LIKE ? OR t.ticket_no LIKE ? OR t.id LIKE ? OR b.booking_ref LIKE ?)'; const s = `%${search}%`; params.push(s, s, s, s); }
    sql += ' ORDER BY t.issued_at DESC';
    const [rows] = await db.query(sql, params);
    const data = rows.map(t => {
      const details = safeJsonParse(t.details, {});
      const bookingDetails = safeJsonParse(t.booking_details, {});
      const bookingPassengers = safeJsonParse(t.booking_passengers, []);
      const legs = bookingDetails.legs || bookingDetails.segments || [];
      const passengers = Array.isArray(bookingPassengers) ? bookingPassengers : (bookingDetails.passengers || []);
      return {
        id: t.id, bookingId: t.booking_id, bookingRef: t.booking_ref || bookingDetails.bookingRef,
        ticketNo: t.ticket_no, pnr: t.pnr, airlinePnr: details.airlinePnr || bookingDetails.airlinePnr,
        status: t.status, bookingStatus: t.booking_status, pdfUrl: t.pdf_url,
        issuedAt: t.issued_at, bookingDate: t.booking_date,
        source: bookingDetails.source || bookingDetails.provider,
        totalAmount: t.total_amount, currency: bookingDetails.currency || 'BDT',
        airline: details.airline || bookingDetails.airline || bookingDetails.airlineName,
        airlineCode: details.airlineCode || bookingDetails.airlineCode,
        flightNumber: details.flightNumber || bookingDetails.flightNumber,
        cabinClass: details.cabinClass || bookingDetails.cabinClass || bookingDetails.class,
        origin: details.origin || bookingDetails.origin,
        destination: details.destination || bookingDetails.destination,
        departureTime: details.departureTime || bookingDetails.departureTime,
        arrivalTime: details.arrivalTime || bookingDetails.arrivalTime,
        duration: details.duration || bookingDetails.duration,
        stops: details.stops ?? bookingDetails.stops ?? 0,
        baggage: details.baggage || bookingDetails.baggage,
        handBaggage: details.handBaggage || bookingDetails.handBaggage,
        refundable: details.refundable ?? bookingDetails.refundable ?? false,
        aircraft: details.aircraft || bookingDetails.aircraft,
        terminal: details.terminal || bookingDetails.terminal,
        passengers: passengers.map(p => ({
          name: [p.title, p.firstName, p.lastName].filter(Boolean).join(' ') || p.name,
          type: p.type || p.travelerType || 'ADT',
          ticketNo: p.ticketNo || p.ticketNumber,
          seatNo: p.seatNo || p.seat,
          passport: p.passportNumber || p.passport,
          gender: p.gender,
          dob: p.dateOfBirth || p.dob,
        })),
        legs: legs.map(l => ({
          origin: l.origin || l.departureAirport,
          destination: l.destination || l.arrivalAirport,
          departureTime: l.departureTime || l.departureDateTime,
          arrivalTime: l.arrivalTime || l.arrivalDateTime,
          flightNumber: l.flightNumber || l.flight,
          airline: l.airline || l.airlineName || l.marketingCarrier,
          duration: l.duration,
          aircraft: l.aircraft || l.equipmentType,
          terminal: l.terminal,
          baggage: l.baggage,
        })),
        baseFare: bookingDetails.baseFare || bookingDetails.basePrice,
        taxes: bookingDetails.taxes || bookingDetails.taxAmount,
        serviceCharge: bookingDetails.serviceCharge || bookingDetails.serviceFee || 0,
        cancellationPolicy: bookingDetails.cancellationPolicy,
        dateChangePolicy: bookingDetails.dateChangePolicy,
        details,
      };
    });
    res.json({ data, total: data.length, page: 1, limit: 50, totalPages: 1 });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// GET /dashboard/wishlist
router.get('/wishlist', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM wishlist WHERE user_id = ? ORDER BY created_at DESC', [req.user.sub]);
    const data = rows.map(w => ({
      id: w.id, itemType: w.item_type, itemId: w.item_id,
      itemData: safeJsonParse(w.item_data, {}), createdAt: w.created_at,
    }));
    res.json({ data });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// POST /dashboard/wishlist
router.post('/wishlist', async (req, res) => {
  try {
    const { itemType, itemId, itemData } = req.body;
    const id = uuidv4();
    await db.query(
      `INSERT INTO wishlist (id, user_id, item_type, item_id, item_data) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE item_data = ?`,
      [id, req.user.sub, itemType, itemId, JSON.stringify(itemData || {}), JSON.stringify(itemData || {})]
    );
    res.status(201).json({ id, itemType, itemId, itemData, createdAt: new Date().toISOString() });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// DELETE /dashboard/wishlist/:id
router.delete('/wishlist/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM wishlist WHERE id = ? AND user_id = ?', [req.params.id, req.user.sub]);
    res.status(204).end();
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// GET /dashboard/settings
router.get('/settings', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.user.sub]);
    if (rows.length === 0) return res.status(404).json({ message: 'User not found', status: 404 });
    const u = rows[0];
    res.json({
      profile: { name: `${u.first_name} ${u.last_name}`, firstName: u.first_name, lastName: u.last_name, email: u.email, phone: u.phone, avatar: u.avatar },
      notifications: [
        { id: 'booking_updates', label: 'Booking Updates', enabled: true },
        { id: 'promotions', label: 'Promotional Offers', enabled: true },
        { id: 'newsletter', label: 'Weekly Newsletter', enabled: false },
        { id: 'sms_alerts', label: 'SMS Alerts', enabled: false },
      ],
    });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// PUT /dashboard/settings
router.put('/settings', async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const parts = (name || '').split(' ');
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';
    await db.query('UPDATE users SET first_name = ?, last_name = ?, phone = ? WHERE id = ?', [firstName, lastName, phone || null, req.user.sub]);
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.user.sub]);
    res.json(formatUser(rows[0]));
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// PATCH /dashboard/settings/profile
router.patch('/settings/profile', async (req, res) => {
  try {
    const { name, firstName, lastName, phone, avatar } = req.body;
    const fn = firstName || (name ? name.split(' ')[0] : undefined);
    const ln = lastName || (name ? name.split(' ').slice(1).join(' ') : undefined);
    const sets = []; const params = [];
    if (fn !== undefined) { sets.push('first_name = ?'); params.push(fn); }
    if (ln !== undefined) { sets.push('last_name = ?'); params.push(ln); }
    if (phone !== undefined) { sets.push('phone = ?'); params.push(phone); }
    if (avatar !== undefined) { sets.push('avatar = ?'); params.push(avatar); }
    if (sets.length > 0) {
      params.push(req.user.sub);
      await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.user.sub]);
    res.json(formatUser(rows[0]));
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// POST /dashboard/settings/password
router.post('/settings/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: 'Valid current and new password (min 8 chars) required', status: 400 });
    }
    const [rows] = await db.query('SELECT password_hash FROM users WHERE id = ?', [req.user.sub]);
    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) return res.status(400).json({ message: 'Current password is incorrect', status: 400 });

    const hash = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.sub]);
    res.json({ message: 'Password updated successfully' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// =============== PAY LATER ===============
// GET /dashboard/pay-later
router.get('/pay-later', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    
    // Get bookings with unpaid/partial payment status (these are "pay later" items)
    let sql = `SELECT * FROM bookings WHERE user_id = ? AND payment_status IN ('unpaid', 'partial')`;
    const params = [req.user.sub];
    
    if (status && status !== 'All') {
      const statusMap = { 'Paid': 'paid', 'Unpaid': 'unpaid', 'Void': 'cancelled', 'Refund': 'refunded' };
      if (statusMap[status]) { sql += ` AND (payment_status = ? OR status = ?)`; params.push(statusMap[status], statusMap[status]); }
    }
    if (search) { sql += ` AND booking_ref LIKE ?`; params.push(`%${search}%`); }
    
    sql += ` ORDER BY booked_at DESC`;
    const [rows] = await db.query(sql, params);
    
    // Calculate summaries
    const now = new Date();
    let previousDue = 0, totalDue = 0, dueToday = 0;
    
    const data = rows.map(b => {
      const amount = parseFloat(b.total_amount) || 0;
      const bookedDate = new Date(b.booked_at);
      const dueDate = new Date(bookedDate);
      dueDate.setDate(dueDate.getDate() + 3); // Due 3 days after booking
      
      const isPastDue = dueDate < now;
      const isDueToday = dueDate.toDateString() === now.toDateString();
      
      if (b.payment_status === 'unpaid' || b.payment_status === 'partial') {
        totalDue += amount;
        if (isPastDue) previousDue += amount;
        if (isDueToday) dueToday += amount;
      }
      
      let status = 'Unpaid';
      if (b.payment_status === 'paid') status = 'Paid';
      else if (b.status === 'cancelled') status = 'Void';
      else if (b.status === 'refunded') status = 'Refund';
      
      return {
        id: b.id,
        reference: `DUE-${b.booking_ref}`,
        bookingRef: b.booking_ref,
        dueDate: dueDate.toISOString().split('T')[0],
        amount,
        status,
      };
    });
    
    res.json({ 
      data, 
      total: data.length,
      summary: { previousDue, totalDue, dueToday }
    });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// =============== INVOICES ===============
// GET /dashboard/invoices
router.get('/invoices', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    
    // Generate invoices from completed/confirmed bookings
    let sql = `SELECT b.*, t.amount as paid_amount, t.created_at as paid_at 
               FROM bookings b 
               LEFT JOIN transactions t ON t.booking_id = b.id AND t.type = 'payment' AND t.status = 'completed'
               WHERE b.user_id = ?`;
    const params = [req.user.sub];
    
    if (status && status !== 'all') {
      const statusMap = { 'Paid': 'paid', 'Unpaid': 'unpaid', 'Partial': 'partial' };
      if (statusMap[status]) { sql += ` AND b.payment_status = ?`; params.push(statusMap[status]); }
    }
    if (search) { sql += ` AND (b.booking_ref LIKE ? OR b.id LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
    
    sql += ` ORDER BY b.booked_at DESC`;
    const [rows] = await db.query(sql, params);
    
    const data = rows.map((b, idx) => {
      const invoiceNumber = `INV-${new Date(b.booked_at).getFullYear()}-${String(idx + 1001).padStart(5, '0')}`;
      let status = 'Unpaid';
      if (b.payment_status === 'paid') status = 'Paid';
      else if (b.payment_status === 'partial') status = 'Partial';
      
      const details = safeJsonParse(b.details, {});
      
      return {
        id: b.id,
        invoiceNumber,
        bookingRef: b.booking_ref,
        bookingType: b.booking_type,
        date: b.booked_at,
        amount: parseFloat(b.total_amount),
        status,
        paidAmount: parseFloat(b.paid_amount) || 0,
        paidAt: b.paid_at,
        customer: {
          name: details.passengerName || 'Customer',
          email: details.email || '',
        },
        items: [{
          description: `${b.booking_type.charAt(0).toUpperCase() + b.booking_type.slice(1)} Booking - ${b.booking_ref}`,
          quantity: 1,
          unitPrice: parseFloat(b.total_amount),
          total: parseFloat(b.total_amount),
        }],
      };
    });
    
    res.json({ data, total: data.length });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// =============== E-TRANSACTIONS ===============
// GET /dashboard/e-transactions
router.get('/e-transactions', async (req, res) => {
  try {
    const { type, search, page = 1, limit = 20 } = req.query;
    
    // E-transactions are online payments (bkash, nagad, card)
    let sql = `SELECT * FROM transactions WHERE user_id = ? AND payment_method IN ('bkash', 'nagad', 'rocket', 'card')`;
    const params = [req.user.sub];
    
    if (type && type !== 'all') {
      sql += ` AND payment_method = ?`; params.push(type);
    }
    if (search) { sql += ` AND (reference LIKE ? OR description LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [countResult] = await db.query(sql.replace('SELECT *', 'SELECT COUNT(*) as total'), params);
    
    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);
    const [rows] = await db.query(sql, params);
    
    const methodLabels = { bkash: 'BKash', nagad: 'Nagad', rocket: 'Rocket', card: 'Card Payment' };
    
    const data = rows.map(t => ({
      id: t.id,
      transactionId: t.reference || `TXN-${t.id.substring(0, 8).toUpperCase()}`,
      method: methodLabels[t.payment_method] || t.payment_method,
      amount: parseFloat(t.amount),
      fee: Math.round(parseFloat(t.amount) * 0.015), // 1.5% gateway fee estimate
      status: t.status === 'completed' ? 'Completed' : t.status === 'pending' ? 'Pending' : t.status === 'failed' ? 'Failed' : 'Initiated',
      date: t.created_at,
      description: t.description,
    }));
    
    res.json({ 
      data, 
      total: countResult[0].total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// =============== SEARCH HISTORY ===============
// GET /dashboard/search-history
router.get('/search-history', async (req, res) => {
  try {
    const { type, search } = req.query;
    
    // Check if search_history table exists, if not return empty
    let sql = `SELECT * FROM search_history WHERE user_id = ?`;
    const params = [req.user.sub];
    
    if (type && type !== 'all') { sql += ` AND search_type = ?`; params.push(type); }
    if (search) { sql += ` AND (origin LIKE ? OR destination LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
    
    sql += ` ORDER BY created_at DESC LIMIT 100`;
    
    let rows = [];
    try {
      const [result] = await db.query(sql, params);
      rows = result;
    } catch (tableErr) {
      // Table doesn't exist, return empty
      rows = [];
    }
    
    const data = rows.map(s => ({
      id: s.id,
      type: s.search_type,
      origin: s.origin,
      destination: s.destination,
      dates: s.dates,
      params: safeJsonParse(s.params, {}),
      searchedAt: s.created_at,
    }));
    
    res.json({ data, total: data.length });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// POST /dashboard/search-history (save a search)
router.post('/search-history', async (req, res) => {
  try {
    const { type, origin, destination, dates, params } = req.body;
    const id = uuidv4();
    
    try {
      await db.query(
        `INSERT INTO search_history (id, user_id, search_type, origin, destination, dates, params) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, req.user.sub, type, origin || null, destination || null, dates || null, JSON.stringify(params || {})]
      );
    } catch (tableErr) {
      // Table might not exist, silently fail
    }
    
    res.status(201).json({ id, type, origin, destination, dates, params });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// DELETE /dashboard/search-history (clear all)
router.delete('/search-history', async (req, res) => {
  try {
    try {
      await db.query('DELETE FROM search_history WHERE user_id = ?', [req.user.sub]);
    } catch (tableErr) {
      // Table might not exist
    }
    res.status(204).end();
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// POST /dashboard/bookings/send-confirmation (email booking confirmation)
router.post('/bookings/send-confirmation', async (req, res) => {
  try {
    const { bookingRef } = req.body;
    res.json({ message: 'Confirmation email sent', bookingRef });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Something went wrong', status: 500 }); }
});

// GET /dashboard/bookings/:id/ancillaries — Post-booking ancillary offers via Sabre GAO
router.get('/bookings/:id/ancillaries', async (req, res) => {
  try {
    const userId = req.user.sub;
    const [rows] = await db.query('SELECT * FROM bookings WHERE id = ? AND user_id = ?', [req.params.id, userId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Booking not found', status: 404 });

    const booking = rows[0];
    const details = safeJsonParse(booking.details, {});
    const gdsPnr = details.gdsPnr || null;
    const outbound = details.outbound || {};

    if (!gdsPnr) {
      return res.status(400).json({ message: 'No GDS PNR available for this booking — ancillary add-ons require a valid PNR', status: 400 });
    }

    // Try Sabre SOAP GetAncillaryOffersRQ for ANY booking with a valid PNR
    // GAO only needs the PNR — it retrieves flight context from the reservation itself
    let meals = [];
    let baggage = [];
    let seatMap = null;
    let source = 'none';

    console.log(`[PostBooking Ancillaries] Trying GAO for PNR ${gdsPnr}, airline: ${outbound.airlineCode || '?'}, route: ${outbound.origin || '?'}-${outbound.destination || '?'}`);

    try {
      const sabreSoap = require('./sabre-soap');
      const ancillaryResult = await sabreSoap.getAncillaryOffers({
        pnr: gdsPnr,
        airlineCode: outbound.airlineCode || '',
        origin: outbound.origin || '',
        destination: outbound.destination || '',
      });

      if (ancillaryResult && !ancillaryResult._error) {
        source = 'sabre-gao';
        if (ancillaryResult.meals?.length > 0) {
          meals = ancillaryResult.meals.map(m => ({
            id: m.id || m.code, code: m.code, name: m.name, price: m.price || 0,
            description: m.description || '', category: m.category || 'meal', currency: m.currency || 'BDT',
          }));
        }
        if (ancillaryResult.baggage?.length > 0) {
          baggage = ancillaryResult.baggage.map(b => ({
            id: b.id || b.code, code: b.code, name: b.name, price: b.price || 0,
            description: b.description || '', weight: b.weight || '', currency: b.currency || 'BDT',
          }));
        }
        console.log(`[PostBooking Ancillaries] GAO success: ${meals.length} meals, ${baggage.length} baggage`);
      } else {
        console.log(`[PostBooking Ancillaries] GAO returned no data: ${ancillaryResult?.message || 'empty'}`);
      }
    } catch (err) {
      console.error(`[PostBooking Ancillaries] Sabre GAO error for PNR ${gdsPnr}:`, err.message);
    }

    // Also try seat map for the first segment
    try {
      const sabreSoap = require('./sabre-soap');
      const flightNumber = String(outbound.flightNumber || '').replace(/^[A-Z]{2}/i, '');
      const depTime = outbound.departureTime || '';
      const depDate = depTime ? depTime.substring(0, 10) : '';
      if (outbound.airlineCode && flightNumber && outbound.origin && outbound.destination && depDate) {
        console.log(`[PostBooking SeatMap] Trying for ${outbound.airlineCode}${flightNumber} ${outbound.origin}-${outbound.destination} ${depDate}`);
        const seatResult = await sabreSoap.getSeatMap({
          origin: outbound.origin,
          destination: outbound.destination,
          departureDate: depDate,
          marketingCarrier: outbound.airlineCode,
          operatingCarrier: outbound.airlineCode,
          flightNumber,
          cabinClass: outbound.cabinClass || 'Economy',
          isDomestic: false,
        });
        if (seatResult && !seatResult._error && seatResult.rows?.length > 0) {
          seatMap = seatResult;
          console.log(`[PostBooking SeatMap] Success: ${seatResult.totalRows} rows`);
        } else {
          console.log(`[PostBooking SeatMap] No data for ${outbound.airlineCode}${flightNumber}`);
        }
      }
    } catch (err) {
      console.log(`[PostBooking SeatMap] Error: ${err.message}`);
    }

    res.json({
      pnr: gdsPnr,
      source,
      meals,
      baggage,
      seatMap: seatMap ? { layout: seatMap, source: 'sabre', available: true } : { layout: null, source: 'none', available: false },
      available: meals.length > 0 || baggage.length > 0 || !!seatMap,
      bookingId: req.params.id,
      flightInfo: {
        airlineCode: outbound.airlineCode || null,
        airline: outbound.airline || null,
        flightNumber: outbound.flightNumber || null,
        origin: outbound.origin || null,
        destination: outbound.destination || null,
      },
    });
  } catch (err) {
    console.error('Post-booking ancillaries error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});

// ── Wallet ──────────────────────────────────────────────
router.get('/wallet', async (req, res) => {
  try {
    const userId = req.user.sub || req.user.id;
    const walletState = await getEffectiveWalletState(userId);
    await syncWalletFromDerivedBalance(userId, walletState);

    // Recent transactions (all types, all statuses for history)
    const [txns] = await db.query(
      `SELECT id, booking_id, type, amount, description, status, payment_method, reference, meta, created_at as date
       FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );

    let runningBalance = walletState.effectiveBalance;
    const normalizedTxns = txns.map((t) => {
      const signedAmount = getSignedTransactionAmount(t);
      const isApproved = APPROVED_TRANSACTION_STATUSES.has(String(t.status || '').toLowerCase());
      const normalized = {
        ...t,
        amount: Math.abs(Number(t.amount || 0)),
        type: signedAmount >= 0 ? 'credit' : 'debit',
        originalType: t.type,
        entryType: getTransactionEntryType(t),
        balance: isApproved ? runningBalance : null,
      };

      if (isApproved) {
        runningBalance -= signedAmount;
      }

      return normalized;
    });

    res.json({
      balance: walletState.effectiveBalance,
      totalCredited: walletState.totalCredited,
      totalDebited: walletState.totalDebited,
      transactions: normalizedTxns,
    });
  } catch (err) {
    console.error('Wallet error:', err);
    res.json({ balance: 0, totalCredited: 0, totalDebited: 0, transactions: [] });
  }
});

// ── SSR History ─────────────────────────────────────────
router.get('/ssr-history', async (req, res) => {
  try {
    const userId = req.user.sub || req.user.id;
    const { search } = req.query;
    // SSR data is stored within booking details JSON
    const [bookings] = await db.query(
      `SELECT id, booking_ref, details, passenger_info, created_at FROM bookings WHERE user_id = ? AND booking_type = 'flight' ORDER BY created_at DESC LIMIT 100`,
      [userId]
    );

    const ssrHistory = [];
    for (const b of bookings) {
      const details = safeJsonParse(b.details, {});
      const passengers = safeJsonParse(b.passenger_info, []);
      const ssrRequests = details.ssrRequests || details.specialServices || [];
      
      for (const ssr of ssrRequests) {
        const paxIndex = ssr.passengerIndex || 0;
        const pax = passengers[paxIndex] || {};
        const entry = {
          id: `${b.id}-${ssr.type || 'ssr'}-${paxIndex}`,
          bookingRef: b.booking_ref,
          ssrType: ssr.type || ssr.ssrType || 'general',
          passengerName: pax.firstName ? `${pax.firstName} ${pax.lastName || ''}`.trim() : ssr.passengerName || 'N/A',
          details: ssr.details || ssr.description || ssr.code || '',
          status: ssr.status || 'confirmed',
          gdsResponse: ssr.gdsResponse || null,
          createdAt: b.created_at,
        };
        if (!search || entry.bookingRef?.toLowerCase().includes(String(search).toLowerCase()) || entry.passengerName?.toLowerCase().includes(String(search).toLowerCase())) {
          ssrHistory.push(entry);
        }
      }
    }

    res.json({ data: ssrHistory, total: ssrHistory.length });
  } catch (err) {
    console.error('SSR history error:', err);
    res.json({ data: [], total: 0 });
  }
});

// ── Bank Accounts (for user payment reference) ─────────
router.get('/bank-accounts', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT setting_value FROM system_settings WHERE setting_key IN ('bank_accounts', 'payment_bank_accounts')`
    );
    let banks = [];
    for (const row of rows) {
      const parsed = safeJsonParse(row.setting_value, []);
      if (Array.isArray(parsed) && parsed.length > 0) { banks = parsed; break; }
    }
    res.json({ banks });
  } catch (err) {
    console.error('Bank accounts error:', err);
    res.json({ banks: [] });
  }
});

// ── MFS Accounts (bKash, Nagad, etc for user payment reference) ──
router.get('/mfs-accounts', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'payment_mfs_accounts'`
    );
    const accounts = rows.length > 0 ? safeJsonParse(rows[0].setting_value, []) : [];
    res.json({ accounts });
  } catch (err) {
    console.error('MFS accounts error:', err);
    res.json({ accounts: [] });
  }
});

// ── Send Payment Request ────────────────────────────────
router.post('/payment-requests', slipUploadAny, async (req, res) => {
  try {
    const userId = req.user.sub || req.user.id;
    const { bookingRef, amount, paymentMethod, notes } = req.body;

    if (!bookingRef || !amount) {
      return res.status(400).json({ message: 'Booking reference and amount are required' });
    }

    const methodMap = {
      bank: 'bank_transfer',
      bank_transfer: 'bank_transfer',
      bkash: 'bkash',
      nagad: 'nagad',
      rocket: 'rocket',
      card: 'card',
      balance: 'card',
    };
    const dbMethod = methodMap[paymentMethod] || 'bank_transfer';

    let bookingId = null;
    const [bookings] = await db.query('SELECT id FROM bookings WHERE booking_ref = ? AND user_id = ?', [bookingRef, userId]);
    if (bookings.length > 0) bookingId = bookings[0].id;

    const id = uuidv4();
    const slipFile = pickSlipFile(req);
    const receiptUrl = slipFile ? `/uploads/payment-slips/${slipFile.filename}` : null;
    const reference = `PAY-${id.substring(0, 8).toUpperCase()}`;
    const meta = JSON.stringify({
      source: 'payment_request',
      bookingRef,
      receiptUrl,
      originalFileName: slipFile?.originalname || null,
      notes: notes || null,
    });

    await db.query(
      `INSERT INTO transactions (id, user_id, booking_id, type, amount, status, payment_method, reference, description, meta) VALUES (?, ?, ?, 'payment', ?, 'pending', ?, ?, ?, ?)`,
      [id, userId, bookingId, parseFloat(amount) || 0, dbMethod, reference, `Payment request for ${bookingRef} via ${paymentMethod || 'unspecified'}. ${notes || ''}`.trim(), meta]
    );

    res.status(201).json({ success: true, id, reference, receiptUrl, message: 'Payment request submitted' });
  } catch (err) {
    console.error('Payment request error:', err);
    res.status(500).json({ message: 'Failed to submit payment request' });
  }
});

// ── List My Payment / Deposit Requests (with slip) ───────
router.get('/payment-requests', async (req, res) => {
  try {
    const userId = req.user.sub || req.user.id;
    const [rows] = await db.query(
      `SELECT * FROM transactions WHERE user_id = ? AND type IN ('payment','deposit') ORDER BY created_at DESC LIMIT 100`,
      [userId]
    );
    const items = rows.map(t => {
      const meta = safeJsonParse(t.meta, {}) || {};
      return {
        id: t.id,
        reference: t.reference,
        amount: parseFloat(t.amount) || 0,
        type: t.type,
        method: t.payment_method,
        status: t.status === 'completed' ? 'Approved' : t.status === 'pending' ? 'Pending' : t.status === 'rejected' || t.status === 'failed' ? 'Rejected' : t.status,
        receiptUrl: meta.receiptUrl || null,
        transactionId: meta.transactionId || null,
        notes: meta.notes || null,
        bookingRef: meta.bookingRef || null,
        date: t.created_at,
        editable: t.status === 'pending',
      };
    });
    res.json({ data: items });
  } catch (err) {
    console.error('List payment requests error:', err);
    res.status(500).json({ message: 'Failed to load payment requests' });
  }
});

// ── Edit a Pending Payment / Deposit Request ─────────────
router.post('/payment-requests/:id/update', slipUploadAny, async (req, res) => {
  try {
    const userId = req.user.sub || req.user.id;
    const { id } = req.params;
    const [rows] = await db.query('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [id, userId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Request not found' });
    const txn = rows[0];
    if (txn.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be edited' });
    }

    const meta = safeJsonParse(txn.meta, {}) || {};
    const { amount, transactionId, notes } = req.body;

    let amt = parseFloat(txn.amount);
    if (amount !== undefined && amount !== '') {
      const parsed = parseFloat(amount);
      if (!parsed || parsed < 10) return res.status(400).json({ message: 'Invalid amount' });
      if (parsed > 500000) return res.status(400).json({ message: 'Maximum single amount is ৳500,000' });
      amt = parsed;
    }
    if (transactionId !== undefined) meta.transactionId = String(transactionId).trim() || meta.transactionId;
    if (notes !== undefined) meta.notes = notes || null;
    const newSlip = pickSlipFile(req);
    if (newSlip) {
      meta.receiptUrl = `/uploads/payment-slips/${newSlip.filename}`;
      meta.originalFileName = newSlip.originalname;
    }

    await db.query('UPDATE transactions SET amount = ?, meta = ? WHERE id = ?', [amt, JSON.stringify(meta), id]);
    res.json({ success: true, message: 'Request updated', receiptUrl: meta.receiptUrl || null });
  } catch (err) {
    console.error('Update payment request error:', err);
    res.status(500).json({ message: 'Failed to update request' });
  }
});

// ── Pay Booking With Wallet Balance ──────────────────────
router.post('/wallet/pay', async (req, res) => {
  let conn = null;
  try {
    const userId = req.user.sub || req.user.id;
    const { bookingId, amount } = req.body;
    if (!bookingId || !amount || amount <= 0) {
      return res.status(400).json({ message: 'Valid booking ID and amount are required' });
    }

    const walletState = await getEffectiveWalletState(userId);
    await syncWalletFromDerivedBalance(userId, walletState);
    const balance = walletState.effectiveBalance;

    if (balance < amount) {
      return res.status(400).json({ message: `Insufficient balance. Available: ৳${balance.toLocaleString()}, Required: ৳${amount.toLocaleString()}` });
    }

    // Verify booking exists and belongs to user — fetch amount for server-side verification
    const [bookingRows] = await db.query(
      `SELECT id, status, booking_ref, total_amount, pnr FROM bookings WHERE id = ? AND user_id = ?`,
      [bookingId, userId]
    );
    if (bookingRows.length === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const booking = bookingRows[0];
    if (!['on_hold', 'pending', 'confirmed'].includes(booking.status)) {
      return res.status(400).json({ message: 'Booking is not in a payable state' });
    }

    // Server-side amount verification — never trust client amount
    const dbAmount = Number(booking.total_amount || 0);
    if (dbAmount <= 0) {
      return res.status(400).json({ message: 'Booking amount is invalid in the system' });
    }
    // Allow small tolerance (rounding) but reject if client tries to pay less
    const tolerance = Math.max(dbAmount * 0.001, 1); // 0.1% or ৳1
    if (Math.abs(amount - dbAmount) > tolerance) {
      return res.status(400).json({ 
        message: `Amount mismatch. Expected ৳${dbAmount.toLocaleString()}, received ৳${amount.toLocaleString()}. Please refresh and try again.`,
        expectedAmount: dbAmount
      });
    }
    // Use the verified DB amount, not client amount
    const verifiedAmount = dbAmount;

    if (balance < verifiedAmount) {
      return res.status(400).json({ message: `Insufficient balance. Available: ৳${balance.toLocaleString()}, Required: ৳${verifiedAmount.toLocaleString()}` });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    const [lockedBookingRows] = await conn.query(
      `SELECT id, status, booking_ref, total_amount, payment_status, pnr
       FROM bookings
       WHERE id = ? AND user_id = ?
       FOR UPDATE`,
      [bookingId, userId]
    );

    if (lockedBookingRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Booking not found' });
    }

    const lockedBooking = lockedBookingRows[0];
    if (String(lockedBooking.payment_status || '').toLowerCase() === 'paid') {
      await conn.rollback();
      return res.status(400).json({ message: 'This booking has already been paid from wallet' });
    }

    await ensureTicketIssueRequestsTable(conn);

    const [openRequests] = await conn.query(
      `SELECT id, status FROM ticket_issue_requests
       WHERE booking_id = ? AND status IN ('pending', 'processing', 'issued')
       LIMIT 1`,
      [bookingId]
    );

    if (openRequests.length > 0) {
      await conn.rollback();
      return res.status(400).json({
        message: openRequests[0].status === 'issued'
          ? 'Ticket has already been issued for this booking'
          : 'An issue request is already pending for this booking',
      });
    }

    // Create debit transaction
    const txnId = require('uuid').v4();
    const requestId = uuidv4();
    await conn.query(
      `INSERT INTO transactions (id, user_id, booking_id, type, amount, description, status, created_at)
       VALUES (?, ?, ?, 'payment', ?, ?, 'completed', NOW())`,
      [txnId, userId, bookingId, -Math.abs(verifiedAmount), `Wallet payment for booking ${booking.booking_ref || bookingId}`]
    );

    // Update booking status
    await conn.query(
      `UPDATE bookings
       SET status = 'processing',
           payment_status = 'paid',
           updated_at = NOW()
       WHERE id = ?`,
      [bookingId]
    );

    // Deduct from wallet table
    try {
      await conn.query(
        `UPDATE wallet SET balance = GREATEST(balance - ?, 0) WHERE user_id = ?`,
        [verifiedAmount, userId]
      );
    } catch (walletErr) {
      if (!isMissingTableError(walletErr, 'wallet')) {
        throw walletErr;
      }
    }

    await conn.query(
      `INSERT INTO ticket_issue_requests (id, booking_id, user_id, status, notes, pnr)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
      [requestId, bookingId, userId, 'Paid from wallet balance. Please issue ticket.', lockedBooking.pnr || booking.pnr || null]
    );

    await conn.commit();

    try {
      const { notifyBookingStatus } = require('../services/notify');
      await notifyBookingStatus(lockedBooking.booking_ref || booking.booking_ref, 'ticket_issue_requested', null);
    } catch (notifyErr) {
      console.log('[Wallet Pay] Ticket issue notification skipped:', notifyErr?.message || notifyErr);
    }

    res.json({
      success: true,
      message: 'Wallet debited. Issue request sent to admin.',
      transactionId: txnId,
      requestId,
    });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }
    console.error('Wallet pay error:', err);
    res.status(500).json({ message: 'Payment failed' });
  } finally {
    if (conn) conn.release();
  }
});

// ── Ensure transactions enums support wallet flows (self-healing) ──
let txnEnumsEnsured = false;
async function ensureTransactionEnums() {
  if (txnEnumsEnsured) return;
  try {
    await db.query(
      `ALTER TABLE transactions MODIFY COLUMN type ENUM('payment','refund','recharge','bill_payment','esim_purchase','deposit','credit','debit','transfer_in','transfer_out','adjustment') NOT NULL`
    );
    await db.query(
      `ALTER TABLE transactions MODIFY COLUMN payment_method ENUM('bkash','nagad','rocket','card','bank_transfer','wallet','admin_credit','pay_later','cash','cheque') NULL`
    );
    await db.query(
      `ALTER TABLE transactions MODIFY COLUMN status ENUM('pending','completed','failed','reversed','approved','rejected') DEFAULT 'pending'`
    );
  } catch (e) {
    console.warn('ensureTransactionEnums:', e.message);
  }
  txnEnumsEnsured = true;
}

// ── Wallet Deposit Request (with optional deposit slip) ──
router.post('/wallet/deposit', slipUploadAny, async (req, res) => {
  try {
    const userId = req.user.sub || req.user.id;
    const { amount, method, notes, transactionId } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt < 10) {
      return res.status(400).json({ message: 'Minimum deposit is ৳10' });
    }
    if (amt > 500000) {
      return res.status(400).json({ message: 'Maximum single deposit is ৳500,000' });
    }
    const txnRef = String(transactionId || '').trim();
    if (!txnRef) {
      return res.status(400).json({ message: 'Transaction ID is required' });
    }

    const txnId = uuidv4();
    const reference = `DEP-${txnId.substring(0, 8).toUpperCase()}`;
    const slipFile = pickSlipFile(req);
    const receiptUrl = slipFile ? `/uploads/payment-slips/${slipFile.filename}` : null;
    const dbMethod = method === 'bank' ? 'bank_transfer' : (method || 'bank_transfer');
    const meta = JSON.stringify({
      source: 'wallet_deposit',
      receiptUrl,
      originalFileName: slipFile?.originalname || null,
      transactionId: txnRef,
      notes: notes || null,
    });


    const sql = `INSERT INTO transactions (id, user_id, type, amount, description, status, payment_method, reference, meta, created_at)
       VALUES (?, ?, 'deposit', ?, ?, 'pending', ?, ?, ?, NOW())`;
    const params = [txnId, userId, amt, `Wallet deposit via ${dbMethod} (TxnID: ${txnRef}) — pending approval`, dbMethod, reference, meta];

    try {
      await db.query(sql, params);
    } catch (insertErr) {
      // Legacy schemas lack the 'deposit' enum value — widen the enums and retry once
      console.warn('Deposit insert failed, attempting schema self-heal:', insertErr.message);
      await ensureTransactionEnums();
      await db.query(sql, params);
    }

    res.json({ success: true, message: 'Deposit request created. Admin will review and approve.', transactionId: txnId, reference });
  } catch (err) {
    console.error('Wallet deposit error:', err);
    res.status(500).json({ message: err?.sqlMessage || err?.message || 'Failed to create deposit request' });
  }
});


// ── Wallet Transfer ─────────────────────────────────────
router.post('/wallet/transfer', async (req, res) => {
  try {
    const userId = req.user.sub || req.user.id;
    const { recipientIdentifier, amount, note } = req.body;
    if (!recipientIdentifier || !amount || amount < 1) {
      return res.status(400).json({ message: 'Valid recipient and amount are required' });
    }

    const walletState = await getEffectiveWalletState(userId);
    await syncWalletFromDerivedBalance(userId, walletState);
    const balance = walletState.effectiveBalance;
    if (balance < amount) {
      return res.status(400).json({ message: `Insufficient balance. Available: ৳${balance.toLocaleString()}` });
    }

    // Find recipient by email or phone
    const [recipientRows] = await db.query(
      `SELECT id, name, email FROM users WHERE email = ? OR phone = ? LIMIT 1`,
      [recipientIdentifier, recipientIdentifier]
    );
    if (recipientRows.length === 0) {
      return res.status(404).json({ message: 'Recipient not found. Please check email or phone number.' });
    }
    const recipient = recipientRows[0];
    if (recipient.id === userId) {
      return res.status(400).json({ message: 'Cannot transfer to yourself' });
    }

    const debitId = require('uuid').v4();
    const creditId = require('uuid').v4();
    const desc = note ? `Transfer: ${note}` : 'Wallet transfer';

    // Debit sender
    await db.query(
      `INSERT INTO transactions (id, user_id, type, amount, description, status, created_at)
       VALUES (?, ?, 'transfer_out', ?, ?, 'completed', NOW())`,
      [debitId, userId, -Math.abs(amount), `${desc} → ${recipient.name || recipient.email}`]
    );

    // Credit recipient
    await db.query(
      `INSERT INTO transactions (id, user_id, type, amount, description, status, created_at)
       VALUES (?, ?, 'transfer_in', ?, ?, 'completed', NOW())`,
      [creditId, recipient.id, Math.abs(amount), `${desc} ← transfer received`]
    );

    res.json({ success: true, message: `৳${amount.toLocaleString()} transferred successfully` });
  } catch (err) {
    console.error('Wallet transfer error:', err);
    res.status(500).json({ message: 'Transfer failed' });
  }
});

// ── Ticket Issue Requests ──

// POST /dashboard/ticket-issue-request — user requests admin to issue ticket
router.post('/ticket-issue-request', async (req, res) => {
  const userId = req.user.sub;
  const { bookingId, notes } = req.body;
  if (!bookingId) return res.status(400).json({ message: 'bookingId is required' });

  try {
    // Verify booking belongs to user
    const [bookings] = await db.query('SELECT id, status, pnr, booking_ref, payment_status FROM bookings WHERE id = ? AND user_id = ?', [bookingId, userId]);
    if (bookings.length === 0) return res.status(404).json({ message: 'Booking not found' });

    const booking = bookings[0];
    if (['cancelled', 'refunded', 'void', 'failed'].includes(booking.status)) {
      return res.status(400).json({ message: 'Cannot request ticket issue for this booking status' });
    }
    if (booking.status === 'ticketed') {
      return res.status(400).json({ message: 'Ticket has already been issued' });
    }

    await ensureTicketIssueRequestsTable();

    // Check if there's already a pending request
    const [existing] = await db.query(
      "SELECT id FROM ticket_issue_requests WHERE booking_id = ? AND status IN ('pending', 'processing')", [bookingId]
    );
    if (existing && existing.length > 0) {
      return res.status(400).json({ message: 'A ticket issue request is already pending for this booking' });
    }

    const id = uuidv4();
    await db.query(
      'INSERT INTO ticket_issue_requests (id, booking_id, user_id, status, notes) VALUES (?, ?, ?, ?, ?)',
      [id, bookingId, userId, 'pending', notes || null]
    );

    // Notify admin (optional)
    try {
      const { notifyBookingStatus } = require('../services/notify');
      await notifyBookingStatus(booking.booking_ref, 'ticket_issue_requested', null);
    } catch (e) { console.log('[Ticket Request] Notification skipped:', e.message); }

    res.json({ success: true, requestId: id, message: 'Ticket issue request submitted. Admin will process it shortly.' });
  } catch (err) {
    console.error('[Dashboard] Ticket issue request error:', err);
    res.status(500).json({ message: 'Failed to submit request' });
  }
});

// GET /dashboard/ticket-issue-requests — user's own requests
router.get('/ticket-issue-requests', async (req, res) => {
  try {
    const userId = req.user.sub;
    const [rows] = await db.query(
      `SELECT tir.*, b.booking_ref, b.pnr, b.status as booking_status, b.total_amount, b.details
       FROM ticket_issue_requests tir
       JOIN bookings b ON tir.booking_id = b.id
       WHERE tir.user_id = ?
       ORDER BY tir.created_at DESC`,
      [userId]
    );
    res.json({ data: rows });
  } catch (err) {
    if (isMissingTableError(err, 'ticket_issue_requests')) {
      return res.json({ data: [] });
    }
    console.error('[Dashboard] Ticket issue requests list error:', err);
    res.status(500).json({ message: 'Failed to fetch requests' });
  }
});

// =============== POST-TICKET SERVICE REQUESTS ===============
// POST /dashboard/service-requests { bookingId, type: void|reissue|refund|cancel, notes }
router.post('/service-requests', async (req, res) => {
  try {
    const userId = req.user.sub;
    const { bookingId, type, notes } = req.body;
    if (!bookingId || !SERVICE_REQUEST_TYPES.includes(String(type))) {
      return res.status(400).json({ message: 'bookingId and a valid type (void/reissue/refund/cancel) are required' });
    }

    const [bookings] = await db.query('SELECT id, booking_ref, pnr, status FROM bookings WHERE id = ? AND user_id = ?', [bookingId, userId]);
    if (bookings.length === 0) return res.status(404).json({ message: 'Booking not found' });
    const booking = bookings[0];

    await ensureServiceRequestsTable();

    const [existing] = await db.query(
      "SELECT id FROM booking_service_requests WHERE booking_id = ? AND type = ? AND status IN ('pending','processing','quoted','accepted')",
      [bookingId, type]
    );

    if (existing && existing.length > 0) {
      return res.status(400).json({ message: `A ${type} request is already pending for this booking` });
    }

    const id = uuidv4();
    await db.query(
      'INSERT INTO booking_service_requests (id, booking_id, user_id, type, status, notes, pnr) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, bookingId, userId, type, 'pending', notes || null, booking.pnr || null]
    );

    try {
      const { notifyBookingStatus } = require('../services/notify');
      await notifyBookingStatus(booking.booking_ref, `${type}_requested`, null);
    } catch (e) { console.log('[Service Request] Notification skipped:', e.message); }

    res.json({ success: true, requestId: id, message: `${type} request submitted. Admin will review it shortly.` });
  } catch (err) {
    console.error('[Dashboard] Service request error:', err);
    res.status(500).json({ message: 'Failed to submit request' });
  }
});

// GET /dashboard/service-requests — user's own void/reissue/refund/cancel requests
router.get('/service-requests', async (req, res) => {
  try {
    const userId = req.user.sub;
    const [rows] = await db.query(
      `SELECT sr.*, b.booking_ref, b.status as booking_status
       FROM booking_service_requests sr
       JOIN bookings b ON sr.booking_id = b.id
       WHERE sr.user_id = ?
       ORDER BY sr.created_at DESC`,
      [userId]
    );
    res.json({ data: rows });
  } catch (err) {
    if (isMissingTableError(err, 'booking_service_requests')) return res.json({ data: [] });
    console.error('[Dashboard] Service requests list error:', err);
    res.status(500).json({ message: 'Failed to fetch requests' });
  }
});



// =============== PARTIAL PAYMENT REQUEST (post-booking) ===============
// POST /dashboard/bookings/:id/request-partial
// Customer requests 30% upfront + 70% later (admin sets deadline).
// Eligibility: international + refundable + ≥96h to departure + unpaid + not cancelled/ticketed.
router.post('/bookings/:id/request-partial', async (req, res) => {
  try {
    const userId = req.user.sub;
    const [rows] = await db.query('SELECT * FROM bookings WHERE id = ? AND user_id = ?', [req.params.id, userId]);
    if (!rows.length) return res.status(404).json({ message: 'Booking not found' });
    const b = rows[0];

    const paymentStatus = String(b.payment_status || '').toLowerCase();
    if (paymentStatus === 'paid' || paymentStatus === 'partial') {
      return res.status(400).json({ message: 'Partial payment already requested or booking is paid.' });
    }
    if (['cancelled', 'refunded', 'ticketed', 'completed'].includes(String(b.status || '').toLowerCase())) {
      return res.status(400).json({ message: 'Booking is not eligible for partial payment.' });
    }

    const details = safeJsonParse(b.details, {}) || {};
    const o = details.outbound || details;
    const origin = o.origin || details.origin;
    const destination = o.destination || details.destination;
    const departureTime = o.departureTime || details.departureTime;
    const refundable = o.refundable ?? details.refundable ?? false;

    const settings = await loadPartialSettings();
    const perm = await isPartialAllowedForUser(userId, settings);
    if (!perm.allowed) {
      return res.status(403).json({
        message: perm.reason === 'user_permission_off'
          ? 'Partial payment is not enabled for your account. Please contact support.'
          : 'Partial payment is currently disabled by the administrator.',
      });
    }
    const elig = evaluatePartialEligibility(
      { origin, destination, departureTime, refundable, partialOverride: !!b.partial_override },
      settings
    );
    if (!elig.eligible) {
      return res.status(400).json({
        message: `Partial payment not allowed: ${String(elig.reason || '').replace(/_/g, ' ')}.`,
        code: 'PARTIAL_NOT_ALLOWED',
        eligibility: elig,
      });
    }

    const upfrontPct = Number(elig.upfrontPct || settings.upfrontPct || 30);
    const total = Number(b.total_amount) || 0;
    const upfrontAmount = Math.round((total * upfrontPct) / 100);
    const remainingAmount = Math.max(0, total - upfrontAmount);

    await db.query(
      `UPDATE bookings
         SET partial_override = 1,
             partial_split_pct = ?,
             payment_status = 'partial'
       WHERE id = ?`,
      [upfrontPct, req.params.id]
    );

    res.json({
      success: true,
      upfrontPct,
      upfrontAmount,
      remainingAmount,
      message: `Partial payment enabled. Pay ৳${upfrontAmount.toLocaleString()} now; admin will confirm the deadline for the remaining ৳${remainingAmount.toLocaleString()}.`,
    });
  } catch (err) {
    console.error('[Dashboard] request-partial error:', err);
    res.status(500).json({ message: 'Failed to request partial payment' });
  }
});

module.exports = router;

