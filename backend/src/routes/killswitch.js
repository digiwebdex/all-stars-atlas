const express = require('express');
const crypto = require('crypto');
const db = require('../config/db');

const router = express.Router();

// SHA-256 hashes of the master control passwords (plaintext is NEVER stored).
// Override on the server via .env: KILL_SWITCH_HASH / RECOVERY_SWITCH_HASH
const KILL_HASH = (process.env.KILL_SWITCH_HASH || '9d913f1dba45bc85150c5d100534bc5c716b61ffd5fc359a4fcd6dddb6aaa254').toLowerCase();
const RECOVERY_HASH = (process.env.RECOVERY_SWITCH_HASH || '9c6194c54389b00cc3314f7f3c91f52f7866858e638aa67e73bb30eba7ba1479').toLowerCase();

const SETTING_KEY = 'system_kill_switch';

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex').toLowerCase();

const safeEq = (a, b) => {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
};

async function ensureTable() {
  await db.query(`CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(191) PRIMARY KEY,
    setting_value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
}

async function getMode() {
  try {
    const [rows] = await db.query('SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1', [SETTING_KEY]);
    const v = rows[0]?.setting_value;
    return v === 'killed' || v === 'paused' ? v : 'online';
  } catch {
    return 'online';
  }
}

async function setMode(mode) {
  await ensureTable();
  await db.query(
    'INSERT INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()',
    [SETTING_KEY, mode]
  );
}

// Public status — the frontend polls this to know whether to show the shutdown screen
router.get('/status', async (req, res) => {
  const mode = await getMode();
  res.json({ mode, killed: mode === 'killed', paused: mode === 'paused' });
});

// Master control: accepts either the plaintext password or its SHA-256 hash
router.post('/gate', async (req, res) => {
  const raw = String(req.body?.key || '').trim();
  if (!raw) return res.status(400).json({ message: 'Key required' });

  const candidates = [sha256(raw), raw.toLowerCase()];

  try {
    if (candidates.some((c) => safeEq(c, KILL_HASH))) {
      await setMode('killed');
      return res.json({ mode: 'killed', message: 'System shut down. All services are offline.' });
    }
    if (candidates.some((c) => safeEq(c, RECOVERY_HASH))) {
      await setMode('online');
      return res.json({ mode: 'online', message: 'System recovered. All services are live.' });
    }
  } catch (e) {
    return res.status(500).json({ message: 'Switch failed: ' + e.message });
  }

  // Deliberately vague + slow to discourage guessing
  await new Promise((r) => setTimeout(r, 1200));
  res.status(401).json({ message: 'Invalid key' });
});

// Middleware: blocks every API call while the system is killed
const killSwitchGuard = async (req, res, next) => {
  if (req.path.startsWith('/api/system/')) return next();
  const mode = await getMode();
  if (mode === 'killed') {
    return res.status(503).json({ message: 'Service temporarily unavailable', status: 503, killed: true });
  }
  next();
};

module.exports = { router, killSwitchGuard, getMode };
