const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'fallback-secret';

function generateTokens(user) {
  const payload = { sub: user.id, email: user.email, role: user.role };
  const accessToken = jwt.sign(payload, SECRET, { expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m' });
  const refreshToken = jwt.sign({ sub: user.id, type: 'refresh' }, SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d' });
  return { accessToken, refreshToken };
}

function formatUser(row) {
  return {
    id: row.id,
    name: `${row.first_name} ${row.last_name}`,
    email: row.email,
    phone: row.phone || null,
    avatar: row.avatar || null,
    role: row.role,
    emailVerified: !!row.email_verified,
    phoneVerified: !!row.phone_verified,
    canApproveDeposits: !!row.can_approve_deposits,
    createdAt: row.created_at,
  };
}

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required', status: 401 });
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token', status: 401 });
  }
}

// Attaches req.user when a valid token is present, but never blocks the request.
function authenticateOptional(req, _res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.split(' ')[1], SECRET);
    } catch (_) { /* ignore — treat as guest */ }
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'super_admin')) {
    return res.status(403).json({ message: 'Access denied. Admin privileges required.', status: 403 });
  }
  next();
}

module.exports = { generateTokens, formatUser, authenticate, authenticateOptional, requireAdmin };
