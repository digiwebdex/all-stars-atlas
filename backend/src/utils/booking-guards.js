/**
 * Booking guards — partial-payment eligibility & route restrictions.
 * Reusable from flights.js and admin checks.
 */
const db = require('../config/db');
const { safeJsonParse } = require('./json');

const BD_AIRPORTS = ['DAC', 'CXB', 'CGP', 'ZYL', 'JSR', 'RJH', 'SPD', 'BZL', 'IRD', 'TKR'];

async function loadPartialSettings() {
  try {
    const [rows] = await db.query(
      "SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('b2c_partial_enabled','b2b_partial_enabled','partial_min_hours','partial_upfront_pct')"
    );
    const map = {};
    rows.forEach((r) => { map[r.setting_key] = r.setting_value; });
    return {
      enabled: String(map.b2c_partial_enabled ?? 'true').toLowerCase() === 'true',
      b2cEnabled: String(map.b2c_partial_enabled ?? 'true').toLowerCase() === 'true',
      b2bEnabled: String(map.b2b_partial_enabled ?? 'true').toLowerCase() === 'true',
      minHours: Number(map.partial_min_hours ?? 96),
      upfrontPct: Number(map.partial_upfront_pct ?? 30),
    };
  } catch {
    return { enabled: true, b2cEnabled: true, b2bEnabled: true, minHours: 96, upfrontPct: 30 };
  }
}

/**
 * Determines whether partial-payment is allowed for a flight.
 * Rules:
 *  - Domestic flight  => never
 *  - Non-refundable   => never
 *  - International + refundable + departure ≥ minHours away => allowed
 *  - Admin override   => bypass all rules
 */
function evaluatePartialEligibility({ origin, destination, departureTime, refundable, partialOverride }, settings) {
  if (partialOverride) return { eligible: true, reason: 'admin_override', upfrontPct: settings.upfrontPct };
  if (!settings.enabled) return { eligible: false, reason: 'disabled_by_admin' };

  const isDomestic = BD_AIRPORTS.includes(String(origin || '').toUpperCase()) && BD_AIRPORTS.includes(String(destination || '').toUpperCase());
  if (isDomestic) return { eligible: false, reason: 'domestic_not_allowed' };

  if (refundable === false) return { eligible: false, reason: 'non_refundable' };

  if (!departureTime) return { eligible: false, reason: 'missing_departure' };
  const dep = new Date(departureTime);
  const hoursToDep = (dep.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursToDep < settings.minHours) {
    return { eligible: false, reason: `within_${settings.minHours}h`, hoursToDep: Math.floor(hoursToDep) };
  }

  return { eligible: true, reason: 'international_refundable_long_lead', upfrontPct: settings.upfrontPct };
}

/**
 * Returns true if airline is BLOCKED for the given route based on admin restrictions.
 */
async function isAirlineRouteBlocked({ airlineCode, originCountry, destCountry }) {
  if (!airlineCode) return false;
  try {
    const [rows] = await db.query(
      'SELECT * FROM airline_route_restrictions WHERE airline_code = ?',
      [String(airlineCode).toUpperCase()]
    );
    for (const r of rows) {
      if (r.blocked_origin_country && r.blocked_origin_country.toUpperCase() === String(originCountry || '').toUpperCase()) return true;
      if (r.blocked_dest_country && r.blocked_dest_country.toUpperCase() === String(destCountry || '').toUpperCase()) return true;
      if (r.allowed_origin_country && r.allowed_origin_country.toUpperCase() !== String(originCountry || '').toUpperCase()) return true;
      if (r.allowed_dest_country && r.allowed_dest_country.toUpperCase() !== String(destCountry || '').toUpperCase()) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Resolves discount/AIT/markup for a user+airline combination.
 * Precedence: user override > airline-specific > global.
 */
async function resolveCommission({ userId, airlineCode }) {
  let globalDiscount = 6.30;
  let globalAit = 0.3;
  let airlineMarkup = 0;
  let airlineCommission = null;
  try {
    const [rows] = await db.query(
      "SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('markup_config','airline_markup_config')"
    );
    for (const r of rows) {
      if (r.setting_key === 'markup_config') {
        const m = safeJsonParse(r.setting_value, {});
        const flight = m.FLIGHT || {};
        if (flight.fareSummaryDiscount != null) globalDiscount = Number(flight.fareSummaryDiscount);
        if (flight.fareSummaryAitVat != null) globalAit = Number(flight.fareSummaryAitVat);
      } else if (r.setting_key === 'airline_markup_config') {
        const a = safeJsonParse(r.setting_value, {});
        const entry = airlineCode ? a[String(airlineCode).toUpperCase()] : null;
        if (entry && !entry.useGlobal) {
          if (entry.discount != null) globalDiscount = Number(entry.discount);
          if (entry.markup != null) airlineMarkup = Number(entry.markup);
          if (entry.commission != null) airlineCommission = Number(entry.commission);
        }
      }
    }
  } catch {}

  // User override wins
  let userOverride = null;
  if (userId) {
    try {
      const [u] = await db.query('SELECT * FROM user_commission_overrides WHERE user_id = ?', [userId]);
      if (u.length) userOverride = u[0];
    } catch {}
  }

  return {
    discountPct: userOverride?.discount_pct != null ? Number(userOverride.discount_pct) : globalDiscount,
    aitPct: userOverride?.ait_pct != null ? Number(userOverride.ait_pct) : globalAit,
    markupPct: userOverride?.markup_pct != null ? Number(userOverride.markup_pct) : airlineMarkup,
    commissionPct: airlineCommission,
    source: userOverride ? 'user_override' : (airlineCode ? 'airline_or_global' : 'global'),
  };
}

module.exports = {
  loadPartialSettings,
  evaluatePartialEligibility,
  isAirlineRouteBlocked,
  resolveCommission,
  BD_AIRPORTS,
};


/**
 * Global (role-based) + per-user partial-payment permission.
 * Returns { allowed, reason }.
 */
async function isPartialAllowedForUser(userId, settings) {
  const s = settings || await loadPartialSettings();
  let role = 'customer';
  try {
    const [rows] = await db.query('SELECT role FROM users WHERE id = ?', [userId]);
    role = rows[0]?.role || 'customer';
  } catch (_) {}
  const isB2B = role === 'agent' || role === 'agency';
  const globalOn = isB2B ? (s.b2bEnabled !== false) : (s.b2cEnabled !== false);
  if (!globalOn) return { allowed: false, reason: isB2B ? 'b2b_partial_disabled' : 'b2c_partial_disabled' };
  try {
    const [rows] = await db.query('SELECT enabled FROM user_partial_permission WHERE user_id = ?', [userId]);
    if (!rows.length || !rows[0].enabled) return { allowed: false, reason: 'user_permission_off' };
  } catch (_) { /* table may not exist */ }
  return { allowed: true, reason: 'ok' };
}

module.exports.isPartialAllowedForUser = isPartialAllowedForUser;
module.exports.loadPartialSettings = loadPartialSettings;
