const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { generateTokens, formatUser, authenticate } = require('../middleware/auth');
const { notifyOTP, notifyPasswordReset, notifyWelcome, notifyAdminsEvent } = require('../services/notify');

const router = express.Router();

// Multer for ID document uploads
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const ID_DOCS_DIR = path.join(UPLOAD_DIR, 'id-documents');
if (!fs.existsSync(ID_DOCS_DIR)) fs.mkdirSync(ID_DOCS_DIR, { recursive: true });

const idStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ID_DOCS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.user.sub}-${Date.now()}${ext}`);
  },
});
const idUpload = multer({
  storage: idStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type ${ext} not allowed`));
  },
});

// POST /auth/register
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, phone, password } = req.body;
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: 'All fields are required', status: 400 });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters', status: 400 });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE LOWER(email) = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email already registered', status: 409 });
    }

    const id = uuidv4();
    const hash = await bcrypt.hash(password, 12);
    await db.query(
      'INSERT INTO users (id, first_name, last_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, firstName, lastName, email, phone || null, hash, 'customer']
    );

    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    const user = formatUser(rows[0]);
    const tokens = generateTokens(rows[0]);

    await db.query('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
      [uuidv4(), id, tokens.refreshToken]);

    // Send welcome SMS + Email (non-blocking)
    notifyWelcome(id).catch(err => console.error('Welcome notify error:', err));
    notifyAdminsEvent('New user ID created', [`Name: ${firstName} ${lastName || ''}`, `Email: ${email}`, `Phone: ${phone || '—'}`, 'Type: Personal']).catch(() => {});

    res.status(201).json({ user, ...tokens });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});

// POST /auth/register-agency  (B2B agent signup — pending admin verification)
router.post('/register-agency', async (req, res) => {
  try {
    const {
      agencyName, mocatLicense, country, city, address, postalCode,
      ownerFirstName, ownerLastName, ownerEmail, ownerMobile,
      mobile, password,
    } = req.body || {};
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (!agencyName || !ownerFirstName || !ownerEmail || !ownerMobile || !email || !mobile || !password) {
      return res.status(400).json({ message: 'Please fill all required fields', status: 400 });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters', status: 400 });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE LOWER(email) = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email already registered', status: 409 });
    }

    const id = uuidv4();
    const hash = await bcrypt.hash(password, 12);
    await db.query(
      'INSERT INTO users (id, first_name, last_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, ownerFirstName, ownerLastName || '', email, mobile, hash, 'agent']
    );

    try {
      await db.query(
        `INSERT INTO agency_profiles
          (user_id, agency_name, mocat_license, country, city, address, postal_code,
           owner_first_name, owner_last_name, owner_email, owner_mobile, verification_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [id, agencyName, mocatLicense || null, country || 'Bangladesh', city || null, address || null, postalCode || null,
         ownerFirstName, ownerLastName || null, ownerEmail, ownerMobile]
      );
    } catch (e) {
      if (e?.code === 'ER_NO_SUCH_TABLE') {
        console.warn('[register-agency] agency_profiles table missing — run agency-registration-migration.sql');
      } else { throw e; }
    }

    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    const user = formatUser(rows[0]);
    const tokens = generateTokens(rows[0]);
    await db.query(
      'INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
      [uuidv4(), id, tokens.refreshToken]
    );

    notifyWelcome(id).catch(() => {});
    notifyAdminsEvent('New agency (B2B) ID created', [`Email: ${email}`, 'Type: Agency — pending verification']).catch(() => {});
    res.status(201).json({ user, ...tokens, pendingVerification: true });
  } catch (err) {
    console.error('Register agency error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});


// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = req.body?.password;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required', status: 400 });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE LOWER(TRIM(email)) = ? ORDER BY created_at DESC', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password', status: 401 });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid email or password', status: 401 });
    }

    const tokens = generateTokens(user);
    await db.query('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
      [uuidv4(), user.id, tokens.refreshToken]);

    res.json({ user: formatUser(user), ...tokens });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});

// POST /admin/auth/login
router.post('/admin/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = req.body?.password;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required', status: 400 });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE LOWER(TRIM(email)) = ? ORDER BY created_at DESC', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials', status: 401 });
    }

    const user = rows[0];
    if (!['admin', 'super_admin', 'secondary_admin'].includes(user.role)) {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.', status: 403 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials', status: 401 });
    }

    const tokens = generateTokens(user);
    await db.query('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
      [uuidv4(), user.id, tokens.refreshToken]);

    res.json({ user: formatUser(user), ...tokens });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token required', status: 400 });
    }

    const SECRET = process.env.JWT_SECRET || 'fallback-secret';
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, SECRET);
    } catch {
      return res.status(401).json({ message: 'Invalid or expired refresh token', status: 401 });
    }

    const [tokenRows] = await db.query('SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > NOW()', [refreshToken]);
    if (tokenRows.length === 0) {
      return res.status(401).json({ message: 'Invalid or expired refresh token', status: 401 });
    }

    const [userRows] = await db.query('SELECT * FROM users WHERE id = ?', [decoded.sub]);
    if (userRows.length === 0) {
      return res.status(401).json({ message: 'User not found', status: 401 });
    }

    await db.query('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
    const tokens = generateTokens(userRows[0]);
    await db.query('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
      [uuidv4(), userRows[0].id, tokens.refreshToken]);

    res.json(tokens);
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});

// Ensure password-reset columns exist (self-heal for older databases)
let resetColumnsChecked = false;
async function ensureResetColumns() {
  if (resetColumnsChecked) return;
  const cols = [
    ['otp_code', 'VARCHAR(255) NULL'],
    ['otp_expires', 'DATETIME NULL'],
    ['reset_token', 'VARCHAR(100) NULL'],
    ['reset_expires', 'DATETIME NULL'],
  ];
  try { await db.query('ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NULL'); } catch {}
  for (const [name, type] of cols) {
    try { await db.query(`ALTER TABLE users ADD COLUMN ${name} ${type}`); } catch {}
  }
  resetColumnsChecked = true;
}

// POST /auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'Valid email address required', status: 400 });
    }
    await ensureResetColumns();

    const [rows] = await db.query('SELECT * FROM users WHERE LOWER(TRIM(email)) = ? ORDER BY created_at DESC LIMIT 1', [email]);
    let delivery = null;
    if (rows.length > 0) {
      const user = rows[0];
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const hash = await bcrypt.hash(otp, 10);
      await db.query('UPDATE users SET otp_code = ?, otp_expires = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE id = ?', [hash, user.id]);

      const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
      try {
        const results = await notifyPasswordReset(user.email, user.phone, name, otp) || [];
        const ok = results.some(r => r.status === 'fulfilled' && r.value?.success);
        delivery = ok ? 'sent' : 'failed';
        if (!ok) console.error('Password reset delivery failed:', JSON.stringify(results));
      } catch (err) {
        delivery = 'failed';
        console.error('Password reset notify error:', err);
      }
    }
    if (delivery === 'failed') {
      return res.status(503).json({ message: 'Email service is not configured yet. Please contact support.', status: 503 });
    }
    res.json({ message: 'If the email exists, an OTP has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }

});

// POST /auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();
    const [rows] = await db.query('SELECT * FROM users WHERE LOWER(TRIM(email)) = ? AND otp_expires > NOW() ORDER BY otp_expires DESC LIMIT 1', [email]);
    if (rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired OTP', status: 400 });
    }

    const valid = await bcrypt.compare(otp, rows[0].otp_code);
    if (!valid) {
      return res.status(400).json({ message: 'Invalid OTP', status: 400 });
    }

    const resetToken = uuidv4();
    await db.query('UPDATE users SET reset_token = ?, reset_expires = DATE_ADD(NOW(), INTERVAL 30 MINUTE), otp_code = NULL, otp_expires = NULL WHERE email = ?',
      [resetToken, email]);

    res.json({ message: 'OTP verified', resetToken });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});

// POST /auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8) {
      return res.status(400).json({ message: 'Valid token and password (min 8 chars) required', status: 400 });
    }

    const [rows] = await db.query('SELECT id FROM users WHERE reset_token = ? AND reset_expires > NOW()', [token]);
    if (rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired reset token', status: 400 });
    }

    const hash = await bcrypt.hash(password, 12);
    await db.query('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?', [hash, rows[0].id]);

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});

// POST /auth/logout
router.post('/logout', authenticate, async (req, res) => {
  try {
    await db.query('DELETE FROM refresh_tokens WHERE user_id = ?', [req.user.sub]);
    res.json({ message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});

// POST /auth/upload-id-document
router.post('/upload-id-document', authenticate, idUpload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded', status: 400 });
    }
    const documentType = req.body.documentType || 'nid';
    const docPath = `/uploads/id-documents/${req.file.filename}`;

    await db.query(
      'UPDATE users SET id_document_path = ?, id_document_type = ?, id_verified = FALSE WHERE id = ?',
      [docPath, documentType, req.user.sub]
    );

    res.json({ message: 'ID document uploaded successfully', path: docPath, type: documentType });
  } catch (err) {
    console.error('ID upload error:', err);
    res.status(500).json({ message: 'Upload failed', status: 500 });
  }
});

// ============================================================
// OTP Login (passwordless) — email OR SMS
// ============================================================
const { sendEmail, otpEmail } = require('../services/email');
const { sendSMS, otpSMS } = require('../services/sms');

async function ensureOtpTable() {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS otp_login_codes (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      identifier VARCHAR(255) NOT NULL,
      channel ENUM('email','sms') NOT NULL,
      code VARCHAR(10) NOT NULL,
      attempts INT DEFAULT 0,
      consumed TINYINT(1) DEFAULT 0,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_otp_identifier (identifier)
    )`);
  } catch (_) {}
}

// POST /auth/login-otp/request  { identifier, channel: 'email'|'sms' }
router.post('/login-otp/request', async (req, res) => {
  try {
    const { identifier, channel } = req.body || {};
    if (!identifier || !['email', 'sms'].includes(channel)) {
      return res.status(400).json({ message: 'identifier and channel (email|sms) are required' });
    }
    await ensureOtpTable();

    const col = channel === 'email' ? 'email' : 'phone';
    const [rows] = await db.query(`SELECT id, first_name, last_name, email, phone FROM users WHERE ${col} = ? LIMIT 1`, [identifier]);
    // Neutral response even if user doesn't exist
    if (rows.length === 0) {
      return res.json({ message: 'If the account exists, an OTP has been sent.' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await db.query(
      `INSERT INTO otp_login_codes (identifier, channel, code, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
      [identifier, channel, code]
    );

    const u = rows[0];
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Traveller';
    if (channel === 'email') {
      const tpl = otpEmail(name, code);
      sendEmail({ to: u.email, ...tpl }).catch(err => console.error('OTP email error:', err));
    } else {
      sendSMS(u.phone, otpSMS(code)).catch(err => console.error('OTP SMS error:', err));
    }
    res.json({ message: 'OTP sent. Please check your ' + (channel === 'email' ? 'email' : 'SMS') + '.' });
  } catch (err) {
    console.error('OTP request error:', err);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
});

// POST /auth/login-otp/verify  { identifier, channel, code }
router.post('/login-otp/verify', async (req, res) => {
  try {
    const { identifier, channel, code } = req.body || {};
    if (!identifier || !channel || !code) {
      return res.status(400).json({ message: 'identifier, channel, and code are required' });
    }
    await ensureOtpTable();

    const [otpRows] = await db.query(
      `SELECT * FROM otp_login_codes WHERE identifier = ? AND channel = ? AND consumed = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1`,
      [identifier, channel]
    );
    if (otpRows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }
    const otp = otpRows[0];
    if (otp.attempts >= 5) {
      return res.status(429).json({ message: 'Too many attempts. Request a new OTP.' });
    }
    if (String(otp.code) !== String(code)) {
      await db.query('UPDATE otp_login_codes SET attempts = attempts + 1 WHERE id = ?', [otp.id]);
      return res.status(400).json({ message: 'Invalid OTP' });
    }
    await db.query('UPDATE otp_login_codes SET consumed = 1 WHERE id = ?', [otp.id]);

    const col = channel === 'email' ? 'email' : 'phone';
    const [users] = await db.query(`SELECT * FROM users WHERE ${col} = ? LIMIT 1`, [identifier]);
    if (users.length === 0) return res.status(404).json({ message: 'User not found' });

    const user = users[0];
    if (['admin', 'super_admin', 'secondary_admin'].includes(user.role)) {
      return res.status(403).json({ message: 'Admins must sign in via the admin panel.' });
    }
    const tokens = generateTokens(user);
    await db.query('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
      [uuidv4(), user.id, tokens.refreshToken]);

    res.json({ user: formatUser(user), ...tokens });
  } catch (err) {
    console.error('OTP verify error:', err);
    res.status(500).json({ message: 'Failed to verify OTP' });
  }
});

module.exports = router;
