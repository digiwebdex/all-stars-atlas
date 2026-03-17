/**
 * Sabre Hotel API Integration — SOAP-based (OTA_HotelAvailLLSRQ)
 * Uses session-based SOAP on webservices.platform.sabre.com (same as flights)
 * NOTE: CSL REST APIs (havail.sabre.com) require separate activation/credentials.
 *       This implementation uses the LLS SOAP APIs that work with existing PCC credentials.
 *
 * SOAP Services:
 *   OTA_HotelAvailLLSRQ v2.3.0           — Search hotels by city code
 *   HotelPropertyDescriptionLLSRQ v2.3.0  — Hotel details + room rates
 *   CreatePassengerNameRecordRQ v2.4.0     — PNR creation (REST, on platform.sabre.com)
 */

const db = require('../config/db');
const { safeJsonParse } = require('../utils/json');

// Import SOAP hotel functions
let _sabreSoap = null;
function getSabreSoap() {
  if (!_sabreSoap) {
    try { _sabreSoap = require('./sabre-soap'); } catch { _sabreSoap = {}; }
  }
  return _sabreSoap;
}

// ── Reuse Sabre auth from sabre-flights (shared token cache) ──
let _configCache = null;
let _configCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getSabreConfig() {
  if (_configCache && Date.now() - _configCacheTime < CACHE_TTL) return _configCache;
  try {
    const [rows] = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'api_sabre'");
    if (rows.length === 0 || !rows[0].setting_value) return null;
    const cfg = JSON.parse(rows[0].setting_value);
    if (cfg.enabled !== 'true' && cfg.enabled !== true) return null;

    const isProd = cfg.environment === 'production' || cfg.environment === 'prod'
      || (!cfg.environment && (cfg.prod_url || cfg.prod_basic_auth || cfg.prodPassword));

    // Flight/booking API base (platform.sabre.com)
    const platformUrl = isProd
      ? (cfg.prod_url || 'https://api.platform.sabre.com')
      : (cfg.sandbox_url || 'https://api.cert.platform.sabre.com');

    // Hotel CSL API base (havail.sabre.com) — DIFFERENT DOMAIN
    const hotelUrl = isProd
      ? 'https://api.havail.sabre.com'
      : 'https://api-crt.cert.havail.sabre.com';

    const pick = (...vals) => vals.find(v => typeof v === 'string' && v.trim().length > 0)?.trim() || '';

    const clientId = isProd
      ? pick(cfg.prod_client_id, cfg.clientId, cfg.sandbox_client_id)
      : pick(cfg.cert_client_id, cfg.clientId, cfg.sandbox_client_id, cfg.prod_client_id);
    const clientSecret = isProd
      ? pick(cfg.prod_client_secret, cfg.clientSecret, cfg.sandbox_client_secret)
      : pick(cfg.cert_client_secret, cfg.clientSecret, cfg.sandbox_client_secret, cfg.prod_client_secret);

    const basicAuth = isProd ? pick(cfg.prod_basic_auth) : pick(cfg.cert_basic_auth);
    // CSL App ID is a distinct credential from OAuth client_id
    const appId = pick(cfg.appId, cfg.app_id, cfg.customerAppId, cfg.customer_app_id, cfg.cslAppId, cfg.csl_app_id);

    if (!clientId || !clientSecret) return null;

    const epr = pick(cfg.epr);
    const agencyPassword = isProd
      ? pick(cfg.prodPassword, cfg.agency_password)
      : pick(cfg.agencyPassword, cfg.agency_password);
    if (!epr || !agencyPassword) return null;

    _configCache = {
      baseUrl: platformUrl.replace(/\/$/, ''),
      hotelUrl: hotelUrl.replace(/\/$/, ''),
      clientId, clientSecret, basicAuth, appId,
      pcc: cfg.pcc || cfg.scCode || '',
      epr, agencyPassword,
      environment: isProd ? 'production' : (cfg.environment || 'cert'),
    };
    _configCacheTime = Date.now();
    return _configCache;
  } catch (err) {
    console.error('[Sabre Hotels] Config load error:', err.message);
    return null;
  }
}

function clearSabreHotelConfigCache() { _configCache = null; _configCacheTime = 0; }

// ── OAuth — CSL uses /v2/auth/token on havail; platform commonly uses /v3/auth/token password grant ──
// References:
// - https://developer.sabre.com/rest-api/oauth-token-create-rest-api/v2/index.html
// - Existing, proven flight auth flow in sabre-flights.js (/v3/auth/token + password grant)
let hotelTokenCache = { token: null, expiresAt: 0 };
let platformTokenCache = { token: null, expiresAt: 0 };

function writeHotelAuthDebug(payload) {
  try {
    require('fs').writeFileSync('/tmp/sabre-hotel-auth-debug.json', JSON.stringify(payload, null, 2));
  } catch {}
}

async function getAccessToken(config, domain = 'hotel') {
  const cache = domain === 'hotel' ? hotelTokenCache : platformTokenCache;
  if (cache.token && Date.now() < cache.expiresAt - 60000) return cache.token;

  const credentials = config.basicAuth
    ? config.basicAuth
    : Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  const username = `${config.epr}-${config.pcc}-AA`;
  const passwordGrantBody = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(config.agencyPassword)}`;

  const attempts = [];
  const plans = domain === 'hotel'
    ? [
        // Official CSL token endpoint (if CSL is provisioned)
        { base: config.hotelUrl, path: '/v2/auth/token', body: 'grant_type=client_credentials', label: 'havail-v2-client' },
        { base: config.hotelUrl, path: '/v3/auth/token', body: 'grant_type=client_credentials', label: 'havail-v3-client' },
        // Practical fallback: use proven platform token flow
        { base: config.baseUrl, path: '/v3/auth/token', body: passwordGrantBody, label: 'platform-v3-password-fallback' },
        { base: config.baseUrl, path: '/v3/auth/token', body: 'grant_type=client_credentials', label: 'platform-v3-client-fallback' },
      ]
    : [
        // Match working flight auth first
        { base: config.baseUrl, path: '/v3/auth/token', body: passwordGrantBody, label: 'platform-v3-password' },
        { base: config.baseUrl, path: '/v3/auth/token', body: 'grant_type=client_credentials', label: 'platform-v3-client' },
        { base: config.baseUrl, path: '/v2/auth/token', body: 'grant_type=client_credentials', label: 'platform-v2-client' },
      ];

  for (const plan of plans) {
    const url = `${plan.base}${plan.path}`;
    const grantType = plan.body.split('&')[0];
    try {
      console.log(`[Sabre Hotels] Auth try → ${url} (${plan.label}, ${grantType})`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: plan.body,
        signal: AbortSignal.timeout(12000),
      });

      const raw = await res.text().catch(() => '');
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch {}

      attempts.push({
        label: plan.label,
        url,
        status: res.status,
        ok: res.ok,
        preview: (data?.error_description || data?.error || raw || '').slice(0, 220),
      });

      if (!res.ok) {
        console.warn(`[Sabre Hotels] Auth ${res.status} from ${url}: ${(data?.error_description || data?.error || raw || '').slice(0, 200)}`);
        continue;
      }

      const token = data?.access_token;
      if (!token) {
        console.warn(`[Sabre Hotels] Auth response without access_token from ${url}`);
        continue;
      }

      const newCache = { token, expiresAt: Date.now() + (data?.expires_in || 604800) * 1000 };
      if (domain === 'hotel') hotelTokenCache = newCache;
      else platformTokenCache = newCache;

      writeHotelAuthDebug({
        domain,
        success: true,
        selected: { label: plan.label, url, status: res.status },
        attempts,
        timestamp: new Date().toISOString(),
      });

      console.log(`[Sabre Hotels] ✓ Auth success (${plan.label})`);
      return token;
    } catch (err) {
      attempts.push({ label: plan.label, url, ok: false, error: err.message });
      console.warn(`[Sabre Hotels] Auth error ${url}: ${err.message}`);
    }
  }

  // Last resort: platform token can often authorize hotel calls
  if (domain === 'hotel') {
    if (platformTokenCache.token && Date.now() < platformTokenCache.expiresAt - 60000) {
      console.log('[Sabre Hotels] Reusing cached platform token for hotel domain');
      return platformTokenCache.token;
    }

    const fallbackPlatformToken = await getAccessToken(config, 'platform');
    if (fallbackPlatformToken) {
      hotelTokenCache = { token: fallbackPlatformToken, expiresAt: platformTokenCache.expiresAt };
      console.log('[Sabre Hotels] Reusing freshly-acquired platform token for hotel domain');
      return fallbackPlatformToken;
    }
  }

  writeHotelAuthDebug({
    domain,
    success: false,
    attempts,
    hint: domain === 'hotel'
      ? 'If havail fails but platform v3 password works, CSL might not be provisioned for this PCC.'
      : 'Platform OAuth failed. Verify client credentials, EPR, PCC, and agency password in api_sabre settings.',
    timestamp: new Date().toISOString(),
  });

  console.error(`[Sabre Hotels] ✗ All auth attempts failed for domain=${domain}`);
  return null;
}

// ── REST CSL request — matches official Sabre sample: POST /v2.1.0/get/hotelavail ──
// Endpoint versions to try (v2.1.0 is Sabre's official sample, v5 is latest)
const HOTEL_AVAIL_ENDPOINTS = [
  '/v2.1.0/get/hotelavail',  // Official Sabre sample uses this
  '/v5.0.0/get/hotelavail',  // Latest documented version
  '/v4.1.0/get/hotelavail',
  '/v3.0.0/get/hotelavail',
];

const HOTEL_DETAILS_ENDPOINTS = [
  '/v2.1.0/get/hoteldetails',
  '/v5.1.0/get/hoteldetails',
  '/v4.1.0/get/hoteldetails',
];

const fs = require('fs');

async function sabreHotelRequest(config, endpoint, body, method = 'POST', timeoutMs = 30000) {
  const endpointCandidates = endpoint.includes('hotelavail') ? HOTEL_AVAIL_ENDPOINTS
    : endpoint.includes('hoteldetails') ? HOTEL_DETAILS_ENDPOINTS
    : [endpoint];

  // Try hotel domain (havail) first, then platform domain
  const domains = [
    { baseUrl: config.hotelUrl, label: 'havail', tokenDomain: 'hotel' },
    { baseUrl: config.baseUrl, label: 'platform', tokenDomain: 'platform' },
  ];

  const errors = [];

  for (const domain of domains) {
    const token = await getAccessToken(config, domain.tokenDomain);
    if (!token) {
      errors.push(`${domain.label}: no auth token`);
      continue;
    }

    for (const path of endpointCandidates) {
      const url = `${domain.baseUrl}${path}`;
      try {
        const headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        };
        if (config.appId) headers['Application-ID'] = config.appId;

        console.log(`[Sabre Hotels] → ${method} ${url}`);
        const res = await fetch(url, {
          method,
          headers,
          body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });

        const responseText = await res.text();

        // Write diagnostic file
        try {
          fs.writeFileSync('/tmp/sabre-hotel-rest-response.json', responseText);
          console.log(`[Sabre Hotels] REST response (${res.status}) written to /tmp/sabre-hotel-rest-response.json (${responseText.length} bytes)`);
        } catch {}

        if (!res.ok) {
          console.warn(`[Sabre Hotels] ${domain.label} ${path}: HTTP ${res.status} — ${responseText.slice(0, 300)}`);
          errors.push(`${domain.label} ${path}: ${res.status}`);

          // If 401/403, token is bad for this domain — skip remaining endpoints on it
          if (res.status === 401 || res.status === 403) {
            errors.push(`${domain.label}: auth rejected (${res.status}) — CSL may not be activated for this PCC`);
            break;
          }
          continue;
        }

        // Parse response
        let data;
        try { data = JSON.parse(responseText); } catch { data = {}; }
        console.log(`[Sabre Hotels] ✓ REST success via ${domain.label} ${path}`);
        return data;
      } catch (err) {
        console.warn(`[Sabre Hotels] ${domain.label} ${path}: ${err.message}`);
        errors.push(`${domain.label} ${path}: ${err.message}`);
      }
    }
  }

  const errSummary = errors.join(' | ');
  console.error(`[Sabre Hotels] ✗ REST CSL failed all attempts: ${errSummary}`);
  throw new Error(`Sabre Hotels REST: all failed — ${errSummary}`);
}

// ── City/Airport code resolution ──
// Sabre Hotel GeoSearch uses IATA airport codes (RefPointType=6 for city, 1 for airport)
const CITY_TO_CODES = {
  // Bangladesh
  'dhaka': { code: 'DAC', type: '1' }, 'chittagong': { code: 'CGP', type: '1' }, 'chattogram': { code: 'CGP', type: '1' },
  'sylhet': { code: 'ZYL', type: '1' }, 'coxs bazar': { code: 'CXB', type: '1' }, "cox's bazar": { code: 'CXB', type: '1' },
  'rajshahi': { code: 'RJH', type: '1' }, 'jessore': { code: 'JSR', type: '1' },
  'barishal': { code: 'BZL', type: '1' }, 'barisal': { code: 'BZL', type: '1' }, 'saidpur': { code: 'SPD', type: '1' },
  // International popular
  'dubai': { code: 'DXB', type: '1' }, 'abu dhabi': { code: 'AUH', type: '1' },
  'bangkok': { code: 'BKK', type: '1' }, 'pattaya': { code: 'UTP', type: '1' },
  'singapore': { code: 'SIN', type: '1' },
  'kuala lumpur': { code: 'KUL', type: '1' }, 'penang': { code: 'PEN', type: '1' },
  'kolkata': { code: 'CCU', type: '1' }, 'delhi': { code: 'DEL', type: '1' }, 'new delhi': { code: 'DEL', type: '1' },
  'mumbai': { code: 'BOM', type: '1' }, 'goa': { code: 'GOI', type: '1' }, 'chennai': { code: 'MAA', type: '1' },
  'london': { code: 'LON', type: '6' }, 'new york': { code: 'NYC', type: '6' }, 'los angeles': { code: 'LAX', type: '1' },
  'istanbul': { code: 'IST', type: '1' }, 'jeddah': { code: 'JED', type: '1' }, 'riyadh': { code: 'RUH', type: '1' },
  'medina': { code: 'MED', type: '1' }, 'makkah': { code: 'JED', type: '1' }, 'mecca': { code: 'JED', type: '1' },
  'doha': { code: 'DOH', type: '1' }, 'muscat': { code: 'MCT', type: '1' },
  'male': { code: 'MLE', type: '1' }, 'maldives': { code: 'MLE', type: '1' },
  'kathmandu': { code: 'KTM', type: '1' },
  'tokyo': { code: 'TYO', type: '6' }, 'osaka': { code: 'KIX', type: '1' },
  'hong kong': { code: 'HKG', type: '1' }, 'seoul': { code: 'ICN', type: '1' },
  'phuket': { code: 'HKT', type: '1' }, 'bali': { code: 'DPS', type: '1' },
  'paris': { code: 'PAR', type: '6' }, 'rome': { code: 'ROM', type: '6' },
  'cairo': { code: 'CAI', type: '1' }, 'nairobi': { code: 'NBO', type: '1' },
  'sydney': { code: 'SYD', type: '1' }, 'melbourne': { code: 'MEL', type: '1' },
  'toronto': { code: 'YYZ', type: '1' }, 'vancouver': { code: 'YVR', type: '1' },
};

function resolveCity(city) {
  if (!city) return null;
  const cleaned = city.trim().toLowerCase().replace(/['']/g, "'");
  if (CITY_TO_CODES[cleaned]) return CITY_TO_CODES[cleaned];
  // Try partial match
  for (const [key, val] of Object.entries(CITY_TO_CODES)) {
    if (cleaned.includes(key) || key.includes(cleaned)) return val;
  }
  // If 3-letter code directly
  if (cleaned.length === 3) return { code: cleaned.toUpperCase(), type: '1' };
  return null;
}


// ══════════════════════════════════════════════
//  1. HOTEL SEARCH — SOAP OTA_HotelAvailLLSRQ (uses existing PCC credentials)
// ══════════════════════════════════════════════
async function searchHotels({ city, checkIn, checkOut, adults = 2, children = 0, rooms = 1, minRate, maxRate, minStars, maxStars }) {
  const resolved = resolveCity(city);
  if (!resolved) { console.warn(`[Sabre Hotels] Could not resolve city: ${city}`); return []; }

  const { code: cityCode, type: cityType } = resolved;
  const totalGuests = parseInt(adults) + parseInt(children || 0);

  try {
    let hotels = [];

    // Strategy 1: Try REST CSL first (official Sabre approach — havail.sabre.com)
    const config = await getSabreConfig();
    if (config && checkIn && checkOut) {
      const roomCount = Math.max(1, parseInt(rooms || 1, 10) || 1);
      const adultsPerRoom = Math.max(1, Math.ceil((parseInt(adults || 1, 10) || 1) / roomCount));
      const childrenPerRoom = Math.max(0, Math.ceil((parseInt(children || 0, 10) || 0) / roomCount));

      // Exact payload from Sabre official sample:
      // https://github.com/SabreDevStudio/get-hotel-avail-v2-sample-nodejs/blob/master/app/hotelAvailabilityModel.js
      const requestBody = {
        GetHotelAvailRQ: {
          SearchCriteria: {
            OffSet: 1,
            SortBy: 'TotalRate',
            SortOrder: 'ASC',
            PageSize: 50,
            TierLabels: false,
            GeoSearch: {
              GeoRef: {
                Radius: 50,
                UOM: 'MI',
                RefPoint: {
                  Value: cityCode,
                  ValueContext: 'CODE',
                  RefPointType: '6',  // Sabre sample uses '6' (city)
                },
              },
            },
            RateInfoRef: {
              ConvertedRateInfoOnly: false,
              CurrencyCode: 'USD',
              BestOnly: '2',
              PrepaidQualifier: 'IncludePrepaid',
              StayDateRange: {
                StartDate: checkIn,
                EndDate: checkOut,
              },
              Rooms: {
                Room: Array.from({ length: roomCount }, (_, idx) => ({
                  Index: idx + 1,
                  Adults: adultsPerRoom,
                  Children: childrenPerRoom,
                })),
              },
              InfoSource: '100,110,112,113',  // 100=Sabre GDS, 110=Expedia, 112=Bedsonline, 113=Booking.com
            },
            HotelPref: {
              SabreRating: {
                Min: String(minStars ? parseInt(minStars, 10) : 1),
                Max: String(maxStars ? parseInt(maxStars, 10) : 5),
              },
            },
            ImageRef: {
              Type: 'MEDIUM',
              LanguageCode: 'EN',
            },
          },
        },
      };

      try {
        console.log(`[Sabre Hotels] REST CSL search: city=${cityCode}, ${checkIn} → ${checkOut}, ${adultsPerRoom}A+${childrenPerRoom}C, ${roomCount} rooms`);
        const restResponse = await sabreHotelRequest(config, '/v2.1.0/get/hotelavail', requestBody, 'POST', 30000);
        hotels = normalizeSearchResponse(restResponse, city, checkIn, checkOut);
        console.log(`[Sabre Hotels] REST CSL found ${hotels.length} hotels for ${city}`);
      } catch (restErr) {
        console.error('[Sabre Hotels] REST CSL failed:', restErr.message);
      }
    }

    // Strategy 2: Fallback to SOAP LLS (uses existing PCC session)
    if (hotels.length === 0) {
      const sabreSoap = getSabreSoap();
      if (sabreSoap.getHotelAvail) {
        try {
          console.log(`[Sabre Hotels] SOAP fallback: city=${cityCode}, ${checkIn} → ${checkOut}`);
          const soapHotels = await sabreSoap.getHotelAvail({
            cityCode, cityType, cityName: city,
            checkIn, checkOut, guests: totalGuests, rooms,
          });
          console.log(`[Sabre Hotels] SOAP found ${soapHotels.length} hotels for ${city}`);
          hotels = soapHotels;
        } catch (soapErr) {
          console.error('[Sabre Hotels] SOAP fallback failed:', soapErr.message);
        }
      }
    }

    // Apply client-side filters
    if (minStars) hotels = hotels.filter(h => (h.starRating || 0) >= parseInt(minStars));
    if (maxStars) hotels = hotels.filter(h => (h.starRating || 0) <= parseInt(maxStars));
    if (minRate) hotels = hotels.filter(h => (h.price || 0) >= parseFloat(minRate));
    if (maxRate) hotels = hotels.filter(h => (h.price || 0) <= parseFloat(maxRate));

    return hotels;
  } catch (err) {
    console.error('[Sabre Hotels] Hotel search failed:', err.message);
    return [];
  }
}

function normalizeSearchResponse(response, searchCity, checkIn, checkOut) {
  const hotels = [];
  try {
    const avail = response?.GetHotelAvailRS;
    if (!avail) {
      console.warn('[Sabre Hotels] No GetHotelAvailRS in response. Keys:', Object.keys(response || {}));
      return [];
    }
    
    const hotelAvail = avail?.HotelAvailInfos?.HotelAvailInfo || [];
    if (!Array.isArray(hotelAvail)) {
      console.warn('[Sabre Hotels] HotelAvailInfo is not array:', typeof hotelAvail);
      return [];
    }

    // Calculate nights for total price
    const nights = checkIn && checkOut ? Math.max(1, Math.ceil((new Date(checkOut) - new Date(checkIn)) / 86400000)) : 1;

    for (const h of hotelAvail) {
      const info = h.HotelInfo || {};
      const rateInfo = h.HotelRateInfo || {};
      const rates = rateInfo.Rates?.Rate || [];
      const lowestRate = Array.isArray(rates) ? rates[0] : rates;

      // Extract amenities from PropertyOptionInfo
      const opts = info.PropertyOptionInfo || {};
      const amenities = [];
      if (opts.Wifi === 'true' || opts.FreeWifi === 'true') amenities.push('Free WiFi');
      if (opts.Pool === 'true' || opts.IndoorPool === 'true' || opts.OutdoorPool === 'true') amenities.push('Swimming Pool');
      if (opts.Restaurant === 'true') amenities.push('Restaurant');
      if (opts.Parking === 'true' || opts.FreeParking === 'true') amenities.push('Parking');
      if (opts.FreeParking === 'true') amenities.push('Free Parking');
      if (opts.Gym === 'true' || opts.FitnessCenter === 'true') amenities.push('Fitness Center');
      if (opts.Spa === 'true') amenities.push('Spa');
      if (opts.AirConditioning === 'true') amenities.push('Air Conditioning');
      if (opts.BreakfastBuffet === 'true' || opts.FreeBreakfast === 'true') amenities.push('Breakfast Included');
      if (opts.BusinessCenter === 'true') amenities.push('Business Center');
      if (opts.RoomService === 'true') amenities.push('Room Service');
      if (opts.LaundryService === 'true') amenities.push('Laundry');
      if (opts.PetsAllowed === 'true') amenities.push('Pet Friendly');
      if (opts.AirportShuttle === 'true') amenities.push('Airport Shuttle');
      if (opts.Bar === 'true' || opts.Lounge === 'true') amenities.push('Bar/Lounge');
      if (opts.MeetingRooms === 'true') amenities.push('Meeting Rooms');

      // Price extraction — Sabre returns various rate formats
      let pricePerNight = null;
      let totalPrice = null;
      let currencyCode = 'USD';

      if (lowestRate) {
        const avgNightly = parseFloat(lowestRate.AverageNightlyRate || lowestRate.AverageNightlyRateBeforeTax || 0);
        const amount = parseFloat(lowestRate.Amount || lowestRate.AmountBeforeTax || 0);
        currencyCode = lowestRate.CurrencyCode || 'USD';

        if (avgNightly > 0) {
          pricePerNight = avgNightly;
          totalPrice = avgNightly * nights;
        } else if (amount > 0) {
          // Amount might be total or nightly depending on context
          if (amount > 500 && nights > 1) {
            totalPrice = amount;
            pricePerNight = Math.round(amount / nights);
          } else {
            pricePerNight = amount;
            totalPrice = amount * nights;
          }
        }
      }

      // Skip hotels without price
      if (!pricePerNight) continue;

      // Image handling — Sabre returns ImageURL or HotelImageUrl
      const imageUrl = info.ImageURL || info.HotelImageUrl || null;
      const images = imageUrl ? [imageUrl] : [];

      // Location info
      const locInfo = info.LocationInfo || {};
      const address = locInfo.Address?.AddressLine1 || locInfo.Address?.AddressLine || '';
      const hotelCity = locInfo.City || searchCity || '';
      const country = locInfo.CountryName || locInfo.Country || '';

      // Star/rating
      const sabreRating = parseInt(info.SabreRating || info.HotelRating || info.PropertyRating || 0);
      const tripAdvisorRating = parseFloat(info.TripAdvisorRating || 0);
      const tripAdvisorReviews = parseInt(info.TripAdvisorReviewCount || 0);

      // Cancellation policy from rate
      const cancelPolicy = lowestRate?.RateDescription || lowestRate?.GuaranteeInfo?.Description || null;
      const isFreeCancellation = cancelPolicy?.toLowerCase()?.includes('free cancel') 
        || cancelPolicy?.toLowerCase()?.includes('refundable')
        || lowestRate?.RateQualifier === 'REF';

      // Tags
      const tags = [];
      if (sabreRating >= 5) tags.push('Luxury');
      else if (sabreRating >= 4) tags.push('Top Rated');
      if (isFreeCancellation) tags.push('Free Cancellation');
      if (amenities.includes('Breakfast Included')) tags.push('Breakfast Included');

      const hotelCode = info.HotelCode || info.SabreHotelCode;

      hotels.push({
        id: `sabre-${hotelCode || Math.random().toString(36).slice(2, 10)}`,
        sabreHotelCode: hotelCode,
        source: 'sabre',
        name: info.HotelName || 'Hotel',
        city: hotelCity,
        country,
        address,
        latitude: parseFloat(locInfo.Latitude || 0) || null,
        longitude: parseFloat(locInfo.Longitude || 0) || null,
        starRating: sabreRating,
        stars: sabreRating,
        userRating: tripAdvisorRating || (sabreRating > 0 ? sabreRating * 0.9 : null),
        rating: tripAdvisorRating || (sabreRating > 0 ? sabreRating * 0.9 : null),
        reviewCount: tripAdvisorReviews,
        reviews: tripAdvisorReviews,
        pricePerNight: Math.round(pricePerNight),
        price: Math.round(pricePerNight),
        totalPrice: Math.round(totalPrice),
        originalPrice: null,
        currency: currencyCode,
        img: imageUrl || null,
        images,
        amenities,
        description: info.HotelDescription || '',
        tags,
        tag: tags[0] || null,
        location: `${hotelCity}, ${country}`.replace(/, $/, ''),
        cancelPolicy,
        isFreeCancellation: !!isFreeCancellation,
        rateKey: lowestRate?.RateKey || null,
        nights,
        checkIn,
        checkOut,
        roomsAvailable: lowestRate?.AvailableRooms || null,
      });
    }
  } catch (err) {
    console.error('[Sabre Hotels] Response normalization error:', err.message, err.stack);
  }

  console.log(`[Sabre Hotels] Normalized ${hotels.length} hotels from response`);
  return hotels;
}


// ══════════════════════════════════════════════
//  2. HOTEL DETAILS — SOAP HotelPropertyDescriptionLLSRQ
// ══════════════════════════════════════════════
async function getHotelDetails(hotelCode, checkIn, checkOut, adults, rooms) {
  try {
    const sabreSoap = getSabreSoap();
    if (!sabreSoap.getHotelPropertyDescription) {
      console.warn('[Sabre Hotels] SOAP hotel details not available');
      return null;
    }

    const result = await sabreSoap.getHotelPropertyDescription({
      hotelCode,
      checkIn,
      checkOut,
      guests: adults || 2,
    });

    if (!result) return null;

    return {
      ...result,
      source: 'sabre',
      sabreHotelCode: hotelCode,
      checkIn,
      checkOut,
    };
  } catch (err) {
    console.error('[Sabre Hotels] SOAP details failed:', err.message);
    return null;
  }
}

async function getHotelContent(_config, hotelCode, checkIn, checkOut, adults) {
  try {
    const sabreSoap = getSabreSoap();
    if (!sabreSoap.getHotelPropertyDescription) return {};

    const details = await sabreSoap.getHotelPropertyDescription({
      hotelCode,
      checkIn,
      checkOut,
      guests: adults || 2,
    });

    if (!details) return {};

    return {
      id: details.id || `sabre-${hotelCode}`,
      name: details.name || '',
      city: details.city || '',
      country: details.country || '',
      address: details.address || '',
      latitude: details.latitude ?? null,
      longitude: details.longitude ?? null,
      starRating: details.starRating || 0,
      stars: details.stars || details.starRating || 0,
      images: Array.isArray(details.images) ? details.images : [],
      amenities: Array.isArray(details.amenities) ? details.amenities : [],
      description: details.description || '',
      policies: Array.isArray(details.policies) ? details.policies : [],
      checkInTime: details.checkInTime || '15:00',
      checkOutTime: details.checkOutTime || '11:00',
      contactInfo: details.contactInfo || {},
      rating: details.rating || null,
      reviews: details.reviews || 0,
      source: 'sabre',
      sabreHotelCode: hotelCode,
    };
  } catch (err) {
    console.error(`[Sabre Hotels] Content fetch failed for ${hotelCode}:`, err.message);
    return {};
  }
}

async function getHotelRates(_config, hotelCode, checkIn, checkOut, adults, rooms) {
  try {
    const sabreSoap = getSabreSoap();
    if (!sabreSoap.getHotelPropertyDescription) return [];

    const details = await sabreSoap.getHotelPropertyDescription({
      hotelCode,
      checkIn,
      checkOut,
      guests: adults || 2,
      rooms,
    });

    const roomResults = Array.isArray(details?.rooms) ? details.rooms : [];
    roomResults.sort((a, b) => (a.price || 0) - (b.price || 0));
    return roomResults;
  } catch (err) {
    console.error(`[Sabre Hotels] Rates fetch failed for ${hotelCode}:`, err.message);
    return [];
  }
}


// ══════════════════════════════════════════════
//  3. HOTEL BOOKING — CreatePNR with Hotel segment
// ══════════════════════════════════════════════
async function bookHotel({ hotelCode, rateKey, bookingKey, checkIn, checkOut, rooms, guests, contactInfo, paymentInfo }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre not configured');

  const primaryGuest = guests?.[0] || {};

  const body = {
    CreatePassengerNameRecordRQ: {
      version: '2.4.0',
      TravelItineraryAddInfo: {
        CustomerInfo: {
          ContactNumbers: {
            ContactNumber: [{
              Phone: contactInfo?.phone || primaryGuest.phone || '01700000000',
              PhoneUseType: 'H'
            }]
          },
          PersonName: [{
            NameNumber: '1.1',
            GivenName: (primaryGuest.firstName || 'GUEST').toUpperCase(),
            Surname: (primaryGuest.lastName || 'TRAVELER').toUpperCase(),
          }],
          Email: [{ Address: contactInfo?.email || primaryGuest.email || '', Type: 'TO' }]
        },
        AgencyInfo: {
          Ticketing: { TicketType: '7TAW' }
        }
      },
      HotelBook: {
        HotelSegment: [{
          BasicHotelInfo: {
            HotelCode: hotelCode,
          },
          Guarantee: paymentInfo ? {
            PaymentCard: {
              CardCode: paymentInfo.cardType || 'VI',
              CardNumber: paymentInfo.cardNumber,
              ExpirationDate: paymentInfo.expiry,
              CardHolderName: paymentInfo.cardHolder || `${primaryGuest.firstName} ${primaryGuest.lastName}`.toUpperCase(),
            },
          } : undefined,
          GuestCounts: {
            GuestCount: [{ Count: parseInt(rooms?.[0]?.adults || 2) }]
          },
          TimeSpan: {
            Start: checkIn,
            End: checkOut,
          },
          BookingKey: bookingKey || undefined,
          RoomRateDescription: rateKey ? { Text: [rateKey] } : undefined,
        }]
      },
      PostProcessing: {
        EndTransaction: {
          Source: { ReceivedFrom: 'SEVEN TRIP WEB' }
        }
      }
    }
  };

  try {
    console.log(`[Sabre Hotels] Booking hotel ${hotelCode}: ${checkIn} → ${checkOut}`);
    const response = await sabreRequest(config, '/v2.4.0/passenger/records?mode=create', body, 'POST', 45000);
    
    // Extract PNR from multiple possible paths
    const pnr = response?.CreatePassengerNameRecordRS?.ItineraryRef?.ID
      || response?.CreatePassengerNameRecordRS?.TravelItineraryReadRS?.TravelItinerary?.ItineraryRef?.ID;
    const confNumber = response?.CreatePassengerNameRecordRS?.HotelBook?.HotelSegment?.[0]?.ConfirmationNumber;

    return {
      success: true,
      pnr: pnr || null,
      confirmationNumber: confNumber || null,
      source: 'sabre',
      rawResponse: response,
    };
  } catch (err) {
    console.error('[Sabre Hotels] Booking failed:', err.message);
    throw err;
  }
}


// ══════════════════════════════════════════════
//  4. HOTEL DEALS — Background cache for homepage
// ══════════════════════════════════════════════
let hotelDealsCache = { data: null, expiry: 0 };

const POPULAR_DESTINATIONS = [
  { city: "Cox's Bazar", cityCode: 'CXB' },
  { city: 'Dubai', cityCode: 'DXB' },
  { city: 'Bangkok', cityCode: 'BKK' },
  { city: 'Singapore', cityCode: 'SIN' },
  { city: 'Kuala Lumpur', cityCode: 'KUL' },
  { city: 'Istanbul', cityCode: 'IST' },
  { city: 'Maldives', cityCode: 'MLE' },
  { city: 'Kolkata', cityCode: 'CCU' },
];

async function getTopHotelDeals() {
  if (hotelDealsCache.data && Date.now() < hotelDealsCache.expiry) {
    return hotelDealsCache.data;
  }

  const config = await getSabreConfig();
  if (!config) return [];

  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const dayAfterTomorrow = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];

  const results = [];

  const searches = POPULAR_DESTINATIONS.map(async (dest) => {
    try {
      const hotels = await searchHotels({
        city: dest.city,
        checkIn: tomorrow,
        checkOut: dayAfterTomorrow,
        adults: 2,
        rooms: 1,
      });
      if (hotels.length > 0) {
        const sorted = hotels
          .filter(h => h.pricePerNight > 0)
          .sort((a, b) => (a.pricePerNight || 99999) - (b.pricePerNight || 99999));
        return sorted.slice(0, 3).map(h => ({
          ...h,
          dealCity: dest.city,
          dealCityCode: dest.cityCode,
        }));
      }
      return [];
    } catch {
      return [];
    }
  });

  const allResults = await Promise.allSettled(searches);
  for (const r of allResults) {
    if (r.status === 'fulfilled' && r.value.length > 0) results.push(...r.value);
  }

  // Cache for 1 hour
  hotelDealsCache = { data: results, expiry: Date.now() + 3600000 };
  console.log(`[Sabre Hotels] Cached ${results.length} hotel deals across ${POPULAR_DESTINATIONS.length} cities`);
  return results;
}

// Background refresh every hour
function scheduleHotelDealsRefresh() {
  setTimeout(() => {
    getTopHotelDeals().catch(err => console.error('[Sabre Hotels] Initial deals fetch error:', err.message));
  }, 15000);

  setInterval(() => {
    getTopHotelDeals().catch(err => console.error('[Sabre Hotels] Deals refresh error:', err.message));
  }, 3600000);
}

scheduleHotelDealsRefresh();


module.exports = {
  searchHotels,
  getHotelDetails,
  getHotelRates,
  bookHotel,
  getTopHotelDeals,
  clearSabreHotelConfigCache,
  resolveCity,
};
