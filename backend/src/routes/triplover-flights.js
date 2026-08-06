// TripLover (Online Travel Agency Common API) Flight Integration
// Reads credentials from system_settings table (api_triplover)
// Admin Panel → Settings → API Integrations → TripLover
//
// Flow: apiLogIn → /api/Search → /api/Reprice → /api/Book → /api/ticket/NewTicket
//       (+ /api/Cancel, /api/FareRules, /api/pnr)

const db = require('../config/db');
const { logApiCall, describeFailure } = require('../utils/api-logger');


let cachedConfig = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

async function getTripLoverConfig() {
  if (cachedConfig && Date.now() - cacheTime < CACHE_TTL) return cachedConfig;
  try {
    const [rows] = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'api_triplover'");
    if (rows.length === 0 || !rows[0].setting_value) return null;
    const cfg = typeof rows[0].setting_value === 'string' ? JSON.parse(rows[0].setting_value) : rows[0].setting_value;
    if (cfg.enabled !== 'true' && cfg.enabled !== true) return null;

    // UAT defaults (TripLover sandbox)
    const baseUrl = (cfg.base_url || 'https://userapi-uat.triplover.com').replace(/\/$/, '');
    const searchBaseUrl = (cfg.search_base_url || 'https://searchapi-uat.triplover.com').replace(/\/$/, '');
    const email = cfg.email || 'testapi@mail.com';
    const password = cfg.password || 'VTBkV2MySkhPVE5pTTBweldrVkJlQT09';

    cachedConfig = { baseUrl, searchBaseUrl, email, password };
    cacheTime = Date.now();
    return cachedConfig;
  } catch (err) {
    console.error('[TripLover] Config load error:', err.message);
    return null;
  }
}

function clearTripLoverConfigCache() { cachedConfig = null; cacheTime = 0; tokenCache = { token: null, expiresAt: 0 }; }

// ── Auth (token is short-lived, ~30 min) ──
let tokenCache = { token: null, expiresAt: 0 };

async function getToken(config) {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;
  const url = `${config.baseUrl}/api/user/apiLogIn`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: config.email, password: config.password }),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
    const token = res.ok ? data?.data?.token : null;
    if (!token) {
      const { error, hint } = describeFailure({
        status: res.status,
        message: data?.message || (res.ok ? 'Login response contained no token' : `HTTP ${res.status}`),
        body: data,
        operation: 'Login',
      });
      logApiCall({
        provider: 'triplover', operation: 'Login', url, status: res.status, ok: false,
        durationMs: Date.now() - started, request: { email: config.email }, response: data, error, hint,
      });
      return null;
    }
    const exp = data?.data?.tokenExpieryTime ? Date.parse(data.data.tokenExpieryTime) : Date.now() + 25 * 60 * 1000;
    tokenCache = { token, expiresAt: Number.isFinite(exp) ? exp : Date.now() + 25 * 60 * 1000 };
    logApiCall({
      provider: 'triplover', operation: 'Login', url, status: res.status, ok: true,
      durationMs: Date.now() - started, request: { email: config.email },
      response: { tokenExpieryTime: data?.data?.tokenExpieryTime || null, token: '***redacted***' },
    });
    return token;
  } catch (err) {
    const { error, hint } = describeFailure({ status: null, message: err.message, operation: 'Login' });
    logApiCall({
      provider: 'triplover', operation: 'Login', url, ok: false,
      durationMs: Date.now() - started, request: { email: config.email }, error, hint,
    });
    return null;
  }
}

async function tlPost(pathname, body, { useSearchBase = false, timeout = 45000 } = {}) {
  const operation = pathname.replace(/^\/api\/?/, '') || pathname;
  const config = await getTripLoverConfig();
  if (!config) {
    const { error, hint } = describeFailure({ message: 'TripLover API not configured or disabled', operation });
    logApiCall({ provider: 'triplover', operation, ok: false, request: body, error, hint });
    throw new Error(error);
  }
  const token = await getToken(config);
  if (!token) {
    const { error, hint } = describeFailure({ message: 'TripLover authentication failed', operation });
    logApiCall({ provider: 'triplover', operation, ok: false, request: body, error, hint });
    throw new Error(error);
  }

  const base = useSearchBase ? config.searchBaseUrl : config.baseUrl;
  const url = `${base}${pathname}`;
  const started = Date.now();
  let res;
  let text = '';
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    text = await res.text();
  } catch (err) {
    const isAbort = err.name === 'TimeoutError' || err.name === 'AbortError';
    const { error, hint } = describeFailure({
      message: isAbort ? `${operation} timed out after ${timeout}ms` : err.message,
      operation,
    });
    logApiCall({
      provider: 'triplover', operation, url, ok: false,
      durationMs: Date.now() - started, request: body, error, hint,
    });
    throw new Error(`TripLover ${pathname}: ${error}`);
  }

  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.message || data?.item1?.message || data?.item2?.message || `HTTP ${res.status}`;
    const { error, hint } = describeFailure({ status: res.status, message: msg, body: data, operation });
    logApiCall({
      provider: 'triplover', operation, url, status: res.status, ok: false,
      durationMs: Date.now() - started, request: body, response: data, error, hint,
    });
    throw new Error(`TripLover ${pathname}: ${error}`);
  }

  // Successful Search responses are megabytes of fare data — log a summary only,
  // otherwise every search pays a deep-copy + JSON.stringify cost. Failures keep full bodies.
  const isBulk = /search/i.test(operation);
  logApiCall({
    provider: 'triplover', operation, url, status: res.status, ok: true,
    durationMs: Date.now() - started,
    request: body,
    response: isBulk
      ? { summary: `${(data?.item1?.airSearchResponses || []).length} itineraries returned`, responseBytes: text.length }
      : data,
  });

  return data;
}


const CABIN_MAP = { economy: 1, 'premium economy': 2, premiumeconomy: 2, business: 3, first: 4 };

// ── Search ──
async function searchFlights({ origin, destination, departDate, returnDate, adults = 1, children = 0, infants = 0, cabinClass, preferredAirline, childrenAges = [] }) {
  const config = await getTripLoverConfig();
  if (!config) return [];

  const routes = [{ origin, destination, departureDate: departDate }];
  if (returnDate) routes.push({ origin: destination, destination: origin, departureDate: returnDate });

  const payload = {
    routes,
    adults: parseInt(adults) || 1,
    childs: parseInt(children) || 0,
    infants: parseInt(infants) || 0,
    cabinClass: CABIN_MAP[String(cabinClass || '').toLowerCase()] || 1,
    preferredCarriers: preferredAirline ? [String(preferredAirline).toUpperCase()] : [],
    prohibitedCarriers: [],
    childrenAges: Array.isArray(childrenAges) ? childrenAges : [],
  };

  try {
    const data = await tlPost('/api/Search', payload, { useSearchBase: true, timeout: 90000 });
    return normalizeSearch(data, origin, destination);
  } catch (err) {
    console.error('[TripLover] Search error:', err.message);
    return [];
  }
}

function toIso(s) {
  if (!s) return null;
  return String(s).replace(' ', 'T');
}

function parseDurationToMinutes(str) {
  if (!str) return 0;
  const h = /(\d+)\s*h/i.exec(str);
  const m = /(\d+)\s*m/i.exec(str);
  return (h ? parseInt(h[1]) * 60 : 0) + (m ? parseInt(m[1]) : 0);
}

function formatMinutes(mins) {
  if (!mins) return '';
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function normalizeSearch(response, originCode, destinationCode) {
  const items = response?.item1?.airSearchResponses || [];
  const flights = [];

  items.forEach((item, idx) => {
    const directions = item.directions || [];
    // Each direction group = one leg group (outbound / return). Flatten segments per group.
    const groups = directions.map(group => (Array.isArray(group) ? group : [group]));
    if (groups.length === 0) return;

    const buildLegs = (dirs) => {
      const legs = [];
      for (const dir of dirs) {
        for (const seg of dir.segments || []) {
          const detail = (seg.details && seg.details[0]) || {};
          const mins = parseDurationToMinutes((seg.duration && seg.duration[0]) || detail.flightTime);
          legs.push({
            origin: seg.from,
            destination: seg.to,
            originAirport: seg.fromAirport || detail.originName || '',
            destinationAirport: seg.toAirport || detail.destinationName || '',
            departureTime: toIso(seg.departure),
            arrivalTime: toIso(seg.arrival),
            durationMinutes: mins,
            duration: formatMinutes(mins),
            flightNumber: `${seg.airlineCode || ''}${seg.flightNumber || ''}`,
            airlineCode: seg.airlineCode || dir.platingCarrierCode || '',
            airline: seg.airline || dir.platingCarrierName || '',
            operatingAirline: seg.airlineCode || dir.platingCarrierCode || '',
            aircraft: (seg.plane && seg.plane[0]) || detail.equipment || '',
            cabinClass: seg.cabinClass || 'Economy',
            bookingClass: seg.bookingClass || seg.serviceClass || '',
            fareBasis: seg.fareBasisCode || '',
            originTerminal: detail.originTerminal || '',
            destinationTerminal: detail.destinationTerminal || '',
            baggage: Array.isArray(seg.baggage) ? seg.baggage.map(b => `${b.amount} ${b.units} (${b.passengerTypeCode})`).join(', ') : null,
            handBaggage: seg.handBaggage || null,
            segmentCodeRef: seg.segmentCodeRef || '',
            stops: [],
          });
        }
      }
      return legs;
    };

    const outboundLegs = buildLegs(groups[0]);
    const returnLegs = groups.length > 1 ? buildLegs(groups.slice(1).flat()) : [];
    const allLegs = [...outboundLegs, ...returnLegs];
    if (allLegs.length === 0) return;

    const first = outboundLegs[0];
    const last = outboundLegs[outboundLegs.length - 1];
    const totalMinutes = outboundLegs.reduce((s, l) => s + l.durationMinutes, 0);
    const segmentCodeRefs = allLegs.map(l => l.segmentCodeRef).filter(Boolean);
    const seatCount = Math.min(
      ...(groups.flat().flatMap(d => (d.segments || []).map(s => parseInt(s.bookingCount) || Infinity)))
    );

    flights.push({
      id: `tl-${item.itemCodeRef ? item.itemCodeRef.slice(-14) : idx}-${idx}`,
      source: 'triplover',
      provider: 'TripLover',
      airline: item.platingCarrierName || first.airline || '',
      airlineCode: item.platingCarrier || first.airlineCode || '',
      airlineLogo: null,
      flightNumber: first.flightNumber,
      origin: first.origin || originCode,
      destination: last.destination || destinationCode,
      departureTime: first.departureTime,
      arrivalTime: last.arrivalTime,
      duration: formatMinutes(totalMinutes),
      durationMinutes: totalMinutes,
      stops: Math.max(0, outboundLegs.length - 1),
      stopCodes: outboundLegs.slice(0, -1).map(l => l.destination),
      cabinClass: first.cabinClass || 'Economy',
      bookingClass: first.bookingClass || '',
      availableSeats: Number.isFinite(seatCount) ? seatCount : null,
      price: item.totalPrice || 0,
      baseFare: item.basePrice || 0,
      taxes: item.taxes || 0,
      currency: 'BDT',
      refundable: !!item.refundable,
      baggage: first.baggage,
      handBaggage: first.handBaggage,
      aircraft: first.aircraft,
      legs: outboundLegs,
      returnLegs: returnLegs.length ? returnLegs : undefined,
      isRoundTrip: returnLegs.length > 0,
      fareDetails: Object.entries(item.passengerFares || {})
        .filter(([, f]) => f && typeof f === 'object')
        .map(([ptc, f]) => ({
          passengerType: ptc.toUpperCase(),
          basePrice: f.basePrice ?? 0,
          taxes: f.taxes ?? 0,
          totalPrice: f.totalPrice ?? 0,
          ait: f.ait ?? 0,
        })),
      passengerCounts: item.passengerCounts || null,
      bookable: item.bookable !== false,
      validatingAirline: item.platingCarrier || '',
      // Refs required for reprice/book/ticket
      _tlUniqueTransID: item.uniqueTransID,
      _tlItemCodeRef: item.itemCodeRef,
      _tlSegmentCodeRefs: segmentCodeRefs,
    });
  });

  return flights;
}

// ── Reprice (mandatory before booking) ──
async function revalidatePrice({ uniqueTransID, itemCodeRef, segmentCodeRefs = [] }) {
  const data = await tlPost('/api/Reprice', {
    uniqueTransID,
    itemCodeRef,
    taxRedemptions: [],
    segmentCodeRefs,
    commissionOnTaxes: [],
    brandedFareRefs: '',
  });
  const r = data?.item1 || {};
  return {
    success: !!r.priceCodeRef,
    priceChanged: !!r.isPriceChanged,
    priceCodeRef: r.priceCodeRef || null,
    itemCodeRef: r.itemCodeRef || itemCodeRef,
    uniqueTransID: r.uniqueTransID || uniqueTransID,
    totalPrice: r.totalPrice || 0,
    basePrice: r.basePrice || 0,
    taxes: r.taxes || 0,
    refundable: !!r.refundable,
    partialPaymentAmount: r.newPartialPaymentAmount || 0,
    segmentCodeRefs: (r.directions || []).flat().flatMap(d => (d.segments || []).map(s => s.segmentCodeRef)).filter(Boolean),
    raw: data,
  };
}

function mapPassenger(p, contactInfo) {
  const typeMap = { adult: 'ADT', child: 'CNN', children: 'CNN', infant: 'INF', ADT: 'ADT', CNN: 'CNN', CHD: 'CNN', INF: 'INF' };
  const title = p.title || 'Mr';
  return {
    nameElement: {
      title,
      firstName: p.firstName || '',
      lastName: p.lastName || '',
    },
    gender: p.gender || (/^(mrs|ms|miss)$/i.test(title) ? 'Female' : 'Male'),
    passengerType: typeMap[p.type] || typeMap[String(p.type || '').toLowerCase()] || 'ADT',
    dateOfBirth: p.dob || p.dateOfBirth || '',
    documentInfo: {
      documentNumber: p.passport || p.documentNumber || '',
      expireDate: p.passportExpiry || '',
      documentType: '',
      frequentFlyerNumber: p.frequentFlyer || '',
      issuingCountry: p.issuingCountry || p.nationality || 'BD',
      nationality: p.nationality || 'BD',
      passportCopy: '',
      visaCopy: '',
      postCode: '',
    },
    contactInfo: {
      phone: (contactInfo?.phone || '').replace(/^\+?88/, ''),
      email: contactInfo?.email || '',
      phoneCountryCode: contactInfo?.phoneCountryCode || '+88',
      countryCode: contactInfo?.countryCode || 'BD',
    },
    isLeadPassenger: !!p.isLeadPassenger,
    aCMExtraServices: [],
  };
}

// ── Book (creates PNR) ──
async function createBooking({ uniqueTransID, itemCodeRef, priceCodeRef, segmentCodeRefs = [], passengers = [], contactInfo = {} }) {
  try {
    const passengerInfoes = passengers.map((p, i) => mapPassenger({ ...p, isLeadPassenger: p.isLeadPassenger ?? i === 0 }, contactInfo));

    const data = await tlPost('/api/Book', {
      passengerInfoes,
      uniqueTransID,
      itemCodeRef,
      priceCodeRef,
      segmentCodeRefs,
      remarks: [],
      isPartialPayment: false,
    });

    const r = data?.item1 || {};
    const pnr = r.pnr || r.bookingRefNumber || null;
    if (!pnr) {
      // Surface the real supplier reason (item2.message) instead of a generic failure.
      const reason = r.message || data?.item2?.message
        || (typeof data?.raw === 'string' ? data.raw.split('\n')[0].trim() : null)
        || 'TripLover booking failed (no PNR)';
      const { error, hint } = describeFailure({ message: reason, body: data, operation: 'Book' });
      logApiCall({ provider: 'triplover', operation: 'Book (rejected)', ok: false, response: data, error, hint });
      return { success: false, error, hint, pnr: null, rawResponse: data };

    }

    console.log('[TripLover] Booking created — PNR:', pnr);
    return {
      success: true,
      pnr,
      bookingId: pnr,
      airlinePnr: Array.isArray(r.airlinesPNR) ? r.airlinesPNR[0] : (r.airlinesPNR || null),
      bookingStatus: r.bookingStatus || 'Created',
      ticketingTimeLimit: r.ticketingTimeLimit || null,
      refs: {
        uniqueTransID: r.uniqueTransID || uniqueTransID,
        itemCodeRef: r.itemCodeRef || itemCodeRef,
        priceCodeRef: r.priceCodeRef || priceCodeRef,
        bookingCodeRef: r.bookingCodeRef || null,
      },
      rawResponse: data,
    };
  } catch (err) {
    console.error('[TripLover] CreateBooking failed:', err.message);
    return { success: false, error: err.message, pnr: null };
  }
}

// ── Issue ticket ──
async function issueTicket({ pnr, uniqueTransID, itemCodeRef, priceCodeRef, bookingCodeRef, isPartialPayment = false, commission = 0 }) {
  try {
    const data = await tlPost('/api/ticket/NewTicket', {
      PNR: pnr,
      BookingRefNumber: pnr,
      UniqueTransID: uniqueTransID,
      PriceCodeRef: priceCodeRef,
      ItemCodeRef: itemCodeRef,
      BookingCodeRef: bookingCodeRef,
      PreTicketValidationRef: '',
      IsSmsSend: false,
      IsPartialPayment: !!isPartialPayment,
      TicketWithNewFare: true,
      commission,
      isPartialPayment: !!isPartialPayment,
    }, { timeout: 90000 });

    const r = data?.item1 || {};
    const ticketNumbers = (r.ticketInfoes || []).flatMap(t => t.ticketNumbers || []);
    return { success: ticketNumbers.length > 0, ticketNumbers, warnings: r.warnings || [], rawResponse: data };
  } catch (err) {
    console.error('[TripLover] IssueTicket failed:', err.message);
    return { success: false, error: err.message, ticketNumbers: [] };
  }
}

// ── Cancel ──
async function cancelBooking({ pnr, uniqueTransID, itemCodeRef, priceCodeRef, bookingCodeRef }) {
  try {
    const data = await tlPost('/api/Cancel', {
      PNR: pnr,
      BookingRefNumber: pnr,
      UniqueTransID: uniqueTransID,
      PriceCodeRef: priceCodeRef,
      ItemCodeRef: itemCodeRef,
      BookingCodeRef: bookingCodeRef,
    });
    const r = data?.item1 || {};
    return { success: r.isSuccess !== false, message: r.message || 'Cancelled', rawResponse: data };
  } catch (err) {
    console.error('[TripLover] CancelBooking failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Fare rules ──
async function getFareRules({ uniqueTransID, itemCodeRef, segmentCodeRefs = [] }) {
  try {
    const data = await tlPost('/api/FareRules', { itemCodeRef, uniqueTransID, segmentCodeRefs, brandedFareRefs: '' });
    return { success: true, rules: data?.item1 || data, rawResponse: data };
  } catch (err) {
    return { success: false, error: err.message, rules: null };
  }
}

// ── Retrieve PNR ──
async function getBooking({ pnr, uniqueTransID, itemCodeRef, priceCodeRef, bookingCodeRef }) {
  try {
    const data = await tlPost('/api/pnr', {
      PNR: pnr,
      BookingRefNumber: pnr,
      UniqueTransID: uniqueTransID,
      PriceCodeRef: priceCodeRef,
      ItemCodeRef: itemCodeRef,
      BookingCodeRef: bookingCodeRef,
    });
    return { success: true, booking: data?.item1 || data, rawResponse: data };
  } catch (err) {
    return { success: false, error: err.message, booking: null };
  }
}

// ── Connectivity test (used by admin pause/resume panel) ──
async function testConnection() {
  const config = await getTripLoverConfig();
  if (!config) return { success: false, error: 'TripLover not configured or disabled' };
  const token = await getToken(config);
  return token ? { success: true, message: 'Authenticated with TripLover' } : { success: false, error: 'Login failed' };
}

module.exports = {
  searchFlights,
  revalidatePrice,
  createBooking,
  issueTicket,
  cancelBooking,
  getFareRules,
  getBooking,
  testConnection,
  getTripLoverConfig,
  clearTripLoverConfigCache,
};
