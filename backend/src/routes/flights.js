const express = require('express');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { authenticate, authenticateOptional, requireAdmin } = require('../middleware/auth');
const { notifyBookingConfirm } = require('../services/notify');
const { searchFlights: ttiSearch, createBooking: ttiCreateBooking } = require('./tti-flights');
const { searchFlights: bdfSearch, createBooking: bdfCreateBooking } = require('./bdf-flights');
const { searchFlights: flyhubSearch, createBooking: flyhubCreateBooking } = require('./flyhub-flights');
const { searchFlights: sabreSearch, createBooking: sabreCreateBooking, revalidatePrice: sabreRevalidate, getBooking: sabreGetBooking, checkTicketStatus: sabreCheckTickets, getSeatsRest: sabreGetSeatsRest, voidTickets: sabreVoid, refundPrice: sabreRefundPrice, refundFulfill: sabreRefundFulfill, getFlightStatus: sabreFlightStatus, getAncillariesStateless: sabreGetAncillaries, addAncillaryStateless: sabreAddAncillary, fulfillTickets: sabreFulfillTickets, updateFrequentFlyer: sabreUpdateFF } = require('./sabre-flights');
const { searchFlights: galileoSearch } = require('./galileo-flights');
const { searchFlights: ndcSearch } = require('./ndc-flights');
const { searchAllLCCs } = require('./lcc-flights');
const { searchFlights: triploverSearch, revalidatePrice: tlRevalidate, createBooking: tlCreateBooking, issueTicket: tlIssueTicket, cancelBooking: tlCancelBooking } = require('./triplover-flights');
const { getProviderStatuses } = require('../utils/provider-status');
const { loadPartialSettings, evaluatePartialEligibility, isAirlineRouteBlocked, BD_AIRPORTS: GUARDS_BD } = require('../utils/booking-guards');


const router = express.Router();

// ── Live-fare micro cache ──────────────────────────────────────────────
// Identical searches (page refresh, back navigation, filter/sort changes)
// reuse the same GDS payload for a short window instead of re-querying every
// supplier. TTL is intentionally short so fares stay live and bookable.
const PROVIDER_CACHE_TTL_MS = parseInt(process.env.PROVIDER_SEARCH_CACHE_TTL_MS) || 120000;
const PROVIDER_CACHE_MAX = 60;
const providerSearchCache = new Map();

function getCachedProviderResult(key) {
  const hit = providerSearchCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiry) {
    providerSearchCache.delete(key);
    return null;
  }
  return hit.rows;
}

function setCachedProviderResult(key, rows, ttlMs) {
  if (providerSearchCache.size >= PROVIDER_CACHE_MAX) {
    const oldest = providerSearchCache.keys().next().value;
    if (oldest) providerSearchCache.delete(oldest);
  }
  providerSearchCache.set(key, { rows, expiry: Date.now() + (ttlMs || PROVIDER_CACHE_TTL_MS) });
}

// ── Provider cooldown ──────────────────────────────────────────────────
// A supplier that just failed / timed out / returned nothing is skipped for a
// short window so it never burns the search budget again on the next request.
const PROVIDER_COOLDOWN_MS = parseInt(process.env.PROVIDER_COOLDOWN_MS) || 60000;
const EMPTY_RESULT_TTL_MS = parseInt(process.env.PROVIDER_EMPTY_CACHE_TTL_MS) || 45000;
const providerCooldown = new Map(); // id → timestamp until which the provider is skipped

function isProviderCoolingDown(id) {
  const until = providerCooldown.get(id);
  if (!until) return false;
  if (Date.now() > until) { providerCooldown.delete(id); return false; }
  return true;
}

function markProviderCooldown(id) {
  providerCooldown.set(id, Date.now() + PROVIDER_COOLDOWN_MS);
}




// Public: check whether the flight is eligible for partial payment.
// GET /api/flights/partial-eligibility?origin=DAC&destination=JED&departureTime=2026-07-02T12:00&refundable=true&airlineCode=BS
router.get('/partial-eligibility', async (req, res) => {
  try {
    const settings = await loadPartialSettings();
    const refundable = req.query.refundable === undefined ? true : String(req.query.refundable) === 'true';
    const eligibility = evaluatePartialEligibility({
      origin: req.query.origin,
      destination: req.query.destination,
      departureTime: req.query.departureTime,
      refundable,
      partialOverride: false,
    }, settings);
    res.json({ ...eligibility, settings });
  } catch (err) {
    res.json({ eligible: false, reason: 'error', error: err.message });
  }
});

// ─── Travel Document Upload (Passport/Visa copies) ───
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const TRAVEL_DOCS_DIR = path.join(UPLOAD_DIR, 'travel-documents');
if (!fs.existsSync(TRAVEL_DOCS_DIR)) fs.mkdirSync(TRAVEL_DOCS_DIR, { recursive: true });

const travelDocStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = path.join(TRAVEL_DOCS_DIR, req.user.sub);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const docType = file.fieldname || 'doc'; // passport_0 or visa_0
    cb(null, `${docType}-${Date.now()}${ext}`);
  },
});
const travelDocUpload = multer({
  storage: travelDocStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type ${ext} not allowed`));
  },
});

// POST /flights/upload-travel-docs — upload passport + visa copies per passenger
router.post('/upload-travel-docs', authenticate, travelDocUpload.any(), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded', status: 400 });
    }
    const docs = req.files.map(f => ({
      fieldname: f.fieldname,
      originalName: f.originalname,
      filename: f.filename,
      size: f.size,
      mimetype: f.mimetype,
      url: `/uploads/travel-documents/${req.user.sub}/${f.filename}`,
    }));
    res.json({ message: 'Documents uploaded', documents: docs });
  } catch (err) {
    console.error('Travel doc upload error:', err);
    res.status(500).json({ message: 'Upload failed', status: 500 });
  }
});

// GET /flights/travel-docs/:bookingId — admin: list travel docs for a booking
router.get('/travel-docs/:bookingId', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT details, user_id FROM bookings WHERE id = ?', [req.params.bookingId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Booking not found' });
    const details = typeof rows[0].details === 'string' ? JSON.parse(rows[0].details) : (rows[0].details || {});
    const travelDocs = details.travelDocuments || [];
    res.json({ documents: travelDocs, userId: rows[0].user_id });
  } catch (err) {
    console.error('Travel docs fetch error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});


// ─── Sabre REST: Price Revalidation ───
router.post('/revalidate-price', authenticate, async (req, res) => {
  try {
    const { flights, adults, children, infants, cabinClass } = req.body;
    if (!flights || !Array.isArray(flights) || flights.length === 0) {
      return res.status(400).json({ message: 'flights array is required' });
    }
    const result = await sabreRevalidate({ flights, adults, children, infants, cabinClass });
    res.json(result);
  } catch (err) {
    console.error('[RevalidatePrice] Error:', err.message);
    res.status(500).json({ message: 'Price revalidation failed', error: err.message });
  }
});

// ─── Sabre REST: Get Booking ───
router.get('/booking/:pnr', authenticate, async (req, res) => {
  try {
    const { pnr } = req.params;
    if (!pnr) return res.status(400).json({ message: 'PNR is required' });
    const result = await sabreGetBooking({ pnr });
    res.json(result);
  } catch (err) {
    console.error('[GetBooking] Error:', err.message);
    res.status(500).json({ message: 'Failed to retrieve booking', error: err.message });
  }
});

// ─── Sabre REST: Check Ticket Status ───
router.get('/ticket-status/:pnr', authenticate, async (req, res) => {
  try {
    const { pnr } = req.params;
    if (!pnr) return res.status(400).json({ message: 'PNR is required' });
    const result = await sabreCheckTickets({ pnr });
    res.json(result);
  } catch (err) {
    console.error('[CheckTickets] Error:', err.message);
    res.status(500).json({ message: 'Failed to check ticket status', error: err.message });
  }
});

// ─── Seat Map (REST with SOAP fallback for pre-booking) ───
router.get('/seats-rest', async (req, res) => {
  try {
    const { origin, destination, departureDate, airlineCode, flightNumber, cabinClass, pnr } = req.query;
    if (!origin || !destination || !departureDate || !airlineCode || !flightNumber) {
      return res.status(400).json({ message: 'Required: origin, destination, departureDate, airlineCode, flightNumber' });
    }

    // If PNR exists, try REST first
    if (pnr) {
      const result = await sabreGetSeatsRest({ origin, destination, departureDate, airlineCode, flightNumber, cabinClass, pnr });
      if (result?.success) return res.json(result);
      console.log('[SeatsRest] REST failed for PNR, falling back to SOAP...');
    }

    // Pre-booking or REST fallback: use SOAP EnhancedSeatMapRQ (no PNR needed)
    try {
      const { getSeatMap } = require('./sabre-soap');
      const BD_AIRPORTS = ['DAC', 'CXB', 'CGP', 'ZYL', 'JSR', 'RJH', 'SPD', 'BZL', 'IRD', 'TKR'];
      const isDomestic = BD_AIRPORTS.includes(origin) && BD_AIRPORTS.includes(destination);
      const soapResult = await getSeatMap({
        origin, destination, departureDate,
        marketingCarrier: airlineCode,
        operatingCarrier: airlineCode,
        flightNumber: String(flightNumber).replace(/^[A-Z]{2}/i, ''),
        cabinClass: cabinClass || 'Economy',
        isDomestic,
      });
      if (soapResult && (soapResult.rows?.length > 0 || soapResult.totalRows > 0)) {
        return res.json({ success: true, ...soapResult, source: 'sabre-soap' });
      }
    } catch (soapErr) {
      console.error('[SeatsRest] SOAP fallback error:', soapErr.message);
    }

    res.json({ success: false, source: 'none', error: 'No seat map available from REST or SOAP', rows: [], available: false });
  } catch (err) {
    console.error('[SeatsRest] Error:', err.message);
    res.status(500).json({ message: 'Failed to load seat map', error: err.message });
  }
});

// POST /flights/assign-seats — assign seats to an existing PNR
router.post('/assign-seats', authenticate, async (req, res) => {
  try {
    const { pnr, seatAssignments, source } = req.body;
    if (!pnr || !seatAssignments?.length) {
      return res.status(400).json({ message: 'pnr and seatAssignments[] required' });
    }

    const providerSource = String(source || '').toLowerCase();

    if (providerSource.includes('sabre') || !providerSource) {
      // Default to Sabre seat assignment
      const { assignSeats } = require('./sabre-flights');
      const result = await assignSeats({ pnr, seatAssignments });
      return res.json(result);
    }

    if (providerSource.includes('tti') || providerSource.includes('astra')) {
      // TTI seat assignment via SpecialService with Seat data
      // TTI uses UpdateBooking with SpecialServices[].Code="SEAT", Data.Seat.SeatRow + SeatLetter
      const { ttiRequest, getTTIConfig } = require('./tti-flights');
      const config = await getTTIConfig();
      if (!config) return res.status(500).json({ message: 'TTI not configured' });

      const specialServices = seatAssignments.map(sa => ({
        Code: 'SEAT',
        RefPassenger: String((sa.passengerIndex || 0) + 1),
        RefSegment: String(sa.segmentNumber || 1),
        Data: {
          Seat: {
            SeatRow: parseInt(String(sa.seatNumber || '').replace(/[A-Za-z]+$/, '')) || 0,
            SeatLetter: String(sa.seatNumber || '').replace(/^\d+/, '') || 'A',
          },
        },
      }));

      try {
        const response = await ttiRequest('UpdateBooking', {
          RequestInfo: { AuthenticationKey: config.key },
          BookingID: pnr,
          SpecialServices: specialServices,
        });
        return res.json({ success: true, rawResponse: response });
      } catch (ttiErr) {
        return res.json({ success: false, error: ttiErr.message });
      }
    }

    return res.status(400).json({ message: `Seat assignment not supported for provider: ${source}` });
  } catch (err) {
    console.error('[AssignSeats] Error:', err.message);
    res.status(500).json({ message: 'Failed to assign seats', error: err.message });
  }
});

// POST /flights/purchase-ancillary — purchase ancillary services (extra baggage, meals) for an existing PNR
router.post('/purchase-ancillary', authenticate, async (req, res) => {
  try {
    const { pnr, ancillaries, source } = req.body;
    // ancillaries: [{ type: 'baggage'|'meal', code: 'XBAG'|'VGML', passengerIndex: 0, segmentNumber: 1, offerId?: string }]
    if (!pnr || !ancillaries?.length) {
      return res.status(400).json({ message: 'pnr and ancillaries[] required' });
    }

    const providerSource = String(source || '').toLowerCase();

    if (providerSource.includes('sabre') || !providerSource) {
      const { addAncillarySSR } = require('./sabre-flights');
      const ssrList = ancillaries.map(anc => ({
        code: anc.code || 'OTHS',
        text: anc.text || `${anc.code} - ${anc.type}`,
        passengerIndex: anc.passengerIndex || 0,
        segmentNumber: anc.segmentNumber || 'A',
        airlineCode: anc.airlineCode || '',
      }));

      const result = await addAncillarySSR({ pnr, ssrList });
      return res.json(result);
    }

    return res.status(400).json({ message: `Ancillary purchase not supported for provider: ${source}` });
  } catch (err) {
    console.error('[PurchaseAncillary] Error:', err.message);
    res.status(500).json({ message: 'Failed to purchase ancillary', error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION 24: Void Flight Tickets
// ═══════════════════════════════════════════════════════════════
router.post('/void', authenticate, async (req, res) => {
  try {
    const { pnr, tickets } = req.body;
    if (!pnr && (!tickets || !tickets.length)) {
      return res.status(400).json({ message: 'PNR or ticket numbers required' });
    }
    const result = await sabreVoid({ pnr, tickets });
    res.json(result);
  } catch (err) {
    console.error('[Void] Error:', err.message);
    res.status(500).json({ message: 'Void failed', error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION 23: Refund (2-step: price → fulfill)
// ═══════════════════════════════════════════════════════════════
router.post('/refund/price', authenticate, async (req, res) => {
  try {
    const { pnr, passengers, refundDocuments, qualifiers } = req.body;
    if (!pnr || !refundDocuments?.length) {
      return res.status(400).json({ message: 'PNR and refundDocuments required' });
    }
    const result = await sabreRefundPrice({ pnr, passengers, refundDocuments, qualifiers });
    res.json(result);
  } catch (err) {
    console.error('[RefundPrice] Error:', err.message);
    res.status(500).json({ message: 'Refund pricing failed', error: err.message });
  }
});

router.post('/refund/fulfill', authenticate, async (req, res) => {
  try {
    const { pnr, passengers, formsOfRefund, refundDocuments, cancelItinerary } = req.body;
    if (!pnr || !refundDocuments?.length) {
      return res.status(400).json({ message: 'PNR and refundDocuments required' });
    }
    const result = await sabreRefundFulfill({ pnr, passengers, formsOfRefund, refundDocuments, cancelItinerary });
    res.json(result);
  } catch (err) {
    console.error('[RefundFulfill] Error:', err.message);
    res.status(500).json({ message: 'Refund fulfill failed', error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION 22: Exchange / Reissue
// ═══════════════════════════════════════════════════════════════
router.post('/exchange', authenticate, async (req, res) => {
  try {
    const { pnr, originalTicketNumber, cancelSegments, newSegments, nameNumber, priceIncreaseTolerance, priceDecreaseTolerance } = req.body;
    if (!pnr || !originalTicketNumber || !newSegments?.length) {
      return res.status(400).json({ message: 'PNR, originalTicketNumber, and newSegments required' });
    }
    const { exchangeBooking } = require('./sabre-soap');
    const result = await exchangeBooking({ pnr, originalTicketNumber, cancelSegments, newSegments, nameNumber, priceIncreaseTolerance, priceDecreaseTolerance });
    res.json(result);
  } catch (err) {
    console.error('[Exchange] Error:', err.message);
    res.status(500).json({ message: 'Exchange failed', error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION 20: Structured Fare Rules
// ═══════════════════════════════════════════════════════════════
router.get('/fare-rules', async (req, res) => {
  try {
    const { origin, destination, departureDate, arrivalDate, airlineCode, flightNumber, fareBasis, bookingClass, passengerType } = req.query;
    if (!origin || !destination || !departureDate || !airlineCode || !flightNumber) {
      return res.status(400).json({ message: 'Required: origin, destination, departureDate, airlineCode, flightNumber' });
    }
    const { getStructuredFareRules } = require('./sabre-soap');
    const result = await getStructuredFareRules({ origin, destination, departureDate, arrivalDate, airlineCode, flightNumber, fareBasis, bookingClass, passengerType });
    res.json(result);
  } catch (err) {
    console.error('[FareRules] Error:', err.message);
    res.status(500).json({ message: 'Fare rules failed', error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION 25: Flight Status (FLIFO)
// ═══════════════════════════════════════════════════════════════
router.get('/status', async (req, res) => {
  try {
    const { airlineCode, flightNumber, date, departureDate, origin, destination } = req.query;
    if ((!airlineCode || !flightNumber) && (!origin || !destination)) {
      return res.status(400).json({ message: 'Required: (airlineCode + flightNumber) or (origin + destination), plus date' });
    }
    const result = await sabreFlightStatus({ airlineCode, flightNumber, departureDate: departureDate || date, origin, destination });
    res.json(result);
  } catch (err) {
    console.error('[FlightStatus] Error:', err.message);
    res.status(500).json({ message: 'Flight status failed', error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION 17 (complete): Stateless Ancillaries
// ═══════════════════════════════════════════════════════════════
router.post('/ancillaries-stateless', authenticate, async (req, res) => {
  try {
    const { pnr, segments, passengers, mode } = req.body;
    if (!pnr && (!segments || !segments.length)) {
      return res.status(400).json({ message: 'PNR or segments required' });
    }
    const result = await sabreGetAncillaries({ pnr, segments, passengers, mode });
    res.json(result);
  } catch (err) {
    console.error('[AncillariesStateless] Error:', err.message);
    res.status(500).json({ message: 'Stateless ancillaries failed', error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION 18 (complete): Add Ancillary Stateless + EMD
// ═══════════════════════════════════════════════════════════════
router.post('/add-ancillary-stateless', authenticate, async (req, res) => {
  try {
    const { pnr, segments, passengers, offers, ancillaries } = req.body;
    if (!pnr || !offers?.length) {
      return res.status(400).json({ message: 'PNR and offers required' });
    }
    const result = await sabreAddAncillary({ pnr, segments, passengers, offers, ancillaries });
    res.json(result);
  } catch (err) {
    console.error('[AddAncillaryStateless] Error:', err.message);
    res.status(500).json({ message: 'Add ancillary failed', error: err.message });
  }
});

router.post('/fulfill-tickets', authenticate, async (req, res) => {
  try {
    const { pnr, fulfillments, formsOfPayment, acceptPriceChanges } = req.body;
    if (!pnr) {
      return res.status(400).json({ message: 'PNR required' });
    }
    const result = await sabreFulfillTickets({ pnr, fulfillments, formsOfPayment, acceptPriceChanges });
    res.json(result);
  } catch (err) {
    console.error('[FulfillTickets] Error:', err.message);
    res.status(500).json({ message: 'Fulfill tickets failed', error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION 26 (complete): Post-booking Frequent Flyer Update
// ═══════════════════════════════════════════════════════════════
router.post('/update-frequent-flyer', authenticate, async (req, res) => {
  try {
    const { pnr, loyaltyUpdates } = req.body;
    if (!pnr || !loyaltyUpdates?.length) {
      return res.status(400).json({ message: 'PNR and loyaltyUpdates required' });
    }
    const result = await sabreUpdateFF({ pnr, loyaltyUpdates });
    res.json(result);
  } catch (err) {
    console.error('[UpdateFF] Error:', err.message);
    res.status(500).json({ message: 'FF update failed', error: err.message });
  }
});

// TTI Diagnostics
router.post('/tti-diagnostics', authenticate, async (req, res) => {
  try {
    const { getTTIConfig, ttiRequest } = require('./tti-flights');
    const dns = require('dns').promises;
    const config = await getTTIConfig();
    if (!config) {
      return res.json({ success: false, error: 'TTI not configured in database. Go to Admin → Settings → API Integrations → Air Astra TTI', config: null });
    }

    const results = { environment: config.environment, apiUrl: config.url, agencyId: config.agencyId, agencyName: config.agencyName };

    // Test 0: DNS resolution
    try {
      const hostname = new URL(config.url).hostname;
      const addresses = await dns.resolve4(hostname);
      results.dns = { hostname, resolved: true, addresses };
    } catch (e) {
      results.dns = { error: e.message, hint: 'DNS resolution failed — VPS cannot resolve TTI hostname. Check /etc/resolv.conf or try adding 8.8.8.8' };
    }

    // Test 1: Raw HTTP connectivity (bypass ttiRequest to get detailed errors)
    const baseUrl = config.url.replace(/\/+$/, '');
    const httpsUrl = baseUrl.replace('http://', 'https://');
    const urlsToTest = [baseUrl, httpsUrl];

    results.connectivityTests = [];
    for (const testBaseUrl of urlsToTest) {
      const testUrl = `${testBaseUrl}/Ping`;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const r = await fetch(testUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ RequestInfo: { AuthenticationKey: config.key } }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const text = await r.text();
        let parsed; try { parsed = JSON.parse(text); } catch { parsed = null; }
        results.connectivityTests.push({
          url: testBaseUrl, status: r.status, ok: r.ok,
          bodyPreview: text.slice(0, 500),
          parsed: parsed ? Object.keys(parsed) : null,
        });
      } catch (e) {
        results.connectivityTests.push({
          url: testBaseUrl, error: e.message,
          cause: e.cause ? String(e.cause) : undefined,
          code: e.code || undefined,
        });
      }
    }

    // Test 2: Full search via ttiRequest (uses HTTP/HTTPS fallback)
    const searchDate = new Date();
    searchDate.setDate(searchDate.getDate() + 3);
    try {
      const searchReq = {
        RequestInfo: { AuthenticationKey: config.key },
        Passengers: [{ Ref: '1', PassengerTypeCode: 'AD', PassengerQuantity: 1 }],
        OriginDestinations: [{ Ref: '1', OriginCode: 'DAC', DestinationCode: 'CGP', TargetDate: `/Date(${searchDate.getTime()})/` }],
        FareDisplaySettings: { SaleCurrencyCode: 'BDT' },
      };
      const raw = await ttiRequest('SearchFlights', searchReq);
      results.testSearch = {
        route: 'DAC → CGP',
        date: searchDate.toISOString().slice(0, 10),
        segmentCount: raw?.Segments?.length || 0,
        itineraryCount: raw?.FareInfo?.Itineraries?.length || 0,
        errors: raw?.ResponseInfo?.Errors || [],
        rawKeys: raw ? Object.keys(raw) : [],
      };
    } catch (e) {
      results.testSearch = { error: e.message };
    }

    results.success = true;
    results.nodeVersion = process.version;
    results.timestamp = new Date().toISOString();
    res.json(results);
  } catch (err) {
    console.error('TTI diagnostic error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
// GET /flights/tti-methods — discover which API methods exist on TTI
router.get('/tti-methods', async (req, res) => {
  try {
    const { getTTIConfig } = require('./tti-flights');
    const config = await getTTIConfig();
    if (!config) return res.json({ success: false, error: 'TTI not configured' });

    const baseUrl = config.url.replace(/\/+$/, '');
    const urls = baseUrl.startsWith('https://') 
      ? [baseUrl, baseUrl.replace('https://', 'http://')]
      : [baseUrl, baseUrl.replace('http://', 'https://')];

    const dummyBody = JSON.stringify({
      request: { RequestInfo: { AuthenticationKey: config.key }, BookingReference: 'TEST', AgencyInfo: { AgencyId: config.agencyId } }
    });

    const methods = [
      // Booking lifecycle
      'Cancel', 'CancelBooking', 'CancelPNR',
      'SearchFlights', 'CreateBooking', 'Confirm', 'Book',
      // Ticketing (Cancel method may handle this too via CancelTicketSettings)
      'TicketBooking', 'IssueTicket', 'Ticket', 'IssueETicket', 'ConfirmBooking', 'Ticketing',
      // Void
      'VoidTicket', 'Void', 'VoidETicket',
      // Ancillaries — seat selection, baggage, meals, SSR
      'GetSeatMap', 'GetSSR', 'GetValueCodes', 'AddServices', 'GetServices',
      'GetAncillaries', 'GetExtras', 'GetBaggage', 'AddBaggage', 'GetMeals',
      'SelectSeat', 'AssignSeat', 'SeatMap', 'PreSeatBooking',
      'GetFareRules', 'GetFareQuote', 'Reprice', 'RepriceBooking',
      // Retrieve / manage PNR
      'GetBooking', 'RetrieveBooking', 'GetPNR', 'RetrievePNR', 'ReadBooking', 'DisplayPNR',
      // Utility
      'Ping', 'Help', 'GetMethods', 'GetSchedules', 'GetAvailability',
    ];

    const results = {};
    for (const method of methods) {
      for (const tryUrl of urls) {
        const fullUrl = `${tryUrl}/${method}`;
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          const r = await fetch(fullUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: dummyBody,
            signal: controller.signal,
          });
          clearTimeout(timeout);
          const text = await r.text();
          results[method] = { status: r.status, exists: r.status !== 404, bodyPreview: text.slice(0, 300) };
          break;
        } catch (e) {
          results[method] = { error: e.message, exists: false };
          break;
        }
      }
    }

    const existingMethods = Object.entries(results)
      .filter(([, v]) => v.exists)
      .map(([k, v]) => ({ method: k, status: v.status }));

    res.json({ success: true, baseUrl, existingMethods, allResults: results, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/search', authenticateOptional, async (req, res) => {
  try {
    const {
      origin, destination, from, to,
      departDate, date, depart,
      returnDate, return: returnParam,
      cabinClass, class: classParam, cabin,
      adults, children, infants,
      sort, priceMin, priceMax,
      carrier, preferredAirline,
      page = 1, limit = 500,
      segments: segmentsRaw, // multi-city: JSON array of {from, to, date}
    } = req.query;

    const IATA_CODE_RE = /^[A-Z]{3}$/;
    const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const BD_ROUTE_AIRPORTS = new Set(['DAC', 'CXB', 'CGP', 'ZYL', 'JSR', 'RJH', 'SPD', 'BZL', 'IRD', 'TKR']);
    const normalizeCode = (v) => String(v || '').trim().toUpperCase();
    const normalizeDate = (v) => String(v || '').trim();

    // Parse + sanitize multi-city segments
    let multiCitySegments = null;
    if (segmentsRaw) {
      try {
        const parsed = JSON.parse(segmentsRaw);
        if (Array.isArray(parsed) && parsed.length >= 2) {
          const cleaned = parsed
            .map((seg) => ({
              from: normalizeCode(seg?.from),
              to: normalizeCode(seg?.to),
              date: normalizeDate(seg?.date),
            }))
            .filter((seg) => IATA_CODE_RE.test(seg.from) && IATA_CODE_RE.test(seg.to) && ISO_DATE_RE.test(seg.date));
          if (cleaned.length >= 2) multiCitySegments = cleaned;
        }
      } catch {
        multiCitySegments = null;
      }
    }
    const isMultiCity = !!multiCitySegments;

    // Normalize params (frontend sends various names)
    const originCode = normalizeCode(origin || from);
    const destCode = normalizeCode(destination || to);
    const dDate = normalizeDate(departDate || date || depart);
    const rDate = normalizeDate(returnDate || returnParam);
    const cabClass = String(cabinClass || classParam || cabin || '').trim();
    const adultCount = parseInt(adults) || 1;
    const childCount = parseInt(children) || 0;
    const infantCount = parseInt(infants) || 0;

    if (!isMultiCity) {
      const hasValidParams = IATA_CODE_RE.test(originCode) && IATA_CODE_RE.test(destCode) && ISO_DATE_RE.test(dDate);
      if (!hasValidParams) {
        console.warn(`[Search] Invalid search params ignored: origin=${originCode || '-'} destination=${destCode || '-'} depart=${dDate || '-'}`);
        return res.json({ success: true, data: [], flights: [], total: 0, page: Number(page) || 1, limit: Number(limit) || 500, message: 'Missing or invalid search parameters' });
      }
    }

    const shouldSearchTTI = !isMultiCity && BD_ROUTE_AIRPORTS.has(originCode) && BD_ROUTE_AIRPORTS.has(destCode);

    // ── Multi-provider parallel search ──
    const searchParams = {
      origin: isMultiCity ? multiCitySegments[0].from : originCode,
      destination: isMultiCity ? multiCitySegments[multiCitySegments.length - 1].to : destCode,
      departDate: isMultiCity ? multiCitySegments[0].date : dDate,
      returnDate: isMultiCity ? undefined : (ISO_DATE_RE.test(rDate) ? rDate : undefined),
      adults: adultCount,
      children: childCount,
      infants: infantCount,
      cabinClass: cabClass || undefined,
      segments: multiCitySegments || undefined, // pass segments for multi-city Sabre BFM
    };

    if (isMultiCity) {
      console.log(`[Search] Multi-city: ${multiCitySegments.map(s => `${s.from}→${s.to}`).join(', ')}`);
    }

    // Providers paused from Admin → Settings → API Control are skipped entirely
    const pausedIds = new Set(
      (await getProviderStatuses()).filter(p => p.paused).map(p => p.id)
    );
    // Per-provider deadline — one slow supplier must never hold up the whole search.
    // Anything still pending after this budget is dropped (results already returned are kept).
    const PROVIDER_BUDGET_MS = parseInt(process.env.PROVIDER_SEARCH_BUDGET_MS) || 12000;
    const withBudget = (id, promise) => {
      let timer;
      const guard = new Promise(resolve => {
        timer = setTimeout(() => {
          console.warn(`[Search] Provider '${id}' exceeded ${PROVIDER_BUDGET_MS}ms budget — dropped from this search`);
          resolve([]);
        }, PROVIDER_BUDGET_MS);
      });
      return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
    };

    const cacheKey = (id) => `${id}|${JSON.stringify(searchParams)}`;

    const runProvider = (id, fn) => {
      if (pausedIds.has(id)) {
        console.log(`[Search] Provider '${id}' is paused — skipped`);
        return Promise.resolve([]);
      }
      // Warm cache: identical searches within the TTL return instantly (no GDS round trip)
      const key = cacheKey(id);
      const cached = getCachedProviderResult(key);
      if (cached) {
        console.log(`[Search] Provider '${id}' served from cache (${cached.length} fares)`);
        return Promise.resolve(cached);
      }
      const started = Date.now();
      return withBudget(id, fn().catch(err => {
        console.error(`${id} search failed (continuing with other providers):`, err.message);
        return [];
      })).then(rows => {
        const list = Array.isArray(rows) ? rows : [];
        console.log(`[Search] Provider '${id}' took ${Date.now() - started}ms → ${list.length} fares`);
        if (list.length > 0) setCachedProviderResult(key, list);
        return list;
      });
    };



    const [dbFlights, ttiFlights, bdfFlights, flyhubFlights, sabreFlights, galileoFlights, ndcFlights, lccFlights, tlFlights] = await Promise.allSettled([
      isMultiCity ? Promise.resolve([]) : searchDB({ originCode, destCode, dDate, cabClass, page, limit }),
      shouldSearchTTI ? runProvider('tti_astra', () => ttiSearch(searchParams)) : Promise.resolve([]),
      isMultiCity ? Promise.resolve([]) : runProvider('bdfare', () => bdfSearch(searchParams)),
      isMultiCity ? Promise.resolve([]) : runProvider('flyhub', () => flyhubSearch(searchParams)),
      runProvider('sabre', () => sabreSearch(searchParams)),
      isMultiCity ? Promise.resolve([]) : runProvider('galileo', () => galileoSearch(searchParams)),
      isMultiCity ? Promise.resolve([]) : runProvider('ndc_gateway', () => ndcSearch(searchParams)),
      isMultiCity ? Promise.resolve([]) : runProvider('lcc', () => searchAllLCCs(searchParams)),
      isMultiCity ? Promise.resolve([]) : runProvider('triplover', () => triploverSearch(searchParams)),
    ]);

    // Collect results
    let flights = [];

    const providerResults = [dbFlights, ttiFlights, bdfFlights, flyhubFlights, sabreFlights, galileoFlights, ndcFlights, lccFlights, tlFlights];

    for (const result of providerResults) {
      if (result.status === 'fulfilled') {
        const val = result.value;
        flights.push(...(val?.rows || val || []));
      }
    }

    // ── Multi-city per-segment fallback ──
    // If unified BFM returned 0 multi-city results, search each segment individually
    // across all providers, then combine into multi-city itinerary cards (like BDFare)
    if (isMultiCity && flights.filter(f => f.isMultiCity || f.direction === 'multicity').length === 0 && multiCitySegments.length >= 2) {
      console.log(`[Search] Multi-city unified returned 0 — falling back to per-segment search for ${multiCitySegments.length} segments`);

      // Search each segment in parallel across all providers
      const segmentResults = await Promise.all(
        multiCitySegments.map(async (seg, idx) => {
          const segParams = {
            origin: seg.from,
            destination: seg.to,
            departDate: seg.date,
            adults: adultCount,
            children: childCount,
            infants: infantCount,
            cabinClass: cabClass || undefined,
          };
          console.log(`[Search] Segment ${idx + 1}: ${seg.from}→${seg.to} on ${seg.date}`);

          const results = await Promise.allSettled([
            ttiSearch(segParams).catch(() => []),
            bdfSearch(segParams).catch(() => []),
            flyhubSearch(segParams).catch(() => []),
            sabreSearch(segParams).catch(() => []),
            galileoSearch(segParams).catch(() => []),
            ndcSearch(segParams).catch(() => []),
            searchAllLCCs(segParams).catch(() => []),
          ]);

          let segFlights = [];
          for (const r of results) {
            if (r.status === 'fulfilled') segFlights.push(...(r.value || []));
          }
          // Filter out return-direction flights; only keep outbound/one-way
          segFlights = segFlights.filter(f => f.direction !== 'return');
          // Sort by price
          segFlights.sort((a, b) => (a.price || 0) - (b.price || 0));
          console.log(`[Search] Segment ${idx + 1} (${seg.from}→${seg.to}): ${segFlights.length} flights found`);
          return segFlights;
        })
      );

      // Check all segments have at least 1 result
      const allSegmentsHaveFlights = segmentResults.every(sr => sr.length > 0);

      if (allSegmentsHaveFlights) {
        // Build combined multi-city cards by grouping top flights from each segment
        // Take top N from each segment and create combinations
        const MAX_PER_SEGMENT = 30;
        const trimmed = segmentResults.map(sr => sr.slice(0, MAX_PER_SEGMENT));

        // Group by airline across segments for same-airline combos first, then mixed
        const airlineGroups = {};
        for (let si = 0; si < trimmed.length; si++) {
          for (const f of trimmed[si]) {
            const code = f.airlineCode || 'XX';
            if (!airlineGroups[code]) airlineGroups[code] = Array.from({ length: trimmed.length }, () => []);
            airlineGroups[code][si].push(f);
          }
        }

        const combinedFlights = [];
        const usedKeys = new Set();

        // 1) Same-airline combinations
        for (const [code, segArrays] of Object.entries(airlineGroups)) {
          const allHave = segArrays.every(arr => arr.length > 0);
          if (!allHave) continue;

          // Take cheapest from each segment for this airline
          for (let ci = 0; ci < Math.min(segArrays[0].length, 5); ci++) {
            const combo = segArrays.map((arr, si) => arr[Math.min(ci, arr.length - 1)]);
            const comboKey = combo.map(f => `${f.flightNumber}-${f.departureTime}`).join('|');
            if (usedKeys.has(comboKey)) continue;
            usedKeys.add(comboKey);

            const segments = combo.map((f, si) => ({
              segmentIndex: si,
              origin: f.origin,
              destination: f.destination,
              departureTime: f.departureTime,
              arrivalTime: f.arrivalTime,
              duration: f.duration,
              durationMinutes: f.durationMinutes || 0,
              stops: f.stops || 0,
              stopCodes: f.stopCodes || [],
              airline: f.airline,
              airlineCode: f.airlineCode,
              flightNumber: f.flightNumber,
              legs: f.legs || [f],
              baggage: f.baggage,
              handBaggage: f.handBaggage,
              aircraft: f.legs?.[0]?.aircraft || '',
              price: f.price || 0,
              baseFare: f.baseFare || 0,
              taxes: f.taxes || 0,
              source: f.source,
              refundable: f.refundable || false,
              _originalFlight: f, // keep reference for booking
            }));

            const totalPrice = segments.reduce((s, seg) => s + (seg.price || 0), 0);
            const totalBaseFare = segments.reduce((s, seg) => s + (seg.baseFare || 0), 0);
            const totalTaxes = segments.reduce((s, seg) => s + (seg.taxes || 0), 0);
            const totalDuration = segments.reduce((s, seg) => s + (seg.durationMinutes || 0), 0);

            combinedFlights.push({
              id: `mc-combo-${combinedFlights.length}`,
              source: segments[0].source || 'sabre',
              direction: 'multicity',
              isMultiCity: true,
              isCombined: true, // flag: built from per-segment searches
              segmentCount: segments.length,
              segments,
              airline: segments[0].airline,
              airlineCode: segments[0].airlineCode,
              airlineLogo: null,
              flightNumber: segments.map(s => s.flightNumber).join(', '),
              origin: segments[0].origin,
              destination: segments[segments.length - 1].destination,
              departureTime: segments[0].departureTime,
              arrivalTime: segments[segments.length - 1].arrivalTime,
              duration: formatDuration(totalDuration),
              durationMinutes: totalDuration,
              stops: segments.reduce((s, seg) => s + seg.stops, 0),
              stopCodes: segments.flatMap(s => s.stopCodes),
              cabinClass: cabClass || 'Economy',
              price: totalPrice,
              baseFare: totalBaseFare,
              taxes: totalTaxes,
              currency: 'BDT',
              refundable: segments.every(s => s.refundable),
              baggage: segments[0].baggage,
              handBaggage: segments[0].handBaggage,
              legs: segments.flatMap(s => s.legs || []),
            });
          }
        }

        // 2) Mixed-airline: cheapest per segment regardless of airline
        for (let ci = 0; ci < Math.min(trimmed[0].length, 15); ci++) {
          const combo = trimmed.map((segArr, si) => segArr[Math.min(ci, segArr.length - 1)]);
          const comboKey = combo.map(f => `${f.flightNumber}-${f.departureTime}`).join('|');
          if (usedKeys.has(comboKey)) continue;
          usedKeys.add(comboKey);

          const segments = combo.map((f, si) => ({
            segmentIndex: si,
            origin: f.origin,
            destination: f.destination,
            departureTime: f.departureTime,
            arrivalTime: f.arrivalTime,
            duration: f.duration,
            durationMinutes: f.durationMinutes || 0,
            stops: f.stops || 0,
            stopCodes: f.stopCodes || [],
            airline: f.airline,
            airlineCode: f.airlineCode,
            flightNumber: f.flightNumber,
            legs: f.legs || [f],
            baggage: f.baggage,
            handBaggage: f.handBaggage,
            aircraft: f.legs?.[0]?.aircraft || '',
            price: f.price || 0,
            baseFare: f.baseFare || 0,
            taxes: f.taxes || 0,
            source: f.source,
            refundable: f.refundable || false,
            _originalFlight: f,
          }));

          const totalPrice = segments.reduce((s, seg) => s + (seg.price || 0), 0);
          const totalBaseFare = segments.reduce((s, seg) => s + (seg.baseFare || 0), 0);
          const totalTaxes = segments.reduce((s, seg) => s + (seg.taxes || 0), 0);
          const totalDuration = segments.reduce((s, seg) => s + (seg.durationMinutes || 0), 0);

          combinedFlights.push({
            id: `mc-mix-${combinedFlights.length}`,
            source: 'combined',
            direction: 'multicity',
            isMultiCity: true,
            isCombined: true,
            segmentCount: segments.length,
            segments,
            airline: segments.map(s => s.airline).filter((v, i, a) => a.indexOf(v) === i).join(' + '),
            airlineCode: segments[0].airlineCode,
            airlineLogo: null,
            flightNumber: segments.map(s => s.flightNumber).join(', '),
            origin: segments[0].origin,
            destination: segments[segments.length - 1].destination,
            departureTime: segments[0].departureTime,
            arrivalTime: segments[segments.length - 1].arrivalTime,
            duration: formatDuration(totalDuration),
            durationMinutes: totalDuration,
            stops: segments.reduce((s, seg) => s + seg.stops, 0),
            stopCodes: segments.flatMap(s => s.stopCodes),
            cabinClass: cabClass || 'Economy',
            price: totalPrice,
            baseFare: totalBaseFare,
            taxes: totalTaxes,
            currency: 'BDT',
            refundable: segments.every(s => s.refundable),
            baggage: segments[0].baggage,
            handBaggage: segments[0].handBaggage,
            legs: segments.flatMap(s => s.legs || []),
          });
        }

        // Sort combined by price and add to flights
        combinedFlights.sort((a, b) => a.price - b.price);
        flights.push(...combinedFlights);
        console.log(`[Search] Multi-city fallback: built ${combinedFlights.length} combined itineraries`);
      } else {
        console.log(`[Search] Multi-city fallback: some segments have no flights — ${segmentResults.map((sr, i) => `Seg${i + 1}:${sr.length}`).join(', ')}`);
      }
    }

    // Deduplicate by itinerary key, but PRESERVE fare variants and prefer richer data (Sabre booking class/seats)
    const itineraryMap = new Map();

    const toMoney = (value) => {
      if (value === null || value === undefined || value === '') return NaN;
      if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
      if (typeof value === 'string') {
        const cleaned = value.replace(/,/g, '').replace(/\s+/g, '').replace(/[^\d.-]/g, '');
        if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return NaN;
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : NaN;
      }
      if (typeof value === 'object') {
        const candidates = [
          value.amount,
          value.value,
          value.total,
          value.totalAmount,
          value.totalPrice,
          value.equivalentAmount,
          value.equivalentPrice,
          value.baseFare,
          value.baseFareAmount,
          value.tax,
          value.taxAmount,
          value.totalTaxAmount,
        ];
        for (const c of candidates) {
          const n = toMoney(c);
          if (Number.isFinite(n)) return n;
        }
      }
      return NaN;
    };

    const pickPositiveMoney = (...values) => {
      for (const v of values) {
        const n = toMoney(v);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return 0;
    };

    const computeFareSnapshot = (flight, detail = null) => {
      const d = detail || {};

      let price = pickPositiveMoney(
        d.price,
        d.totalPrice,
        d.grossPrice,
        d.amount,
        d.total,
        d.publishedFare,
        flight.price,
        flight.totalPrice,
        flight.totalRoundTripPrice,
        flight.grossPrice,
        flight.amount,
        flight.total,
        flight.publishedFare,
        flight.fareTotal,
      );

      let taxes = pickPositiveMoney(
        d.taxes,
        d.tax,
        d.taxAmount,
        d.totalTaxAmount,
        flight.taxes,
        flight.tax,
        flight.taxAmount,
        flight.totalTaxAmount,
      );

      let baseFare = pickPositiveMoney(
        d.baseFare,
        d.baseAmount,
        d.equivalentBaseFareAmount,
        flight.baseFare,
        flight.baseAmount,
      );

      if ((price <= 0 || taxes <= 0) && Array.isArray(flight.paxPricing) && flight.paxPricing.length > 0) {
        const paxTotal = flight.paxPricing.reduce((sum, p) => {
          const count = Math.max(1, Math.round(toMoney(p?.count) || 1));
          const pt = pickPositiveMoney(p?.total, p?.price, p?.grossPrice, p?.amount, p?.totalPrice);
          return sum + (pt * count);
        }, 0);
        const paxTax = flight.paxPricing.reduce((sum, p) => {
          const count = Math.max(1, Math.round(toMoney(p?.count) || 1));
          const tx = pickPositiveMoney(p?.taxes, p?.tax, p?.taxAmount, p?.totalTaxAmount);
          return sum + (tx * count);
        }, 0);
        if (price <= 0 && paxTotal > 0) price = paxTotal;
        if (taxes <= 0 && paxTax > 0) taxes = paxTax;
      }

      if (price <= 0 && Array.isArray(flight.segments) && flight.segments.length > 0) {
        const segTotal = flight.segments.reduce((sum, seg) => sum + pickPositiveMoney(seg?.price, seg?.totalPrice, seg?.grossPrice, seg?.amount, seg?.total), 0);
        const segTax = flight.segments.reduce((sum, seg) => sum + pickPositiveMoney(seg?.taxes, seg?.tax, seg?.taxAmount, seg?.totalTaxAmount), 0);
        if (segTotal > 0) {
          price = segTotal;
          if (taxes <= 0 && segTax > 0) taxes = segTax;
        }
      }

      if (price <= 0 && Array.isArray(flight.fareDetails) && flight.fareDetails.length > 0) {
        const fdPrices = flight.fareDetails
          .map((fd) => pickPositiveMoney(fd?.price, fd?.totalPrice, fd?.grossPrice, fd?.amount, fd?.total, fd?.publishedFare))
          .filter((n) => n > 0)
          .sort((a, b) => a - b);
        if (fdPrices.length > 0) price = fdPrices[0];
      }

      if (baseFare <= 0 && price > 0 && taxes > 0 && price >= taxes) baseFare = price - taxes;
      if (taxes <= 0 && price > 0 && baseFare > 0 && price >= baseFare) taxes = price - baseFare;
      if (price <= 0 && baseFare > 0) price = baseFare + Math.max(0, taxes);
      if (taxes > price && price > 0) taxes = Math.max(0, price);

      return { price, baseFare, taxes };
    };

    const toFareOption = (flight, detail = null) => {
      const d = detail || {};
      const fare = computeFareSnapshot(flight, d);
      return {
        fareBasis: d.fareBasis || flight.fareBasis || '',
        bookingClass: d.bookingClass || flight.bookingClass || '',
        cabinClass: d.cabinClass || flight.cabinClass || '',
        availableSeats: d.availableSeats ?? flight.availableSeats ?? null,
        price: fare.price,
        baseFare: fare.baseFare,
        taxes: fare.taxes,
        currency: d.currency || flight.currency || 'BDT',
        baggage: d.baggage ?? flight.baggage ?? null,
        handBaggage: d.handBaggage ?? flight.handBaggage ?? null,
        refundable: d.refundable ?? flight.refundable ?? false,
        brandName: d.brandName || '',
        brandCode: d.brandCode || '',
        mealIncluded: d.mealIncluded ?? false,
        seatSelection: d.seatSelection ?? false,
        rebookingAllowed: d.rebookingAllowed ?? true,
        cancellationAllowed: d.cancellationAllowed ?? (d.refundable ?? flight.refundable ?? false),
      };
    };

    const addFareOptions = (target, flight) => {
      const sourceOptions = Array.isArray(flight.fareDetails) && flight.fareDetails.length > 0
        ? flight.fareDetails
        : [null];

      if (!Array.isArray(target.fareDetails)) target.fareDetails = [];
      const existingSigs = new Set(target.fareDetails.map((d) => `${d.price}|${d.bookingClass}|${d.fareBasis}|${d.brandCode}`));

      for (const opt of sourceOptions) {
        const normalized = toFareOption(flight, opt);
        const sig = `${normalized.price}|${normalized.bookingClass}|${normalized.fareBasis}|${normalized.brandCode}`;
        if (!existingSigs.has(sig)) {
          target.fareDetails.push(normalized);
          existingSigs.add(sig);
        }
      }

      target.fareDetails.sort((a, b) => (a.price || 0) - (b.price || 0));
    };

    const qualityScore = (f) => {
      const src = String(f.source || '').toLowerCase();
      let score = 0;
      if (src.includes('sabre')) score += 5;
      if (f.bookingClass || (f.fareDetails || []).some((d) => d?.bookingClass)) score += 3;
      if (f.availableSeats !== null && f.availableSeats !== undefined) score += 2;
      if ((f.fareDetails || []).some((d) => d?.availableSeats !== null && d?.availableSeats !== undefined)) score += 2;
      score += Math.min((f.fareDetails || []).length || 0, 3);
      return score;
    };

    for (const f of flights) {
      const normalizedTopFare = computeFareSnapshot(f);
      if (normalizedTopFare.price > 0) {
        f.price = normalizedTopFare.price;
        if ((toMoney(f.baseFare) || 0) <= 0) f.baseFare = normalizedTopFare.baseFare;
        if ((toMoney(f.taxes) || 0) <= 0) f.taxes = normalizedTopFare.taxes;
      }

      const legsKey = (f.legs || []).map(l => `${l.flightNumber || ''}@${l.departureTime || ''}`).join('|');
      const stopKey = (f.stopCodes || []).join(',');
      const baseKey = `${f.source || ''}-${f.airlineCode || ''}-${f._itineraryId || ''}-${f.flightNumber || ''}-${f.origin || ''}-${f.destination || ''}-${f.departureTime || ''}-${f.arrivalTime || ''}-${f.stops ?? 0}-${stopKey}-${f.direction || ''}-${legsKey}`;
      const hasCoreSchedule = Boolean(f.flightNumber || legsKey) && Boolean(f.departureTime || f.arrivalTime);
      const key = hasCoreSchedule
        ? baseKey
        : `unkeyed-${f.id || `${f.source || 'src'}-${Math.random().toString(36).slice(2, 10)}`}`;

      if (!itineraryMap.has(key)) {
        const clone = { ...f, fareDetails: [] };
        addFareOptions(clone, f);
        const best = clone.fareDetails[0];
        if (best) {
          clone.bookingClass = best.bookingClass || clone.bookingClass || '';
          clone.availableSeats = best.availableSeats ?? clone.availableSeats ?? null;
          clone.cabinClass = clone.cabinClass || best.cabinClass || '';
          clone.price = best.price ?? clone.price;
          clone.baseFare = best.baseFare ?? clone.baseFare;
          clone.taxes = best.taxes ?? clone.taxes;
          clone.currency = best.currency || clone.currency;
        }
        itineraryMap.set(key, clone);
        continue;
      }

      const existing = itineraryMap.get(key);
      addFareOptions(existing, f);

      const existingBestPrice = existing.fareDetails?.[0]?.price ?? existing.price ?? Infinity;
      const incomingBestPrice = (() => {
        if (Array.isArray(f.fareDetails) && f.fareDetails.length > 0) {
          return Math.min(...f.fareDetails.map((d) => {
            const p = toMoney(d?.price);
            return Number.isFinite(p) && p > 0 ? p : Infinity;
          }));
        }
        const p = toMoney(f.price);
        return Number.isFinite(p) && p > 0 ? p : Infinity;
      })();

      const shouldPreferIncoming = qualityScore(f) > qualityScore(existing)
        || (qualityScore(f) === qualityScore(existing) && incomingBestPrice < existingBestPrice);

      if (shouldPreferIncoming) {
        const mergedFareDetails = existing.fareDetails;
        Object.assign(existing, f);
        existing.fareDetails = mergedFareDetails;
      }

      const best = existing.fareDetails?.[0];
      if (best) {
        existing.bookingClass = best.bookingClass || existing.bookingClass || '';
        existing.availableSeats = best.availableSeats ?? existing.availableSeats ?? null;
        existing.cabinClass = existing.cabinClass || best.cabinClass || '';
        existing.price = best.price ?? existing.price;
        existing.baseFare = best.baseFare ?? existing.baseFare;
        existing.taxes = best.taxes ?? existing.taxes;
        existing.currency = best.currency || existing.currency;
        if (best.baggage !== null && best.baggage !== undefined) existing.baggage = best.baggage;
        if (best.handBaggage !== null && best.handBaggage !== undefined) existing.handBaggage = best.handBaggage;
        existing.refundable = best.refundable ?? existing.refundable;
      }
    }

    flights = Array.from(itineraryMap.values());

    // ── Hard-stop guard: never return zero/invalid prices ──
    const minByAirline = new Map();
    let globalMinPrice = Number.POSITIVE_INFINITY;

    for (const f of flights) {
      const normalized = computeFareSnapshot(f);
      if (normalized.price > 0) {
        f.price = normalized.price;
        if ((toMoney(f.baseFare) || 0) <= 0) f.baseFare = normalized.baseFare;
        if ((toMoney(f.taxes) || 0) <= 0) f.taxes = normalized.taxes;
        const code = String(f.airlineCode || '').toUpperCase();
        if (code) {
          const prev = minByAirline.get(code);
          if (!prev || normalized.price < prev) minByAirline.set(code, normalized.price);
        }
        if (normalized.price < globalMinPrice) globalMinPrice = normalized.price;
      }
    }

    let recoveredZeroCount = 0;
    const globalFallback = Number.isFinite(globalMinPrice) && globalMinPrice > 0 ? globalMinPrice : 1;

    for (const f of flights) {
      const p = toMoney(f.price);
      if (Number.isFinite(p) && p > 0) continue;

      const code = String(f.airlineCode || '').toUpperCase();
      const airlineFallback = code ? minByAirline.get(code) : null;
      const fallbackPrice = airlineFallback || globalFallback;

      f.price = fallbackPrice;
      const tax = Math.max(0, toMoney(f.taxes) || 0);
      f.taxes = Math.min(tax, fallbackPrice);
      f.baseFare = Math.max(0, fallbackPrice - f.taxes);
      recoveredZeroCount += 1;
    }

    if (recoveredZeroCount > 0) {
      console.warn(`[Search] Recovered ${recoveredZeroCount} zero-price flights using airline/global fallback`);
    }

    // ── Apply scope-aware (Domestic / International / SOTO) + per-user fare rules ──
    try {
      const [settingsRows] = await db.query(
        "SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('markup_config', 'airline_markup_config')"
      );

      // Determine commission scope from the searched route
      const routeOrigin = isMultiCity ? multiCitySegments[0].from : originCode;
      const routeDest = isMultiCity ? multiCitySegments[multiCitySegments.length - 1].to : destCode;
      const originBD = BD_ROUTE_AIRPORTS.has(routeOrigin);
      const destBD = BD_ROUTE_AIRPORTS.has(routeDest);
      const scopeKey = originBD && destBD ? 'FLIGHT_DOM' : (originBD || destBD ? 'FLIGHT_INT' : 'FLIGHT_SOTO');

      let globalDiscount = 6.30;
      let globalAitVat = 0.3;
      let scopeMarkupPct = 0;
      let scopeFixedMarkup = 0;
      let airlineOverrides = {};

      for (const row of settingsRows) {
        const parsed = typeof row.setting_value === 'string' ? JSON.parse(row.setting_value) : (row.setting_value || {});
        if (!parsed || typeof parsed !== 'object') continue;

        if (row.setting_key === 'markup_config') {
          // Prefer the scope-specific config, fall back to the legacy FLIGHT key
          const cfg = parsed[scopeKey] || parsed.FLIGHT || null;
          if (cfg) {
            if (cfg.fareSummaryDiscount !== undefined) globalDiscount = parseFloat(cfg.fareSummaryDiscount) || 0;
            if (cfg.fareSummaryAitVat !== undefined) globalAitVat = parseFloat(cfg.fareSummaryAitVat) || 0;
            if (cfg.markupType === 'fixed') scopeFixedMarkup = parseFloat(cfg.markupValue) || 0;
            else scopeMarkupPct = parseFloat(cfg.markupValue ?? cfg.markup) || 0;
          }
        } else if (row.setting_key === 'airline_markup_config') {
          airlineOverrides = parsed;
        }
      }

      // Per-user commission override (customer / agent) — wins over global + airline
      let userOverride = null;
      if (req.user?.sub) {
        try {
          const [uRows] = await db.query(
            'SELECT discount_pct, ait_pct, markup_pct FROM user_commission_overrides WHERE user_id = ?',
            [req.user.sub]
          );
          if (uRows.length) userOverride = uRows[0];
        } catch (_) { /* table may not exist yet */ }
      }

      flights = flights.map(f => {
        const code = f.airlineCode || '';
        const override = airlineOverrides[code];
        let discount = globalDiscount;
        let aitVat = globalAitVat;
        let markup = scopeMarkupPct;
        let fixedMarkup = scopeFixedMarkup;

        if (override && !override.useGlobal) {
          discount = parseFloat(override.discount) || 0;
          markup = parseFloat(override.markup) || 0;
          fixedMarkup = parseFloat(override.fixedMarkup) || 0;
        }

        if (userOverride) {
          if (userOverride.discount_pct != null) discount = Number(userOverride.discount_pct);
          if (userOverride.ait_pct != null) aitVat = Number(userOverride.ait_pct);
          if (userOverride.markup_pct != null) markup = Number(userOverride.markup_pct);
        }

        // Attach fare rule params for frontend fare summary display
        f.fareRules = {
          discount, aitVat, markup, fixedMarkup,
          scope: scopeKey,
          isGlobal: !override || override.useGlobal,
          userOverride: !!userOverride,
        };
        return f;
      });
    } catch (fareRuleErr) {

      console.error('Fare rule loading failed (using defaults):', fareRuleErr.message);
      // Attach default rules so frontend always has them
      flights = flights.map(f => {
        f.fareRules = { discount: 6.30, aitVat: 0.3, markup: 0, fixedMarkup: 0, isGlobal: true };
        return f;
      });
    }

    // Apply client-side filters
    const preferredCode = carrier || preferredAirline || '';
    if (preferredCode) {
      flights = flights.filter(f => f.airlineCode === preferredCode || f.airline?.toLowerCase().includes(preferredCode.toLowerCase()));
      console.log(`[Search] Preferred airline filter: ${preferredCode} → ${flights.length} results`);
    }
    if (priceMin) flights = flights.filter(f => (toMoney(f.price) || 0) >= parseFloat(priceMin));
    if (priceMax) flights = flights.filter(f => (toMoney(f.price) || 0) <= parseFloat(priceMax));

    // Sort
    switch (sort) {
      case 'cheapest':
      case 'price':
        flights.sort((a, b) => (toMoney(a.price) || 0) - (toMoney(b.price) || 0));
        break;
      case 'earliest':
        flights.sort((a, b) => new Date(a.departureTime || 0) - new Date(b.departureTime || 0));
        break;
      case 'fastest':
        flights.sort((a, b) => (a.durationMinutes || 999) - (b.durationMinutes || 999));
        break;
      case 'best':
      default:
        flights.sort((a, b) => {
          const scoreA = (toMoney(a.price) || 0) + (a.durationMinutes || 0) * 50;
          const scoreB = (toMoney(b.price) || 0) + (b.durationMinutes || 0) * 50;
          return scoreA - scoreB;
        });
        break;
    }

    // Extract unique airlines
    const airlines = [...new Set(flights.map(f => f.airline).filter(Boolean))];
    const cheapest = flights.length > 0 ? Math.min(...flights.map(f => {
      const p = toMoney(f.price);
      return Number.isFinite(p) && p > 0 ? p : Infinity;
    })) : 0;

    const responseData = {
      data: flights,
      airlines,
      cheapest,
      total: flights.length,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(flights.length / parseInt(limit)),
      sources: {
        db: dbFlights.status === 'fulfilled' ? (dbFlights.value?.rows || []).length : 0,
        tti: ttiFlights.status === 'fulfilled' ? (ttiFlights.value || []).length : 0,
        bdfare: bdfFlights.status === 'fulfilled' ? (bdfFlights.value || []).length : 0,
        flyhub: flyhubFlights.status === 'fulfilled' ? (flyhubFlights.value || []).length : 0,
        sabre: sabreFlights.status === 'fulfilled' ? (sabreFlights.value || []).length : 0,
        galileo: galileoFlights.status === 'fulfilled' ? (galileoFlights.value || []).length : 0,
        ndc: ndcFlights.status === 'fulfilled' ? (ndcFlights.value || []).length : 0,
        lcc: lccFlights.status === 'fulfilled' ? (lccFlights.value || []).length : 0,
      },
    };


    res.json(responseData);
  } catch (err) {
    console.error('Flight search error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});

// Helper: search local DB flights
async function searchDB({ originCode, destCode, dDate, cabClass, page, limit }) {
  let sql = 'SELECT * FROM flights WHERE 1=1';
  const params = [];

  if (originCode) { sql += ' AND origin = ?'; params.push(originCode); }
  if (destCode) { sql += ' AND destination = ?'; params.push(destCode); }
  if (dDate) { sql += ' AND DATE(departure_time) = ?'; params.push(dDate); }
  if (cabClass) { sql += ' AND cabin_class = ?'; params.push(cabClass); }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  sql += ` ORDER BY price ASC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), offset);

  const [rows] = await db.query(sql, params);
  const data = rows.map(r => ({
    id: r.id,
    source: 'db',
    airline: r.airline,
    airlineCode: r.airline_code,
    airlineLogo: r.airline_logo,
    flightNumber: r.flight_number,
    origin: r.origin,
    originCity: r.origin_city,
    destination: r.destination,
    destinationCity: r.destination_city,
    departureTime: r.departure_time,
    arrivalTime: r.arrival_time,
    duration: r.duration,
    durationMinutes: parseDurationToMinutes(r.duration),
    stops: r.stops,
    stopCodes: [],
    cabinClass: r.cabin_class,
    price: parseFloat(r.price),
    baseFare: parseFloat(r.base_fare || r.price),
    taxes: parseFloat(r.taxes || 0),
    currency: r.currency || 'BDT',
    availableSeats: r.seats_available ?? null,
    baggage: r.baggage || null,
    handBaggage: null,
    refundable: !!r.refundable,
    aircraft: '',
    legs: [{
      origin: r.origin,
      destination: r.destination,
      departureTime: r.departure_time,
      arrivalTime: r.arrival_time,
      duration: r.duration,
      durationMinutes: parseDurationToMinutes(r.duration),
      flightNumber: r.flight_number,
      airlineCode: r.airline_code,
      aircraft: '',
      stops: [],
    }],
  }));

  return { rows: data };
}

function parseDurationToMinutes(dur) {
  if (!dur) return 0;
  const match = dur.match(/(\d+)h\s*(\d+)?m?/i);
  if (match) return parseInt(match[1]) * 60 + (parseInt(match[2]) || 0);
  const minMatch = dur.match(/(\d+)\s*m/i);
  if (minMatch) return parseInt(minMatch[1]);
  return 0;
}

function formatDuration(mins) {
  if (!mins || mins <= 0) return '0h 0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

// GET /flights/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM flights WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Flight not found', status: 404 });
    const r = rows[0];
    res.json({
      id: r.id, airline: r.airline, airlineCode: r.airline_code, airlineLogo: r.airline_logo,
      flightNumber: r.flight_number, origin: r.origin, originCity: r.origin_city,
      destination: r.destination, destinationCity: r.destination_city,
      departureTime: r.departure_time, arrivalTime: r.arrival_time,
      duration: r.duration, stops: r.stops, cabinClass: r.cabin_class,
      price: parseFloat(r.price), currency: r.currency, seatsAvailable: r.seats_available,
      baggage: r.baggage, refundable: !!r.refundable, meta: r.meta ? JSON.parse(r.meta) : null,
    });
  } catch (err) {
    console.error('Flight detail error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});

// Bangladesh domestic airports
const BD_AIRPORTS = ['DAC', 'CXB', 'CGP', 'ZYL', 'JSR', 'RJH', 'SPD', 'BZL', 'IRD', 'TKR'];

function flattenLegs(items = []) {
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    if (Array.isArray(item?.legs) && item.legs.length > 0) return flattenLegs(item.legs);
    return item ? [item] : [];
  });
}

function mergeBookingFlightData({ flightData, returnFlightData, multiCityFlights = [], isRoundTrip = false }) {
  const merged = { ...(flightData || {}) };

  if (isRoundTrip && returnFlightData) {
    const outLegs = flattenLegs(flightData?.legs?.length ? flightData.legs : [flightData]);
    const retLegs = flattenLegs(returnFlightData?.legs?.length ? returnFlightData.legs : [returnFlightData]);
    merged.legs = [...outLegs, ...retLegs];
  } else if (Array.isArray(multiCityFlights) && multiCityFlights.length >= 2) {
    merged.legs = flattenLegs(multiCityFlights);
  } else {
    merged.legs = flattenLegs(flightData?.legs?.length ? flightData.legs : [flightData]);
  }

  // CRITICAL: Only propagate parentClass to legs that truly have NO bookingClass.
  // For round-trips, each leg already carries its own per-direction RBD from search.
  const parentClass = merged.bookingClass || merged.fareDetails?.[0]?.bookingClass || '';
  if (Array.isArray(merged.legs)) {
    let propagatedCount = 0;
    merged.legs = merged.legs.map(leg => {
      if (leg.bookingClass) return leg; // Already has per-direction RBD — preserve it
      propagatedCount++;
      return { ...leg, bookingClass: parentClass || 'Y' };
    });
    if (propagatedCount > 0) {
      console.log(`[Booking] Propagated bookingClass "${parentClass}" to ${propagatedCount}/${merged.legs.length} leg(s) that lacked one`);
    } else {
      console.log(`[Booking] All ${merged.legs.length} leg(s) already have per-direction bookingClass — no override needed`);
    }
  }

  return merged;
}

function toDateOnly(dateTime) {
  if (!dateTime) return null;
  const raw = String(dateTime);
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function getPassengerCounts(passengers = []) {
  return passengers.reduce((acc, p) => {
    const type = String(p?.type || 'adult').toLowerCase();
    if (type === 'child') acc.children += 1;
    else if (type === 'infant') acc.infants += 1;
    else acc.adults += 1;
    return acc;
  }, { adults: 0, children: 0, infants: 0 });
}

function extractDistinctSabreAirlinePnr(rawBooking, gdsPnr) {
  const gds = String(gdsPnr || '').trim().toUpperCase();
  const candidates = [];
  const stack = [rawBooking];
  const seen = new Set();

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((item) => stack.push(item));
      continue;
    }

    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object') {
        stack.push(value);
        continue;
      }
      if (typeof value !== 'string') continue;
      
      // Standard named fields
      if (/(vendorlocator|airlinelocator|airlinepnr|confirmationid|confirmationnumber|reservationnumber|locator|recordlocator|supplierref|airlineconfirmation|operatingairlineconfirmation)/i.test(key)) {
        const code = value.trim().toUpperCase();
        if (/^[A-Z0-9]{5,20}$/.test(code)) candidates.push(code);
      }
      
      // Extract from /DCBS*09HUEY or /DCAI*FCQGEC patterns in segment data
      if (typeof value === 'string') {
        const dcMatch = value.match(/\/DC[A-Z]{2}\*([A-Z0-9]{4,8})/i);
        if (dcMatch) {
          candidates.push(dcMatch[1].toUpperCase());
        }
      }
    }
  }

  const distinct = candidates.find((code) => code !== gds);
  return distinct || null;
}

function normalizeLocatorCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{5,20}$/.test(code) ? code : null;
}

function resolveCancelLocators(booking = {}, details = {}) {
  const gdsCandidates = [
    details?.gdsPnr,
    booking?.pnr,
    details?.gdsBookingResult?.pnr,
    details?.outbound?.pnr,
  ].map(normalizeLocatorCode).filter(Boolean);

  const airlineCandidates = [
    details?.airlinePnr,
    details?.gdsBookingResult?.airlinePnr,
    details?.outbound?.airlinePnr,
  ].map(normalizeLocatorCode).filter(Boolean);

  const gdsPnr = gdsCandidates.find((c) => !airlineCandidates.includes(c)) || gdsCandidates[0] || null;
  const airlinePnr = airlineCandidates[0] || null;

  return { gdsPnr, airlinePnr };
}

async function hydrateTtiContextForBooking({ mergedFlightData, returnFlightData, isRoundTrip, passengers }) {
  if (mergedFlightData?._ttiOffer?.Ref && mergedFlightData?._ttiItineraryRef) {
    return mergedFlightData;
  }

  const legs = flattenLegs(mergedFlightData?.legs?.length ? mergedFlightData.legs : [mergedFlightData]);
  const firstLeg = legs[0];
  if (!firstLeg?.origin || !firstLeg?.destination || !firstLeg?.departureTime) {
    return mergedFlightData;
  }

  const counts = getPassengerCounts(passengers);
  const returnDate = isRoundTrip
    ? (toDateOnly(returnFlightData?.departureTime)
      || toDateOnly(legs.find((l) => l?.origin === firstLeg.destination && l?.destination === firstLeg.origin)?.departureTime))
    : undefined;

  const searchParams = {
    origin: firstLeg.origin,
    destination: firstLeg.destination,
    departDate: toDateOnly(firstLeg.departureTime),
    returnDate,
    adults: Math.max(counts.adults, 1),
    children: counts.children,
    infants: counts.infants,
    cabinClass: mergedFlightData?.cabinClass || 'Economy',
  };

  try {
    const results = await ttiSearch(searchParams);
    if (!Array.isArray(results) || results.length === 0) {
      return mergedFlightData;
    }

    const wantedFlightNo = String(firstLeg.flightNumber || '').replace(/\D/g, '');
    const wantedAirline = String(firstLeg.airlineCode || '').toUpperCase();

    const best = results.find((r) => {
      if (!r?._ttiOffer?.Ref || !r?._ttiItineraryRef) return false;
      if (wantedAirline && String(r.airlineCode || '').toUpperCase() !== wantedAirline) return false;
      if (!wantedFlightNo) return true;
      return String(r.flightNumber || '').replace(/\D/g, '') === wantedFlightNo;
    }) || results.find((r) => r?._ttiOffer?.Ref && r?._ttiItineraryRef);

    if (!best) return mergedFlightData;

    console.log('[Booking][TTI] Hydrated search context:', JSON.stringify({
      itineraryRef: best._ttiItineraryRef,
      offerRef: best._ttiOffer?.Ref || null,
      airline: best.airlineCode,
      flightNumber: best.flightNumber,
    }));

    return {
      ...mergedFlightData,
      _ttiItineraryRef: best._ttiItineraryRef,
      _ttiRawItinerary: best._ttiRawItinerary,
      _ttiRawFares: best._ttiRawFares,
      _ttiRawSegments: best._ttiRawSegments,
      _ttiFullFareInfo: best._ttiFullFareInfo,
      _ttiAllSegments: best._ttiAllSegments,
      _ttiOffer: best._ttiOffer,
      _ttiPassengers: best._ttiPassengers,
    };
  } catch (err) {
    console.warn('[Booking][TTI] Context hydration failed:', err.message);
    return mergedFlightData;
  }
}

/**
 * Determine payment deadline.
 * API-ONLY: Uses airline-provided timeLimit / LastTicketingDate from GDS.
 * No hardcoded fallbacks — if GDS provides no deadline, returns null.
 */
function resolvePaymentDeadline(airlineTimeLimit) {
  if (airlineTimeLimit) {
    const tl = new Date(airlineTimeLimit);
    if (!isNaN(tl.getTime()) && tl > new Date()) {
      return tl;
    }
  }
  return null; // No deadline from API — booking stays open until airline auto-cancels
}

// POST /flights/book
router.post('/book', authenticate, async (req, res) => {
  try {
    const {
      flightData,
      returnFlightData,
      passengers: rawPassengers,
      isRoundTrip,
      isDomestic,
      payLater,
      paymentMethod,
      totalAmount,
      baseFare,
      taxes,
      serviceCharge,
      discount,
      aitVat,
      fareRules,
      addOns,
      contactInfo,
      travelDocuments,
      specialServices,
    } = req.body;

    const passengers = (Array.isArray(rawPassengers) ? rawPassengers : []).map((p) => {
      const titleRaw = String(p?.title || p?.civility || '').trim();
      const title = titleRaw || 'Mr';
      const firstName = String(p?.firstName || p?.firstname || p?.givenName || '').trim();
      const lastName = String(p?.lastName || p?.lastname || p?.surname || '').trim();
      const dateOfBirth = p?.dateOfBirth || p?.dob || p?.birthDate || null;
      const passportNumber = p?.passportNumber || p?.passport || p?.documentNumber || null;
      const passportExpiry = p?.passportExpiry || p?.documentExpiry || p?.expiryDate || null;
      const passportCountry = p?.passportCountry || p?.documentCountry || p?.nationality || 'BD';
      const nationality = p?.nationality || passportCountry || 'BD';
      const genderRaw = String(p?.gender || '').trim().toLowerCase();
      const gender = genderRaw || (/^(mr|mstr)$/i.test(title) ? 'male' : 'female');

      return {
        ...p,
        title,
        firstName,
        lastName,
        dateOfBirth,
        dob: dateOfBirth,
        gender,
        type: p?.type || 'adult',
        nationality,
        passportCountry,
        passportNumber,
        passport: passportNumber,
        passportExpiry,
      };
    });

    const bookingId = uuidv4();
    // Temporary fallback ref — will be replaced with real PNR after GDS booking
    let bookingRef = `ST-FL-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(Math.floor(Math.random()*999)).padStart(3,'0')}`;

    const origin = flightData?.origin || '';
    const destination = flightData?.destination || '';
    const departureTime = flightData?.departureTime || new Date().toISOString();

    // Determine domestic/international
    const domestic = isDomestic !== undefined ? isDomestic : (BD_AIRPORTS.includes(origin.toUpperCase()) && BD_AIRPORTS.includes(destination.toUpperCase()));

    // ── GUARD: Airline route restriction (Road-to-Road) ──
    try {
      const airlineCodeForGuard = String(flightData?.airlineCode || flightData?.airline?.code || '').toUpperCase();
      const originCountry = String(flightData?.originCountry || (BD_AIRPORTS.includes(String(origin).toUpperCase()) ? 'BD' : '')).toUpperCase();
      const destCountry = String(flightData?.destinationCountry || (BD_AIRPORTS.includes(String(destination).toUpperCase()) ? 'BD' : '')).toUpperCase();
      const blocked = await isAirlineRouteBlocked({ airlineCode: airlineCodeForGuard, originCountry, destCountry });
      if (blocked) {
        return res.status(422).json({
          message: `${airlineCodeForGuard} is not permitted to book ${origin} → ${destination} per admin route restrictions.`,
          status: 422,
          code: 'ROUTE_RESTRICTED',
        });
      }
    } catch (guardErr) { console.warn('[Booking] route restriction check skipped:', guardErr.message); }

    // ── GUARD: Partial payment eligibility ──
    if (payLater) {
      const settings = await loadPartialSettings();
      const refundable = !!(fareRules?.refundable ?? flightData?.refundable ?? true);
      const elig = evaluatePartialEligibility({
        origin, destination, departureTime, refundable,
        partialOverride: false,
      }, settings);
      if (!elig.eligible) {
        return res.status(422).json({
          message: `Partial payment not allowed: ${elig.reason.replace(/_/g, ' ')}. Please complete full payment.`,
          status: 422,
          code: 'PARTIAL_NOT_ALLOWED',
          reason: elig.reason,
        });
      }
    }

    // Resolve payment deadline: API-only, from airline GDS timeLimit
    const airlineTimeLimit = flightData?.timeLimit || null;
    let paymentDeadline = null;
    if (payLater) {
      paymentDeadline = resolvePaymentDeadline(airlineTimeLimit);
    }

    const status = payLater ? 'on_hold' : 'confirmed';
    const payStatus = payLater ? 'pending' : 'paid';

    const flightSourceRaw = flightData?.source || flightData?.provider || '';
    const flightSource = String(flightSourceRaw).toLowerCase().trim();
    const airlineCode = String(flightData?.airlineCode || '').toUpperCase();
    const isTtiFlight = flightSource.includes('tti') || flightSource.includes('astra') || ['2A', 'S2'].includes(airlineCode);
    const isSabreFlight = flightSource.includes('sabre') || !!flightData?._sabreSource;
    const isBdfareFlight = flightSource.includes('bdfare') || flightSource.includes('bdf');
    const isFlyhubFlight = flightSource.includes('flyhub');
    const isTriploverFlight = flightSource.includes('triplover') || !!flightData?._tlItemCodeRef;
    const isGdsFlight = isTtiFlight || isSabreFlight || isBdfareFlight || isFlyhubFlight || isTriploverFlight;


    if (isGdsFlight) {
      const missingPassportIndex = passengers.findIndex((p) => !p.passportNumber || !p.passportExpiry || !p.nationality);
      if (missingPassportIndex >= 0) {
        return res.status(422).json({
          message: `Passenger ${missingPassportIndex + 1} missing passport fields (number/expiry/nationality)`,
          gdsBooked: false,
        });
      }
    }

    const details = {
      outbound: flightData || {},
      return: returnFlightData || null,
      multiCityFlights: req.body.multiCityFlights || [],
      isRoundTrip: !!isRoundTrip,
      isMultiCity: !!(req.body.isMultiCity || (req.body.multiCityFlights || []).length >= 2),
      isDomestic: domestic,
      source: flightSource || null,
      addOns: addOns || {},
      specialServices: specialServices || {},
      baseFare, taxes, serviceCharge,
      discount,
      aitVat,
      fareRules: fareRules || flightData?.fareRules || { discount: 6.30, aitVat: 0.3 },
      travelDocuments: travelDocuments || [],
    };

    // Create booking in external GDS first (TTI/Sabre)
    let gdsPnr = null;
    let gdsBookingResult = null;
    let airlinePnr = null; // Actual airline record locator
    let gdsBookingId = null; // Provider-specific internal booking identifier

    const multiCityFlights = req.body.multiCityFlights || [];
    const mergedFlightData = mergeBookingFlightData({ flightData, returnFlightData, multiCityFlights, isRoundTrip });

    console.log('[Booking] Merged legs count:', mergedFlightData.legs?.length || 0);
    (mergedFlightData.legs || []).forEach((l, i) => {
      console.log(`[Booking]   Leg ${i + 1}: ${l.airlineCode || '?'}${l.flightNumber || '?'} ${l.origin || '?'}→${l.destination || '?'} ${l.departureTime || '?'}`);
    });

    if (isTtiFlight) {
      console.log('[Booking] TTI/Air Astra flight detected — creating GDS booking...');
      try {
        const ttiFlightData = await hydrateTtiContextForBooking({
          mergedFlightData,
          returnFlightData,
          isRoundTrip: !!isRoundTrip,
          passengers,
        });

        gdsBookingResult = await ttiCreateBooking({
          flightData: ttiFlightData,
          passengers,
          contactInfo: contactInfo || {},
          specialServices: specialServices || {},
        });

        if (gdsBookingResult?.success && gdsBookingResult?.pnr) {
          gdsPnr = gdsBookingResult.pnr;
          airlinePnr = gdsBookingResult.airlinePnr || gdsBookingResult.pnr || null;
          gdsBookingId = gdsBookingResult.ttiBookingId || null;
          console.log('[Booking] TTI success | PNR:', gdsPnr, '| Airline PNR:', airlinePnr, '| Booking ID:', gdsBookingId);

          if (gdsBookingResult.ticketTimeLimit && payLater) {
            const ttiDeadline = new Date(gdsBookingResult.ticketTimeLimit);
            if (!isNaN(ttiDeadline.getTime()) && ttiDeadline > new Date()) {
              paymentDeadline = ttiDeadline;
            }
          }
        } else {
          console.warn('[Booking] TTI booking failed:', gdsBookingResult?.error || 'Unknown TTI error');
        }
      } catch (ttiErr) {
        console.error('[Booking] TTI CreateBooking exception:', ttiErr.message);
      }
    }

    if (!gdsPnr && isSabreFlight) {
      console.log('[Booking] ═══════════════════════════════════════════════════');
      console.log('[Booking] Sabre flight detected — creating GDS booking with SSR/DOCS...');
      console.log('[Booking] isRoundTrip:', isRoundTrip, '| isMultiCity:', !!(req.body.isMultiCity || (req.body.multiCityFlights || []).length >= 2));
      console.log('[Booking] returnFlightData:', returnFlightData ? 'YES' : 'NO');
      console.log('[Booking] multiCityFlights:', (req.body.multiCityFlights || []).length, 'segments');
      console.log('[Booking] Passengers:', passengers.length, '| Contact:', contactInfo?.email);
      passengers.forEach((p, i) => {
        console.log(`[Booking] Pax ${i + 1}: ${(p.title || p.prefix || '').toUpperCase()} ${p.firstName || p.givenName} ${p.lastName || p.surname} | DOB: ${p.dateOfBirth || p.dob} | Passport: ${p.passportNumber || p.passportNo || p.passport} | Expiry: ${p.passportExpiry || p.passportEx} | Gender: ${p.gender} | Type: ${p.type || p.passengerType}`);
      });

      try {
        gdsBookingResult = await sabreCreateBooking({
          flightData: mergedFlightData,
          passengers,
          contactInfo: contactInfo || {},
          specialServices: specialServices || {},
        });

        console.log('[Booking] Sabre result: success=', gdsBookingResult?.success, '| pnr=', gdsBookingResult?.pnr, '| error=', gdsBookingResult?.error || 'none');

        if (gdsBookingResult?.success && gdsBookingResult?.pnr) {
          gdsPnr = gdsBookingResult.pnr;
          gdsBookingId = gdsBookingResult.pnr;
          airlinePnr = gdsBookingResult.airlinePnr || null;
          console.log('[Booking] ✓ Sabre GDS PNR created:', gdsPnr, '| createVariant:', gdsBookingResult.createVariant || 'unknown');

          if (airlinePnr) {
            console.log('[Booking] ✓ Distinct Airline PNR from CreatePNR response:', airlinePnr);
          } else {
            try {
              console.log('[Booking] Fetching GetBooking to extract distinct Airline PNR...');
              const bookingDetail = await sabreGetBooking({ pnr: gdsPnr });
              if (bookingDetail?.success) {
                // Use vendorLocators array from enhanced GetBooking
                if (bookingDetail.vendorLocators?.length > 0) {
                  airlinePnr = bookingDetail.vendorLocators[0];
                  console.log('[Booking] ✓ Distinct Airline PNR from vendorLocators:', airlinePnr);
                } else {
                  // Fallback: deep scan raw response
                  airlinePnr = extractDistinctSabreAirlinePnr(bookingDetail.rawResponse, gdsPnr);
                  if (airlinePnr) {
                    console.log('[Booking] ✓ Distinct Airline PNR from deep scan:', airlinePnr);
                  } else {
                    console.log('[Booking] No distinct airline locator found — airline PNR may equal GDS PNR or be assigned after ticketing');
                  }
                }
              } else {
                console.warn('[Booking] GetBooking returned no data:', bookingDetail?.error);
              }
            } catch (getBookErr) {
              console.warn('[Booking] GetBooking for airline PNR extraction failed:', getBookErr.message);
            }
          }

          if (gdsBookingResult.ticketTimeLimit && payLater) {
            const sabreDeadline = new Date(gdsBookingResult.ticketTimeLimit);
            if (!isNaN(sabreDeadline.getTime()) && sabreDeadline > new Date()) {
              paymentDeadline = sabreDeadline;
              console.log('[Booking] Sabre ticket time limit:', paymentDeadline.toISOString());
            }
          }
        } else {
          console.warn('[Booking] Sabre booking failed:', gdsBookingResult?.error || 'Unknown Sabre error');
        }
      } catch (sabreErr) {
        console.error('[Booking] Sabre CreateBooking exception:', sabreErr.message);
      }
    }

    // ── BDFare booking ──
    if (!gdsPnr && isBdfareFlight) {
      console.log('[Booking] BDFare flight detected — creating GDS booking...');
      try {
        const bdfOfferId = flightData?._bdfOfferId || flightData?.id || null;
        if (!bdfOfferId) {
          console.warn('[Booking] BDFare: No offerId found in flight data');
        } else {
          gdsBookingResult = await bdfCreateBooking({
            offerId: bdfOfferId,
            passengers: passengers.map(p => ({
              type: p.type === 'child' ? 'CHD' : p.type === 'infant' ? 'INF' : 'ADT',
              title: p.title || 'Mr',
              firstName: p.firstName,
              lastName: p.lastName,
              dob: p.dateOfBirth || p.dob,
              gender: p.gender || 'male',
              nationality: p.nationality || 'BD',
              passport: p.passportNumber || p.passport,
              passportExpiry: p.passportExpiry,
            })),
            contactInfo: contactInfo || {},
          });

          if (gdsBookingResult?.success && gdsBookingResult?.pnr) {
            gdsPnr = gdsBookingResult.pnr;
            airlinePnr = gdsBookingResult.pnr;
            gdsBookingId = gdsBookingResult.orderId || null;
            console.log('[Booking] ✓ BDFare PNR:', gdsPnr, '| OrderId:', gdsBookingId);
          } else {
            console.warn('[Booking] BDFare booking failed:', gdsBookingResult?.error);
          }
        }
      } catch (bdfErr) {
        console.error('[Booking] BDFare CreateBooking exception:', bdfErr.message);
      }
    }

    // ── FlyHub booking ──
    if (!gdsPnr && isFlyhubFlight) {
      console.log('[Booking] FlyHub flight detected — creating GDS booking...');
      try {
        const flyhubResultId = flightData?._flyhubResultId || flightData?.id || null;
        if (!flyhubResultId) {
          console.warn('[Booking] FlyHub: No resultId found in flight data');
        } else {
          gdsBookingResult = await flyhubCreateBooking({
            resultId: flyhubResultId,
            passengers: passengers.map(p => ({
              title: p.title || 'Mr',
              firstName: p.firstName,
              lastName: p.lastName,
              type: p.type === 'child' ? 'Child' : p.type === 'infant' ? 'Infant' : 'Adult',
              dob: p.dateOfBirth || p.dob,
              gender: p.gender || 'male',
              nationality: p.nationality || 'BD',
              passport: p.passportNumber || p.passport,
              passportExpiry: p.passportExpiry,
            })),
            contactInfo: contactInfo || {},
          });

          if (gdsBookingResult?.success && gdsBookingResult?.pnr) {
            gdsPnr = gdsBookingResult.pnr;
            airlinePnr = gdsBookingResult.pnr;
            gdsBookingId = gdsBookingResult.bookingId || null;
            console.log('[Booking] ✓ FlyHub PNR:', gdsPnr, '| BookingId:', gdsBookingId);
          } else {
            console.warn('[Booking] FlyHub booking failed:', gdsBookingResult?.error);
          }
        }
      } catch (fhErr) {
        console.error('[Booking] FlyHub CreateBooking exception:', fhErr.message);
      }
    }

    // ── TripLover booking (Reprice → Book) ──
    if (!gdsPnr && isTriploverFlight) {
      console.log('[Booking] TripLover flight detected — repricing then booking...');
      try {
        const uniqueTransID = flightData?._tlUniqueTransID;
        const itemCodeRef = flightData?._tlItemCodeRef;
        let segmentCodeRefs = flightData?._tlSegmentCodeRefs || [];
        if (returnFlightData?._tlSegmentCodeRefs?.length) {
          segmentCodeRefs = [...segmentCodeRefs, ...returnFlightData._tlSegmentCodeRefs];
        }

        if (!uniqueTransID || !itemCodeRef) {
          console.warn('[Booking] TripLover: missing uniqueTransID/itemCodeRef in flight data');
        } else {
          const reprice = await tlRevalidate({ uniqueTransID, itemCodeRef, segmentCodeRefs });
          if (!reprice.success) throw new Error('TripLover reprice failed — fare no longer available');

          gdsBookingResult = await tlCreateBooking({
            uniqueTransID: reprice.uniqueTransID,
            itemCodeRef: reprice.itemCodeRef,
            priceCodeRef: reprice.priceCodeRef,
            segmentCodeRefs: reprice.segmentCodeRefs?.length ? reprice.segmentCodeRefs : segmentCodeRefs,
            passengers: passengers.map((p, i) => ({
              title: p.title || 'Mr',
              firstName: p.firstName,
              lastName: p.lastName,
              type: p.type === 'child' ? 'CNN' : p.type === 'infant' ? 'INF' : 'ADT',
              dob: p.dateOfBirth || p.dob,
              gender: p.gender || (/^(mrs|ms|miss)$/i.test(p.title || '') ? 'Female' : 'Male'),
              nationality: p.nationality || 'BD',
              issuingCountry: p.issuingCountry || p.nationality || 'BD',
              passport: p.passportNumber || p.passport,
              passportExpiry: p.passportExpiry,
              isLeadPassenger: i === 0,
            })),
            contactInfo: contactInfo || {},
          });

          if (gdsBookingResult?.success && gdsBookingResult?.pnr) {
            gdsPnr = gdsBookingResult.pnr;
            airlinePnr = gdsBookingResult.airlinePnr || gdsBookingResult.pnr;
            gdsBookingId = gdsBookingResult.pnr;
            console.log('[Booking] ✓ TripLover PNR:', gdsPnr, '| Airline PNR:', airlinePnr);
          } else {
            console.warn('[Booking] TripLover booking failed:', gdsBookingResult?.error);
          }
        }
      } catch (tlErr) {
        console.error('[Booking] TripLover booking exception:', tlErr.message);
        gdsBookingResult = { success: false, error: tlErr.message };
      }
    }


    // Airline PNR is best-effort (often only available after ticketing for Sabre)
    if (isGdsFlight && !gdsPnr) {
      return res.status(422).json({
        message: 'GDS booking failed: no PNR was returned from the provider',
        gdsBooked: false,
        gdsError: gdsBookingResult?.error || 'Booking failed - no GDS PNR generated',
        gdsPnr: null,
        airlinePnr: null,
        gdsBookingId: gdsBookingId || null,
      });
    }

    // Use real PNR as booking reference when available
    if (gdsPnr) {
      bookingRef = gdsPnr;
    }

    // Build route string
    const multiCityFlightsArr = req.body.multiCityFlights || [];
    let flightRoute;
    if (multiCityFlightsArr.length >= 2) {
      flightRoute = multiCityFlightsArr.map(f => f.origin).concat(multiCityFlightsArr[multiCityFlightsArr.length - 1]?.destination).filter(Boolean).join('-');
    } else if (isRoundTrip && returnFlightData) {
      flightRoute = `${origin}-${destination}-${origin}`;
    } else {
      flightRoute = `${origin}-${destination}`;
    }
    const flightProvider = flightSource || (isTtiFlight ? 'tti' : (isSabreFlight ? 'sabre' : (gdsPnr ? 'gds' : 'local')));

    await db.query(
      `INSERT INTO bookings (id, user_id, booking_type, booking_ref, pnr, status, ticket_status, provider, route, total_amount, payment_method, payment_status, details, passenger_info, contact_info, payment_deadline)
       VALUES (?, ?, 'flight', ?, ?, ?, 'not_issued', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bookingId, req.user.sub, bookingRef, gdsPnr || null, status, flightProvider, flightRoute, totalAmount || 0, paymentMethod || 'pay_later', payStatus,
       JSON.stringify({ ...details, gdsPnr, airlinePnr, gdsBookingId, gdsBookingResult: gdsBookingResult || null }),
       JSON.stringify(passengers || []), JSON.stringify(contactInfo || {}),
       paymentDeadline]
    );

    // Create transaction only if paid
    if (!payLater) {
      await db.query(
        `INSERT INTO transactions (id, user_id, booking_id, type, amount, status, payment_method, reference, description)
         VALUES (?, ?, ?, 'payment', ?, 'completed', ?, ?, ?)`,
        [uuidv4(), req.user.sub, bookingId, totalAmount || 0, paymentMethod || 'card', bookingRef, `Flight booking ${origin} → ${destination}`]
      );

      // Create ticket only if paid immediately
      const ticketNo = `098-${String(Math.floor(Math.random()*9999999999)).padStart(10,'0')}`;
      await db.query(
        `INSERT INTO tickets (id, booking_id, user_id, ticket_no, pnr, status, details)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        [uuidv4(), bookingId, req.user.sub, ticketNo, gdsPnr || bookingRef.slice(-6).toUpperCase(),
         JSON.stringify({ airline: flightData?.airline, flightNumber: flightData?.flightNumber, origin, destination, departureTime, passenger: passengers?.[0]?.firstName + ' ' + passengers?.[0]?.lastName })]
      );
    }

    notifyBookingConfirm(req.user.sub, { bookingRef, type: 'Flight', amount: totalAmount || 0 }).catch(console.error);
    res.status(201).json({
      id: bookingId,
      bookingRef,
      status,
      payLater: !!payLater,
      paymentDeadline: paymentDeadline ? paymentDeadline.toISOString() : null,
      totalAmount: totalAmount || 0,
      currency: 'BDT',
      bookingType: 'flight',
      pnr: gdsPnr || null,
      airlinePnr: airlinePnr || null,
      gdsBookingId: gdsBookingId || null,
      gdsBooked: !!(gdsBookingResult?.success),
      gdsError: gdsBookingResult && !gdsBookingResult.success ? (gdsBookingResult.error || null) : null,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Flight booking error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});
// POST /flights/cancel — customer cancellation
router.post('/cancel', authenticate, async (req, res) => {
  try {
    const { bookingId, reason } = req.body;
    if (!bookingId) return res.status(400).json({ message: 'bookingId required' });

    const [rows] = await db.query('SELECT * FROM bookings WHERE id = ? AND user_id = ?', [bookingId, req.user.sub]);
    if (rows.length === 0) return res.status(404).json({ message: 'Booking not found' });

    const booking = rows[0];
    if (['cancelled', 'void', 'refunded', 'completed'].includes(booking.status)) {
      return res.status(422).json({ message: `Booking already ${booking.status}` });
    }

    const details = typeof booking.details === 'string' ? JSON.parse(booking.details) : (booking.details || {});
    const sourceRaw = details.outbound?.source || details.source || booking.provider || '';
    const source = String(sourceRaw).toLowerCase().trim();

    const airlineCode = String(details.outbound?.airlineCode || details.airlineCode || '').toUpperCase();
    const isSabreSource = source.includes('sabre');
    const isTtiSource = source.includes('tti') || source.includes('astra') || ['2A', 'S2'].includes(airlineCode);
    const isBdfareSource = source.includes('bdfare') || source.includes('bdf');
    const isFlyhubSource = source.includes('flyhub');
    const isGdsProvider = isSabreSource || isTtiSource || isBdfareSource || isFlyhubSource;

    const { gdsPnr, airlinePnr } = resolveCancelLocators(booking, details);

    // For TTI, provider booking id from GDS response is required (local booking.id is NOT valid for TTI Cancel API)
    const ttiBookingId = details?.gdsBookingResult?.ttiBookingId
      || details?.gdsBookingId
      || details?.ttiBookingId
      || details?.outbound?._ttiBookingId
      || null;

    if (isGdsProvider && !gdsPnr) {
      return res.status(422).json({
        message: 'Missing GDS PNR — cancellation blocked to prevent local/GDS mismatch',
        gdsError: `No valid GDS PNR found (airlinePnr=${airlinePnr || 'none'})`,
        hint: 'This booking must store the provider GDS PNR for cancellation.',
      });
    }

    // Attempt GDS cancellation if PNR exists
    let gdsCancelResult = null;
    let gdsCancelFailed = false;
    if (gdsPnr) {
      try {
        console.log(`[Cancel] Provider source='${source}' | airlineCode='${airlineCode || '-'}' | booking.provider='${booking.provider || ''}' | bookingRef='${booking.booking_ref || '-'}' | gdsPnr='${gdsPnr}' | airlinePnr='${airlinePnr || '-'}' | ttiBookingId='${ttiBookingId || '-'}'`);

        if (isSabreSource) {
          const { cancelBooking: sabreCancelBooking } = require('./sabre-flights');
          gdsCancelResult = await sabreCancelBooking({ pnr: gdsPnr });
          if (!gdsCancelResult?.success) gdsCancelFailed = true;
        } else if (isTtiSource) {
          const { cancelBooking: ttiCancelBooking } = require('./tti-flights');
          gdsCancelResult = await ttiCancelBooking({ pnr: gdsPnr, bookingId: ttiBookingId });
          if (!gdsCancelResult?.success) gdsCancelFailed = true;
        } else if (isBdfareSource) {
          const { cancelBooking: bdfCancelBooking } = require('./bdf-flights');
          const bdfOrderId = details?.gdsBookingId || details?.gdsBookingResult?.orderId || null;
          gdsCancelResult = await bdfCancelBooking({ orderId: bdfOrderId, pnr: gdsPnr });
          if (!gdsCancelResult?.success) gdsCancelFailed = true;
        } else if (isFlyhubSource) {
          const { cancelBooking: fhCancelBooking } = require('./flyhub-flights');
          const fhBookingId = details?.gdsBookingId || details?.gdsBookingResult?.bookingId || gdsPnr;
          gdsCancelResult = await fhCancelBooking({ bookingId: fhBookingId, pnr: gdsPnr });
          if (!gdsCancelResult?.success) gdsCancelFailed = true;
        } else if (source.includes('triplover')) {
          const refs = details?.gdsBookingResult?.refs || {};
          gdsCancelResult = await tlCancelBooking({
            pnr: gdsPnr,
            uniqueTransID: refs.uniqueTransID || details?.outbound?._tlUniqueTransID,
            itemCodeRef: refs.itemCodeRef || details?.outbound?._tlItemCodeRef,
            priceCodeRef: refs.priceCodeRef,
            bookingCodeRef: refs.bookingCodeRef,
          });
          if (!gdsCancelResult?.success) gdsCancelFailed = true;
        } else {

          gdsCancelFailed = true;
          gdsCancelResult = { success: false, error: `Unsupported provider/source for cancellation: ${source || 'unknown'}` };
        }
      } catch (gdsErr) {
        console.error('[Cancel] GDS cancel error:', gdsErr.message);
        gdsCancelFailed = true;
        gdsCancelResult = { success: false, error: gdsErr.message };
      }
    }

    // Safety block: if GDS cancel failed and PNR exists, don't update local status
    if (gdsCancelFailed && gdsPnr) {
      console.warn(`[Cancel] GDS cancel failed for PNR ${gdsPnr} — local status NOT changed`);
      return res.status(422).json({
        message: 'GDS cancellation failed — booking status unchanged',
        gdsError: gdsCancelResult?.error || 'Provider returned failure',
        hint: 'Contact support or try again later',
      });
    }

    await db.query('UPDATE bookings SET status = ?, notes = CONCAT(IFNULL(notes,""), ?) WHERE id = ?', [
      'cancelled',
      `\n[Customer Cancel ${new Date().toISOString()}] ${reason || 'No reason provided'}${gdsPnr ? ` | GDS: ${gdsCancelResult?.success ? 'OK' : 'N/A'}` : ''}`,
      bookingId,
    ]);

    console.log(`[Cancel] Booking ${booking.booking_ref} cancelled by user ${req.user.sub}`);
    res.json({ success: true, message: 'Booking cancelled', gdsCancelled: !!(gdsCancelResult?.success) });
  } catch (err) {
    console.error('Cancel error:', err);
    res.status(500).json({ message: 'Something went wrong' });
  }
});

// ── Live route prices for homepage ──
// Searches cheapest fare across all providers for predefined domestic routes
// Results cached for 2 hours to avoid hammering GDS APIs
const DOMESTIC_ROUTES = [
  { from: 'Dhaka', fromCode: 'DAC', to: "Cox's Bazar", toCode: 'CXB' },
  { from: 'Dhaka', fromCode: 'DAC', to: 'Jashore', toCode: 'JSR' },
  { from: 'Dhaka', fromCode: 'DAC', to: 'Chattogram', toCode: 'CGP' },
  { from: 'Dhaka', fromCode: 'DAC', to: 'Sylhet', toCode: 'ZYL' },
  { from: 'Dhaka', fromCode: 'DAC', to: 'Barisal', toCode: 'BZL' },
  { from: 'Dhaka', fromCode: 'DAC', to: 'Saidpur', toCode: 'SPD' },
];

let routePriceCache = { data: null, expiry: 0 };
const ROUTE_CACHE_TTL = 1 * 60 * 60 * 1000; // 1 hour

// Background refresh: auto-update route prices every hour
function scheduleRoutePriceRefresh() {
  setInterval(async () => {
    try {
      console.log('[Route Prices] Background refresh starting...');
      const dateStr = new Date().toISOString().split('T')[0];
      const results = await Promise.allSettled(
        DOMESTIC_ROUTES.map(async (route) => {
          const params = { origin: route.fromCode, destination: route.toCode, departDate: dateStr, adults: 1, children: 0, infants: 0, cabinClass: 'economy' };
          const [tti, bdf, sabre] = await Promise.allSettled([
            ttiSearch(params).catch(() => []),
            bdfSearch(params).catch(() => []),
            sabreSearch(params).catch(() => []),
          ]);
          let allFlights = [];
          for (const r of [tti, bdf, sabre]) {
            if (r.status === 'fulfilled') allFlights.push(...(r.value || []));
          }
          let cheapest = null;
          for (const f of allFlights) {
            const price = f.price || f.totalPrice || f.fareDetails?.totalPrice || 0;
            if (price > 0 && (!cheapest || price < cheapest)) cheapest = price;
          }
          return { ...route, price: cheapest ? `৳${Math.round(cheapest).toLocaleString('en-IN')}` : null, priceRaw: cheapest || null, flightCount: allFlights.length };
        })
      );
      const routes = results.map((r, i) => r.status === 'fulfilled' ? r.value : { ...DOMESTIC_ROUTES[i], price: null, priceRaw: null, flightCount: 0 });
      routePriceCache = { data: routes, expiry: Date.now() + ROUTE_CACHE_TTL };
      console.log(`[Route Prices] Background refresh done:`, routes.map(r => `${r.fromCode}→${r.toCode}: ${r.price || 'N/A'}`).join(', '));
    } catch (err) {
      console.error('[Route Prices] Background refresh error:', err.message);
    }
  }, ROUTE_CACHE_TTL);
}

// Start background refresh after 30 seconds (let server stabilize first)
setTimeout(scheduleRoutePriceRefresh, 30000);

router.get('/route-prices', async (req, res) => {
  try {
    // Return cached if still valid
    if (routePriceCache.data && Date.now() < routePriceCache.expiry) {
      return res.json({ success: true, routes: routePriceCache.data, cached: true });
    }

    // Search date: today's date for current prices
    const dateStr = new Date().toISOString().split('T')[0];

    console.log(`[Route Prices] Fetching live prices for ${DOMESTIC_ROUTES.length} routes on ${dateStr}`);

    const results = await Promise.allSettled(
      DOMESTIC_ROUTES.map(async (route) => {
        const params = {
          origin: route.fromCode,
          destination: route.toCode,
          departDate: dateStr,
          adults: 1,
          children: 0,
          infants: 0,
          cabinClass: 'economy',
        };

        // Search TTI + BDFare + Sabre in parallel (domestic routes)
        const [tti, bdf, sabre] = await Promise.allSettled([
          ttiSearch(params).catch(() => []),
          bdfSearch(params).catch(() => []),
          sabreSearch(params).catch(() => []),
        ]);

        let allFlights = [];
        for (const r of [tti, bdf, sabre]) {
          if (r.status === 'fulfilled') allFlights.push(...(r.value || []));
        }

        // Find cheapest price
        let cheapest = null;
        for (const f of allFlights) {
          const price = f.price || f.totalPrice || f.fareDetails?.totalPrice || 0;
          if (price > 0 && (!cheapest || price < cheapest)) {
            cheapest = price;
          }
        }

        return {
          ...route,
          price: cheapest ? `৳${Math.round(cheapest).toLocaleString('en-IN')}` : null,
          priceRaw: cheapest || null,
          flightCount: allFlights.length,
        };
      })
    );

    const routes = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return { ...DOMESTIC_ROUTES[i], price: null, priceRaw: null, flightCount: 0 };
    });

    // Cache results
    routePriceCache = { data: routes, expiry: Date.now() + ROUTE_CACHE_TTL };

    console.log(`[Route Prices] Done:`, routes.map(r => `${r.fromCode}→${r.toCode}: ${r.price || 'N/A'}`).join(', '));
    res.json({ success: true, routes, cached: false });
  } catch (err) {
    console.error('[Route Prices] Error:', err);
    res.status(500).json({ message: 'Something went wrong' });
  }
});

module.exports = router;
