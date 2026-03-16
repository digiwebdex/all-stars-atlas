/**
 * Sabre Hotel API Integration
 * Uses same OAuth/credentials as sabre-flights.js (system_settings → api_sabre)
 * 
 * Endpoints used:
 *   POST /v2.0.0/shop/hotels           — GetHotelAvail (search by geo/city)
 *   POST /v1.0.0/shop/hotels/content   — Hotel content (images, descriptions, amenities)
 *   POST /v1.0.0/shop/hotels/rates     — Detailed rate plans per hotel
 *   POST /v3.0.0/book/hotels           — EnhancedHotelBook (create reservation)
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

    const baseUrl = isProd
      ? (cfg.prod_url || 'https://api.platform.sabre.com')
      : (cfg.sandbox_url || 'https://api.cert.platform.sabre.com');

    const pick = (...vals) => vals.find(v => typeof v === 'string' && v.trim().length > 0)?.trim() || '';

    const clientId = isProd
      ? pick(cfg.prod_client_id, cfg.clientId, cfg.sandbox_client_id)
      : pick(cfg.cert_client_id, cfg.clientId, cfg.sandbox_client_id, cfg.prod_client_id);
    const clientSecret = isProd
      ? pick(cfg.prod_client_secret, cfg.clientSecret, cfg.sandbox_client_secret)
      : pick(cfg.cert_client_secret, cfg.clientSecret, cfg.sandbox_client_secret, cfg.prod_client_secret);

    const basicAuth = isProd ? pick(cfg.prod_basic_auth) : pick(cfg.cert_basic_auth);

    if (!clientId || !clientSecret) return null;

    const epr = pick(cfg.epr);
    const agencyPassword = isProd
      ? pick(cfg.prodPassword, cfg.agency_password)
      : pick(cfg.agencyPassword, cfg.agency_password);
    if (!epr || !agencyPassword) return null;

    _configCache = {
      baseUrl: baseUrl.replace(/\/$/, ''),
      clientId, clientSecret, basicAuth,
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

// ── OAuth (shared pattern with sabre-flights) ──
let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken(config) {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) return tokenCache.token;
  try {
    const credentials = config.basicAuth
      ? config.basicAuth
      : Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const username = `${config.epr}-${config.pcc}-AA`;
    const body = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(config.agencyPassword)}`;

    const res = await fetch(`${config.baseUrl}/v3/auth/token`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.access_token) {
      tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 604800) * 1000 };
      return tokenCache.token;
    }
    return null;
  } catch (err) {
    console.error('[Sabre Hotels] Auth error:', err.message);
    return null;
  }
}

async function sabreRequest(config, endpoint, body, method = 'POST', timeoutMs = 30000) {
  const token = await getAccessToken(config);
  if (!token) throw new Error('Sabre authentication failed');

  const url = `${config.baseUrl}${endpoint}`;
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[Sabre Hotels] API error on ${endpoint}: ${res.status} ${errText.slice(0, 500)}`);
    throw new Error(`Sabre Hotels API ${res.status}: ${errText.slice(0, 300)}`);
  }
  return res.json();
}

// ── IATA city codes for BD destinations ──
const CITY_TO_IATA = {
  'dhaka': 'DAC', 'chittagong': 'CGP', 'chattogram': 'CGP', 'sylhet': 'ZYL',
  'coxs bazar': 'CXB', "cox's bazar": 'CXB', 'rajshahi': 'RJH', 'jessore': 'JSR',
  'barishal': 'BZL', 'barisal': 'BZL', 'saidpur': 'SPD',
  // International popular
  'dubai': 'DXB', 'bangkok': 'BKK', 'singapore': 'SIN', 'kuala lumpur': 'KUL',
  'kolkata': 'CCU', 'delhi': 'DEL', 'mumbai': 'BOM', 'london': 'LON',
  'new york': 'NYC', 'istanbul': 'IST', 'jeddah': 'JED', 'riyadh': 'RUH',
  'doha': 'DOH', 'muscat': 'MCT', 'male': 'MLE', 'kathmandu': 'KTM',
  'tokyo': 'TYO', 'hong kong': 'HKG', 'phuket': 'HKT', 'bali': 'DPS',
};

function resolveCity(city) {
  if (!city) return null;
  const cleaned = city.trim().toLowerCase();
  return CITY_TO_IATA[cleaned] || (cleaned.length === 3 ? cleaned.toUpperCase() : null);
}

// ══════════════════════════════════════════════
//  1. HOTEL SEARCH — GetHotelAvail v2
// ══════════════════════════════════════════════
async function searchHotels({ city, checkIn, checkOut, adults = 1, children = 0, rooms = 1, minRate, maxRate, minStars, maxStars }) {
  const config = await getSabreConfig();
  if (!config) { console.warn('[Sabre Hotels] No config, skipping search'); return []; }

  const cityCode = resolveCity(city);
  if (!cityCode) { console.warn(`[Sabre Hotels] Could not resolve city: ${city}`); return []; }

  const guestCount = parseInt(adults) + parseInt(children || 0);

  const requestBody = {
    GetHotelAvailRQ: {
      POS: {
        Source: { PseudoCityCode: config.pcc }
      },
      SearchCriteria: {
        OffSet: 1,
        SortBy: 'TotalRate',
        SortOrder: 'ASC',
        PageSize: 50,
        TierLabels: false,
        GeoSearch: {
          GeoRef: {
            Radius: 50,
            UOM: 'KM',
            RefPoint: { Value: cityCode, ValueContext: 'CODE', RefPointType: '6' } // 6 = City
          }
        },
        RateInfoRef: {
          CurrencyCode: 'BDT',
          BestOnly: '2',
          PrepaidQualifier: 'IncludePrepaid',
          StayDateRange: {
            StartDate: checkIn,
            EndDate: checkOut
          },
          Rooms: [{
            RoomIndex: 1,
            Adults: parseInt(adults),
            Children: parseInt(children || 0)
          }],
          InfoSource: '100,110,112,113'
        },
        HotelPref: {}
      }
    }
  };

  // Optional filters
  if (minStars || maxStars) {
    requestBody.GetHotelAvailRQ.SearchCriteria.HotelPref.HotelRating = [];
    const minS = parseInt(minStars || 1);
    const maxS = parseInt(maxStars || 5);
    for (let s = minS; s <= maxS; s++) {
      requestBody.GetHotelAvailRQ.SearchCriteria.HotelPref.HotelRating.push({ Rating: s });
    }
  }

  if (minRate || maxRate) {
    requestBody.GetHotelAvailRQ.SearchCriteria.RateInfoRef.RateRange = {
      Min: parseFloat(minRate || 0),
      Max: parseFloat(maxRate || 999999),
      CurrencyCode: 'BDT'
    };
  }

  try {
    console.log(`[Sabre Hotels] Searching: city=${cityCode}, ${checkIn} → ${checkOut}, ${adults} adults, ${rooms} rooms`);
    const response = await sabreRequest(config, '/v2.0.0/shop/hotels', requestBody, 'POST', 45000);
    return normalizeSearchResponse(response, city);
  } catch (err) {
    console.error('[Sabre Hotels] Search failed:', err.message);
    return [];
  }
}

function normalizeSearchResponse(response, searchCity) {
  const hotels = [];
  try {
    const avail = response?.GetHotelAvailRS;
    const hotelAvail = avail?.HotelAvailInfos?.HotelAvailInfo || [];

    for (const h of hotelAvail) {
      const info = h.HotelInfo || {};
      const rateInfo = h.HotelRateInfo || {};
      const rates = rateInfo.Rates?.Rate || [];
      const lowestRate = rates[0];

      const amenityCodes = (info.PropertyOptionInfo || {});
      const amenities = [];
      if (amenityCodes.Wifi === 'true' || amenityCodes.FreeWifi === 'true') amenities.push('wifi');
      if (amenityCodes.Pool === 'true' || amenityCodes.IndoorPool === 'true' || amenityCodes.OutdoorPool === 'true') amenities.push('pool');
      if (amenityCodes.Restaurant === 'true') amenities.push('restaurant');
      if (amenityCodes.Parking === 'true' || amenityCodes.FreeParking === 'true') amenities.push('parking');
      if (amenityCodes.Gym === 'true' || amenityCodes.FitnessCenter === 'true') amenities.push('gym');
      if (amenityCodes.Spa === 'true') amenities.push('spa');
      if (amenityCodes.AirConditioning === 'true') amenities.push('ac');
      if (amenityCodes.BreakfastBuffet === 'true' || amenityCodes.FreeBreakfast === 'true') amenities.push('breakfast');

      const pricePerNight = lowestRate
        ? parseFloat(lowestRate.Amount || lowestRate.AverageNightlyRate || 0)
        : null;

      hotels.push({
        id: `sabre-${info.HotelCode || info.SabreHotelCode || Math.random().toString(36).slice(2)}`,
        sabreHotelCode: info.HotelCode || info.SabreHotelCode,
        source: 'sabre',
        name: info.HotelName || 'Hotel',
        city: searchCity || info.LocationInfo?.City || '',
        country: info.LocationInfo?.CountryName || info.LocationInfo?.Country || '',
        address: info.LocationInfo?.Address?.AddressLine1 || '',
        latitude: parseFloat(info.LocationInfo?.Latitude || 0) || null,
        longitude: parseFloat(info.LocationInfo?.Longitude || 0) || null,
        starRating: parseInt(info.SabreRating || info.HotelRating || 0),
        userRating: parseFloat(info.TripAdvisorRating || info.SabreRating || 0) || null,
        reviewCount: parseInt(info.TripAdvisorReviewCount || 0) || null,
        pricePerNight,
        price: pricePerNight,
        originalPrice: null,
        currency: lowestRate?.CurrencyCode || 'BDT',
        img: info.ImageURL || info.HotelImageUrl || `https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&h=400&fit=crop`,
        images: info.ImageURL ? [info.ImageURL] : [],
        amenities,
        description: info.HotelDescription || '',
        tag: info.SabreRating >= 4 ? 'Top Rated' : null,
        stars: parseInt(info.SabreRating || info.HotelRating || 0),
        rating: parseFloat(info.TripAdvisorRating || info.SabreRating || 0) || null,
        reviews: parseInt(info.TripAdvisorReviewCount || 0) || 0,
        location: `${searchCity || info.LocationInfo?.City || ''}, ${info.LocationInfo?.CountryName || ''}`.replace(/, $/, ''),
        cancelPolicy: lowestRate?.RateDescription || null,
        rateKey: lowestRate?.RateKey || null,
      });
    }
  } catch (err) {
    console.error('[Sabre Hotels] Response normalization error:', err.message);
  }

  console.log(`[Sabre Hotels] Normalized ${hotels.length} hotels from response`);
  return hotels;
}


// ══════════════════════════════════════════════
//  2. HOTEL DETAILS — Content + Rates
// ══════════════════════════════════════════════
async function getHotelDetails(hotelCode) {
  const config = await getSabreConfig();
  if (!config) return null;

  // Fetch content and rates in parallel
  const [content, rates] = await Promise.allSettled([
    getHotelContent(config, hotelCode),
    getHotelRates(config, hotelCode),
  ]);

  const contentData = content.status === 'fulfilled' ? content.value : {};
  const ratesData = rates.status === 'fulfilled' ? rates.value : [];

  return {
    ...contentData,
    rooms: ratesData,
    source: 'sabre',
    sabreHotelCode: hotelCode,
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

    const response = await sabreRequest(config, '/v1.0.0/shop/hotels/content', body, 'POST', 20000);
    const hotelContent = response?.GetHotelContentRS?.HotelContentInfos?.HotelContentInfo?.[0] || {};
    const info = hotelContent.HotelInfo || {};
    const media = hotelContent.HotelMediaInfo || {};
    const desc = hotelContent.HotelDescriptiveInfo || {};

    const images = [];
    const mediaItems = media.MediaItems?.MediaItem || media.Images?.Image || [];
    for (const img of (Array.isArray(mediaItems) ? mediaItems : [mediaItems])) {
      if (img?.Url || img?.URL) images.push(img.Url || img.URL);
    }

    const amenities = [];
    const facilities = desc.Facilities?.Facility || desc.HotelAmenities?.HotelAmenity || [];
    for (const f of (Array.isArray(facilities) ? facilities : [facilities])) {
      if (f?.Description || f?.Name) amenities.push((f.Description || f.Name).toLowerCase());
    }

    return {
      id: `sabre-${hotelCode}`,
      name: info.HotelName || '',
      city: info.LocationInfo?.City || '',
      country: info.LocationInfo?.CountryName || '',
      address: info.LocationInfo?.Address?.AddressLine1 || '',
      latitude: parseFloat(info.LocationInfo?.Latitude || 0) || null,
      longitude: parseFloat(info.LocationInfo?.Longitude || 0) || null,
      starRating: parseInt(info.SabreRating || info.HotelRating || 0),
      images: images.length > 0 ? images : [`https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&h=600&fit=crop`],
      amenities,
      description: desc.LongDescription || desc.ShortDescription || info.HotelDescription || '',
      policies: desc.Policies || {},
      contactInfo: info.ContactInfo || {},
    };
  } catch (err) {
    console.error(`[Sabre Hotels] Content fetch failed for ${hotelCode}:`, err.message);
    return {};
  }
}

async function getHotelRates(config, hotelCode, checkIn, checkOut) {
  try {
    // Default to tomorrow → day after if not specified
    const ci = checkIn || new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const co = checkOut || new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];

    const body = {
      GetHotelRateInfoRQ: {
        POS: { Source: { PseudoCityCode: config.pcc } },
        SearchCriteria: {
          HotelRefs: { HotelRef: [{ HotelCode: hotelCode }] },
          RateInfoRef: {
            CurrencyCode: 'BDT',
            StayDateRange: { StartDate: ci, EndDate: co },
            Rooms: [{ RoomIndex: 1, Adults: 2 }],
            InfoSource: '100,110,112,113'
          }
        }
      }
    };

    const response = await sabreRequest(config, '/v1.0.0/shop/hotels/rates', body, 'POST', 20000);
    const rateInfos = response?.GetHotelRateInfoRS?.HotelRateInfos?.HotelRateInfo || [];
    const rooms = [];

    for (const rateInfo of (Array.isArray(rateInfos) ? rateInfos : [rateInfos])) {
      const rates = rateInfo?.Rates?.Rate || rateInfo?.HotelRateInfo?.Rates?.Rate || [];
      for (const rate of (Array.isArray(rates) ? rates : [rates])) {
        rooms.push({
          id: rate.RateKey || `room-${rooms.length + 1}`,
          name: rate.RoomDescription || rate.RateDescription || `Room ${rooms.length + 1}`,
          type: rate.RoomType || 'Standard',
          bedType: rate.BedType || 'Double',
          maxGuests: parseInt(rate.MaxOccupancy || 2),
          price: parseFloat(rate.Amount || rate.AverageNightlyRate || 0),
          totalPrice: parseFloat(rate.TotalAmount || rate.Amount || 0),
          currency: rate.CurrencyCode || 'BDT',
          cancellationPolicy: rate.CancelPolicy?.Description || rate.GuaranteeInfo?.Description || 'Non-refundable',
          mealPlan: rate.MealPlan || null,
          rateKey: rate.RateKey || null,
          amenities: rate.RoomAmenities ? (Array.isArray(rate.RoomAmenities) ? rate.RoomAmenities.map(a => a.Description || a) : []) : [],
          source: 'sabre',
        });
      }
    }

    return rooms;
  } catch (err) {
    console.error(`[Sabre Hotels] Rates fetch failed for ${hotelCode}:`, err.message);
    return [];
  }
}


// ══════════════════════════════════════════════
//  3. HOTEL BOOKING — EnhancedHotelBook v3
// ══════════════════════════════════════════════
async function bookHotel({ hotelCode, rateKey, checkIn, checkOut, rooms, guests, contactInfo, paymentInfo }) {
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
          Ticketing: { TicketType: '7TAW' } // 7 day time limit
        }
      },
      HotelBook: {
        HotelSegment: [{
          BasicHotelInfo: {
            HotelCode: hotelCode,
          },
          Guarantee: {
            PaymentCard: paymentInfo ? {
              CardCode: paymentInfo.cardType || 'VI',
              CardNumber: paymentInfo.cardNumber,
              ExpirationDate: paymentInfo.expiry,
              CardHolderName: paymentInfo.cardHolder || `${primaryGuest.firstName} ${primaryGuest.lastName}`.toUpperCase(),
            } : undefined,
          },
          GuestCounts: {
            GuestCount: [{ Count: parseInt(rooms?.[0]?.adults || 2) }]
          },
          TimeSpan: {
            Start: checkIn,
            End: checkOut,
          },
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
    
    // Extract PNR
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
  { city: 'Dhaka', cityCode: 'DAC' },
  { city: 'Sylhet', cityCode: 'ZYL' },
  { city: 'Chittagong', cityCode: 'CGP' },
  { city: 'Dubai', cityCode: 'DXB' },
  { city: 'Bangkok', cityCode: 'BKK' },
];

async function getTopHotelDeals() {
  if (hotelDealsCache.data && Date.now() < hotelDealsCache.expiry) {
    return hotelDealsCache.data;
  }

  const config = await getSabreConfig();
  if (!config) return [];

  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const dayAfter = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];

  const results = [];

  // Search each destination in parallel
  const searches = POPULAR_DESTINATIONS.map(async (dest) => {
    try {
      const hotels = await searchHotels({
        city: dest.city,
        checkIn: tomorrow,
        checkOut: dayAfter,
        adults: 2,
        rooms: 1,
      });
      // Take cheapest hotel from each destination
      if (hotels.length > 0) {
        const sorted = hotels.sort((a, b) => (a.pricePerNight || 99999) - (b.pricePerNight || 99999));
        // Return top 2 from each city
        return sorted.slice(0, 2).map(h => ({
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
  // Initial fetch after 10 seconds
  setTimeout(() => {
    getTopHotelDeals().catch(err => console.error('[Sabre Hotels] Initial deals fetch error:', err.message));
  }, 10000);

  // Then every hour
  setInterval(() => {
    getTopHotelDeals().catch(err => console.error('[Sabre Hotels] Deals refresh error:', err.message));
  }, 3600000);
}

// Start background refresh
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
