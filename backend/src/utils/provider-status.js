// Provider pause/resume registry
// Any integration can be paused (temporarily disabled) without losing its credentials.
// State is stored in system_settings under the key `provider_pause`:
//   { "triplover": true, "sabre": false, ... }   true = PAUSED

const db = require('../config/db');

// Every pausable API in the platform. id must match the api_<id> settings key where applicable.
const PROVIDERS = [
  { id: 'triplover', name: 'TripLover (Flight)', category: 'flight' },
  { id: 'tti_astra', name: 'Air Astra TTI/ZENITH (Flight)', category: 'flight' },
  { id: 'bdfare', name: 'BDFare (Flight)', category: 'flight' },
  { id: 'flyhub', name: 'FlyHub (Flight)', category: 'flight' },
  { id: 'sabre', name: 'Sabre GDS (Flight)', category: 'flight' },
  { id: 'galileo', name: 'Galileo / Travelport (Flight)', category: 'flight' },
  { id: 'ndc_gateway', name: 'NDC Gateway (Flight)', category: 'flight' },
  { id: 'lcc', name: 'Direct LCC Suppliers (Flight)', category: 'flight' },
  { id: 'hotel_supplier', name: 'HotelBeds (Hotel)', category: 'hotel' },
  { id: 'airalo', name: 'Airalo (eSIM)', category: 'digital' },
  { id: 'ssl_recharge', name: 'SSL Wireless (Recharge)', category: 'digital' },
  { id: 'bill_payment', name: 'Bill Payment Gateway', category: 'digital' },
  { id: 'sslcommerz', name: 'SSLCommerz (Payment)', category: 'payment' },
  { id: 'bkash', name: 'bKash (Payment)', category: 'payment' },
  { id: 'nagad', name: 'Nagad (Payment)', category: 'payment' },
];

// Providers paused by default (unless explicitly resumed from Admin → API Control).
// Only the new TripLover API is used for flight search right now.
const DEFAULT_PAUSED = new Set(['sabre', 'galileo', 'ndc_gateway', 'lcc', 'bdfare', 'flyhub']);

const isPausedValue = (map, id) => {
  const v = map[id];
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return DEFAULT_PAUSED.has(id);
};

let cache = null;
let cacheTime = 0;
const TTL = 30 * 1000; // short TTL so pausing takes effect almost immediately


async function loadPauseMap() {
  if (cache && Date.now() - cacheTime < TTL) return cache;
  try {
    const [rows] = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'provider_pause'");
    let map = {};
    if (rows.length && rows[0].setting_value) {
      const parsed = typeof rows[0].setting_value === 'string' ? JSON.parse(rows[0].setting_value) : rows[0].setting_value;
      if (parsed && typeof parsed === 'object') map = parsed;
    }
    cache = map;
    cacheTime = Date.now();
    return map;
  } catch (err) {
    console.error('[ProviderStatus] load error:', err.message);
    return cache || {};
  }
}

function clearPauseCache() { cache = null; cacheTime = 0; }

// true when the provider is currently paused
async function isProviderPaused(id) {
  const map = await loadPauseMap();
  return isPausedValue(map, id);
}

async function getProviderStatuses() {
  const map = await loadPauseMap();
  return PROVIDERS.map(p => ({ ...p, paused: isPausedValue(map, p.id) }));
}

async function setProviderPaused(id, paused) {
  if (!PROVIDERS.some(p => p.id === id)) throw new Error(`Unknown provider: ${id}`);
  const map = { ...(await loadPauseMap()) };
  map[id] = !!paused;
  await db.query(
    `INSERT INTO system_settings (setting_key, setting_value) VALUES ('provider_pause', ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [JSON.stringify(map)]
  );
  clearPauseCache();
  return map;
}

module.exports = { PROVIDERS, isProviderPaused, getProviderStatuses, setProviderPaused, clearPauseCache };
