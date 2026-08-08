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
    // ASP.NET validation failures return { errors: { field: [msg] } } — surface those field messages,
    // otherwise "Validation error occurred" tells nobody what is actually wrong.
    const fieldErrors = data?.errors && typeof data.errors === 'object'
      ? Object.entries(data.errors).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`).join(' | ')
      : '';
    const baseMsg = data?.message || data?.title || data?.item1?.message || data?.item2?.message || `HTTP ${res.status}`;
    const msg = fieldErrors ? `${baseMsg} — ${fieldErrors}` : baseMsg;
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
// TripLover returns only ONE PAGE (10 itineraries) per response, while the full
// supplier set (SV, X1, RX, AI, MS, ET …) arrives progressively. Their own booking
// site therefore: 1) opens /api/Search/Progressive (SSE) to collect the pagination
// key + the complete airlineFilters list, then 2) pulls results per airline through
// /api/Search/key=<paginationKey>. Doing a single /api/Search call silently drops
// most airlines — that is why Saudia (SV) was missing from our results.
async function tlRawPost(pathname, body, { timeout = 85000, accept = 'application/json' } = {}) {
  const config = await getTripLoverConfig();
  if (!config) throw new Error('TripLover API not configured');
  const token = await getToken(config);
  if (!token) throw new Error('TripLover authentication failed');
  const url = `${config.searchBaseUrl}${pathname}`;
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: accept, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  if (!res.ok) {
    logApiCall({
      provider: 'triplover', operation: pathname.replace(/^\/api\/?/, ''), url, status: res.status,
      ok: false, durationMs: Date.now() - started, request: body,
      response: { raw: text.slice(0, 800) }, error: `HTTP ${res.status}`,
    });
    throw new Error(`TripLover ${pathname}: HTTP ${res.status}`);
  }
  return { text, durationMs: Date.now() - started, url };
}

// Parses the SSE body of /api/Search/Progressive; returns the last (most complete) frame
// plus the UNION of every airline seen in any frame (the stream is incremental, so the
// last frame alone can miss suppliers that arrived earlier, e.g. SV).
function parseProgressiveStream(text) {
  const frames = String(text).split(/\n?data:\s*/).map(s => s.trim()).filter(Boolean);
  let last = null;
  let key = null;
  const items = [];
  const airlineSet = new Set();
  for (const frame of frames) {
    let json;
    try { json = JSON.parse(frame); } catch (_) { continue; }
    const sr = json.searchResponse || json.item1 || json;
    if (sr && (sr.searchPaginationKey || Array.isArray(sr.airSearchResponses))) last = sr;
    if (sr?.searchPaginationKey) key = sr.searchPaginationKey;
    for (const a of sr?.airlineFilters || []) if (a?.airlineCode) airlineSet.add(a.airlineCode);
    for (const it of sr?.airSearchResponses || []) {
      items.push(it);
      if (it?.platingCarrier) airlineSet.add(it.platingCarrier);
    }
  }
  return { summary: last, items, key, airlines: [...airlineSet] };
}

// Streaming variant: reads /api/Search/Progressive incrementally and ABORTS as soon as
// we have what we need (pagination key + airline list). TripLover UAT keeps the SSE
// connection open for ~40s even though the key + airlineFilters arrive in the first
// few seconds, so waiting for the stream to end was the whole latency cost.
async function tlProgressiveStream(payload, { maxMs = 12000, idleMs = 2500 } = {}) {
  const config = await getTripLoverConfig();
  if (!config) throw new Error('TripLover API not configured');
  const token = await getToken(config);
  if (!token) throw new Error('TripLover authentication failed');

  const url = `${config.searchBaseUrl}/api/Search/Progressive`;
  const controller = new AbortController();
  const started = Date.now();
  const hardStop = setTimeout(() => controller.abort(), maxMs);

  let text = '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      clearTimeout(hardStop);
      const raw = await res.text().catch(() => '');
      logApiCall({
        provider: 'triplover', operation: 'Search/Progressive', url, status: res.status, ok: false,
        durationMs: Date.now() - started, request: payload, response: { raw: raw.slice(0, 800) },
        error: `HTTP ${res.status}`,
      });
      throw new Error(`TripLover Progressive: HTTP ${res.status}`);
    }

    const decoder = new TextDecoder();
    let lastChunkAt = Date.now();
    let sawKey = false;
    for await (const chunk of res.body) {
      text += decoder.decode(chunk, { stream: true });
      lastChunkAt = Date.now();
      if (!sawKey && /searchPaginationKey/.test(text)) sawKey = true;
      // Once the key is in hand, stop after a short idle gap — remaining frames are
      // duplicates of what the keyed per-airline fetches return anyway.
      if (sawKey && Date.now() - lastChunkAt > idleMs) break;
      if (sawKey && Date.now() - started > Math.min(maxMs, 8000)) break;
      if (Date.now() - started > maxMs) break;
    }
  } catch (err) {
    if (err?.name !== 'AbortError' && !text) { clearTimeout(hardStop); throw err; }
  } finally {
    clearTimeout(hardStop);
    try { controller.abort(); } catch (_) {}
  }
  return { text, durationMs: Date.now() - started };
}



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
    searchFilter: { page: 1, limit: 10 },
  };

  const searchTimeout = parseInt(process.env.TRIPLOVER_SEARCH_TIMEOUT_MS) || 85000;
  const perAirlineLimit = parseInt(process.env.TRIPLOVER_PER_AIRLINE_LIMIT) || 20;
  const progressiveMaxMs = parseInt(process.env.TRIPLOVER_PROGRESSIVE_MAX_MS) || 12000;

  // 1) Progressive stream → pagination key + full airline list (early-abort, see above)
  try {
    const { text, durationMs } = await tlProgressiveStream(payload, { maxMs: progressiveMaxMs });

    const parsed = parseProgressiveStream(text);
    const { summary, items } = parsed;
    const key = parsed.key || summary?.searchPaginationKey;
    const airlines = parsed.airlines;

    logApiCall({
      provider: 'triplover', operation: 'Search/Progressive', ok: true, durationMs, request: payload,
      response: { totalFlights: summary?.totalFlights ?? 0, airlines, paginationKey: key ? 'yes' : 'no' },
    });

    const flights = [];
    const seen = new Set();
    const push = (list) => {
      for (const f of list) {
        const k = f._tlItemCodeRef || f.id;
        if (k && seen.has(k)) continue;
        if (k) seen.add(k);
        flights.push(f);
      }
    };
    push(normalizeSearch({ item1: { airSearchResponses: items } }, origin, destination));

    // 2) Pull results through the pagination key so no supplier (SV, X1, RX …) is lost.
    if (key) {
      const keyedFetch = async (codes) => {
        const body = {
          sortBy: 1,
          layoverTime: { maxLayoverTime: 60, minLayoverTime: 0 },
          page: 1, limit: perAirlineLimit,
        };
        if (codes && codes.length) body.airlines = codes;
        const { text: t } = await tlRawPost(`/api/Search/key=${key}`, body, { timeout: 30000 });
        let json = null;
        try { json = JSON.parse(t); } catch (_) { return { list: [], json: null }; }
        const list = json?.airSearchResponse || json?.item1?.airSearchResponses || json?.airSearchResponses || [];
        return { list, json };
      };

      const discovered = new Set(airlines);
      // 2a) Unfiltered keyed page — reveals the full airlineFilters list even when the
      // SSE frame we captured was incomplete.
      try {
        const { list, json } = await keyedFetch(null);
        push(normalizeSearch({ item1: { airSearchResponses: list } }, origin, destination));
        const filters = json?.airlineFilters || json?.item1?.airlineFilters || [];
        for (const a of filters) if (a?.airlineCode) discovered.add(a.airlineCode);
        for (const it of list) if (it?.platingCarrier) discovered.add(it.platingCarrier);
      } catch (err) {
        console.warn('[TripLover] keyed unfiltered fetch failed:', err.message);
      }

      const codes = [...discovered];
      if (codes.length) {
        const results = await Promise.allSettled(codes.map(async (code) => {
          try {
            return await keyedFetch([code]);
          } catch (err) {
            // one retry — UAT drops requests intermittently
            return await keyedFetch([code]);
          }
        }));
        results.forEach((r, i) => {
          if (r.status !== 'fulfilled') {
            console.warn(`[TripLover] airline fetch failed ${codes[i]}: ${r.reason?.message}`);
            return;
          }
          push(normalizeSearch({ item1: { airSearchResponses: r.value.list } }, origin, destination));
        });
      }
    }


    if (flights.length) {
      const codes = [...new Set(flights.map(f => f.airlineCode))];
      console.log(`[TripLover] ${flights.length} fares from ${codes.length} airlines: ${codes.join(',')}`);
      return flights;
    }
  } catch (err) {
    console.error('[TripLover] Progressive search failed, falling back:', err.message);
  }

  // 3) Fallback — legacy single-shot search
  try {
    const data = await tlPost('/api/Search', payload, { useSearchBase: true, timeout: searchTimeout });
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
            operatingAirline: seg.operatingAirlineCode || seg.airlineCode || dir.platingCarrierCode || '',
            aircraft: detail.equipment || (seg.plane && seg.plane[0]) || '',
            cabinClass: seg.serviceClass || seg.cabinClass || 'Economy',
            bookingClass: seg.bookingClass || seg.classOfService || '',

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
      // Some suppliers (e.g. SV via Galileo) return basePrice 0 with only totalPrice —
      // derive the base so fare breakdowns and markups stay correct.
      baseFare: item.basePrice || item.eqivqlBasePrice
        || Math.max(0, (item.totalPrice || 0) - (item.taxes || 0)) || 0,

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

// TripLover expects ISO-2 country codes. The booking form sends nationality labels
// ("Bangladeshi"), which the supplier rejects with a generic "Validation error occurred".
const NATIONALITY_TO_ISO2 = {
  bangladeshi: 'BD', bangladesh: 'BD', indian: 'IN', india: 'IN', pakistani: 'PK', pakistan: 'PK',
  nepali: 'NP', nepalese: 'NP', nepal: 'NP', srilankan: 'LK', 'sri lankan': 'LK', 'sri lanka': 'LK',
  maldivian: 'MV', maldives: 'MV', bhutanese: 'BT', bhutan: 'BT', myanmar: 'MM', burmese: 'MM',
  saudi: 'SA', 'saudi arabian': 'SA', 'saudi arabia': 'SA', emirati: 'AE', 'united arab emirates': 'AE',
  qatari: 'QA', qatar: 'QA', kuwaiti: 'KW', kuwait: 'KW', omani: 'OM', oman: 'OM', bahraini: 'BH', bahrain: 'BH',
  malaysian: 'MY', malaysia: 'MY', singaporean: 'SG', singapore: 'SG', thai: 'TH', thailand: 'TH',
  indonesian: 'ID', indonesia: 'ID', filipino: 'PH', philippines: 'PH', chinese: 'CN', china: 'CN',
  japanese: 'JP', japan: 'JP', korean: 'KR', 'south korea': 'KR', turkish: 'TR', turkey: 'TR',
  british: 'GB', 'united kingdom': 'GB', american: 'US', 'united states': 'US', canadian: 'CA', canada: 'CA',
  australian: 'AU', australia: 'AU', german: 'DE', germany: 'DE', french: 'FR', france: 'FR',
  italian: 'IT', italy: 'IT', spanish: 'ES', spain: 'ES', egyptian: 'EG', egypt: 'EG',
  jordanian: 'JO', jordan: 'JO', lebanese: 'LB', lebanon: 'LB', iraqi: 'IQ', iraq: 'IQ',
  afghan: 'AF', afghanistan: 'AF', iranian: 'IR', iran: 'IR', 'south african': 'ZA', 'south africa': 'ZA',
};

function toIso2(value, fallback = 'BD') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return NATIONALITY_TO_ISO2[raw.toLowerCase()] || fallback;
}

function toApiDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function mapPassenger(p, contactInfo) {
  const typeMap = { adult: 'ADT', child: 'CNN', children: 'CNN', infant: 'INF', ADT: 'ADT', CNN: 'CNN', CHD: 'CNN', INF: 'INF' };
  const rawTitle = String(p.title || '').trim();
  const title = /^(mr|mrs|ms|miss|mstr|master)$/i.test(rawTitle)
    ? rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1).toLowerCase()
    : 'Mr';
  const nationality = toIso2(p.nationality);
  const documentNumber = String(p.passport || p.documentNumber || '').trim().toUpperCase();
  const phone = String(contactInfo?.phone || p.phone || '').replace(/\D/g, '').replace(/^88/, '');
  return {
    nameElement: {
      title,
      firstName: String(p.firstName || '').trim().toUpperCase(),
      lastName: String(p.lastName || '').trim().toUpperCase(),
    },
    gender: /^(mrs|ms|miss)$/i.test(title) ? 'Female' : (/^female$/i.test(p.gender || '') ? 'Female' : 'Male'),
    passengerType: typeMap[p.type] || typeMap[String(p.type || '').toLowerCase()] || 'ADT',
    dateOfBirth: toApiDate(p.dob || p.dateOfBirth),
    documentInfo: {
      documentNumber,
      expireDate: toApiDate(p.passportExpiry || p.documentExpiry),
      documentType: documentNumber ? 'Passport' : '',
      frequentFlyerNumber: p.frequentFlyer || '',
      issuingCountry: toIso2(p.issuingCountry || p.documentCountry || p.nationality),
      nationality,
      passportCopy: '',
      visaCopy: '',
      postCode: '',
    },
    contactInfo: {
      phone,
      email: String(contactInfo?.email || p.email || '').trim(),
      phoneCountryCode: contactInfo?.phoneCountryCode || '+88',
      countryCode: toIso2(contactInfo?.countryCode),
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
