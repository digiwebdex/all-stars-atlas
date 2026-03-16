/**
 * Sabre Hotel API Integration — Enterprise Grade
 * Uses Content Services for Lodging (CSL) on havail.sabre.com
 * NOTE: Sabre CSL hotel APIs use a DIFFERENT domain than flight APIs:
 *   - Flights: api.platform.sabre.com
 *   - Hotels (CSL): api.havail.sabre.com (prod) / api-crt.cert.havail.sabre.com (cert)
 * 
 * CSL REST API Endpoints:
 *   POST /v2/get/hotelavail        — GetHotelAvail v2 (search by geo/city/airport)
 *   POST /v2/get/hoteldetails      — Hotel details (images, descriptions, amenities, rates)
 *   POST /v2/hotel/pricecheck      — Price verification before booking
 *   POST /v2.4.0/passenger/records?mode=create — PNR creation (on platform.sabre.com)
 */

const db = require('../config/db');
const { safeJsonParse } = require('../utils/json');

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
    const appId = pick(cfg.appId, cfg.app_id, cfg.prod_client_id, cfg.cert_client_id, cfg.clientId);

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

// ── OAuth — get token from BOTH domains (CSL uses havail domain for auth too) ──
let hotelTokenCache = { token: null, expiresAt: 0 };
let platformTokenCache = { token: null, expiresAt: 0 };

async function getAccessToken(config, domain = 'hotel') {
  const cache = domain === 'hotel' ? hotelTokenCache : platformTokenCache;
  if (cache.token && Date.now() < cache.expiresAt - 60000) return cache.token;
  
  const authBaseUrl = domain === 'hotel' ? config.hotelUrl : config.baseUrl;
  
  try {
    const credentials = config.basicAuth
      ? config.basicAuth
      : Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

    // CSL uses client_credentials grant (simpler than flight's password grant)
    const body = `grant_type=client_credentials`;

    console.log(`[Sabre Hotels] Auth → ${authBaseUrl}/v2/auth/token (${domain})`);
    const res = await fetch(`${authBaseUrl}/v2/auth/token`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[Sabre Hotels] Auth failed ${authBaseUrl} ${res.status}: ${errText.slice(0, 300)}`);
      // Fallback: try password grant like flights
      return await getAccessTokenPasswordGrant(config, domain);
    }
    const data = await res.json();
    if (data.access_token) {
      const newCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 604800) * 1000 };
      if (domain === 'hotel') hotelTokenCache = newCache;
      else platformTokenCache = newCache;
      console.log(`[Sabre Hotels] Auth success (${domain})`);
      return newCache.token;
    }
    return await getAccessTokenPasswordGrant(config, domain);
  } catch (err) {
    console.error(`[Sabre Hotels] Auth error (${domain}):`, err.message);
    return await getAccessTokenPasswordGrant(config, domain);
  }
}

// Fallback: password grant (same as flights use)
async function getAccessTokenPasswordGrant(config, domain = 'hotel') {
  const authBaseUrl = domain === 'hotel' ? config.hotelUrl : config.baseUrl;
  try {
    const credentials = config.basicAuth
      ? config.basicAuth
      : Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const username = `${config.epr}-${config.pcc}-AA`;
    const body = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(config.agencyPassword)}`;

    // Try /v3/auth/token first (platform style), then /v2/auth/token
    for (const authPath of ['/v3/auth/token', '/v2/auth/token', '/v1/auth/token']) {
      try {
        console.log(`[Sabre Hotels] Auth fallback → ${authBaseUrl}${authPath}`);
        const res = await fetch(`${authBaseUrl}${authPath}`, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (data.access_token) {
          const newCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 604800) * 1000 };
          if (domain === 'hotel') hotelTokenCache = newCache;
          else platformTokenCache = newCache;
          console.log(`[Sabre Hotels] Auth fallback success (${domain} via ${authPath})`);
          return newCache.token;
        }
      } catch { continue; }
    }
    
    // Last resort: use platform token for hotel calls (some Sabre setups share tokens)
    if (domain === 'hotel' && platformTokenCache.token && Date.now() < platformTokenCache.expiresAt) {
      console.log(`[Sabre Hotels] Using platform token for hotel API`);
      return platformTokenCache.token;
    }
    
    console.error(`[Sabre Hotels] All auth attempts failed for ${domain}`);
    return null;
  } catch (err) {
    console.error(`[Sabre Hotels] Auth password grant error:`, err.message);
    return null;
  }
}

const HOTEL_AVAIL_ENDPOINTS = [
  '/v4.1.0/get/hotelavail',
  '/v4.0.0/get/hotelavail',
  '/v3.0.0/get/hotelavail',
  '/v2.1.0/get/hotelavail',
  '/v2.0.0/get/hotelavail',
  '/v2/get/hotelavail',
];

const HOTEL_DETAILS_ENDPOINTS = [
  '/v4.1.0/get/hoteldetails',
  '/v4.0.0/get/hoteldetails',
  '/v2.1.0/get/hoteldetails',
  '/v1.1.0/get/hoteldetails',
  '/v2/get/hoteldetails',
];

function resolveHotelEndpointCandidates(endpoint) {
  if (endpoint === '/v2/get/hotelavail') return HOTEL_AVAIL_ENDPOINTS;
  if (endpoint === '/v2/get/hoteldetails') return HOTEL_DETAILS_ENDPOINTS;
  return [endpoint];
}

// Make API request — tries versioned endpoint candidates + hotel/platform domains
async function sabreRequest(config, endpoint, body, method = 'POST', timeoutMs = 30000) {
  const endpointCandidates = resolveHotelEndpointCandidates(endpoint);
  const isBookingEndpoint = endpoint.includes('passenger/records') || endpoint.includes('trip/orders');

  for (const endpointPath of endpointCandidates) {
    const strategies = isBookingEndpoint
      ? [{ baseUrl: config.baseUrl, domain: 'platform', path: endpointPath }]
      : [
          { baseUrl: config.hotelUrl, domain: 'hotel', path: endpointPath },
          { baseUrl: config.baseUrl, domain: 'platform', path: endpointPath },
        ];

    for (const strategy of strategies) {
      try {
        const token = await getAccessToken(config, strategy.domain);
        if (!token) continue;

        const url = `${strategy.baseUrl}${strategy.path}`;
        const headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        };
        if (config.appId) headers['Application-ID'] = config.appId;

        const opts = {
          method,
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        };
        if (body && method !== 'GET') opts.body = JSON.stringify(body);

        console.log(`[Sabre Hotels] → ${method} ${url}`);
        const res = await fetch(url, opts);
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.warn(`[Sabre Hotels] ${strategy.domain} ${strategy.path}: ${res.status} ${errText.slice(0, 220)}`);
          continue;
        }

        console.log(`[Sabre Hotels] ✓ Success via ${strategy.domain} ${strategy.path}`);
        return res.json();
      } catch (err) {
        console.warn(`[Sabre Hotels] ${strategy.domain} ${strategy.path} failed: ${err.message}`);
      }
    }
  }

  throw new Error(`Sabre Hotels API: all strategies failed for ${endpoint} (tried ${endpointCandidates.join(', ')})`);
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
//  1. HOTEL SEARCH — GetHotelAvail (v2 with fallback strategies)
// ══════════════════════════════════════════════
async function searchHotels({ city, checkIn, checkOut, adults = 2, children = 0, rooms = 1, minRate, maxRate, minStars, maxStars }) {
  const config = await getSabreConfig();
  if (!config) { console.warn('[Sabre Hotels] No config, skipping search'); return []; }

  const resolved = resolveCity(city);
  if (!resolved) { console.warn(`[Sabre Hotels] Could not resolve city: ${city}`); return []; }

  const { code: cityCode, type: refPointType } = resolved;

  // Build room specifications for multi-room
  const roomCount = parseInt(rooms) || 1;
  const adultsPerRoom = Math.max(1, Math.floor(parseInt(adults) / roomCount));
  const childrenPerRoom = Math.floor(parseInt(children || 0) / roomCount);
  const roomSpecs = [];
  for (let i = 0; i < roomCount; i++) {
    const room = { RoomIndex: i + 1, Adults: adultsPerRoom };
    if (childrenPerRoom > 0) room.Children = childrenPerRoom;
    roomSpecs.push(room);
  }

  const requestBody = {
    GetHotelAvailRQ: {
      POS: {
        Source: { PseudoCityCode: config.pcc }
      },
      SearchCriteria: {
        OffSet: 1,
        SortBy: 'TotalRate',
        SortOrder: 'ASC',
        PageSize: 100,
        TierLabels: false,
        GeoSearch: {
          GeoRef: {
            Radius: 50,
            UOM: 'KM',
            RefPoint: { Value: cityCode, ValueContext: 'CODE', RefPointType: refPointType }
          }
        },
        RateInfoRef: {
          CurrencyCode: 'USD',
          BestOnly: '4',
          PrepaidQualifier: 'IncludePrepaid',
          StayDateRange: {
            StartDate: checkIn,
            EndDate: checkOut
          },
          Rooms: roomSpecs,
          InfoSource: '100,110,112,113'
        },
        ImageRef: {
          Type: 'MEDIUM',
          LanguageCode: 'EN'
        },
        HotelPref: {}
      }
    }
  };

  // Star rating filter
  if (minStars || maxStars) {
    requestBody.GetHotelAvailRQ.SearchCriteria.HotelPref.HotelRating = [];
    const minS = parseInt(minStars || 1);
    const maxS = parseInt(maxStars || 5);
    for (let s = minS; s <= maxS; s++) {
      requestBody.GetHotelAvailRQ.SearchCriteria.HotelPref.HotelRating.push({ Rating: s });
    }
  }

  // Price filter
  if (minRate || maxRate) {
    requestBody.GetHotelAvailRQ.SearchCriteria.RateInfoRef.RateRange = {
      Min: parseFloat(minRate || 0),
      Max: parseFloat(maxRate || 50000),
      CurrencyCode: 'USD'
    };
  }

  try {
    console.log(`[Sabre Hotels] Searching: city=${cityCode}(type=${refPointType}), ${checkIn} → ${checkOut}, ${adults}A+${children}C, ${rooms} rooms`);
    const response = await sabreRequest(config, '/v2/get/hotelavail', requestBody, 'POST', 60000);
    
    const hotels = normalizeSearchResponse(response, city, checkIn, checkOut);
    console.log(`[Sabre Hotels] Found ${hotels.length} hotels for ${city}`);
    
    // If 0 results with airport code, retry with city code type
    if (hotels.length === 0 && refPointType === '1') {
      console.log(`[Sabre Hotels] Retrying with RefPointType=6 (city) for ${cityCode}`);
      requestBody.GetHotelAvailRQ.SearchCriteria.GeoSearch.GeoRef.RefPoint.RefPointType = '6';
      try {
        const retryResponse = await sabreRequest(config, '/v2/get/hotelavail', requestBody, 'POST', 60000);
        const retryHotels = normalizeSearchResponse(retryResponse, city, checkIn, checkOut);
        if (retryHotels.length > 0) {
          console.log(`[Sabre Hotels] Retry found ${retryHotels.length} hotels`);
          return retryHotels;
        }
      } catch (retryErr) {
        console.error('[Sabre Hotels] Retry also failed:', retryErr.message);
      }
    }
    
    return hotels;
  } catch (err) {
    console.error('[Sabre Hotels] Search failed:', err.message);
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
//  2. HOTEL DETAILS — Content + Rates
// ══════════════════════════════════════════════
async function getHotelDetails(hotelCode, checkIn, checkOut, adults, rooms) {
  const config = await getSabreConfig();
  if (!config) return null;

  // Fetch content and rates in parallel
  const [content, rates] = await Promise.allSettled([
    getHotelContent(config, hotelCode),
    getHotelRates(config, hotelCode, checkIn, checkOut, adults, rooms),
  ]);

  const contentData = content.status === 'fulfilled' ? content.value : {};
  const ratesData = rates.status === 'fulfilled' ? rates.value : [];

  if (!contentData.name && ratesData.length === 0) return null;

  return {
    ...contentData,
    rooms: ratesData,
    source: 'sabre',
    sabreHotelCode: hotelCode,
    checkIn,
    checkOut,
  };
}

async function getHotelContent(config, hotelCode) {
  try {
    const body = {
      GetHotelContentRQ: {
        POS: { Source: { PseudoCityCode: config.pcc } },
        SearchCriteria: {
          HotelRefs: { HotelRef: [{ HotelCode: hotelCode }] }
        }
      }
    };

    const response = await sabreRequest(config, '/v2/get/hoteldetails', body, 'POST', 20000);
    const hotelContent = response?.GetHotelContentRS?.HotelContentInfos?.HotelContentInfo?.[0] || {};
    const info = hotelContent.HotelInfo || {};
    const media = hotelContent.HotelMediaInfo || {};
    const desc = hotelContent.HotelDescriptiveInfo || {};

    // Extract all images
    const images = [];
    const mediaItems = media.MediaItems?.MediaItem || media.Images?.Image || media.Medias?.Media || [];
    const mediaList = Array.isArray(mediaItems) ? mediaItems : [mediaItems];
    for (const img of mediaList) {
      const url = img?.Url || img?.URL || img?.ImageURL;
      if (url) images.push(url);
    }

    // Extract amenities
    const amenities = [];
    const facilities = desc.Facilities?.Facility || desc.HotelAmenities?.HotelAmenity || [];
    const facilityList = Array.isArray(facilities) ? facilities : [facilities];
    for (const f of facilityList) {
      const name = f?.Description || f?.Name || f?.FacilityName;
      if (name) amenities.push(name);
    }

    // Extract policies
    const policies = [];
    const policyData = desc.Policies?.Policy || desc.HotelPolicies?.Policy || [];
    const policyList = Array.isArray(policyData) ? policyData : [policyData];
    for (const p of policyList) {
      const text = p?.Description || p?.Text || p?.PolicyText;
      if (text) policies.push(text);
    }

    // Check-in/out times
    const checkInTime = desc.CheckInTime || info.CheckInTime || '15:00';
    const checkOutTime = desc.CheckOutTime || info.CheckOutTime || '11:00';

    return {
      id: `sabre-${hotelCode}`,
      name: info.HotelName || '',
      city: info.LocationInfo?.City || '',
      country: info.LocationInfo?.CountryName || '',
      address: info.LocationInfo?.Address?.AddressLine1 || '',
      latitude: parseFloat(info.LocationInfo?.Latitude || 0) || null,
      longitude: parseFloat(info.LocationInfo?.Longitude || 0) || null,
      starRating: parseInt(info.SabreRating || info.HotelRating || 0),
      stars: parseInt(info.SabreRating || info.HotelRating || 0),
      images: images.length > 0 ? images : [],
      amenities,
      description: desc.LongDescription || desc.ShortDescription || info.HotelDescription || '',
      policies,
      checkInTime,
      checkOutTime,
      contactInfo: info.ContactInfo || {},
      rating: parseFloat(info.TripAdvisorRating || info.SabreRating || 0) || null,
      reviews: parseInt(info.TripAdvisorReviewCount || 0),
    };
  } catch (err) {
    console.error(`[Sabre Hotels] Content fetch failed for ${hotelCode}:`, err.message);
    return {};
  }
}

async function getHotelRates(config, hotelCode, checkIn, checkOut, adults, rooms) {
  try {
    const ci = checkIn || new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const co = checkOut || new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];
    const nights = Math.max(1, Math.ceil((new Date(co) - new Date(ci)) / 86400000));

    const roomCount = parseInt(rooms || 1);
    const adultsPerRoom = Math.max(1, Math.floor(parseInt(adults || 2) / roomCount));
    const roomSpecs = [];
    for (let i = 0; i < roomCount; i++) {
      roomSpecs.push({ RoomIndex: i + 1, Adults: adultsPerRoom });
    }

    const body = {
      GetHotelRateInfoRQ: {
        POS: { Source: { PseudoCityCode: config.pcc } },
        SearchCriteria: {
          HotelRefs: { HotelRef: [{ HotelCode: hotelCode }] },
          RateInfoRef: {
            CurrencyCode: 'USD',
            BestOnly: '10',
            PrepaidQualifier: 'IncludePrepaid',
            StayDateRange: { StartDate: ci, EndDate: co },
            Rooms: roomSpecs,
            InfoSource: '100,110,112,113'
          }
        }
      }
    };

    const response = await sabreRequest(config, '/v2/get/hoteldetails', body, 'POST', 30000);
    const rateInfos = response?.GetHotelRateInfoRS?.HotelRateInfos?.HotelRateInfo || [];
    const roomResults = [];

    const rateList = Array.isArray(rateInfos) ? rateInfos : [rateInfos];
    for (const rateInfo of rateList) {
      const rates = rateInfo?.Rates?.Rate || rateInfo?.HotelRateInfo?.Rates?.Rate || [];
      const rateArr = Array.isArray(rates) ? rates : [rates];

      for (const rate of rateArr) {
        if (!rate) continue;

        const avgNightly = parseFloat(rate.AverageNightlyRate || rate.AverageNightlyRateBeforeTax || 0);
        const amount = parseFloat(rate.Amount || rate.AmountBeforeTax || 0);
        const totalAmount = parseFloat(rate.TotalAmount || rate.TotalAmountBeforeTax || 0);

        let nightly = avgNightly || amount || 0;
        let total = totalAmount || (nightly * nights);

        if (nightly === 0 && total > 0) {
          nightly = Math.round(total / nights);
        }

        if (nightly === 0) continue;

        // Determine cancellation
        const cancelDesc = rate.CancelPolicy?.Description || rate.GuaranteeInfo?.Description || '';
        const isRefundable = cancelDesc.toLowerCase().includes('free cancel') 
          || cancelDesc.toLowerCase().includes('refundable')
          || rate.RateQualifier === 'REF';

        // Room description
        const roomDesc = rate.RoomDescription || rate.RateDescription || rate.RoomTypeDescription || '';
        const roomType = rate.RoomType || rate.RoomTypeCode || 'Standard';
        const bedType = rate.BedType || rate.BedTypeDescription || '';

        // Meal plan
        const mealPlan = rate.MealPlan || rate.MealPlanDescription || null;

        // Room amenities
        const roomAmenities = [];
        if (rate.RoomAmenities) {
          const ra = Array.isArray(rate.RoomAmenities) ? rate.RoomAmenities : [rate.RoomAmenities];
          for (const a of ra) {
            const name = a?.Description || a?.Name || a;
            if (typeof name === 'string') roomAmenities.push(name);
          }
        }

        roomResults.push({
          id: rate.RateKey || `room-${roomResults.length + 1}`,
          name: roomDesc || `${roomType} Room`,
          type: roomType,
          bedType: bedType || 'Double',
          maxGuests: parseInt(rate.MaxOccupancy || rate.MaxGuests || adultsPerRoom),
          price: Math.round(nightly),
          totalPrice: Math.round(total),
          nights,
          currency: rate.CurrencyCode || 'USD',
          cancellationPolicy: cancelDesc || 'Non-refundable',
          isRefundable,
          mealPlan,
          rateKey: rate.RateKey || null,
          bookingKey: rate.BookingKey || null,
          amenities: roomAmenities,
          source: 'sabre',
          availableRooms: parseInt(rate.AvailableRooms || 0) || null,
          guaranteeRequired: !!rate.GuaranteeInfo?.GuaranteeRequired,
          paymentDeadline: rate.CancelPolicy?.Deadline || null,
        });
      }
    }

    // Sort by price ascending
    roomResults.sort((a, b) => a.price - b.price);
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
