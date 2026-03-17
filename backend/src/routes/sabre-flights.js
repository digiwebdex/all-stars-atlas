/**
 * Sabre GDS API integration — JV_BD OTA Solution
 * OAuth v3 password grant (EPR-PCC + agency password)
 * Credentials stored in system_settings DB table (key: 'api_sabre')
 * Admin Panel → Settings → API Integrations → Sabre GDS
 *
 * Auth: POST /v3/auth/token (password grant, Basic auth with JV_BD shared secret)
 * CERT: https://api.cert.platform.sabre.com
 * PROD: https://api.platform.sabre.com
 * PCC: J4YL | EPR: 631470
 */

const db = require('../config/db');
const zlib = require('zlib');

// ── Config cache (5 min TTL) ──
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

    // Production detection: explicit environment OR presence of prod credentials
    // IMPORTANT: 'cert' = pre-production/UAT, 'production'/'prod' = live
    const isProd = cfg.environment === 'production' || cfg.environment === 'prod'
      || (!cfg.environment && (cfg.prod_url || cfg.prod_basic_auth || cfg.prodPassword));

    // Production URLs (confirmed by Sabre JV_BD):
    //   REST: https://api.platform.sabre.com
    //   SOAP: https://webservices.platform.sabre.com
    // Cert/UAT URLs:
    //   REST: https://api.cert.platform.sabre.com
    //   SOAP: https://webservices.cert.platform.sabre.com
    const baseUrl = isProd
      ? (cfg.prod_url || 'https://api.platform.sabre.com')
      : (cfg.sandbox_url || 'https://api.cert.platform.sabre.com');

    const pick = (...vals) => vals.find(v => typeof v === 'string' && v.trim().length > 0)?.trim() || '';

    // Pick env-specific client credentials (CERT and PROD have different secrets per Sabre JV_BD docs)
    const clientId = isProd
      ? pick(cfg.prod_client_id, cfg.clientId, cfg.sandbox_client_id)
      : pick(cfg.cert_client_id, cfg.clientId, cfg.sandbox_client_id, cfg.prod_client_id);
    const clientSecret = isProd
      ? pick(cfg.prod_client_secret, cfg.clientSecret, cfg.sandbox_client_secret)
      : pick(cfg.cert_client_secret, cfg.clientSecret, cfg.sandbox_client_secret, cfg.prod_client_secret);

    // Pre-computed Basic auth from Sabre JV_BD official docs (avoids encoding issues)
    const basicAuth = isProd
      ? pick(cfg.prod_basic_auth)
      : pick(cfg.cert_basic_auth);

    if (!clientId || !clientSecret) {
      console.error('[Sabre] Missing client credentials. Configure cert/prod client_id and client_secret in Admin → Settings → API Integrations → Sabre GDS');
      return null;
    }

    // EPR + password required for OAuth v3 password grant
    const epr = pick(cfg.epr);
    // Use environment-appropriate password
    const agencyPassword = isProd
      ? pick(cfg.prodPassword, cfg.agency_password)
      : pick(cfg.agencyPassword, cfg.agency_password);
    if (!epr || !agencyPassword) {
      console.error('[Sabre] EPR and agency_password are required for OAuth v3. Configure in Admin → Settings → API Integrations → Sabre GDS');
      return null;
    }

    const resolvedEnv = isProd ? 'production' : (cfg.environment || 'cert');

    _configCache = {
      baseUrl: baseUrl.replace(/\/$/, ''),
      clientId,
      clientSecret,
      basicAuth, // pre-computed base64 from Sabre docs
      pcc: cfg.pcc || cfg.scCode || '',
      epr,
      agencyPassword,
      environment: resolvedEnv,
      ptr: cfg.ptr || cfg.PTR || '',
      tamPool: cfg.tamPool || '',
    };
    _configCacheTime = Date.now();
    console.log(`[Sabre] Config loaded: env=${_configCache.environment}, PCC=${_configCache.pcc}, EPR=${_configCache.epr}, baseUrl=${_configCache.baseUrl}, hasBasicAuth=${!!basicAuth}`);
    return _configCache;
  } catch (err) {
    console.error('[Sabre] Config load error:', err.message);
    return null;
  }
}

function clearSabreConfigCache() { _configCache = null; _configCacheTime = 0; }

// ── OAuth2 v3 Token Management (Password Grant — JV_BD OTA) ──
let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken(config) {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) return tokenCache.token;

  try {
    // Use pre-computed Basic auth from Sabre JV_BD official docs if available,
    // otherwise compute from clientId:clientSecret
    const credentials = config.basicAuth
      ? config.basicAuth
      : Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

    // JV_BD OAuth v3: password grant with EPR-PCC-AA as username (confirmed working format)
    const username = `${config.epr}-${config.pcc}-AA`;
    const body = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(config.agencyPassword)}`;

    console.log(`[Sabre] Authenticating via OAuth v3 (EPR: ${config.epr}, PCC: ${config.pcc}, env: ${config.environment})`);
    console.log(`[Sabre] URL: ${config.baseUrl}/v3/auth/token | username: ${username} | usingPrecomputedAuth: ${!!config.basicAuth}`);

    const res = await fetch(`${config.baseUrl}/v3/auth/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[Sabre] OAuth v3 auth failed: ${res.status} ${errText.slice(0, 300)}`);
      console.error(`[Sabre] Debug: clientId=${config.clientId}, basicAuthLen=${credentials.length}, username=${username}`);
      return null;
    }

    const data = await res.json();
    if (data.access_token) {
      tokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in || 604800) * 1000,
      };
      console.log('[Sabre] OAuth v3 token acquired, expires in', data.expires_in, 'seconds');
      return tokenCache.token;
    }
    return null;
  } catch (err) {
    console.error('[Sabre] OAuth v3 auth error:', err.message);
    return null;
  }
}

// ── Sabre API Request Helper ──
async function sabreRequest(config, endpoint, body, method = 'POST', timeoutMs = 30000) {
  const token = await getAccessToken(config);
  if (!token) throw new Error('Sabre authentication failed');

  const url = `${config.baseUrl}${endpoint}`;
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  };

  if (body && method !== 'GET') {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[Sabre] API error on ${endpoint}: ${res.status} ${errText.slice(0, 1000)}`);
    throw new Error(`Sabre API ${res.status}: ${errText.slice(0, 500)}`);
  }
  const text = await res.text();
  if (!text || !text.trim()) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

// ── Flight Search (Bargain Finder Max) ──
// Supports: one-way, round-trip, AND multi-city (via params.segments array)
async function searchFlights(params) {
  const config = await getSabreConfig();
  if (!config) return [];

  const {
    origin, destination, departDate, returnDate,
    adults = 1, children = 0, infants = 0,
    cabinClass,
    segments, // multi-city: [{ from, to, date }, ...]
  } = params;

  const IATA_CODE_RE = /^[A-Z]{3}$/;
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const normalizeCode = (v) => String(v || '').trim().toUpperCase();
  const normalizeDate = (v) => String(v || '').trim();

  const originCode = normalizeCode(origin);
  const destinationCode = normalizeCode(destination);
  const departDateValue = normalizeDate(departDate);
  const returnDateValue = normalizeDate(returnDate);

  const preparedSegments = Array.isArray(segments)
    ? segments
        .map((seg) => ({
          from: normalizeCode(seg?.from),
          to: normalizeCode(seg?.to),
          date: normalizeDate(seg?.date),
        }))
        .filter((seg) => IATA_CODE_RE.test(seg.from) && IATA_CODE_RE.test(seg.to) && ISO_DATE_RE.test(seg.date))
    : [];

  // Multi-city: build OD from sanitized segments array
  const isMultiCity = preparedSegments.length >= 2;

  if (!isMultiCity) {
    const hasValidSingleRoute = IATA_CODE_RE.test(originCode) && IATA_CODE_RE.test(destinationCode) && ISO_DATE_RE.test(departDateValue);
    if (!hasValidSingleRoute) {
      console.warn(`[Sabre] Skipping invalid search params: origin=${originCode || '-'} destination=${destinationCode || '-'} depart=${departDateValue || '-'}`);
      return [];
    }
  }

  // Map cabin class to Sabre codes — accept all formats: human-readable, IATA, kebab-case, snake_case
  const cabinMap = {
    'Economy': 'Y', 'Premium Economy': 'S', 'Business': 'C', 'First': 'F',
    'economy': 'Y', 'premium_economy': 'S', 'business': 'C', 'first': 'F',
    'premium economy': 'S', 'premiumeconomy': 'S',
    'premium-economy': 'S', // kebab-case from frontend SelectItem
    // IATA standard cabin codes (from TicketLagBe/BDFare)
    'Y': 'Y', 'S': 'S', 'C': 'C', 'J': 'C', 'F': 'F', 'W': 'S',
    'y': 'Y', 's': 'S', 'c': 'C', 'j': 'C', 'f': 'F', 'w': 'S',
  };
  const sabreCabin = cabinMap[cabinClass] || 'Y';

  // Build passenger types
  const passengers = [];
  if (adults > 0) passengers.push({ Code: 'ADT', Quantity: adults });
  if (children > 0) passengers.push({ Code: 'CNN', Quantity: children });
  if (infants > 0) passengers.push({ Code: 'INF', Quantity: infants });

  // Build origin-destination info
  let originDest;
  if (isMultiCity) {
    originDest = preparedSegments.map((seg, i) => ({
      RPH: String(i + 1),
      DepartureDateTime: `${seg.date}T00:00:00`,
      OriginLocation: { LocationCode: seg.from },
      DestinationLocation: { LocationCode: seg.to },
    }));
    console.log(`[Sabre] Multi-city search: ${preparedSegments.map(s => `${s.from}→${s.to}`).join(', ')}`);
  } else {
    originDest = [{
      RPH: '1',
      DepartureDateTime: `${departDateValue}T00:00:00`,
      OriginLocation: { LocationCode: originCode },
      DestinationLocation: { LocationCode: destinationCode },
    }];
    if (ISO_DATE_RE.test(returnDateValue)) {
      originDest.push({
        RPH: '2',
        DepartureDateTime: `${returnDateValue}T00:00:00`,
        OriginLocation: { LocationCode: destinationCode },
        DestinationLocation: { LocationCode: originCode },
      });
    }
  }

  // Bargain Finder Max request body — proven working payload for PCC J4YL
  // Strategy: try a smart profile first, then progressively relaxed fallbacks so search never silently dies.
  const buildBfmRequestBody = ({
    numTrips = 250,
    enableDiversity = true,
    additionalNonStops = 20,
    includeBrandedFareIndicators = true,
  } = {}) => {
    const travelTpaExtensions = {
      NumTrips: { Number: numTrips },
      DataSources: {
        NDC: 'Enable',
        ATPCO: 'Enable',
        LCC: 'Enable',
      },
    };

    if (enableDiversity) {
      travelTpaExtensions.DiversityParameters = {
        Weightings: {
          PriceWeight: 10,
          TravelTimeWeight: 0,
        },
        ...(typeof additionalNonStops === 'number' ? { AdditionalNonStopsPercentage: additionalNonStops } : {}),
      };
    }

    const travelerInfoSummary = {
      SeatsRequested: [parseInt(adults) + parseInt(children)],
      AirTravelerAvail: [{ PassengerTypeQuantity: passengers }],
    };

    if (includeBrandedFareIndicators) {
      travelerInfoSummary.PriceRequestInformation = {
        TPA_Extensions: {
          BrandedFareIndicators: {
            MultipleBrandedFares: true,
            ReturnBrandAncillaries: true,
          },
        },
      };
    }

    return {
      OTA_AirLowFareSearchRQ: {
        Version: '5',
        POS: {
          Source: [{
            PseudoCityCode: config.pcc || 'F9CE',
            RequestorID: { Type: '1', ID: '1', CompanyName: { Code: 'TN' } },
          }],
        },
        OriginDestinationInformation: originDest,
        TravelPreferences: {
          TPA_Extensions: travelTpaExtensions,
          // Cabin is a preference so we don't return 0 inventory when Sabre can't honor strict cabin filtering.
          CabinPref: [{ Cabin: sabreCabin, PreferLevel: 'Preferred' }],
        },
        TPA_Extensions: {
          IntelliSellTransaction: {
            RequestType: { Name: '200ITINS' },
          },
        },
        TravelerInfoSummary: travelerInfoSummary,
      },
    };
  };

  const getResponseStats = (rawResponse) => {
    const grouped = rawResponse?.groupedItineraryResponse;
    if (grouped) {
      const itinGroups = Array.isArray(grouped.itineraryGroups) ? grouped.itineraryGroups : [];
      const itinCount = itinGroups.reduce((sum, g) => sum + ((g?.itineraries || []).length), 0);
      const groupedMessages = [
        ...(Array.isArray(grouped?.messages) ? grouped.messages : []),
        ...(Array.isArray(rawResponse?.messages) ? rawResponse.messages : []),
      ];
      const hasNoAvailability = groupedMessages.some((m) => {
        const text = String(m?.text || m?.message || '').toLowerCase();
        return text.includes('no availability') || text.includes('no fares') || text.includes('no flights');
      });
      return { itinCount, hasNoAvailability };
    }

    const classic = rawResponse?.OTA_AirLowFareSearchRS || rawResponse || {};
    const pricedItins = classic?.PricedItineraries?.PricedItinerary;
    const itinCount = Array.isArray(pricedItins) ? pricedItins.length : (pricedItins ? 1 : 0);
    const errors = classic?.Errors?.Error || classic?.errors || [];
    const errorList = Array.isArray(errors) ? errors : [errors];
    const hasNoAvailability = errorList.some((e) => {
      const text = String(e?.ShortText || e?.Message || e?.message || '').toLowerCase();
      return text.includes('no availability') || text.includes('no fares') || text.includes('no flights');
    });
    return { itinCount, hasNoAvailability };
  };

  const normalizeParams = {
    origin: originCode,
    destination: destinationCode,
    departDate: isMultiCity ? preparedSegments[0]?.date : departDateValue,
    returnDate: !isMultiCity && ISO_DATE_RE.test(returnDateValue) ? returnDateValue : undefined,
    adults: parseInt(adults) || 1,
    children: parseInt(children) || 0,
    infants: parseInt(infants) || 0,
    cabinClass: sabreCabin,
    isMultiCity,
    segments: preparedSegments,
  };

  try {
    const requestProfiles = [
      {
        name: 'smart_diverse',
        numTrips: 250,
        enableDiversity: true,
        additionalNonStops: 20,
        includeBrandedFareIndicators: true,
      },
      {
        name: 'fallback_diverse_relaxed',
        numTrips: 220,
        enableDiversity: true,
        additionalNonStops: null,
        includeBrandedFareIndicators: true,
      },
      {
        name: 'fallback_safe',
        numTrips: 180,
        enableDiversity: false,
        additionalNonStops: null,
        includeBrandedFareIndicators: false,
      },
    ];

    let lastRaw = null;

    for (const profile of requestProfiles) {
      try {
        console.log(`[Sabre] BFM attempt: ${profile.name}`);
        const requestBody = buildBfmRequestBody(profile);
        const raw = await sabreRequest(config, '/v5/offers/shop', requestBody);
        lastRaw = raw;

        const { itinCount, hasNoAvailability } = getResponseStats(raw);
        console.log(`[Sabre] ${profile.name} stats: itineraries=${itinCount}, NAV=${hasNoAvailability}`);

        if (itinCount === 0) {
          console.log(`[Sabre] ${profile.name} raw (truncated): ${JSON.stringify(raw).slice(0, 1200)}`);
          continue;
        }

        const results = normalizeSabreResponse(raw, normalizeParams);

        const classCounts = {};
        for (const f of results) {
          const cls = f.bookingClass || 'unknown';
          classCounts[cls] = (classCounts[cls] || 0) + 1;
        }

        console.log(`[Sabre] ${profile.name} normalized ${results.length} flights — booking classes: ${JSON.stringify(classCounts)}`);

        if (results.length > 0) {
          return results;
        }

        console.warn(`[Sabre] ${profile.name} returned itineraries but normalized to 0. Trying fallback...`);
      } catch (attemptErr) {
        console.error(`[Sabre] ${profile.name} attempt failed:`, attemptErr.message);
      }
    }

    console.warn('[Sabre] All BFM attempts returned no usable results');
    if (lastRaw) {
      console.log(`[Sabre] Last BFM raw (truncated): ${JSON.stringify(lastRaw).slice(0, 2000)}`);
    }
    return [];
  } catch (err) {
    console.error('[Sabre] Search failed:', err.message);
    return [];
  }
}

// ── Normalize Sabre BFM response to standard flight format ──
function normalizeSabreResponse(raw, params) {
  const flights = [];

  try {
    // Detect response format: grouped (newer) vs classic OTA
    if (raw?.groupedItineraryResponse) {
      return normalizeGroupedResponse(raw.groupedItineraryResponse, params);
    }

    const response = raw?.OTA_AirLowFareSearchRS || raw;
    const pricedItins = response?.PricedItineraries?.PricedItinerary || [];

    for (let idx = 0; idx < pricedItins.length; idx++) {
      const itin = pricedItins[idx];
      const airItinerary = itin.AirItinerary || {};
      const pricingInfo = itin.AirItineraryPricingInfo || {};
      const odOptions = airItinerary.OriginDestinationOptions?.OriginDestinationOption || [];

      // Extract pricing
      const totalFare = pricingInfo.ItinTotalFare || {};
      const totalAmount = parseFloat(totalFare.TotalFare?.Amount || totalFare.Amount || 0);
      const baseFareAmt = parseFloat(totalFare.BaseFare?.Amount || 0);
      const taxesAmt = parseFloat(totalFare.Taxes?.Tax?.[0]?.Amount || totalFare.Taxes?.Amount || 0) || (totalAmount - baseFareAmt);
      const currency = totalFare.TotalFare?.CurrencyCode || totalFare.CurrencyCode || 'BDT';

      // ── Extract per-passenger-type pricing from PTC_FareBreakdowns ──
      const ptcBreakdowns = pricingInfo.PTC_FareBreakdowns?.PTC_FareBreakdown || [];
      const classicPaxPricing = [];
      for (const ptc of (Array.isArray(ptcBreakdowns) ? ptcBreakdowns : [ptcBreakdowns])) {
        const ptcCode = ptc.PassengerTypeQuantity?.Code || 'ADT';
        const ptcQty = parseInt(ptc.PassengerTypeQuantity?.Quantity || 1);
        const ptcFare = ptc.PassengerFare || {};
        const ptcBase = parseFloat(ptcFare.BaseFare?.Amount || 0);
        const ptcTax = parseFloat(ptcFare.Taxes?.TotalAmount || ptcFare.Taxes?.Tax?.[0]?.Amount || 0);
        const ptcTotal = parseFloat(ptcFare.TotalFare?.Amount || 0) || (ptcBase + ptcTax);
        let paxLabel = 'Adult';
        if (ptcCode === 'CNN' || ptcCode === 'CHD' || ptcCode.startsWith('C')) paxLabel = 'Child';
        else if (ptcCode === 'INF' || ptcCode === 'INS') paxLabel = 'Infant';
        classicPaxPricing.push({ type: ptcCode, label: paxLabel, count: ptcQty, baseFare: ptcBase, taxes: ptcTax, total: ptcTotal, currency });
      }

      // Extract fare rules
      let isRefundable = false;
      let cancellationPolicy = null;
      let dateChangePolicy = null;
      const fareInfos = pricingInfo.FareInfos?.FareInfo || [];
      for (const fi of fareInfos) {
        if (fi.TPA_Extensions?.Refundable?.Ind === true || fi.IsRefundable === true) {
          isRefundable = true;
        }
        if (fi.TPA_Extensions?.Penalties) {
          const penalties = fi.TPA_Extensions.Penalties;
          if (penalties.Penalty) {
            for (const p of (Array.isArray(penalties.Penalty) ? penalties.Penalty : [penalties.Penalty])) {
              if (p.Type === 'Refund' || p.Type === 'Cancel') {
                cancellationPolicy = {
                  beforeDeparture: p.Amount ? parseFloat(p.Amount) : null,
                  afterDeparture: 'Non-refundable',
                  noShow: 'Non-refundable',
                  currency,
                };
              }
              if (p.Type === 'Exchange' || p.Type === 'Reissue') {
                dateChangePolicy = {
                  changeAllowed: !p.NotPermitted,
                  changeFee: p.Amount ? parseFloat(p.Amount) : null,
                  currency,
                };
              }
            }
          }
        }
      }

      // Process each origin-destination (outbound / return)
      for (let odIdx = 0; odIdx < odOptions.length; odIdx++) {
        const od = odOptions[odIdx];
        const segments = od.FlightSegment || [];
        if (segments.length === 0) continue;

        const legs = segments.map(seg => {
          const depAirport = seg.DepartureAirport || {};
          const arrAirport = seg.ArrivalAirport || {};
          const operatingAirline = seg.OperatingAirline || {};
          const marketingAirline = seg.MarketingAirline || {};
          const equipment = seg.Equipment || {};

          return {
            origin: depAirport.LocationCode || '',
            destination: arrAirport.LocationCode || '',
            departureTime: seg.DepartureDateTime || null,
            arrivalTime: seg.ArrivalDateTime || null,
            durationMinutes: seg.ElapsedTime || 0,
            duration: formatDuration(seg.ElapsedTime || 0),
            flightNumber: `${marketingAirline.Code || ''}${seg.FlightNumber || ''}`,
            airlineCode: marketingAirline.Code || operatingAirline.Code || '',
            operatingAirline: operatingAirline.Code || marketingAirline.Code || '',
            aircraft: equipment.AirEquipType || '',
            originTerminal: depAirport.Terminal || '',
            destinationTerminal: arrAirport.Terminal || '',
            stops: [],
          };
        });

        const firstLeg = legs[0];
        const lastLeg = legs[legs.length - 1];

        // Total duration including layovers
        let totalDurationMin = 0;
        for (const leg of legs) totalDurationMin += leg.durationMinutes;
        for (let i = 1; i < legs.length; i++) {
          if (legs[i].departureTime && legs[i - 1].arrivalTime) {
            const layover = (new Date(legs[i].departureTime).getTime() - new Date(legs[i - 1].arrivalTime).getTime()) / 60000;
            if (layover > 0) totalDurationMin += layover;
          }
        }

        const direction = odIdx === 0 ? 'outbound' : 'return';
        const pricePerDirection = odOptions.length > 1 ? Math.round(totalAmount / odOptions.length) : totalAmount;

        // Extract booking class and seat availability
        let bookingClass = '';
        let minSeats = Infinity;
        let checkedBaggage = null;
        for (const fi of fareInfos) {
          if (fi.FareReference) bookingClass = fi.FareReference;
          if (fi.TPA_Extensions?.SeatsRemaining?.Number !== undefined) {
            const seats = parseInt(fi.TPA_Extensions.SeatsRemaining.Number);
            if (seats < minSeats) minSeats = seats;
          }
          // Baggage
          if (fi.TPA_Extensions?.BaggageInformationList?.BaggageInformation) {
            const bagInfos = fi.TPA_Extensions.BaggageInformationList.BaggageInformation;
            for (const bi of (Array.isArray(bagInfos) ? bagInfos : [bagInfos])) {
              const allowance = bi.Allowance || {};
              if (allowance.Weight) {
                checkedBaggage = `${allowance.Weight}${(allowance.Unit || 'KG').toUpperCase()}`;
              } else if (allowance.Pieces !== undefined) {
                checkedBaggage = `${allowance.Pieces} piece${allowance.Pieces > 1 ? 's' : ''}`;
              } else if (allowance.PieceCount !== undefined) {
                checkedBaggage = `${allowance.PieceCount} piece${allowance.PieceCount > 1 ? 's' : ''}`;
              }
            }
          }
        }
        const availableSeats = minSeats === Infinity ? null : minSeats;

        // Extract time limit
        let timeLimit = null;
        if (pricingInfo.TPA_Extensions?.TicketingTimeLimit) {
          timeLimit = pricingInfo.TPA_Extensions.TicketingTimeLimit;
        } else if (itin.TPA_Extensions?.ValidatingCarrier?.TicketingTimeLimit) {
          timeLimit = itin.TPA_Extensions.ValidatingCarrier.TicketingTimeLimit;
        }

        const validatingCarrier = itin.TPA_Extensions?.ValidatingCarrier?.Code
          || itin.ValidatingAirlineCode
          || firstLeg.airlineCode;

        flights.push({
          id: `sabre-${idx}-${direction}`,
          source: 'sabre',
          direction,
          isRoundTrip: odOptions.length > 1,
          _itineraryId: `sabre-itin-${idx}`,
          airline: getAirlineName(firstLeg.airlineCode),
          airlineCode: firstLeg.airlineCode,
          airlineLogo: null,
          flightNumber: firstLeg.flightNumber,
          origin: firstLeg.origin,
          destination: lastLeg.destination,
          departureTime: firstLeg.departureTime,
          arrivalTime: lastLeg.arrivalTime,
          duration: formatDuration(totalDurationMin),
          durationMinutes: totalDurationMin,
          stops: legs.length - 1,
          stopCodes: legs.length > 1 ? legs.slice(0, -1).map(l => l.destination) : [],
          cabinClass: getCabinName(fareInfos[0]?.TPA_Extensions?.Cabin?.Cabin || 'Y'),
          bookingClass,
          availableSeats,
          price: pricePerDirection,
          baseFare: odOptions.length > 1 ? Math.round(baseFareAmt / odOptions.length) : baseFareAmt,
          taxes: odOptions.length > 1 ? Math.round(taxesAmt / odOptions.length) : taxesAmt,
          totalRoundTripPrice: odOptions.length > 1 ? totalAmount : undefined,
          currency,
          refundable: isRefundable,
          baggage: checkedBaggage || null,
          handBaggage: null,
          aircraft: firstLeg.aircraft,
          legs,
          fareDetails: fareInfos.map(fi => ({
            fareBasis: fi.FareBasis?.Code || fi.FareReference || '',
            bookingClass: fi.FareReference || '',
            cabinClass: fi.TPA_Extensions?.Cabin?.Cabin || '',
            availableSeats: fi.TPA_Extensions?.SeatsRemaining?.Number ?? null,
            price: pricePerDirection,
            baseFare: odOptions.length > 1 ? Math.round(baseFareAmt / odOptions.length) : baseFareAmt,
            taxes: odOptions.length > 1 ? Math.round(taxesAmt / odOptions.length) : taxesAmt,
            currency,
            priceScope: odOptions.length > 1 ? 'per-direction' : 'itinerary',
            isTotalPrice: odOptions.length <= 1,
            mealIncluded: 'available',
            seatSelection: 'available',
            rebookingAllowed: true,
            cancellationAllowed: isRefundable,
          })),
          paxPricing: odOptions.length > 1
            ? classicPaxPricing.map(pp => ({ ...pp, baseFare: Math.round(pp.baseFare / odOptions.length), taxes: Math.round(pp.taxes / odOptions.length), total: Math.round(pp.total / odOptions.length), priceScope: 'per-direction' }))
            : classicPaxPricing,
          timeLimit,
          cancellationPolicy,
          dateChangePolicy,
          validatingAirline: validatingCarrier,
          _sabreSeqNumber: itin.SequenceNumber || idx,
        });
      }
    }
  } catch (err) {
    console.error('[Sabre] Normalization error:', err.message);
  }

  return flights;
}

// ── Grouped Itinerary Response (newer Sabre format) ──
function normalizeGroupedResponse(response, params) {
  const flights = [];
  try {
    const legDescs = response.legDescs || [];
    const scheduleDescs = response.scheduleDescs || [];
    const fareComponentDescs = response.fareComponentDescs || [];
    const baggageAllowanceDescs = response.baggageAllowanceDescs || [];
    const itinGroups = response.itineraryGroups || [];

    // Build baggage lookup: id → descriptor (handle both camelCase and PascalCase)
    const baggageLookup = {};
    for (const bd of baggageAllowanceDescs) {
      const bdId = bd.id ?? bd.Id ?? bd.ID;
      if (bdId !== undefined) baggageLookup[bdId] = bd;
    }

    // Build fareComponent lookup: ref → descriptor (for bookingCode, seatsAvailable, cabin)
    const fareComponentLookup = {};
    for (const fcd of fareComponentDescs) {
      const fcdId = fcd.id ?? fcd.Id ?? fcd.ID;
      if (fcdId !== undefined) fareComponentLookup[fcdId] = fcd;
    }

    const toNumber = (value) => {
      if (value === null || value === undefined || value === '') return NaN;

      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : NaN;
      }

      if (typeof value === 'string') {
        const raw = value.trim();
        if (!raw) return NaN;
        const cleaned = raw
          .replace(/,/g, '')
          .replace(/\s+/g, '')
          .replace(/[^\d.-]/g, '');
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
          const n = toNumber(c);
          if (Number.isFinite(n)) return n;
        }
      }

      return NaN;
    };

    const firstPositiveNumber = (...values) => {
      for (const v of values) {
        const n = toNumber(v);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return 0;
    };

    const sumPassengerTotals = (passengerInfoList = []) => {
      let total = 0;
      let baseFare = 0;
      let taxes = 0;
      let currency = '';

      for (const pax of (Array.isArray(passengerInfoList) ? passengerInfoList : [])) {
        const pInfo = pax?.passengerInfo || {};
        const cc = pInfo.currencyConversion || {};
        const ptf = pInfo.passengerTotalFare || {};
        const qty = Math.max(1, Math.round(toNumber(pInfo.passengerNumber) || 1));

        const paxTotal = firstPositiveNumber(
          cc.totalPrice,
          ptf.totalPrice,
          cc.equivalentAmount,
          ptf.equivalentAmount,
          cc.equivalentPrice,
          ptf.equivalentPrice,
        );
        const paxBase = firstPositiveNumber(
          cc.baseFareAmount,
          ptf.baseFareAmount,
          cc.baseFare,
          ptf.baseFare,
          cc.equivalentBaseFareAmount,
          ptf.equivalentBaseFareAmount,
        );
        const paxTax = firstPositiveNumber(
          cc.totalTaxAmount,
          ptf.totalTaxAmount,
          cc.taxAmount,
          ptf.taxAmount,
        );

        if (!currency) {
          currency = cc.currency || ptf.currency || '';
        }

        total += paxTotal * qty;
        baseFare += paxBase * qty;
        taxes += paxTax * qty;
      }

      return { total, baseFare, taxes, currency };
    };

    const extractFareTotals = (fare = {}) => {
      const totalFare = fare?.totalFare || {};
      const paxTotals = sumPassengerTotals(fare?.passengerInfoList || []);

      let total = firstPositiveNumber(
        totalFare.totalPrice,
        totalFare.totalFareAmount,
        totalFare.totalAmount,
        totalFare.equivalentAmount,
        totalFare.equivalentPrice,
        paxTotals.total,
      );

      let baseFare = firstPositiveNumber(
        totalFare.baseFareAmount,
        totalFare.baseFare,
        totalFare.baseAmount,
        totalFare.equivalentBaseFareAmount,
        paxTotals.baseFare,
      );

      let taxes = firstPositiveNumber(
        totalFare.totalTaxAmount,
        totalFare.taxAmount,
        totalFare.taxes,
        paxTotals.taxes,
      );

      if (total <= 0 && baseFare > 0 && taxes > 0) {
        total = baseFare + taxes;
      }
      if (baseFare <= 0 && total > 0 && taxes > 0 && total >= taxes) {
        baseFare = total - taxes;
      }
      if (taxes <= 0 && total > 0 && baseFare > 0 && total >= baseFare) {
        taxes = total - baseFare;
      }

      const currency = totalFare.currency || paxTotals.currency || 'BDT';

      return { total, baseFare, taxes, currency };
    };

    // Debug: log baggage descriptors once
    if (baggageAllowanceDescs.length > 0) {
      console.log(`[Sabre] baggageAllowanceDescs (${baggageAllowanceDescs.length}):`, JSON.stringify(baggageAllowanceDescs.slice(0, 5)));
    } else {
      console.log(`[Sabre] WARNING: No baggageAllowanceDescs in grouped response`);
    }
    if (fareComponentDescs.length > 0) {
      console.log(`[Sabre] fareComponentDescs (${fareComponentDescs.length}):`, JSON.stringify(fareComponentDescs.slice(0, 3)));
    }

    // Log multi-pricing stats
    let totalPricingOptions = 0;
    let itinsWithMultiplePricing = 0;
    for (const g of itinGroups) {
      for (const it of (g.itineraries || [])) {
        const piCount = (it.pricingInformation || []).length;
        totalPricingOptions += piCount;
        if (piCount > 1) itinsWithMultiplePricing++;
      }
    }
    console.log(`[Sabre] Pricing stats: ${totalPricingOptions} total options, ${itinsWithMultiplePricing} itineraries with multiple fares`);

    for (let groupIdx = 0; groupIdx < itinGroups.length; groupIdx++) {
      const group = itinGroups[groupIdx];
      const groupDesc = group.groupDescription || {};
      const itineraries = group.itineraries || [];

      for (let idx = 0; idx < itineraries.length; idx++) {
        const itin = itineraries[idx];
        const pricingInfo = itin.pricingInformation || [];
        if (pricingInfo.length === 0) continue;

        // ── CRITICAL: Sort pricing options by REAL API total price ascending ──
        // Ensures cheapest booking class (V/L/S/T etc.) is primary; skips malformed 0-price artifacts.
        const sortedPricing = [...pricingInfo].sort((a, b) => {
          const priceA = extractFareTotals(a?.fare || {}).total;
          const priceB = extractFareTotals(b?.fare || {}).total;
          const normalizedA = priceA > 0 ? priceA : Number.POSITIVE_INFINITY;
          const normalizedB = priceB > 0 ? priceB : Number.POSITIVE_INFINITY;
          return normalizedA - normalizedB;
        });

        const pricing = sortedPricing[0];
        const fare = pricing.fare || {};
        let { total: totalAmount, baseFare: baseFareAmt, taxes: taxesAmt, currency } = extractFareTotals(fare);

        // ── SAFETY NET: If extractFareTotals returned 0, reconstruct from paxPricing ──
        // Some airlines (MH, CZ etc.) have pricing only in passengerInfo.currencyConversion
        // but NOT in totalFare — this prevents BDT 0 display.
        if (totalAmount <= 0) {
          const paxList = fare.passengerInfoList || [];
          let paxSum = 0, paxBase = 0, paxTax = 0;
          for (const pax of paxList) {
            const pInfo = pax?.passengerInfo || {};
            const cc = pInfo.currencyConversion || {};
            const ptf = pInfo.passengerTotalFare || {};
            const qty = Math.max(1, Math.round(toNumber(pInfo.passengerNumber) || 1));
            const t = firstPositiveNumber(cc.totalPrice, ptf.totalPrice, cc.equivalentAmount, ptf.equivalentAmount);
            const b = firstPositiveNumber(cc.baseFareAmount, ptf.baseFareAmount, cc.baseFare, ptf.baseFare, cc.equivalentBaseFareAmount, ptf.equivalentBaseFareAmount);
            const x = firstPositiveNumber(cc.totalTaxAmount, ptf.totalTaxAmount, cc.taxAmount, ptf.taxAmount);
            paxSum += (t || (b + x)) * qty;
            paxBase += b * qty;
            paxTax += x * qty;
          }
          if (paxSum > 0) {
            totalAmount = paxSum;
            baseFareAmt = paxBase;
            taxesAmt = paxTax;
            console.log(`[Sabre] Price recovered from paxPricing: total=${totalAmount}, base=${baseFareAmt}, tax=${taxesAmt}`);
          }
        }
        if (totalAmount <= 0) {
          console.warn(`[Sabre] WARNING: Flight itin ${groupIdx}-${idx} has price=0. Raw fare keys: ${Object.keys(fare).join(',')}, totalFare keys: ${Object.keys(fare.totalFare || {}).join(',')}`);
        }

        // Extract baggage per segment from passengerInfoList
        const passengerInfoList = fare.passengerInfoList || [];
        const allBaggageInfos = [];
        let checkedBaggageGlobal = null;
        let handBaggageGlobal = null;

        // Debug first itinerary's baggage structure
        if (idx === 0) {
          const pInfo = passengerInfoList[0]?.passengerInfo || {};
          console.log(`[Sabre] First itin passengerInfo keys:`, Object.keys(pInfo));
          const bi = pInfo.baggageInformation || pInfo.BaggageInformation || [];
          console.log(`[Sabre] baggageInformation (${bi.length}):`, JSON.stringify(bi.slice(0, 3)));
        }

        for (const paxInfo of passengerInfoList) {
          const pInfo = paxInfo.passengerInfo || paxInfo.PassengerInfo || {};
          const baggageInfos = pInfo.baggageInformation || pInfo.BaggageInformation || [];
          
          for (const bi of baggageInfos) {
            const allowance = bi.allowance || bi.Allowance || {};
            const ref = allowance.ref ?? allowance.Ref ?? allowance.REF;
            
            // Resolve from lookup
            let resolved = allowance;
            if (ref !== undefined && baggageLookup[ref]) {
              resolved = baggageLookup[ref];
            }
            
            // Extract segment info
            const segmentInfo = bi.segment || bi.Segment || {};
            const provisionType = bi.provisionType || bi.ProvisionType || '';
            
            // Try all possible field name variations (camelCase, PascalCase, lowercase)
            const weight = resolved.weight ?? resolved.Weight ?? resolved.WEIGHT;
            const unit = (resolved.unit ?? resolved.Unit ?? resolved.UNIT) || 'KG';
            const pieceCount = resolved.pieceCount ?? resolved.PieceCount ?? resolved.Pieces ?? resolved.pieces ?? resolved.NumberOfPieces ?? resolved.numberOfPieces;
            const maxWeight = resolved.maxWeight ?? resolved.MaxWeight;
            const maxWeightUnit = resolved.maxWeightUnit ?? resolved.MaxWeightUnit;
            
            let baggageStr = null;
            if (weight) {
              baggageStr = `${weight}${String(unit).toUpperCase()}`;
            } else if (pieceCount !== undefined) {
              // If piece-based, check if there's a per-piece weight
              if (maxWeight) {
                baggageStr = `${pieceCount}PC x ${maxWeight}${String(maxWeightUnit || 'KG').toUpperCase()}`;
              } else {
                baggageStr = `${pieceCount} Piece${pieceCount > 1 ? 's' : ''}`;
              }
            }
            
            if (baggageStr) {
              // provisionType: 'A' = checked, 'B' = carry-on/hand, 'C' = carry-on
              if (provisionType === 'B' || provisionType === 'C') {
                if (!handBaggageGlobal) handBaggageGlobal = baggageStr;
              } else {
                if (!checkedBaggageGlobal) checkedBaggageGlobal = baggageStr;
              }
              allBaggageInfos.push({ provisionType, baggage: baggageStr, segment: segmentInfo });
            }
          }
        }

        // Zero-mock: no hardcoded hand baggage fallback — null if API doesn't provide it

        // Debug baggage result for first itinerary
        if (idx === 0) {
          console.log(`[Sabre] Resolved baggage: checked=${checkedBaggageGlobal}, hand=${handBaggageGlobal}, total infos=${allBaggageInfos.length}`);
        }

        // ── Extract per-passenger-type pricing from passengerInfoList (real API data) ──
        const paxPricing = [];
        for (const paxInfo of passengerInfoList) {
          const pInfo = paxInfo.passengerInfo || {};
          const paxType = pInfo.passengerType || 'ADT';
          const paxNumber = pInfo.passengerNumber || 1;
          // Per-pax fare: Sabre provides currencyConversion with per-pax amounts
          const cc = pInfo.currencyConversion || {};
          // Also check passengerTotalFare for direct amounts
          const ptf = pInfo.passengerTotalFare || {};
          const paxBaseFare = parseFloat(cc.baseFareAmount || ptf.baseFareAmount || 0);
          const paxTaxes = parseFloat(cc.totalTaxAmount || ptf.totalTaxAmount || 0);
          const paxTotal = parseFloat(cc.totalPrice || ptf.totalPrice || 0) || (paxBaseFare + paxTaxes);
          const paxCurrency = cc.currency || ptf.currency || currency;
          
          // Map Sabre pax types to readable names
          let paxLabel = 'Adult';
          if (paxType === 'CNN' || paxType === 'CHD' || paxType.startsWith('C')) paxLabel = 'Child';
          else if (paxType === 'INF' || paxType === 'INS') paxLabel = 'Infant';
          
          paxPricing.push({
            type: paxType,
            label: paxLabel,
            count: paxNumber,
            baseFare: paxBaseFare,
            taxes: paxTaxes,
            total: paxTotal,
            currency: paxCurrency,
          });
        }

        // Debug first itinerary's pax pricing
        if (idx === 0 && paxPricing.length > 0) {
          console.log(`[Sabre] paxPricing:`, JSON.stringify(paxPricing));
        }

        // Helper: resolve fareComponent segment data (inline or via fareComponentDescs ref)
        function resolveFareComponentSegments(fareComponents) {
          const resolvedSegments = [];
          for (const fc of fareComponents) {
            const fcRef = fc.ref ?? fc.id;
            const fcDesc = (fcRef !== undefined && fareComponentLookup[fcRef]) ? fareComponentLookup[fcRef] : fc;
            // IMPORTANT: fc.segments (inline) has bookingCode/seatsAvailable per-itinerary;
            // fcDesc.segments (from fareComponentDescs) only has surcharges/fare info.
            // Use inline segments first, fall back to descriptor segments for fare basis.
            const inlineSegments = fc.segments || [];
            const descSegments = fcDesc.segments || [];
            const segCount = Math.max(inlineSegments.length, descSegments.length);
            for (let si = 0; si < segCount; si++) {
              const inlineSeg = inlineSegments[si] || {};
              const descSeg = descSegments[si] || {};
              // Inline segment may nest data under .segment sub-object
              const inlineInner = inlineSeg.segment || inlineSeg;
              const descInner = descSeg.segment || descSeg;
              resolvedSegments.push({
                bookingCode: inlineInner.bookingCode || inlineInner.BookingCode || descInner.bookingCode || '',
                seatsAvailable: inlineInner.seatsAvailable ?? inlineInner.SeatsAvailable ?? inlineInner.seatsRemaining ?? descInner.seatsAvailable ?? null,
                cabin: inlineInner.cabin?.cabin || inlineInner.cabin?.Cabin || inlineInner.cabinCode || descInner.cabin?.cabin || fcDesc.cabinCode || '',
                fareBasisCode: inlineInner.fareBasisCode || descInner.fareBasisCode || fc.fareBasisCode || fcDesc.fareBasisCode || '',
              });
            }
            // Also extract brand info from resolved descriptor
            if (!resolvedSegments.brandName) {
              const brand = fcDesc.brand || fcDesc.brandFeatures || fc.brand || fc.brandFeatures || {};
              resolvedSegments.brandName = brand.brandName || brand.name || '';
              resolvedSegments.brandCode = brand.brandCode || brand.code || '';
            }
          }
          return resolvedSegments;
        }

        // Extract fare details from pricingInformation for fare options (branded fares)
        const fareDetailsArr = sortedPricing.map((pi, piIdx) => {
          const piFare = pi.fare || {};
          const piFareTotals = extractFareTotals(piFare);
          const piPassengers = piFare.passengerInfoList || [];
          const piFareComponents = piPassengers[0]?.passengerInfo?.fareComponents || [];
          
          // Resolve segments from fareComponentDescs
          const resolvedSegs = resolveFareComponentSegments(piFareComponents);
          const firstSeg = resolvedSegs[0] || {};
          
          // Extract brand name
          let brandName = resolvedSegs.brandName || '';
          let brandCode = resolvedSegs.brandCode || '';
          if (!brandName) {
            for (const fc of piFareComponents) {
              const brand = fc.brand || fc.brandFeatures || {};
              brandName = brand.brandName || brand.name || brandName;
              brandCode = brand.brandCode || brand.code || brandCode;
              const fcRef = fc.ref ?? fc.id;
              if (!brandName && fcRef !== undefined) {
                const fcDesc = fareComponentDescs.find(d => d.id === fcRef);
                if (fcDesc) {
                  brandName = fcDesc.brandName || fcDesc.brand?.brandName || fcDesc.brand?.name || '';
                  brandCode = fcDesc.brandCode || fcDesc.brand?.brandCode || '';
                }
              }
            }
          }
          
          // Extract per-pax baggage for this fare option
          let piBaggage = checkedBaggageGlobal;
          let piHandBaggage = handBaggageGlobal;
          let mealIncluded = null; // null = unknown from BFM; 'available' = can be added via SSR
          let seatSelection = null; // null = unknown; 'available' = can be selected via seat map
          let isNonRefundable = true;

          for (const paxInfo of piPassengers) {
            const pInfo = paxInfo.passengerInfo || {};
            const bInfos = pInfo.baggageInformation || [];
            if (pInfo.nonRefundable === false) isNonRefundable = false;
            for (const bi of bInfos) {
              const allowance = bi.allowance || {};
              const ref = allowance.ref ?? allowance.Ref;
              const resolved = (ref !== undefined && baggageLookup[ref]) ? baggageLookup[ref] : allowance;
              const w = resolved.weight ?? resolved.Weight;
              const u = (resolved.unit ?? resolved.Unit) || 'KG';
              const pc = resolved.pieceCount ?? resolved.PieceCount ?? resolved.Pieces ?? resolved.pieces;
              const pt = bi.provisionType || '';
              let bStr = null;
              if (w) bStr = `${w}${String(u).toUpperCase()}`;
              else if (pc !== undefined) bStr = `${pc} Piece${pc > 1 ? 's' : ''}`;
              if (bStr) {
                if (pt === 'B' || pt === 'C') { if (!piHandBaggage) piHandBaggage = bStr; }
                else { piBaggage = bStr; }
              }
            }
          }

          // Extract penalty info for this pricing option
          const penInfos = piPassengers[0]?.passengerInfo?.penaltyInformation || [];
          let rebookingAllowed = true;
          let cancellationAllowed = !isNonRefundable;
          for (const pen of penInfos) {
            const cat = pen.cat || pen.category || '';
            if (cat === 'Exchange' || cat === 'Reissue') {
              rebookingAllowed = !(pen.details?.isNonChangeable);
            }
            if (cat === 'Refund' || cat === 'Cancel') {
              cancellationAllowed = !(pen.details?.isNonRefundable);
            }
          }

          // Extract seats for this fare option
          let piMinSeats = Infinity;
          for (const rs of resolvedSegs) {
            if (rs.seatsAvailable !== null && rs.seatsAvailable !== undefined) {
              const s = parseInt(rs.seatsAvailable);
              if (!isNaN(s) && s < piMinSeats) piMinSeats = s;
            }
          }

          // Derive bookingClass: prefer inline bookingCode, then first char of fareBasis (standard IATA), then cabin
          const rawBookingCode = firstSeg.bookingCode || '';
          const fareBasis = firstSeg.fareBasisCode || '';
          const derivedBookingClass = rawBookingCode 
            || (fareBasis ? fareBasis.charAt(0).toUpperCase() : '') 
            || '';

          return {
            fareBasis,
            bookingClass: derivedBookingClass,
            cabinClass: firstSeg.cabin || getCabinName(derivedBookingClass) || '',
            availableSeats: piMinSeats === Infinity ? null : piMinSeats,
            price: piFareTotals.total,
            baseFare: piFareTotals.baseFare,
            taxes: piFareTotals.taxes,
            currency: piFareTotals.currency || 'BDT',
            priceScope: 'itinerary',
            isTotalPrice: true,
            baggage: piBaggage,
            handBaggage: piHandBaggage,
            refundable: !isNonRefundable,
            brandName: brandName || '',
            brandCode: brandCode || '',
            // Sabre supports meal SSR and seat map for virtually all flights
            // If BFM didn't explicitly include/exclude, mark as 'available' (add-on)
            mealIncluded: mealIncluded === true ? true : 'available',
            seatSelection: seatSelection === true ? true : 'available',
            rebookingAllowed,
            cancellationAllowed,
          };
        });

        const itinLegs = itin.legs || [];
        const isMultiCityItin = (params.isMultiCity && itinLegs.length >= 2);
        
        if (isMultiCityItin) {
          // ── MULTI-CITY: Emit one combined flight object with all segment legs ──
          const allLegs = [];
          const segmentDetails = [];
          
          for (let legIdx = 0; legIdx < itinLegs.length; legIdx++) {
            const leg = itinLegs[legIdx];
            const legRef = leg.ref;
            const legDesc = legDescs.find(ld => ld.id === legRef) || {};
            const schedules = legDesc.schedules || [];
            const legDepartDate = groupDesc.legDescriptions?.[legIdx]?.departureDate || '';

            const segLegs = schedules.map((sched) => {
              const schedRef = sched.ref;
              const schedDesc = scheduleDescs.find(sd => sd.id === schedRef) || {};
              const dep = schedDesc.departure || sched.departure || {};
              const arr = schedDesc.arrival || sched.arrival || {};
              const carrier = schedDesc.carrier || {};

              let depDateTime = dep.dateTime || null;
              let arrDateTime = arr.dateTime || null;
              if (!depDateTime && dep.time && legDepartDate) {
                const depAdj = sched.departureDateAdjustment || 0;
                depDateTime = `${adjustDate(legDepartDate, depAdj)}T${dep.time}`;
              }
              if (!arrDateTime && arr.time && legDepartDate) {
                const arrAdj = sched.departureDateAdjustment || 0;
                const arrDateAdj = (arr.time < dep.time) ? arrAdj + 1 : arrAdj;
                arrDateTime = `${adjustDate(legDepartDate, arrDateAdj)}T${arr.time}`;
              }

              return {
                origin: dep.airport || '',
                destination: arr.airport || '',
                departureTime: depDateTime,
                arrivalTime: arrDateTime,
                durationMinutes: schedDesc.elapsedTime || 0,
                duration: formatDuration(schedDesc.elapsedTime || 0),
                flightNumber: `${carrier.marketing || carrier.operating || ''}${carrier.marketingFlightNumber || ''}`,
                airlineCode: carrier.marketing || carrier.operating || '',
                operatingAirline: carrier.operating || carrier.marketing || '',
                aircraft: carrier.equipment?.code || '',
                originTerminal: dep.terminal || '',
                destinationTerminal: arr.terminal || '',
                stops: [],
              };
            });

            if (segLegs.length === 0) continue;
            allLegs.push(...segLegs);

            const segFirst = segLegs[0];
            const segLast = segLegs[segLegs.length - 1];
            const segDuration = legDesc.elapsedTime || segLegs.reduce((s, l) => s + l.durationMinutes, 0);
            
            segmentDetails.push({
              segmentIndex: legIdx,
              origin: segFirst.origin,
              destination: segLast.destination,
              departureTime: segFirst.departureTime,
              arrivalTime: segLast.arrivalTime,
              duration: formatDuration(segDuration),
              durationMinutes: segDuration,
              stops: segLegs.length - 1,
              stopCodes: segLegs.length > 1 ? segLegs.slice(0, -1).map(l => l.destination) : [],
              airline: getAirlineName(segFirst.airlineCode),
              airlineCode: segFirst.airlineCode,
              flightNumber: segFirst.flightNumber,
              legs: segLegs,
              baggage: checkedBaggageGlobal,
              handBaggage: handBaggageGlobal,
              aircraft: segFirst.aircraft,
            });
          }

          if (allLegs.length === 0 || segmentDetails.length === 0) continue;

          const firstSeg = segmentDetails[0];
          const lastSeg = segmentDetails[segmentDetails.length - 1];

          let minSeats = Infinity;
          let bookingClass = '';
          const fareComponents = passengerInfoList[0]?.passengerInfo?.fareComponents || [];
          const mcResolvedSegs = resolveFareComponentSegments(fareComponents);
          for (const rs of mcResolvedSegs) {
            if (rs.seatsAvailable !== null && rs.seatsAvailable !== undefined) {
              const s = parseInt(rs.seatsAvailable);
              if (!isNaN(s) && s < minSeats) minSeats = s;
            }
            if (rs.bookingCode) bookingClass = rs.bookingCode;
          }

          const isRefundable = fare.passengerInfoList?.[0]?.passengerInfo?.nonRefundable === false;

          flights.push({
            id: `sabre-mc-${groupIdx}-${idx}`,
            source: 'sabre',
            direction: 'multicity',
            isMultiCity: true,
            segmentCount: segmentDetails.length,
            segments: segmentDetails,
            airline: firstSeg.airline,
            airlineCode: firstSeg.airlineCode,
            airlineLogo: null,
            flightNumber: segmentDetails.map(s => s.flightNumber).join(', '),
            origin: firstSeg.origin,
            destination: lastSeg.destination,
            departureTime: firstSeg.departureTime,
            arrivalTime: lastSeg.arrivalTime,
            duration: formatDuration(segmentDetails.reduce((s, seg) => s + seg.durationMinutes, 0)),
            durationMinutes: segmentDetails.reduce((s, seg) => s + seg.durationMinutes, 0),
            stops: segmentDetails.reduce((s, seg) => s + seg.stops, 0),
            stopCodes: segmentDetails.flatMap(s => s.stopCodes),
            cabinClass: getCabinName(fareComponents[0]?.segments?.[0]?.cabin?.cabin || 'Y'),
            bookingClass,
            availableSeats: minSeats === Infinity ? null : minSeats,
            price: totalAmount,
            baseFare: baseFareAmt,
            taxes: taxesAmt,
            currency,
            refundable: isRefundable,
            baggage: checkedBaggageGlobal,
            handBaggage: handBaggageGlobal,
            aircraft: firstSeg.aircraft,
            legs: allLegs,
            fareDetails: fareDetailsArr,
            paxPricing,
            timeLimit: fare.lastTicketDate || null,
            validatingAirline: fare.validatingCarrierCode || firstSeg.airlineCode,
            _sabreSeqNumber: `${groupIdx}-${idx}`,
          });
        } else {
          // ── ONE-WAY / ROUND-TRIP: per-leg emission (original logic) ──
          for (let legIdx = 0; legIdx < itinLegs.length; legIdx++) {
            const leg = itinLegs[legIdx];
            const legRef = leg.ref;
            const legDesc = legDescs.find(ld => ld.id === legRef) || {};
            const schedules = legDesc.schedules || [];

            const legDepartDate = groupDesc.legDescriptions?.[legIdx]?.departureDate || params.departDate || '';

            const legs = schedules.map((sched) => {
              const schedRef = sched.ref;
              const schedDesc = scheduleDescs.find(sd => sd.id === schedRef) || {};
              const dep = schedDesc.departure || sched.departure || {};
              const arr = schedDesc.arrival || sched.arrival || {};
              const carrier = schedDesc.carrier || {};

              let depDateTime = dep.dateTime || null;
              let arrDateTime = arr.dateTime || null;
              if (!depDateTime && dep.time && legDepartDate) {
                const depAdj = sched.departureDateAdjustment || 0;
                const depDate = adjustDate(legDepartDate, depAdj);
                depDateTime = `${depDate}T${dep.time}`;
              }
              if (!arrDateTime && arr.time && legDepartDate) {
                const arrAdj = sched.departureDateAdjustment || 0;
                const arrDateAdj = (schedDesc.elapsedTime && dep.time && arr.time) ? 
                  (arr.time < dep.time ? arrAdj + 1 : arrAdj) : arrAdj;
                const arrDate = adjustDate(legDepartDate, arrDateAdj);
                arrDateTime = `${arrDate}T${arr.time}`;
              }

              return {
                origin: dep.airport || '',
                destination: arr.airport || '',
                departureTime: depDateTime,
                arrivalTime: arrDateTime,
                durationMinutes: schedDesc.elapsedTime || 0,
                duration: formatDuration(schedDesc.elapsedTime || 0),
                flightNumber: `${carrier.marketing || carrier.operating || ''}${carrier.marketingFlightNumber || ''}`,
                airlineCode: carrier.marketing || carrier.operating || '',
                operatingAirline: carrier.operating || carrier.marketing || '',
                aircraft: carrier.equipment?.code || '',
                originTerminal: dep.terminal || '',
                destinationTerminal: arr.terminal || '',
                stops: [],
              };
            });

            if (legs.length === 0) continue;
            const firstLeg = legs[0];
            const lastLeg = legs[legs.length - 1];

            let totalDurationMin = legDesc.elapsedTime || legs.reduce((s, l) => s + l.durationMinutes, 0);
            const direction = legIdx === 0 ? 'outbound' : 'return';
            const pricePerDirection = itinLegs.length > 1 ? Math.round(totalAmount / itinLegs.length) : totalAmount;

            let minSeats = Infinity;
            let bookingClass = '';
            const fareComponents = passengerInfoList[0]?.passengerInfo?.fareComponents || [];
            
            // ── CRITICAL: Extract booking class PER-LEG, not from all fare components ──
            // Each fareComponent in Sabre grouped response corresponds to a specific OD leg.
            // fareComponents[0] = outbound, fareComponents[1] = return.
            // Using all segments causes the last (return) bookingCode to overwrite outbound,
            // and misses per-direction cheapest class resolution.
            const legFareComponents = fareComponents[legIdx] ? [fareComponents[legIdx]] : fareComponents;
            const owResolvedSegs = resolveFareComponentSegments(legFareComponents);
            for (const rs of owResolvedSegs) {
              if (rs.seatsAvailable !== null && rs.seatsAvailable !== undefined) {
                const s = parseInt(rs.seatsAvailable);
                if (!isNaN(s) && s < minSeats) minSeats = s;
              }
              if (rs.bookingCode) bookingClass = rs.bookingCode;
            }

            // Determine refundable status
            const isRefundable = fare.passengerInfoList?.[0]?.passengerInfo?.nonRefundable === false;

            // Extract cancellation/date change from fare penalties
            let cancellationPolicy = null;
            let dateChangePolicy = null;
            const penaltyInfos = fare.passengerInfoList?.[0]?.passengerInfo?.penaltyInformation || [];
            for (const pen of penaltyInfos) {
              const cat = pen.cat || pen.category || '';
              const details = pen.details || {};
              if (cat === 'Refund' || cat === 'Cancel') {
                cancellationPolicy = {
                  beforeDeparture: details.amount ? parseFloat(details.amount) : null,
                  afterDeparture: 'As per airline policy',
                  noShow: 'As per airline policy',
                  currency: details.currency || currency,
                  allowed: !details.isNonRefundable,
                };
              }
              if (cat === 'Exchange' || cat === 'Reissue') {
                dateChangePolicy = {
                  changeAllowed: !details.isNonChangeable,
                  changeFee: details.amount ? parseFloat(details.amount) : null,
                  currency: details.currency || currency,
                };
              }
            }

            flights.push({
              id: `sabre-g-${groupIdx}-${idx}-${legIdx}`,
              source: 'sabre',
              direction,
              isRoundTrip: itinLegs.length > 1,
              _itineraryId: `sabre-g-itin-${groupIdx}-${idx}`,
              airline: getAirlineName(firstLeg.airlineCode),
              airlineCode: firstLeg.airlineCode,
              airlineLogo: null,
              flightNumber: firstLeg.flightNumber,
              origin: firstLeg.origin,
              destination: lastLeg.destination,
              departureTime: firstLeg.departureTime,
              arrivalTime: lastLeg.arrivalTime,
              duration: formatDuration(totalDurationMin),
              durationMinutes: totalDurationMin,
              stops: legs.length - 1,
              stopCodes: legs.length > 1 ? legs.slice(0, -1).map(l => l.destination) : [],
              cabinClass: getCabinName(legFareComponents[0]?.segments?.[0]?.segment?.cabin?.cabin || legFareComponents[0]?.segments?.[0]?.cabin?.cabin || fareComponents[legIdx]?.segments?.[0]?.segment?.cabin?.cabin || fareComponents[0]?.segments?.[0]?.cabin?.cabin || 'Y'),
              bookingClass,
              availableSeats: minSeats === Infinity ? null : minSeats,
              price: pricePerDirection,
              baseFare: itinLegs.length > 1 ? Math.round(baseFareAmt / itinLegs.length) : baseFareAmt,
              taxes: itinLegs.length > 1 ? Math.round(taxesAmt / itinLegs.length) : taxesAmt,
              totalRoundTripPrice: itinLegs.length > 1 ? totalAmount : undefined,
              currency,
              refundable: isRefundable,
              baggage: checkedBaggageGlobal,
              handBaggage: handBaggageGlobal,
              aircraft: firstLeg.aircraft,
              legs,
              fareDetails: itinLegs.length > 1
                ? fareDetailsArr.map(fd => {
                    // Per-leg: override bookingClass with the resolved per-direction class
                    const legBookingClass = bookingClass || fd.bookingClass;
                    return {
                      ...fd,
                      bookingClass: legBookingClass,
                      price: Math.round((fd.price || 0) / itinLegs.length),
                      baseFare: Math.round((fd.baseFare || 0) / itinLegs.length),
                      taxes: Math.round((fd.taxes || 0) / itinLegs.length),
                      priceScope: 'per-direction',
                      isTotalPrice: false,
                    };
                  })
                : fareDetailsArr,
              paxPricing: itinLegs.length > 1
                ? paxPricing.map(pp => ({
                    ...pp,
                    baseFare: Math.round(pp.baseFare / itinLegs.length),
                    taxes: Math.round(pp.taxes / itinLegs.length),
                    total: Math.round(pp.total / itinLegs.length),
                    priceScope: 'per-direction',
                  }))
                : paxPricing,
              timeLimit: fare.lastTicketDate || null,
              cancellationPolicy,
              dateChangePolicy,
              validatingAirline: fare.validatingCarrierCode || firstLeg.airlineCode,
              _sabreSeqNumber: `${groupIdx}-${idx}`,
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('[Sabre] Grouped normalization error:', err.message, err.stack);
  }
  return flights;
}

// ── Helpers ──
function adjustDate(dateStr, days) {
  if (!days) return dateStr;
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m > 0 ? `${m}m` : ''}`.trim();
}

function getCabinName(code) {
  const map = { 'Y': 'Economy', 'S': 'Premium Economy', 'C': 'Business', 'J': 'Business', 'F': 'First', 'W': 'Premium Economy' };
  return map[code] || code || 'Economy';
}

function getAirlineName(code) {
  const names = {
    'EK': 'Emirates', 'QR': 'Qatar Airways', 'SQ': 'Singapore Airlines',
    'TG': 'Thai Airways', 'MH': 'Malaysia Airlines', 'TK': 'Turkish Airlines',
    'CX': 'Cathay Pacific', 'AI': 'Air India', 'SV': 'Saudi Arabian Airlines',
    'EY': 'Etihad Airways', 'LH': 'Lufthansa', 'BA': 'British Airways',
    'AF': 'Air France', 'KL': 'KLM', 'LO': 'LOT Polish Airlines',
    'SK': 'SAS', 'ET': 'Ethiopian Airlines', 'WY': 'Oman Air',
    'GF': 'Gulf Air', 'PG': 'Bangkok Airways', 'OZ': 'Asiana Airlines',
    'KE': 'Korean Air', 'NH': 'ANA', 'JL': 'Japan Airlines',
    'AA': 'American Airlines', 'UA': 'United Airlines', 'DL': 'Delta',
    'AC': 'Air Canada', 'FZ': 'flydubai', 'G9': 'Air Arabia',
    'UL': 'SriLankan Airlines', '6E': 'IndiGo', 'BG': 'Biman Bangladesh',
    'BS': 'US-Bangla Airlines', 'VQ': 'Novoair', '2A': 'Air Astra',
    'S2': 'Air Astra', 'RX': 'Regent Airways', 'PK': 'PIA',
    'BR': 'EVA Air', 'CI': 'China Airlines', 'CA': 'Air China',
    'MU': 'China Eastern', 'CZ': 'China Southern', 'GA': 'Garuda Indonesia',
    'VN': 'Vietnam Airlines', 'QF': 'Qantas', 'NZ': 'Air New Zealand',
    'PR': 'Philippine Airlines', 'AK': 'AirAsia', 'FR': 'Ryanair',
    'U2': 'easyJet', 'W6': 'Wizz Air', 'IB': 'Iberia',
    'AY': 'Finnair', 'LX': 'SWISS', 'OS': 'Austrian Airlines',
    'W5': 'Mahan Air', 'HU': 'Hainan Airlines', 'WS': 'WestJet',
  };
  return names[code] || code || 'Unknown';
}

function formatSabreApplicationErrors(applicationResults) {
  const normalized = [];

  const pushValue = (value) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) normalized.push(trimmed);
      return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      normalized.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(pushValue);
      return;
    }
    if (typeof value === 'object') {
      if (value?.code) normalized.push(`code=${value.code}`);
      if (value?.type) normalized.push(`type=${value.type}`);
      pushValue(value?.Message);
      pushValue(value?.ShortText);
      pushValue(value?.SystemSpecificResults);
      pushValue(value?.Error);
      pushValue(value?.Warning);
    }
  };

  pushValue(applicationResults?.Error);
  pushValue(applicationResults?.Warning);

  const deduped = [...new Set(normalized.map((item) => String(item).trim()).filter(Boolean))];
  return deduped.join(' | ');
}

function extractSabreCreateRejectionMessage(response) {
  const rs = response?.CreatePassengerNameRecordRS || {};
  const appStatus = rs?.ApplicationResults?.status || '';
  if (appStatus !== 'NotProcessed' && appStatus !== 'Incomplete') return '';

  const parsed = formatSabreApplicationErrors(rs?.ApplicationResults);
  return parsed || `status=${appStatus}`;
}

function extractSabrePnrFromCreateResponse(response) {
  const rs = response?.CreatePassengerNameRecordRS || {};

  // CRITICAL: Check ApplicationResults status FIRST — if NotProcessed, the PNR was never created
  const appStatus = rs?.ApplicationResults?.status || '';
  if (appStatus === 'NotProcessed' || appStatus === 'Incomplete') {
    const errMsgs = extractSabreCreateRejectionMessage(response);
    console.error(`[Sabre] CreatePNR REJECTED by GDS: status=${appStatus} errors=${errMsgs || 'UNKNOWN'}`);
    return null;
  }

  const itineraryRefs = [
    rs?.ItineraryRef,
    rs?.TravelItineraryRead?.TravelItinerary?.ItineraryRef,
    rs?.TravelItineraryRead?.ItineraryRef,
    response?.ItineraryRef,
  ];

  const pnrCandidates = [
    rs?.ItineraryRef?.ID,
    rs?.ItineraryRef?.id,
    rs?.ItineraryRef?.Id,
    rs?.TravelItineraryRead?.TravelItinerary?.ItineraryRef?.ID,
    rs?.TravelItineraryRead?.TravelItinerary?.ItineraryRef?.id,
    rs?.TravelItineraryRead?.TravelItinerary?.ItineraryRef?.Id,
    rs?.TravelItineraryRead?.ItineraryRef?.ID,
    rs?.TravelItineraryRead?.ItineraryRef?.id,
    rs?.TravelItineraryRead?.ItineraryRef?.Id,
    response?.RecordLocator,
    response?.PNR,
    response?.BookingReference,
    response?.Locator,
  ];

  itineraryRefs.forEach((ref) => {
    if (!ref || typeof ref !== 'object') return;
    pnrCandidates.push(ref.RecordLocator, ref.BookingReference, ref.Locator, ref.ID, ref.id, ref.Id);
  });

  const deepCandidates = [];
  const visited = new Set();
  const stack = [response];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (visited.has(node)) continue;
    visited.add(node);

    if (Array.isArray(node)) {
      node.forEach((item) => stack.push(item));
      continue;
    }

    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') {
        stack.push(v);
        continue;
      }
      if (typeof v !== 'string') continue;
      if (/(recordlocator|bookingreference|locator|confirmationid|pnr)$/i.test(k)) {
        deepCandidates.push(v);
      }
    }
  }

  const allCandidates = [...pnrCandidates, ...deepCandidates];
  return allCandidates.find((value) => {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    return /^[A-Z0-9]{5,8}$/i.test(trimmed);
  }) || null;
}

function extractDistinctSabreAirlinePnr(payload, gdsPnr) {
  const gds = String(gdsPnr || '').trim().toUpperCase();
  const candidates = [];
  const stack = [payload];
  const visited = new Set();

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (visited.has(node)) continue;
    visited.add(node);

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
      
      // Standard named fields for airline PNR
      if (/(vendorlocator|airlinelocator|airlinepnr|reservationnumber|confirmationnumber|vendorconfirmation|supplierlocator|otherpnr|supplierref|airlineconfirmation|operatingairlineconfirmation)/i.test(key)) {
        const code = value.trim().toUpperCase();
        if (/^[A-Z0-9]{5,20}$/.test(code)) {
          candidates.push(code);
        }
      }
      
      // Extract airline PNR from /DCBS*09HUEY or /DCAI*FCQGEC patterns
      // This appears in segment reference fields (e.g., "DC" prefix with airline code + * + confirmation)
      if (typeof value === 'string') {
        const dcMatch = value.match(/\/DC[A-Z]{2}\*([A-Z0-9]{4,8})/i);
        if (dcMatch) {
          candidates.push(dcMatch[1].toUpperCase());
        }
      }
    }
  }

  return candidates.find((code) => code !== gds) || null;
}

function logSabreCreatePnrDebug(response) {
  console.log('[Sabre] CreatePNR response keys:', JSON.stringify(Object.keys(response || {})));
  const rs = response?.CreatePassengerNameRecordRS;

  if (!rs) {
    console.log('[Sabre] CreatePNR raw (truncated):', JSON.stringify(response).slice(0, 1000));
    return;
  }

  console.log('[Sabre] RS keys:', JSON.stringify(Object.keys(rs)));
  if (rs.ApplicationResults) {
    console.log('[Sabre] ApplicationResults status:', rs.ApplicationResults.status);
    if (rs.ApplicationResults.Error) {
      console.log('[Sabre] RS Errors:', JSON.stringify(rs.ApplicationResults.Error).slice(0, 800));
    }
    if (rs.ApplicationResults.Warning) {
      console.log('[Sabre] RS Warnings:', JSON.stringify(rs.ApplicationResults.Warning).slice(0, 800));
    }
  }
  if (rs.ItineraryRef) {
    console.log('[Sabre] ItineraryRef:', JSON.stringify(rs.ItineraryRef));
  }
}

/**
 * Create a PNR in Sabre using CreatePassengerNameRecordRQ
 * Supports SSR: meals, wheelchair, medical, pets, UMNR, FF#, DOCS/DOCA
 */
async function createBooking({ flightData, passengers, contactInfo, specialServices }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  console.log('[Sabre] ═══════════════════════════════════════════════════');
  console.log('[Sabre] Creating PNR for', flightData?.origin, '→', flightData?.destination);
  console.log('[Sabre] Environment:', config.environment, '| BaseURL:', config.baseUrl);
  console.log('[Sabre] PCC:', config.pcc, '| EPR:', config.epr);
  console.log('[Sabre] Passengers:', passengers?.length, '| Legs:', flightData?.legs?.length || 0);
  console.log('[Sabre] Airline:', flightData?.airlineCode, '| Flight:', flightData?.flightNumber);
  console.log('[Sabre] IsMultiCity:', !!flightData?.isMultiCity, '| Source:', flightData?.source);

  try {
    const paxSegments = [];
    const rawLegs = flightData?.legs || [];
    // Flatten nested legs: multi-city or round-trip items may have their own sub-legs
    const flatLegs = [];
    for (const leg of rawLegs) {
      if (leg?.legs?.length > 0) {
        flatLegs.push(...leg.legs);
      } else {
        flatLegs.push(leg);
      }
    }
    const segs = flatLegs.length > 0 ? flatLegs : [flightData];
    console.log(`[Sabre] Creating PNR with ${segs.length} segment(s):`);
    segs.forEach((s, i) => console.log(`[Sabre]   Seg ${i+1}: ${s.airlineCode || flightData.airlineCode}${s.flightNumber || ''} ${s.origin || '?'}→${s.destination || '?'} ${s.departureTime || '?'}`));

    const toSabreDateTime = (value) => {
      if (!value) return '';
      const raw = String(value).trim();

      // Convert ISO/offset datetime to schema-safe format: YYYY-MM-DDTHH:mm:ss (no timezone suffix)
      const m = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
      if (m) return `${m[1]}T${m[2]}:00`;

      // If already in MM-DDTHH:mm style, keep as-is for Sabre compatibility
      const shortM = raw.match(/^(\d{2}-\d{2})[T\s](\d{2}:\d{2})(?::\d{2})?$/);
      if (shortM) return `${shortM[1]}T${shortM[2]}`;

      return raw.replace('Z', '').split('.')[0].replace(/[+-]\d{2}:?\d{2}$/, '');
    };

    // NumberInParty = total passengers including infants (per verified Sabre payload)
    const totalPaxCount = passengers.length;

    // Resolve booking class from parent flight data as fallback for legs that lack it
    const parentBookingClass = flightData?.bookingClass 
      || flightData?.fareDetails?.[0]?.bookingClass 
      || '';

    segs.forEach((seg) => {
      const departureDateTime = toSabreDateTime(seg.departureTime);
      const arrivalDateTime = toSabreDateTime(seg.arrivalTime);
      const numericFlightNumber = String(seg.flightNumber || '').replace(/\D/g, '');
      const rbd = seg.bookingClass || parentBookingClass || 'Y';
      console.log(`[Sabre] Segment ${seg.origin || '?'}→${seg.destination || '?'} RBD: ${rbd} (seg: ${seg.bookingClass || 'none'}, parent: ${parentBookingClass || 'none'})`);

      paxSegments.push({
        DepartureDateTime: departureDateTime,
        ArrivalDateTime: arrivalDateTime,
        FlightNumber: numericFlightNumber,
        NumberInParty: String(Math.max(totalPaxCount, 1)),
        ResBookDesigCode: rbd,
        Status: 'NN',
        OriginLocation: { LocationCode: seg.origin || flightData.origin },
        DestinationLocation: { LocationCode: seg.destination || flightData.destination },
        MarketingAirline: { Code: seg.airlineCode || flightData.airlineCode, FlightNumber: numericFlightNumber },
      });
    });

    // Per verified Sabre payload: all passengers (ADT/CHD/INF) are plain PersonName entries

    // Per verified Sabre payload (SABRE_PAYLOADS.md §4c):
    // - ALL passengers (adult, child, infant) get their own PersonName entry
    // - NO PassengerType field on PersonName
    // - NO Infant field on adult PersonName
    // - Infant gender is handled via DOCS (MI/FI)
    const travelersInfo = passengers.map((p, i) => {
      const paxType = (p.type || p.passengerType || 'adult').toLowerCase();
      const rawTitle = (p.title || p.prefix || '').toUpperCase().replace(/\./g, '');
      let title = rawTitle;

      // Child/Infant title rules per Sabre standard
      if (paxType === 'child' || paxType === 'cnn') {
        const gender = (p.gender || '').toLowerCase();
        title = (gender === 'female' || gender === 'f' || ['MS', 'MRS', 'MISS'].includes(rawTitle)) ? 'MISS' : 'MSTR';
      } else if (paxType === 'infant' || paxType === 'inf') {
        const gender = (p.gender || '').toLowerCase();
        title = (gender === 'female' || gender === 'f' || ['MS', 'MRS', 'MISS'].includes(rawTitle)) ? 'MISS' : 'MSTR';
      }

      const givenName = (p.firstName || p.givenName || '').toUpperCase();
      const personName = {
        NameNumber: `${i + 1}.1`,
        GivenName: title ? `${givenName} ${title}` : givenName,
        Surname: (p.lastName || p.surname || '').toUpperCase(),
      };

      console.log(`[Sabre] Pax ${i + 1}: ${paxType} | ${personName.GivenName} ${personName.Surname}`);

      return { PersonName: personName };
    });

    // ── Build SSR (Special Service Requests) ──
    const ssrList = [];
    const advancePassenger = [];
    const ss = specialServices || {};

    passengers.forEach((pax, i) => {
      const nameNumber = `${i + 1}.1`;
      const paxSS = ss.perPassenger?.[i] || {};
      const airlineCode = flightData?.airlineCode || segs[0]?.airlineCode || '';

      // Meal SSR (VGML, MOML, AVML, KSML, DBML, CHML, SFML, FPML, BBML, GFML, LCML, NLML, RVML, SPML)
      if (paxSS.meal && paxSS.meal !== 'none' && paxSS.meal !== 'standard') {
        ssrList.push({
          SSRCode: paxSS.meal,
          AirlineCode: airlineCode,
          Text: `${paxSS.meal}-${(pax.firstName || '').toUpperCase()}/${(pax.lastName || '').toUpperCase()}`,
          PersonName: { NameNumber: nameNumber },
          SegmentNumber: 'A', // All segments
        });
      }

      // Wheelchair SSR (WCHR, WCHS, WCHC)
      if (paxSS.wheelchair && paxSS.wheelchair !== 'none') {
        ssrList.push({
          SSRCode: paxSS.wheelchair,
          AirlineCode: airlineCode,
          Text: `${(pax.firstName || '').toUpperCase()}/${(pax.lastName || '').toUpperCase()}`,
          PersonName: { NameNumber: nameNumber },
          SegmentNumber: 'A',
        });
      }

      // Medical SSR (MEDA)
      if (paxSS.medical) {
        ssrList.push({
          SSRCode: 'MEDA',
          AirlineCode: airlineCode,
          Text: paxSS.medicalDetails || `MEDICAL ASSISTANCE REQUIRED-${(pax.lastName || '').toUpperCase()}`,
          PersonName: { NameNumber: nameNumber },
          SegmentNumber: 'A',
        });
      }

      // Blind passenger (BLND)
      if (paxSS.blind) {
        ssrList.push({
          SSRCode: 'BLND',
          AirlineCode: airlineCode,
          Text: `BLIND PASSENGER-${(pax.lastName || '').toUpperCase()}`,
          PersonName: { NameNumber: nameNumber },
          SegmentNumber: 'A',
        });
      }

      // Deaf passenger (DEAF)
      if (paxSS.deaf) {
        ssrList.push({
          SSRCode: 'DEAF',
          AirlineCode: airlineCode,
          Text: `DEAF PASSENGER-${(pax.lastName || '').toUpperCase()}`,
          PersonName: { NameNumber: nameNumber },
          SegmentNumber: 'A',
        });
      }

      // Unaccompanied Minor (UMNR)
      if (paxSS.unaccompaniedMinor) {
        ssrList.push({
          SSRCode: 'UMNR',
          AirlineCode: airlineCode,
          Text: paxSS.umnrDetails || `UM${paxSS.umnrAge || '10'}-${(pax.lastName || '').toUpperCase()}`,
          PersonName: { NameNumber: nameNumber },
          SegmentNumber: 'A',
        });
      }

      // Pet in Cabin (PETC) or Pet in Hold (AVIH)
      if (paxSS.pet && paxSS.pet !== 'none') {
        ssrList.push({
          SSRCode: paxSS.pet, // PETC or AVIH
          AirlineCode: airlineCode,
          Text: paxSS.petDetails || `PET-${paxSS.pet === 'PETC' ? 'CABIN' : 'CARGO'}`,
          PersonName: { NameNumber: nameNumber },
          SegmentNumber: 'A',
        });
      }

      // Extra Baggage SSR (XBAG) — for non-ancillary based extra bags
      if (paxSS.extraBaggage) {
        ssrList.push({
          SSRCode: 'XBAG',
          AirlineCode: airlineCode,
          Text: `${paxSS.extraBaggage}KG EXTRA BAGGAGE`,
          PersonName: { NameNumber: nameNumber },
          SegmentNumber: 'A',
        });
      }

      // Frequent Flyer (FQTV)
      if (paxSS.frequentFlyer?.number) {
        ssrList.push({
          SSRCode: 'FQTV',
          AirlineCode: paxSS.frequentFlyer.airline || airlineCode,
          Text: `${paxSS.frequentFlyer.airline || airlineCode}${paxSS.frequentFlyer.number}`,
          PersonName: { NameNumber: nameNumber },
          SegmentNumber: 'A',
        });
      }

      // Free-text special request (OSI)
      if (paxSS.specialRequest?.trim()) {
        ssrList.push({
          SSRCode: 'OTHS',
          AirlineCode: airlineCode,
          Text: paxSS.specialRequest.trim().substring(0, 70).toUpperCase(),
          PersonName: { NameNumber: nameNumber },
          SegmentNumber: 'A',
        });
      }

      // ── CTCM (Mobile Contact SSR) — Required by many airlines ──
      const paxPhone = contactInfo?.phone || contactInfo?.contactPhone || pax.phone || '';
      if (paxPhone) {
        // Split phone: remove leading + and country code for E164 format
        const cleanPhone = paxPhone.replace(/[\s\-\(\)]/g, '');
        let phoneForSSR = cleanPhone.replace(/^\+/, '');
        // If starts with 880, keep as-is (already E164 without +)
        // If starts with 0, prepend 880 (Bangladesh local)
        if (phoneForSSR.startsWith('0')) phoneForSSR = '880' + phoneForSSR.substring(1);
        ssrList.push({
          SSRCode: 'CTCM',
          Text: phoneForSSR,
          PersonName: { NameNumber: nameNumber },
          SegmentNumber: 'A',
        });
      }

      // ── CTCE (Email Contact SSR) — Required by many airlines ──
      const paxEmail = contactInfo?.email || contactInfo?.contactEmail || pax.email || '';
      if (paxEmail) {
        // Sabre CTCE format: replace @ with // and . with ..
        const emailForSSR = paxEmail.toUpperCase().replace('@', '//').replace(/\./g, '..');
        ssrList.push({
          SSRCode: 'CTCE',
          Text: emailForSSR,
          PersonName: { NameNumber: nameNumber },
          SegmentNumber: 'A',
        });
      }

      // DOCS — Passport/Travel Document (full fields required by Sabre)
      const rawPassportField = typeof pax.passport === 'string' ? pax.passport.trim() : '';
      const passportLooksLikeFilePath = /[\\/]/.test(rawPassportField) || /\.(jpg|jpeg|png|pdf|webp)$/i.test(rawPassportField);
      const passportNumberSource = [
        pax.passportNumber,
        pax.passportNo,
        pax.documentNumber,
        pax.travelDocumentNumber,
        !passportLooksLikeFilePath ? rawPassportField : '',
      ].find((val) => val !== undefined && val !== null && String(val).trim() !== '');

      const passportNo = passportNumberSource ? String(passportNumberSource).trim().toUpperCase() : '';
      const passportExpiry = pax.passportExpiry || pax.passportEx || pax.documentExpiry || pax.expiryDate || '';

      if (rawPassportField && passportLooksLikeFilePath && !pax.passportNumber && !pax.passportNo) {
        console.warn(`[Sabre] Pax ${i + 1}: passport field looks like upload path, not passport number (${rawPassportField})`);
      }

      if (passportNo) {
        // Sabre ExpirationDate schema requires YYYY-MM-DD format
        let expiryFormatted = '';
        if (passportExpiry) {
          const raw = String(passportExpiry).replace(/['"]/g, '').trim();
          console.log(`[Sabre] DOCS ExpirationDate raw='${raw}' for pax ${i + 1}`);
          if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            expiryFormatted = raw;
          } else if (/^\d{8}$/.test(raw)) {
            expiryFormatted = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
          } else if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(raw)) {
            const parts = raw.split(/[\/\-]/);
            expiryFormatted = `${parts[2]}-${parts[1]}-${parts[0]}`;
          } else {
            const d = new Date(raw);
            if (!isNaN(d.getTime())) {
              expiryFormatted = d.toISOString().slice(0, 10);
            }
          }
          console.log(`[Sabre] DOCS ExpirationDate formatted='${expiryFormatted}'`);
        }

        if (!expiryFormatted) {
          throw new Error(`Missing or invalid passport expiry for passenger ${i + 1}`);
        }

        // DOB formatting
        let dobFormatted = '';
        const dobRaw = pax.dateOfBirth || pax.dob || '';
        if (dobRaw) {
          const rawDob = String(dobRaw).replace(/['"]/g, '').trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(rawDob)) {
            dobFormatted = rawDob;
          } else {
            const d = new Date(rawDob);
            if (!isNaN(d.getTime())) dobFormatted = d.toISOString().slice(0, 10);
          }
        }

        // Gender mapping: M/F/MI(male infant)/FI(female infant)
        const genderRaw = (pax.gender || pax.sex || '').toUpperCase();
        let genderCode = 'M'; // default
        if (genderRaw.startsWith('F') || genderRaw === 'FEMALE') genderCode = 'F';
        const paxType = (pax.type || pax.passengerType || '').toUpperCase();
        if (paxType === 'INF' || paxType === 'INFANT') {
          genderCode = genderCode === 'F' ? 'FI' : 'MI';
        }

        // Country extraction from source payload style (e.g. "Bangladesh,BD,BGD")
        // Keep only explicit ISO2 token from provided values.
        const extractIso2Country = (value) => {
          const raw = String(value || '').trim();
          if (!raw) return '';

          const parts = raw.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
          for (const part of parts) {
            if (/^[A-Z]{2}$/.test(part)) return part;
          }

          const compact = raw.toUpperCase().replace(/[^A-Z]/g, '');
          return /^[A-Z]{2}$/.test(compact) ? compact : '';
        };

        const docCountry =
          extractIso2Country(
            pax.documentCountry ||
            pax.issueCountry ||
            pax.passportCountry ||
            pax.passportIssueCountry
          ) || '';

        const nationality =
          extractIso2Country(
            pax.nationalityCountry ||
            pax.nationality ||
            pax.citizenshipCountry ||
            pax.countryCode ||
            pax.documentCountry
          ) ||
          docCountry ||
          'BD';

        const issueCountry = docCountry || nationality;

        // Full DOCS payload — Document contains ONLY document fields;
        // personal fields go under PersonName (per Sabre v2.4.0 schema)
        const docPayload = {
          Type: 'P',
          Number: passportNo,
          ExpirationDate: expiryFormatted,
          IssueCountry: issueCountry,
          NationalityCountry: nationality,
        };

        console.log(`[Sabre] DOCS pax ${i + 1}: ${docPayload.Number} | exp=${docPayload.ExpirationDate} | dob=${dobFormatted || 'N/A'} | gender=${genderCode} | nat=${nationality}`);

        advancePassenger.push({
          Document: docPayload,
          PersonName: {
            NameNumber: nameNumber,
            ...(dobFormatted ? { DateOfBirth: dobFormatted } : {}),
            Gender: genderCode,
            GivenName: String(pax.firstName || pax.givenName || '').toUpperCase(),
            Surname: String(pax.lastName || pax.surname || '').toUpperCase(),
          },
          SegmentNumber: 'A',
          VendorPrefs: { Airline: { Hosted: false } },
        });
      }

      // DOCA — Destination Address (if provided)
      if (paxSS.destinationAddress?.trim()) {
        advancePassenger.push({
          Document: {
            Type: 'A',
            Text: paxSS.destinationAddress.trim().substring(0, 99).toUpperCase(),
          },
          PersonName: { NameNumber: nameNumber },
          SegmentNumber: 'A',
        });
      }
    });

    const body = {
      CreatePassengerNameRecordRQ: {
        targetCity: config.pcc,
        TravelItineraryAddInfo: {
          AgencyInfo: { Ticketing: { TicketType: '7TAW' } },
          CustomerInfo: {
            ContactNumbers: {
              ContactNumber: (() => {
                const rawPhone = contactInfo?.phone || contactInfo?.contactPhone || '01700000000';
                const clean = rawPhone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');
                let phoneNum = clean;
                // If starts with 880, strip it for local number
                if (clean.startsWith('880')) {
                  phoneNum = '0' + clean.substring(3);
                }
                return [{
                  Phone: phoneNum,
                  PhoneUseType: 'H',
                }];
              })(),
            },
            Email: [{ Address: contactInfo?.email || contactInfo?.contactEmail || '', Type: 'TO' }],
            PersonName: travelersInfo.map(t => t.PersonName),
          },
        },
        AirBook: {
          HaltOnStatus: [{ Code: 'NN' }, { Code: 'UC' }, { Code: 'US' }, { Code: 'UN' }],
          OriginDestinationInformation: {
            FlightSegment: paxSegments,
          },
        },
        PostProcessing: {
          EndTransaction: { Source: { ReceivedFrom: 'SEVEN TRIP API' } },
        },
      },
    };

    // Inject SSR and DOCS/DOCA into SpecialReqDetails
    if (ssrList.length > 0 || advancePassenger.length > 0) {
      const specialServiceInfo = {};

      if (ssrList.length > 0) {
        specialServiceInfo.Service = ssrList.map(ssr => ({
          SSR_Code: ssr.SSRCode,
          ...(ssr.AirlineCode ? { VendorPrefs: { Airline: { Code: ssr.AirlineCode } } } : {}),
          Text: ssr.Text,
          PersonName: ssr.PersonName,
          SegmentNumber: ssr.SegmentNumber,
        }));
        console.log(`[Sabre] Adding ${ssrList.length} SSR(s): ${ssrList.map(s => s.SSRCode).join(', ')}`);
      }

      body.CreatePassengerNameRecordRQ.SpecialReqDetails = {
        SpecialService: {
          SpecialServiceInfo: specialServiceInfo,
        },
      };

      // DOCS/DOCA go under SpecialService.SpecialServiceInfo.AdvancePassenger
      if (advancePassenger.length > 0) {
        specialServiceInfo.AdvancePassenger = advancePassenger;
        console.log(`[Sabre] Adding ${advancePassenger.length} DOCS/DOCA entries`);
      }
    }

    const toSchemaSafeDocsBody = (inputBody, options = {}) => {
      const { stripPersonalFields = false } = options;
      const cloned = JSON.parse(JSON.stringify(inputBody));
      const advancePax = cloned?.CreatePassengerNameRecordRQ?.SpecialReqDetails?.SpecialService?.SpecialServiceInfo?.AdvancePassenger;

      if (!Array.isArray(advancePax)) return cloned;

      advancePax.forEach((entry) => {
        if (entry?.Document?.Type !== 'P') return;
        // Strip optional Document fields that some schemas reject
        const document = entry.Document;
        entry.Document = {
          Type: document.Type,
          Number: document.Number,
          ExpirationDate: document.ExpirationDate,
          ...(document.IssueCountry ? { IssueCountry: document.IssueCountry } : {}),
        };
        if (stripPersonalFields && entry.PersonName) {
          // Keep only NameNumber
          entry.PersonName = { NameNumber: entry.PersonName.NameNumber };
        }
      });

      return cloned;
    };

    const requestVariants = [{
      label: 'full_payload',
      body,
    }];

    if (advancePassenger.length > 0) {
      // Variant 2: Strip NationalityCountry from Document (keep PersonName fields)
      requestVariants.push({
        label: 'full_payload_docs_minimal',
        body: toSchemaSafeDocsBody(body),
      });

      // Variant 3: Strip NationalityCountry + strip PersonName personal fields
      requestVariants.push({
        label: 'full_payload_docs_bare',
        body: toSchemaSafeDocsBody(body, { stripPersonalFields: true }),
      });

      // Variant 4: DOCS-only (no SSR) with minimal Document
      const bodyDocsOnly = toSchemaSafeDocsBody(body);
      const specialServiceInfo2 = bodyDocsOnly?.CreatePassengerNameRecordRQ?.SpecialReqDetails?.SpecialService?.SpecialServiceInfo;
      if (specialServiceInfo2?.Service) {
        delete specialServiceInfo2.Service;
      }
      requestVariants.push({
        label: 'docs_only_no_ssr',
        body: bodyDocsOnly,
      });
    }

    const hasPassportDocs = advancePassenger.some((entry) => entry?.Document?.Type === 'P');

    // Final fallback: no SpecialReqDetails at all.
    // Keep DOCS-first attempts above, but if Sabre rejects every DOCS variant,
    // attempt PNR creation without SSR/DOCS to avoid hard checkout failure.
    const bodyNoSpecial = JSON.parse(JSON.stringify(body));
    delete bodyNoSpecial.CreatePassengerNameRecordRQ.SpecialReqDetails;
    requestVariants.push({
      label: hasPassportDocs ? 'no_special_req_force' : 'no_special_req',
      body: bodyNoSpecial,
    });

    if (hasPassportDocs) {
      console.warn('[Sabre] DOCS strict mode enabled, but emergency fallback no_special_req_force is queued as last attempt');
    }

    let finalResponse = null;
    let finalPnr = null;
    let finalErrorMessage = '';
    let successfulVariant = '';

    for (let attemptIndex = 0; attemptIndex < requestVariants.length; attemptIndex += 1) {
      const variant = requestVariants[attemptIndex];

      try {
        console.log(`[Sabre] ── CreatePNR attempt ${attemptIndex + 1}/${requestVariants.length}: ${variant.label} ──`);
        console.log(`[Sabre] Request segments:`, JSON.stringify(variant.body?.CreatePassengerNameRecordRQ?.AirBook?.OriginDestinationInformation?.FlightSegment?.map(s => `${s.MarketingAirline?.Code}${s.MarketingAirline?.FlightNumber} ${s.OriginLocation?.LocationCode}→${s.DestinationLocation?.LocationCode} ${s.DepartureDateTime}`) || []));
        console.log(`[Sabre] Request passengers:`, JSON.stringify(variant.body?.CreatePassengerNameRecordRQ?.TravelItineraryAddInfo?.CustomerInfo?.PersonName?.map(p => `${p.GivenName} ${p.Surname}`) || []));
        
        const hasDocs = !!variant.body?.CreatePassengerNameRecordRQ?.SpecialReqDetails?.SpecialService?.SpecialServiceInfo?.AdvancePassenger;
        const hasSSR = !!variant.body?.CreatePassengerNameRecordRQ?.SpecialReqDetails?.SpecialService?.SpecialServiceInfo?.Service;
        console.log(`[Sabre] Has DOCS: ${hasDocs} | Has SSR: ${hasSSR}`);

        const response = await sabreRequest(config, '/v2.4.0/passenger/records?mode=create', variant.body, 'POST', 60000);
        finalResponse = response;
        logSabreCreatePnrDebug(response);

        const pnr = extractSabrePnrFromCreateResponse(response);
        if (pnr) {
          finalPnr = pnr;
          successfulVariant = variant.label;
          console.log(`[Sabre] ✓ PNR created via ${variant.label}: ${pnr}`);
          break;
        }

        // No PNR extracted — try next variant
        const rejectionMessage = extractSabreCreateRejectionMessage(response);
        finalErrorMessage = rejectionMessage
          ? `${variant.label}: ${rejectionMessage}`
          : `No PNR returned from ${variant.label}`;
        console.warn(`[Sabre] ${finalErrorMessage}`);
        console.warn(`[Sabre] Response keys:`, JSON.stringify(Object.keys(response || {})));
        if (attemptIndex < requestVariants.length - 1) {
          console.warn(`[Sabre] Retrying with next variant: ${requestVariants[attemptIndex + 1].label}`);
        }
        // loop continues to next variant automatically
      } catch (err) {
        finalErrorMessage = err.message;
        console.error(`[Sabre] ✗ CreatePNR attempt failed (${variant.label}):`, err.message);

        const shouldRetry = /VALIDATION_FAILED|NotProcessed|AdvancePassenger|SpecialReqDetails|Document|PersonName|NamePrefix|not allowed|UNABLE TO PROCESS|FORMAT|INVALID|CHECK FLIGHT/i.test(err.message || '');
        if (shouldRetry && attemptIndex < requestVariants.length - 1) {
          console.warn(`[Sabre] Retrying CreatePNR with fallback payload: ${requestVariants[attemptIndex + 1].label}`);
          // loop continues to next variant
        } else {
          console.error(`[Sabre] No more fallback variants — booking failed`);
          break;
        }
      }
    }

    if (!finalPnr) {
      return {
        success: false,
        error: finalErrorMessage || 'Sabre CreatePNR did not return a valid record locator',
        pnr: null,
        rawResponse: finalResponse,
      };
    }

    console.log(`[Sabre] PNR created (${successfulVariant || 'unknown_variant'}):`, finalPnr);

    // Extract ticket time limit from Sabre response
    let ticketTimeLimit = null;
    const rs = finalResponse?.CreatePassengerNameRecordRS || {};
    const airBook = rs?.AirBook || {};
    const itinRef = rs?.ItineraryRef || {};

    // Sabre returns ticketing deadline in multiple possible locations
    const candidates = [
      itinRef?.TicketingDeadline,
      itinRef?.Source?.ReceivedFrom,
      airBook?.OriginDestinationOption?.[0]?.FlightSegment?.[0]?.TicketingInfo?.TicketTimeLimit,
      rs?.TravelItineraryRead?.TravelItinerary?.ItineraryInfo?.Ticketing?.[0]?.TicketTimeLimit,
      rs?.TravelItineraryRead?.TravelItinerary?.ItineraryInfo?.Ticketing?.[0]?.eTicketNumber,
    ];

    // Also check AirBook segments for LastTicketingDate
    const segments = airBook?.OriginDestinationOption || airBook?.FlightSegment || [];
    const segArr = Array.isArray(segments) ? segments : [segments];
    segArr.forEach(seg => {
      const fs = seg?.FlightSegment || seg;
      const fsArr = Array.isArray(fs) ? fs : [fs];
      fsArr.forEach(f => {
        if (f?.TicketingInfo?.TicketTimeLimit) candidates.push(f.TicketingInfo.TicketTimeLimit);
        if (f?.LastTicketingDate) candidates.push(f.LastTicketingDate);
      });
    });

    // 7TAW means "7 days after booking" — calculate from now
    const ticketType = rs?.TravelItineraryAddInfo?.AgencyInfo?.Ticketing?.TicketType || '7TAW';
    const tawMatch = ticketType.match(/^(\d+)TAW$/);

    for (const c of candidates) {
      if (!c || typeof c !== 'string') continue;
      const d = new Date(c);
      if (!isNaN(d.getTime()) && d > new Date()) {
        ticketTimeLimit = d.toISOString();
        break;
      }
    }

    // Fallback: derive from 7TAW (N days after creation)
    if (!ticketTimeLimit && tawMatch) {
      const days = parseInt(tawMatch[1]) || 7;
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + days);
      deadline.setHours(23, 59, 59, 0);
      ticketTimeLimit = deadline.toISOString();
      console.log(`[Sabre] Ticket time limit derived from ${ticketType}: ${ticketTimeLimit}`);
    }

    if (ticketTimeLimit) {
      console.log(`[Sabre] Ticket time limit: ${ticketTimeLimit}`);
    }

    let airlinePnr = extractDistinctSabreAirlinePnr(finalResponse, finalPnr);
    if (airlinePnr) {
      console.log(`[Sabre] Distinct airline locator found in CreatePNR response: ${airlinePnr}`);
    }

    // If no airline PNR from CreatePNR, retrieve PNR to get airline confirmation
    // The airline PNR (e.g., 09HUEY from /DCBS*09HUEY) is often only available after EndTransaction
    if (!airlinePnr) {
      try {
        console.log(`[Sabre] No airline PNR in CreatePNR response — retrieving PNR ${finalPnr} for airline confirmation...`);
        const retrieveResult = await getBooking({ pnr: finalPnr });
        if (retrieveResult.success) {
          // Check vendorLocators from getBooking deep scan
          if (retrieveResult.vendorLocators && retrieveResult.vendorLocators.length > 0) {
            airlinePnr = retrieveResult.vendorLocators[0];
            console.log(`[Sabre] ✓ Airline PNR from GetBooking vendorLocators: ${airlinePnr}`);
          }
          // Also try extracting from raw response with DC* pattern
          if (!airlinePnr) {
            airlinePnr = extractDistinctSabreAirlinePnr(retrieveResult.rawResponse, finalPnr);
            if (airlinePnr) {
              console.log(`[Sabre] ✓ Airline PNR from GetBooking deep scan: ${airlinePnr}`);
            }
          }
        }
      } catch (retrieveErr) {
        console.warn(`[Sabre] GetBooking for airline PNR failed (non-fatal):`, retrieveErr.message);
      }
    }

    return {
      success: true,
      pnr: finalPnr,
      airlinePnr: airlinePnr || null,
      ticketTimeLimit,
      createVariant: successfulVariant || null,
      rawResponse: finalResponse,
    };
  } catch (err) {
    console.error('[Sabre] CreateBooking failed:', err.message);
    return { success: false, error: err.message, pnr: null };
  }
}

/**
 * Revalidate/reprice an itinerary before booking
 * Uses Sabre RevalidateItinerary v4 (BFM revalidation)
 */
async function revalidatePrice({ flights, adults = 1, children = 0, infants = 0, cabinClass }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  console.log('[Sabre] Revalidating price for', flights?.length || 0, 'segments');

  try {
    const cabinMap = { 'Economy': 'Y', 'Premium Economy': 'S', 'Business': 'C', 'First': 'F' };
    const cabinCode = cabinMap[cabinClass] || 'Y';

    // Sabre v4 revalidation uses TPA_Extensions.Flight[] inside OriginDestinationInformation
    // NOT FlightSegment[] — that's the key difference from BFM search
    const originDestinations = (flights || []).map((seg, idx) => {
      const depDT = (seg.departureTime || '').replace(/[+-]\d{2}:?\d{2}$/, '').split('.')[0] || '';
      const arrDT = (seg.arrivalTime || '').replace(/[+-]\d{2}:?\d{2}$/, '').split('.')[0] || '';
      const flightNum = parseInt(String(seg.flightNumber || '').replace(/\D/g, ''), 10) || 0;

      return {
        RPH: String(idx + 1),
        DepartureDateTime: depDT,
        OriginLocation: { LocationCode: seg.origin },
        DestinationLocation: { LocationCode: seg.destination },
        TPA_Extensions: {
          SegmentType: { Code: 'O' },
          Flight: [{
            Number: flightNum,
            DepartureDateTime: depDT,
            ArrivalDateTime: arrDT,
            Type: 'A',
            ClassOfService: seg.bookingClass || cabinCode,
            OriginLocation: { LocationCode: seg.origin },
            DestinationLocation: { LocationCode: seg.destination },
            Airline: { Operating: seg.airlineCode, Marketing: seg.airlineCode },
          }],
        },
      };
    });

    const paxTypes = [];
    if (adults > 0) paxTypes.push({ Code: 'ADT', Quantity: parseInt(adults, 10) });
    if (children > 0) paxTypes.push({ Code: 'CNN', Quantity: parseInt(children, 10) });
    if (infants > 0) paxTypes.push({ Code: 'INF', Quantity: parseInt(infants, 10) });

    const body = {
      OTA_AirLowFareSearchRQ: {
        Version: '4',
        POS: {
          Source: [{
            PseudoCityCode: config.pcc,
            RequestorID: { Type: '1', ID: '1', CompanyName: { Code: 'TN' } },
          }],
        },
        OriginDestinationInformation: originDestinations,
        TravelerInfoSummary: {
          AirTravelerAvail: [{ PassengerTypeQuantity: paxTypes }],
        },
        TPA_Extensions: {
          IntelliSellTransaction: { RequestType: { Name: 'REVALIDATE' } },
        },
      },
    };

    console.log('[Sabre] Revalidation payload:', JSON.stringify(body, null, 2).substring(0, 2000));
    const response = await sabreRequest(config, '/v4/shop/flights/revalidate', body);

    // Extract revalidated pricing
    const rs = response?.OTA_AirLowFareSearchRS || response?.groupedItineraryResponse || response;
    const pricedItins = rs?.PricedItineraries?.PricedItinerary || [];

    // Also try grouped format
    let results = [];
    if (pricedItins.length > 0) {
      results = pricedItins.map(itin => {
        const fare = itin?.AirItineraryPricingInfo?.[0]?.ItinTotalFare || {};
        return {
          totalFare: parseFloat(fare?.TotalFare?.Amount || 0),
          baseFare: parseFloat(fare?.BaseFare?.Amount || 0),
          taxes: parseFloat(fare?.Taxes?.Tax?.[0]?.Amount || fare?.Taxes?.Amount || 0),
          currency: fare?.TotalFare?.CurrencyCode || 'BDT',
          validatingCarrier: itin?.ValidatingCarrierCode || '',
          lastTicketDate: itin?.AirItineraryPricingInfo?.[0]?.LastTicketDate || null,
        };
      });
    } else if (rs?.statistics || rs?.itineraryGroups) {
      // Grouped response format — price is valid if we got a response at all
      results = [{ valid: true, format: 'grouped' }];
    }

    console.log(`[Sabre] Revalidation: ${results.length} priced itineraries`);
    return {
      success: true,
      valid: true,
      pricedItineraries: results,
      priceChanged: results.length > 0,
      rawResponse: response,
    };
  } catch (err) {
    console.error('[Sabre] RevalidatePrice failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Retrieve a booking via Sabre REST GetBooking
 */
async function getBooking({ pnr }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  console.log('[Sabre] Retrieving booking PNR:', pnr);

  try {
    const body = {
      confirmationId: pnr,
    };

    const response = await sabreRequest(config, '/v1/trip/orders/getBooking', body);
    console.log('[Sabre] GetBooking success for PNR:', pnr);
    console.log('[Sabre] GetBooking response keys:', JSON.stringify(Object.keys(response || {})));

    // Extract useful booking info
    const booking = response || {};
    const flights = booking.flights || booking.airSegments || [];
    const passengers = booking.travelers || booking.passengers || [];
    const ticketing = booking.ticketing || [];

    // Deep-extract vendor/airline locators from the response
    // Sabre GetBooking puts airline confirmations in various nested paths
    const vendorLocators = [];
    const stack = [response];
    const visited = new Set();
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (visited.has(node)) continue;
      visited.add(node);
      if (Array.isArray(node)) { node.forEach(i => stack.push(i)); continue; }
      for (const [k, v] of Object.entries(node)) {
        if (v && typeof v === 'object') { stack.push(v); continue; }
        if (typeof v !== 'string') continue;
        // Match vendor/airline locator keys
        if (/(vendorlocator|airlinelocator|airlinepnr|airlineconfirmation|vendorconfirmation|vendorPNR|otherPNR|supplierlocator|reservationnumber|confirmationnumber|supplierref|operatingairlineconfirmation)/i.test(k)) {
          const code = v.trim().toUpperCase();
          if (/^[A-Z0-9]{5,20}$/.test(code) && code !== pnr.toUpperCase()) {
            vendorLocators.push(code);
          }
        }
        // Also extract from /DCBS*09HUEY or /DCAI*FCQGEC patterns
        if (typeof v === 'string') {
          const dcMatch = v.match(/\/DC[A-Z]{2}\*([A-Z0-9]{4,8})/i);
          if (dcMatch && dcMatch[1].toUpperCase() !== pnr.toUpperCase()) {
            vendorLocators.push(dcMatch[1].toUpperCase());
          }
        }
      }
    }

    console.log('[Sabre] GetBooking vendor locators found:', JSON.stringify(vendorLocators));

    return {
      success: true,
      pnr,
      flights,
      passengers,
      ticketing,
      vendorLocators,
      status: booking.status || booking.bookingStatus || 'unknown',
      rawResponse: response,
    };
  } catch (err) {
    console.error('[Sabre] GetBooking failed:', err.message);
    return { success: false, error: err.message, pnr };
  }
}

/**
 * Check flight ticket status via Sabre REST
 */
async function checkTicketStatus({ pnr }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  console.log('[Sabre] Checking ticket status for PNR:', pnr);

  try {
    const body = {
      confirmationId: pnr,
    };

    const response = await sabreRequest(config, '/v1/trip/orders/checkFlightTickets', body);
    console.log('[Sabre] CheckFlightTickets response received for PNR:', pnr);

    const tickets = response?.tickets || response?.flightTickets || [];
    const ticketList = (Array.isArray(tickets) ? tickets : [tickets]).filter(Boolean).map(t => ({
      ticketNumber: t.ticketNumber || t.documentNumber || t.number || '',
      status: t.status || t.ticketStatus || 'unknown',
      passengerName: t.passengerName || t.travelerName || '',
      issueDate: t.issueDate || t.dateOfIssue || '',
      airline: t.airline || t.validatingCarrier || '',
      couponStatus: t.coupons || t.couponStatus || [],
    }));

    return {
      success: true,
      pnr,
      tickets: ticketList,
      allTicketed: ticketList.length > 0 && ticketList.every(t => /^(ticketed|issued|active|open)/i.test(t.status)),
      rawResponse: response,
    };
  } catch (err) {
    console.error('[Sabre] CheckTicketStatus failed:', err.message);
    return { success: false, error: err.message, pnr, tickets: [] };
  }
}

/**
 * Get seat map via Sabre REST GetSeats.
 * Tries both v3 and v1 contracts, then falls back to SOAP EnhancedSeatMapRQ
 * when REST fails (e.g., PNR viewership restrictions).
 */
async function getSeatsRest({ origin, destination, departureDate, airlineCode, flightNumber, cabinClass, pnr, offerId }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  const numericFlight = String(flightNumber || '').replace(/\D/g, '');
  console.log(`[Sabre] REST GetSeats: ${airlineCode}${numericFlight} ${origin}-${destination} ${departureDate}${pnr ? ` PNR:${pnr}` : ''}${offerId ? ` offerId:${offerId}` : ''}`);

  if (!pnr && !offerId) {
    return {
      success: false,
      source: 'sabre-rest',
      error: 'GetSeats REST requires PNR or offerId. Use SOAP EnhancedSeatMapRQ for pre-booking.',
      rows: [],
      available: false,
      note: 'Pre-booking seat maps use SOAP EnhancedSeatMapRQ (no PNR needed)',
    };
  }

  const cityCode = String(origin || 'DAC').toUpperCase().slice(0, 3);
  const requestVariants = [];

  if (pnr) {
    // v3 variants (often accepted by parser; may fail later with PNR viewership restrictions)
    requestVariants.push({
      name: 'v3_byPnr_pnrLocator',
      endpoint: '/v3/offers/getseats/byPnrLocator',
      body: { pnrLocator: pnr },
    });
    requestVariants.push({
      name: 'v3_byPnr_confirmationId',
      endpoint: '/v3/offers/getseats/byPnrLocator',
      body: { confirmationId: pnr },
    });

    // v1 variants (as shared by Sabre developer endpoint list)
    requestVariants.push({
      name: 'v1_pnrLocator_with_pos',
      endpoint: '/v1/offers/getseats',
      body: {
        pointOfSale: { location: { countryCode: 'BD', cityCode } },
        requestType: 'pnrLocator',
        request: { pnrLocator: pnr },
      },
    });
    requestVariants.push({
      name: 'v1_pnrLocator_no_pos',
      endpoint: '/v1/offers/getseats',
      body: {
        requestType: 'pnrLocator',
        request: { pnrLocator: pnr },
      },
    });
    requestVariants.push({
      name: 'v1_legacy_confirmationId',
      endpoint: '/v1/offers/getseats',
      body: {
        SeatAvailabilityRQ: {
          SeatMapQueryEnhanced: {
            RequestType: 'Payload',
            ConfirmationId: pnr,
            Flight: [{
              DepartureDate: departureDate,
              Marketing: { Carrier: airlineCode, FlightNumber: parseInt(numericFlight, 10) || 0 },
              Origin: origin,
              Destination: destination,
            }],
          },
        },
      },
    });
    requestVariants.push({
      name: 'v1_simple_confirmationId',
      endpoint: '/v1/offers/getseats',
      body: { confirmationId: pnr },
    });
  } else if (offerId) {
    requestVariants.push({
      name: 'v3_offerId_byReservationPayload',
      endpoint: '/v3/offers/getseats/byReservationPayload',
      body: { offer: { offerId } },
    });
    requestVariants.push({
      name: 'v1_offerId_with_pos',
      endpoint: '/v1/offers/getseats',
      body: {
        pointOfSale: { location: { countryCode: 'BD', cityCode } },
        requestType: 'offerId',
        request: { offer: { offerId } },
      },
    });
    requestVariants.push({
      name: 'v1_offerId_no_pos',
      endpoint: '/v1/offers/getseats',
      body: {
        requestType: 'offerId',
        request: { offer: { offerId } },
      },
    });
  }

  const attemptErrors = [];

  try {
    let response;
    let successVariant;

    for (const variant of requestVariants) {
      const endpoint = variant.endpoint || '/v1/offers/getseats';
      try {
        console.log(`[Sabre] REST GetSeats attempt: ${variant.name} -> ${endpoint}`);
        response = await sabreRequest(config, endpoint, variant.body);
        successVariant = `${variant.name}@${endpoint}`;
        console.log(`[Sabre] REST GetSeats SUCCESS via ${successVariant}, keys: ${Object.keys(response || {}).join(', ')}`);
        break;
      } catch (variantErr) {
        const errSnippet = variantErr.message?.slice(0, 300) || String(variantErr);
        console.log(`[Sabre] REST GetSeats ${variant.name} failed: ${errSnippet}`);
        attemptErrors.push(`${variant.name}@${endpoint}: ${errSnippet}`);
      }
    }

    if (!response) {
      throw new Error(`All GetSeats variants failed. Attempts: ${attemptErrors.length}`);
    }

    // Parse response — handle both legacy (GetSeatMapRS/SeatMap) and NDC v2 (response.seatMaps) formats
    const rows = [];
    const columns = new Set();
    const exitRows = [];

    // NDC v2 format: response.seatMaps[].cabin.rows[].seats[]
    const seatMaps = response?.response?.seatMaps || response?.seatMaps || [];
    if (Array.isArray(seatMaps) && seatMaps.length > 0) {
      for (const sm of seatMaps) {
        const cabin = sm?.cabin || sm;
        const cabinRows = cabin?.rows || cabin?.row || [];
        const rowArr = Array.isArray(cabinRows) ? cabinRows : [cabinRows];

        for (const row of rowArr) {
          const rowNumber = parseInt(row.row || row.rowNumber || row.RowNumber || row.Number || 0);
          if (!rowNumber) continue;

          const seats = [];
          const seatArr = Array.isArray(row.seats) ? row.seats : (row.Seat ? (Array.isArray(row.Seat) ? row.Seat : [row.Seat]) : []);

          for (const seat of seatArr) {
            const col = seat.column || seat.Column || seat.SeatColumn || seat.Number || '';
            columns.add(col);

            // NDC uses occupationStatusCode: F=free, X/O=occupied, Z=available-for-sale
            const occCode = (seat.occupationStatusCode || '').toUpperCase();
            const isOccupied = occCode === 'X' || occCode === 'O'
              || seat.Availability === 'Occupied' || seat.OccupiedInd === true
              || seat.Availability === 'Blocked' || seat.Status === 'Occupied';

            // Price from offerItemRefIDs or direct fields
            const price = parseFloat(seat.Fee?.Amount || seat.Price?.Amount || seat.SeatPrice || 0);
            const currency = seat.Fee?.CurrencyCode || seat.Price?.CurrencyCode || 'BDT';

            let type = 'standard';
            const chars = seat.characteristics || seat.Characteristics || seat.Facilities || [];
            const charArr = Array.isArray(chars) ? chars : [chars];
            const charCodes = charArr.map(c => c?.code || c?.Code || c || '').join(',');
            const charDescs = charArr.map(c => c?.description || '').join(',');

            if (charCodes.includes('W') || charDescs.includes('Window')) type = 'window';
            else if (charCodes.includes('A') || charDescs.includes('Aisle')) type = 'aisle';
            else if (charCodes.includes('9') || charDescs.includes('Center')) type = 'middle';
            if (charCodes.includes('E') || charDescs.includes('ExitRow') || charDescs.includes('ExtraLegroom')) type = 'extra-legroom';

            if (row.exitRow || charDescs.includes('ExitRow')) {
              if (!exitRows.includes(rowNumber)) exitRows.push(rowNumber);
            }

            seats.push({
              id: `${rowNumber}${col}`,
              row: rowNumber, col, type,
              status: isOccupied ? 'occupied' : 'available',
              price, currency,
              label: `${rowNumber}${col}`,
              offerItemRefIDs: seat.offerItemRefIDs || [],
            });
          }

          if (seats.length > 0) rows.push({ rowNumber, seats });
        }
      }
    }

    // Legacy format fallback: GetSeatMapRS / SeatMap
    if (rows.length === 0) {
      const seatMapResp = response?.GetSeatMapRS || response;
      const seatMap = seatMapResp?.SeatMap || seatMapResp?.seatMap || [];
      const mapArr = Array.isArray(seatMap) ? seatMap : [seatMap];

      for (const map of mapArr) {
        const cabinRows = map?.Row || map?.Cabin?.Row || [];
        const rowArr = Array.isArray(cabinRows) ? cabinRows : [cabinRows];

        for (const row of rowArr) {
          const rowNumber = parseInt(row.RowNumber || row.Number || 0);
          if (!rowNumber) continue;

          if (row.ExitRow === true || row.exitRow === true) exitRows.push(rowNumber);

          const seats = [];
          const seatArr = Array.isArray(row.Seat) ? row.Seat : (row.Seat ? [row.Seat] : []);

          for (const seat of seatArr) {
            const col = seat.Column || seat.SeatColumn || seat.Number || '';
            columns.add(col);
            const isOccupied = seat.Availability === 'Occupied' || seat.OccupiedInd === true
              || seat.Availability === 'Blocked' || seat.Status === 'Occupied';
            const price = parseFloat(seat.Fee?.Amount || seat.Price?.Amount || seat.SeatPrice || 0);
            const currency = seat.Fee?.CurrencyCode || seat.Price?.CurrencyCode || 'BDT';

            let type = 'standard';
            const chars = seat.Characteristics || seat.Facilities || [];
            const charArr = Array.isArray(chars) ? chars : [chars];
            const charCodes = charArr.map(c => c?.Code || c || '').join(',');
            if (charCodes.includes('W') || charCodes.includes('Window')) type = 'window';
            else if (charCodes.includes('A') || charCodes.includes('Aisle')) type = 'aisle';
            else if (charCodes.includes('M') || charCodes.includes('Middle')) type = 'middle';
            if (charCodes.includes('E') || charCodes.includes('ExtraLegroom') || charCodes.includes('LE')) type = 'extra-legroom';

            seats.push({
              id: `${rowNumber}${col}`, row: rowNumber, col, type,
              status: isOccupied ? 'occupied' : 'available',
              price, currency, label: `${rowNumber}${col}`,
            });
          }
          if (seats.length > 0) rows.push({ rowNumber, seats });
        }
      }
    }

    const sortedCols = [...columns].sort();
    console.log(`[Sabre] REST GetSeats: ${rows.length} rows, ${sortedCols.length} columns via ${successVariant}`);

    return {
      success: rows.length > 0,
      source: 'sabre-rest',
      variant: successVariant,
      rows, columns: sortedCols, exitRows,
      totalRows: rows.length,
      totalSeats: rows.reduce((sum, r) => sum + r.seats.length, 0),
      available: rows.length > 0,
      rawResponse: response,
    };
  } catch (err) {
    console.error('[Sabre] REST GetSeats failed:', err.message);

    const attemptsText = attemptErrors.join(' | ');
    const isViewershipRestricted = /viewership is restricted for the pnr|security check not supported|code:\s*700102/i.test(attemptsText);

    // Final fallback: SOAP EnhancedSeatMapRQ (works pre-booking and for many post-booking checks)
    if (origin && destination && departureDate && airlineCode && flightNumber) {
      try {
        const sabreSoap = require('./sabre-soap');
        if (typeof sabreSoap.getSeatMap === 'function') {
          const BD_AIRPORTS = ['DAC', 'CXB', 'CGP', 'ZYL', 'JSR', 'RJH', 'SPD', 'BZL', 'IRD', 'TKR'];
          const isDomestic = BD_AIRPORTS.includes(String(origin).toUpperCase()) && BD_AIRPORTS.includes(String(destination).toUpperCase());

          const soapResult = await sabreSoap.getSeatMap({
            origin,
            destination,
            departureDate,
            marketingCarrier: airlineCode,
            operatingCarrier: airlineCode,
            flightNumber: String(flightNumber).replace(/^[A-Z]{2}/i, ''),
            cabinClass: cabinClass || 'Economy',
            isDomestic,
          });

          if (soapResult && !soapResult._error && Array.isArray(soapResult.rows) && soapResult.rows.length > 0) {
            const totalSeats = soapResult.rows.reduce((sum, r) => sum + (r.seats?.length || 0), 0);
            return {
              success: true,
              source: 'sabre-soap-fallback',
              variant: 'soap_enhanced_seat_map_fallback',
              rows: soapResult.rows,
              columns: soapResult.columns || [],
              exitRows: soapResult.exitRows || [],
              totalRows: soapResult.totalRows || soapResult.rows.length,
              totalSeats,
              available: true,
              warning: isViewershipRestricted
                ? 'REST GetSeats blocked by PNR viewership restriction; SOAP fallback used.'
                : 'REST GetSeats contract rejected this payload; SOAP fallback used.',
              debugAttempts: attemptErrors,
            };
          }
        }
      } catch (soapErr) {
        attemptErrors.push(`soap_fallback: ${soapErr.message}`);
      }
    }

    return {
      success: false,
      source: 'sabre-rest',
      error: err.message,
      hint: isViewershipRestricted
        ? 'PNR viewership restriction: use a PNR created/owned by this PCC or rely on SOAP seat-map endpoint.'
        : 'GetSeats contract rejected payloads in this environment. Use /flights/seat-map (SOAP) for pre-booking visibility.',
      rows: [],
      totalRows: 0,
      totalSeats: 0,
      available: false,
      debugAttempts: attemptErrors,
    };
  }
}

/**
 * Issue ticket via Sabre AirTicketRQ v1.3.0
 */
async function issueTicket({ pnr }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  console.log('[Sabre] Issuing ticket for PNR:', pnr);

  try {
    const body = {
      AirTicketRQ: {
        DesignatePrinter: { Printers: { Hardcopy: { LNIATA: '000000' }, Ticket: { CountryCode: 'BD' } } },
        Itinerary: { ID: pnr },
        Ticketing: [{ PricingQualifiers: { PriceQuote: [{ Record: [{ Number: '1', Reissue: false }] }] } }],
        PostProcessing: { EndTransaction: { Source: { ReceivedFrom: 'SEVEN TRIP API' } } },
      },
    };

    const response = await sabreRequest(config, '/v1.3.0/air/ticket', body);

    const ticketNumbers = [];
    const docs = response.AirTicketRS?.Summary || [];
    if (Array.isArray(docs)) {
      docs.forEach(s => { if (s.DocumentNumber) ticketNumbers.push(s.DocumentNumber); });
    }

    console.log('[Sabre] Tickets issued:', ticketNumbers);
    return { success: true, ticketNumbers, rawResponse: response };
  } catch (err) {
    console.error('[Sabre] IssueTicket failed:', err.message);
    return { success: false, error: err.message, ticketNumbers: [] };
  }
}

/**
 * Cancel/void a Sabre PNR via OTA_CancelLLSRQ
 */
async function cancelBooking({ pnr }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');
  if (!pnr) return { success: false, error: 'PNR is required for Sabre cancellation' };

  console.log('[Sabre] Cancelling PNR:', pnr);

  // Try multiple REST cancel APIs first
  const cancelVariants = [
    {
      label: 'v2.0.2',
      endpoint: '/v2.0.2/booking/cancel',
      body: {
        OTA_CancelRQ: {
          Version: '2.0.2',
          UniqueID: { ID: pnr },
          Segment: [{ Type: 'entire' }],
        },
      },
    },
    {
      label: 'v2.0.0',
      endpoint: '/v2.0.0/booking/cancel',
      body: {
        OTA_CancelRQ: {
          Version: '2.0.0',
          UniqueID: { ID: pnr },
          Segment: [{ Type: 'entire' }],
        },
      },
    },
    {
      label: 'cancel-via-modify',
      endpoint: '/v2.4.0/passenger/records?mode=update',
      body: {
        UpdatePassengerNameRecordRQ: {
          version: '2.4.0',
          Itinerary: { ID: pnr },
          Cancel: { Segment: [{ Type: 'entire' }] },
          PostProcessing: {
            EndTransaction: {
              Source: { ReceivedFrom: 'SEVEN TRIP API CANCEL' },
            },
          },
        },
      },
    },
  ];

  const restFailures = [];

  for (const variant of cancelVariants) {
    try {
      console.log(`[Sabre] Cancel attempt: ${variant.label} for PNR ${pnr}`);
      const response = await sabreRequest(config, variant.endpoint, variant.body);
      console.log(`[Sabre] PNR ${pnr} cancelled via ${variant.label}`);
      return { success: true, method: variant.label, rawResponse: response };
    } catch (err) {
      const msg = err?.message || 'Unknown Sabre error';
      restFailures.push({ method: variant.label, error: msg });
      console.warn(`[Sabre] Cancel via ${variant.label} failed:`, msg);
    }
  }

  // Final fallback: SOAP stateful cancel
  console.log(`[Sabre] All REST cancel attempts failed for ${pnr}. Trying SOAP fallback...`);
  try {
    const { cancelPnrViaSoap } = require('./sabre-soap');
    if (typeof cancelPnrViaSoap !== 'function') {
      throw new Error('cancelPnrViaSoap not available from sabre-soap module');
    }

    const soapResult = await cancelPnrViaSoap(pnr);
    if (soapResult?.success) {
      console.log(`[Sabre] PNR ${pnr} cancelled via SOAP session`);
      return { ...soapResult, restFailures };
    }

    const soapError = soapResult?.error || 'Unknown SOAP cancel failure';
    console.error(`[Sabre] SOAP cancel failed for PNR ${pnr}:`, soapError);
    return {
      success: false,
      method: 'soap-cancel',
      error: `All Sabre cancel methods failed — REST and SOAP unsuccessful`,
      details: { restFailures, soapError },
    };
  } catch (soapErr) {
    const soapError = soapErr?.message || 'SOAP fallback exception';
    console.error(`[Sabre] SOAP cancel exception for PNR ${pnr}:`, soapError);
    return {
      success: false,
      method: 'soap-cancel',
      error: `All Sabre cancel methods failed — REST and SOAP unsuccessful`,
      details: { restFailures, soapError },
    };
  }
}

/**
 * Assign seats to a PNR using UpdatePassengerNameRecord
 * Seats are assigned via SSR RQST (seat request) per segment per passenger
 * @param {string} pnr - Existing PNR
 * @param {Array} seatAssignments - [{ passengerIndex: 0, segmentNumber: 1, seatNumber: '12A' }]
 */
async function assignSeats({ pnr, seatAssignments }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  if (!pnr || !seatAssignments?.length) {
    return { success: false, error: 'PNR and seat assignments are required' };
  }

  console.log(`[Sabre] Assigning ${seatAssignments.length} seat(s) to PNR ${pnr}`);

  try {
    // First, retrieve the PNR to get segment details
    const booking = await getBooking({ pnr });
    if (!booking?.success) {
      return { success: false, error: `Cannot retrieve PNR ${pnr}: ${booking?.error || 'Unknown'}` };
    }

    const segments = booking.flights || [];
    const passengers = booking.passengers || [];

    // Build seat SSR requests
    const seatRequests = seatAssignments.map(sa => {
      const segIdx = (sa.segmentNumber || 1) - 1;
      const paxIdx = sa.passengerIndex || 0;
      const seg = segments[segIdx] || {};
      const pax = passengers[paxIdx] || {};
      const seatRow = String(sa.seatNumber || '').replace(/[A-Za-z]+$/, '');
      const seatLetter = String(sa.seatNumber || '').replace(/^\d+/, '');
      const airlineCode = seg.airlineCode || seg.operatingAirlineCode || '';

      return {
        SSR_Code: 'RQST',
        Text: `${seatRow}${seatLetter}`,
        PersonName: { NameNumber: `${paxIdx + 1}.1` },
        SegmentNumber: String(segIdx + 1),
        VendorPrefs: airlineCode ? { Airline: { Code: airlineCode } } : undefined,
      };
    });

    const body = {
      CreatePassengerNameRecordRQ: {
        targetCity: config.pcc,
        AirBook: {
          RetryRebook: { Option: true },
        },
        SpecialReqDetails: {
          SpecialService: {
            SpecialServiceInfo: {
              Service: seatRequests,
            },
          },
        },
        PostProcessing: {
          EndTransaction: { Source: { ReceivedFrom: 'SEVEN TRIP SEAT' } },
        },
      },
    };

    // Use UpdatePassengerNameRecord approach - modify existing PNR
    const response = await sabreRequest(config, `/v2.4.0/passenger/records?mode=update&recordLocator=${pnr}`, body, 'POST', 30000);
    
    const updatedPnr = extractSabrePnrFromCreateResponse(response);
    if (updatedPnr) {
      console.log(`[Sabre] ✓ Seats assigned to PNR ${pnr}`);
      return { success: true, pnr: updatedPnr, rawResponse: response };
    }

    console.warn('[Sabre] Seat assignment response did not confirm PNR');
    return { success: false, error: 'Seat assignment may not have been confirmed', rawResponse: response };
  } catch (err) {
    console.error(`[Sabre] Seat assignment failed for PNR ${pnr}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Add ancillary SSRs (extra baggage, meals) to an existing PNR
 */
async function addAncillarySSR({ pnr, ssrList }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  if (!pnr || !ssrList?.length) {
    return { success: false, error: 'PNR and SSR list required' };
  }

  console.log(`[Sabre] Adding ${ssrList.length} ancillary SSR(s) to PNR ${pnr}`);

  try {
    const body = {
      CreatePassengerNameRecordRQ: {
        targetCity: config.pcc,
        SpecialReqDetails: {
          SpecialService: {
            SpecialServiceInfo: {
              Service: ssrList.map(ssr => ({
                SSR_Code: ssr.code || 'OTHS',
                Text: ssr.text || '',
                PersonName: { NameNumber: `${(ssr.passengerIndex || 0) + 1}.1` },
                SegmentNumber: String(ssr.segmentNumber || 'A'),
                ...(ssr.airlineCode ? { VendorPrefs: { Airline: { Code: ssr.airlineCode } } } : {}),
              })),
            },
          },
        },
        PostProcessing: {
          EndTransaction: { Source: { ReceivedFrom: 'SEVEN TRIP ANC' } },
        },
      },
    };

    const response = await sabreRequest(config, `/v2.4.0/passenger/records?mode=update&recordLocator=${pnr}`, body, 'POST', 30000);
    const updatedPnr = extractSabrePnrFromCreateResponse(response);
    console.log(`[Sabre] Ancillary SSR update result: PNR=${updatedPnr || pnr}`);
    return { success: true, pnr: updatedPnr || pnr, rawResponse: response };
  } catch (err) {
    console.error(`[Sabre] Ancillary SSR failed for PNR ${pnr}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 24: Void Flight Tickets
// POST /v1/trip/orders/voidFlightTickets
// ═══════════════════════════════════════════════════════════════
async function voidTickets({ pnr, tickets }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  console.log(`[Sabre] Voiding tickets — PNR: ${pnr || 'N/A'}, tickets: ${tickets?.join(', ') || 'all'}`);

  try {
    const body = {};
    if (tickets && tickets.length > 0) {
      body.tickets = tickets;
    } else if (pnr) {
      body.confirmationId = pnr;
    } else {
      return { success: false, error: 'PNR or ticket numbers required' };
    }

    const response = await sabreRequest(config, '/v1/trip/orders/voidFlightTickets', body, 'POST', 30000);
    console.log(`[Sabre] Void response:`, JSON.stringify(response).substring(0, 1000));

    return {
      success: true,
      method: 'void',
      pnr,
      voidedTickets: response?.voidedTickets || response?.tickets || tickets || [],
      rawResponse: response,
    };
  } catch (err) {
    console.error(`[Sabre] Void failed:`, err.message);
    return { success: false, error: err.message, method: 'void' };
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 23: Refund (Stateless Refunds API)
// Step 1: POST /v1/offers/refund/price  → get refund quote
// Step 2: POST /v1/offers/refund/fulfill → execute refund
// ═══════════════════════════════════════════════════════════════
async function refundPrice({ pnr, passengers, refundDocuments, qualifiers }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  console.log(`[Sabre] Pricing refund for PNR: ${pnr}, docs: ${refundDocuments?.length || 0}`);

  try {
    const body = {
      pnrLocator: pnr,
      clientContext: {
        pseudoCityCode: config.pcc,
        stationNumber: '31000104',
        accountingCity: config.pcc,
      },
      passengers: passengers || [],
      refundDocuments: refundDocuments || [],
    };

    if (qualifiers) {
      body.qualifiers = qualifiers;
    }

    const response = await sabreRequest(config, '/v1/offers/refund/price', body, 'POST', 30000);
    console.log(`[Sabre] Refund pricing result:`, JSON.stringify(response).substring(0, 1000));

    return {
      success: true,
      method: 'refund-price',
      pnr,
      refundQuote: response,
    };
  } catch (err) {
    console.error(`[Sabre] Refund pricing failed:`, err.message);
    return { success: false, error: err.message, method: 'refund-price' };
  }
}

async function refundFulfill({ pnr, passengers, formsOfRefund, refundDocuments, cancelItinerary = true }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  console.log(`[Sabre] Fulfilling refund for PNR: ${pnr}, cancel: ${cancelItinerary}`);

  try {
    const body = {
      pnrLocator: pnr,
      clientContext: {
        pseudoCityCode: config.pcc,
        stationNumber: '31000104',
        accountingCity: config.pcc,
      },
      passengers: passengers || [],
      formsOfRefund: formsOfRefund || [],
      refundDocuments: refundDocuments || [],
      cancelItinerary,
    };

    const response = await sabreRequest(config, '/v1/offers/refund/fulfill', body, 'POST', 30000);
    console.log(`[Sabre] Refund fulfill result:`, JSON.stringify(response).substring(0, 1000));

    return {
      success: true,
      method: 'refund-fulfill',
      pnr,
      refundResult: response,
    };
  } catch (err) {
    console.error(`[Sabre] Refund fulfill failed:`, err.message);
    return { success: false, error: err.message, method: 'refund-fulfill' };
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 25: Flight Status (FLIFO)
// GET /products/air/flight/status
// ═══════════════════════════════════════════════════════════════
async function getFlightStatus({ airlineCode, flightNumber, departureDate, origin, destination }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  const params = new URLSearchParams();
  if (departureDate) params.append('departureDate', departureDate);
  if (airlineCode) params.append('airlineCode', airlineCode);
  if (flightNumber) params.append('flightNumber', String(flightNumber).replace(/\D/g, ''));
  if (origin) params.append('origin', origin);
  if (destination) params.append('destination', destination);

  const endpoint = `/products/air/flight/status?${params.toString()}`;
  console.log(`[Sabre] Flight status: ${endpoint}`);

  try {
    const response = await sabreRequest(config, endpoint, null, 'GET', 15000);
    console.log(`[Sabre] FLIFO result:`, JSON.stringify(response).substring(0, 1000));

    // Parse flight status from response
    const flights = response?.flightStatusResponse?.flightStatuses || response?.flightStatuses || [];

    return {
      success: true,
      method: 'flifo',
      flights: flights.map(f => ({
        airlineCode: f.marketingAirline?.code || airlineCode,
        flightNumber: f.flightNumber || flightNumber,
        origin: f.departureAirport?.code || origin,
        destination: f.arrivalAirport?.code || destination,
        scheduledDeparture: f.scheduledDepartureDateTime || null,
        estimatedDeparture: f.estimatedDepartureDateTime || null,
        actualDeparture: f.actualDepartureDateTime || null,
        scheduledArrival: f.scheduledArrivalDateTime || null,
        estimatedArrival: f.estimatedArrivalDateTime || null,
        actualArrival: f.actualArrivalDateTime || null,
        status: f.status || f.flightStatus || 'UNKNOWN',
        equipment: f.equipment?.code || null,
      })),
      rawResponse: response,
    };
  } catch (err) {
    console.error(`[Sabre] FLIFO failed:`, err.message);
    return { success: false, error: err.message, method: 'flifo' };
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 17 (complete): Stateless Ancillaries REST API
// POST /v1/offers/getAncillaries
// ═══════════════════════════════════════════════════════════════
async function getAncillariesStateless({ pnr, segments, passengers, mode = 'payload' }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  console.log(`[Sabre] Stateless ancillaries — mode: ${mode}, PNR: ${pnr || 'N/A'}, segments: ${segments?.length || 0}`);

  try {
    // Try v2 first, fallback to v1
    const versions = [
      { version: 'v2', endpoint: '/v2/offers/getAncillaries' },
      { version: 'v1', endpoint: '/v1/offers/getAncillaries' },
    ];

    let lastError = null;
    for (const { version, endpoint } of versions) {
      try {
        const body = {};

        if (mode === 'pnr' && pnr) {
          body.requestType = 'pnrLocator';
          body.request = { pnrLocator: pnr };
        } else {
          // Payload mode — use ancillaries wrapper for v2, flat for v1
          const segmentData = (segments || []).map((seg, idx) => ({
            id: `SEG-${idx + 1}`,
            departureDateTime: seg.departureTime || seg.departureDateTime || '',
            arrivalDateTime: seg.arrivalTime || seg.arrivalDateTime || '',
            departureDate: (seg.departureTime || seg.departureDateTime || '').substring(0, 10),
            departureAirportCode: seg.origin || seg.departureAirportCode || '',
            arrivalAirportCode: seg.destination || seg.arrivalAirportCode || '',
            operatingAirlineCode: seg.operatingAirline || seg.airlineCode || '',
            bookingAirlineCode: seg.airlineCode || seg.bookingAirlineCode || '',
            isElectronicTicket: true,
            bookingFlightNumber: String(seg.flightNumber || '').replace(/\D/g, ''),
            bookingClassCode: seg.bookingClass || 'Y',
            operatingFlightNumber: String(seg.flightNumber || '').replace(/\D/g, ''),
            operatingBookingClassCode: seg.bookingClass || 'Y',
            sequence: idx + 1,
          }));

          const passengerData = (passengers || []).map((pax, idx) => ({
            id: `PAX-${idx + 1}`,
            passengerId: `Passenger${idx + 1}`,
            nameNumber: `0${idx + 1}.01`,
            givenName: `${(pax.firstName || pax.givenName || 'TEST').toUpperCase()} ${(pax.title || 'MR').toUpperCase()}`,
            surname: (pax.lastName || pax.surname || 'SABRE').toUpperCase(),
            typeCode: pax.type || pax.typeCode || 'ADT',
          }));

          if (version === 'v2') {
            body.ancillaries = { segments: segmentData, passengers: passengerData };
          } else {
            body.clientContext = {
              pseudoCityCode: config.pcc,
              stationNumber: '31000104',
              accountingCity: config.pcc,
            };
            body.segments = segmentData;
            body.passengers = passengerData;
          }
        }

        console.log(`[Sabre] Trying ${endpoint}...`);
        const response = await sabreRequest(config, endpoint, body, 'POST', 30000);
        console.log(`[Sabre] Stateless ancillaries ${version} result:`, JSON.stringify(response).substring(0, 1500));

        // Parse ancillary offers from response
        const offers = response?.ancillaryOffers || response?.offers || [];
        const ancillaries = [];

        for (const offer of offers) {
          const items = offer.items || [];
          for (const item of items) {
            ancillaries.push({
              offerId: offer.id || null,
              itemId: item.id || null,
              groupCode: item.ancillary?.groupCode || item.groupCode || '',
              subCode: item.ancillary?.subCode || item.subCode || '',
              commercialName: item.ancillary?.commercialName || item.commercialName || '',
              airlineCode: item.ancillary?.airlineCode || item.airlineCode || '',
              price: item.price?.amount || item.totalAmount || 0,
              currency: item.price?.currencyCode || item.currency || 'BDT',
              segmentIds: item.segmentReferenceIds || [],
              passengerIds: item.passengerReferenceIds || [],
            });
          }
        }

        return {
          success: true,
          method: `stateless-ancillaries-${version}`,
          ancillaries,
          totalOffers: ancillaries.length,
          rawResponse: response,
        };
      } catch (verErr) {
        console.log(`[Sabre] Stateless ancillaries ${version} failed: ${verErr.message?.substring(0, 300)}`);
        lastError = verErr;
      }
    }

    // If all versions fail, return graceful failure (some PCCs don't have this entitlement)
    throw lastError || new Error('All stateless ancillary API versions failed');
  } catch (err) {
    console.error(`[Sabre] Stateless ancillaries failed:`, err.message);
    return { success: false, error: err.message, method: 'stateless-ancillaries' };
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 18 (complete): Add Ancillary + EMD Issuance
// POST /v1/offers/addAncillaries — attach priced ancillary to PNR
// POST /v1/trip/orders/fulfillOrder — issue EMD
// ═══════════════════════════════════════════════════════════════
async function addAncillaryStateless({ pnr, segments, passengers, offers, ancillaries }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  console.log(`[Sabre] Adding stateless ancillary to PNR: ${pnr}, offers: ${offers?.length || 0}`);

  try {
    const body = {
      pnrLocator: pnr,
      itinerary: { id: 'I-1', itineraryPartReferenceIds: ['IP-1'] },
      itineraryParts: [{ id: 'IP-1', segmentReferenceIds: (segments || []).map((_, i) => `SEG-${i + 1}`) }],
      segments: (segments || []).map((seg, idx) => ({
        id: `SEG-${idx + 1}`,
        departureAirportCode: seg.origin || seg.departureAirportCode || '',
        arrivalAirportCode: seg.destination || seg.arrivalAirportCode || '',
        bookingAirlineCode: seg.airlineCode || seg.bookingAirlineCode || '',
        bookingFlightNumber: String(seg.flightNumber || '').replace(/\D/g, ''),
        sequence: idx + 1,
      })),
      passengers: (passengers || []).map((pax, idx) => ({
        id: `PAX-${idx + 1}`,
        nameNumber: `0${idx + 1}.01`,
        givenName: `${(pax.firstName || pax.givenName || '').toUpperCase()} ${(pax.title || 'MR').toUpperCase()}`,
        surname: (pax.lastName || pax.surname || '').toUpperCase(),
        typeCode: pax.type || pax.typeCode || 'ADT',
      })),
      offers: offers || [],
      ancillaries: ancillaries || [],
    };

    const response = await sabreRequest(config, '/v1/offers/addAncillaries', body, 'POST', 30000);
    console.log(`[Sabre] Add ancillary result:`, JSON.stringify(response).substring(0, 1000));

    return { success: true, method: 'add-ancillary-stateless', pnr, rawResponse: response };
  } catch (err) {
    console.error(`[Sabre] Add ancillary stateless failed:`, err.message);
    return { success: false, error: err.message, method: 'add-ancillary-stateless' };
  }
}

async function fulfillTickets({ pnr, fulfillments, formsOfPayment, acceptPriceChanges = true }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  console.log(`[Sabre] Fulfill tickets/EMD for PNR: ${pnr}`);

  try {
    const body = {
      confirmationId: pnr,
      retainAccounting: false,
      fulfillments: fulfillments || [{
        ticketingQualifiers: {
          priceWithTaxes: true,
          returnFareFlexibilityDetails: false,
          priceQuoteRecordIds: ['1'],
          isNetFareCommission: false,
        },
        payment: { primaryFormOfPayment: 1 },
      }],
      receivedFrom: 'SEVEN TRIP API',
      designatePrinters: [{ ticket: { countryCode: 'BD' } }],
      formsOfPayment: formsOfPayment || [],
      acceptPriceChanges,
    };

    const response = await sabreRequest(config, '/v1/trip/orders/fulfillOrder', body, 'POST', 45000);
    console.log(`[Sabre] Fulfill result:`, JSON.stringify(response).substring(0, 1000));

    return {
      success: true,
      method: 'fulfill-tickets',
      pnr,
      tickets: response?.tickets || response?.fulfillments || [],
      rawResponse: response,
    };
  } catch (err) {
    console.error(`[Sabre] Fulfill tickets failed:`, err.message);
    return { success: false, error: err.message, method: 'fulfill-tickets' };
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 26 (complete): Post-booking Frequent Flyer Update
// Uses UpdatePassengerNameRecord v2.4.0 with FQTV SSR
// ═══════════════════════════════════════════════════════════════
async function updateFrequentFlyer({ pnr, loyaltyUpdates }) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  if (!pnr || !loyaltyUpdates?.length) {
    return { success: false, error: 'PNR and loyaltyUpdates required' };
  }

  console.log(`[Sabre] Updating FF for PNR ${pnr}: ${loyaltyUpdates.length} update(s)`);

  try {
    const services = loyaltyUpdates.map(update => ({
      SSR_Code: 'FQTV',
      Text: `${(update.airlineCode || '').toUpperCase()}${update.loyaltyNumber || ''}`,
      PersonName: { NameNumber: `${(update.passengerIndex || 0) + 1}.1` },
      SegmentNumber: 'A',
      VendorPrefs: { Airline: { Code: update.airlineCode || '' } },
    }));

    const body = {
      CreatePassengerNameRecordRQ: {
        targetCity: config.pcc,
        SpecialReqDetails: {
          SpecialService: {
            SpecialServiceInfo: {
              Service: services,
            },
          },
        },
        PostProcessing: {
          EndTransaction: { Source: { ReceivedFrom: 'SEVEN TRIP FF UPDATE' } },
        },
      },
    };

    const response = await sabreRequest(config, `/v2.4.0/passenger/records?mode=update&recordLocator=${pnr}`, body, 'POST', 30000);
    const updatedPnr = extractSabrePnrFromCreateResponse(response);
    console.log(`[Sabre] FF update result: PNR=${updatedPnr || pnr}`);
    return { success: true, pnr: updatedPnr || pnr, rawResponse: response };
  } catch (err) {
    console.error(`[Sabre] FF update failed for PNR ${pnr}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  searchFlights,
  createBooking,
  issueTicket,
  cancelBooking,
  revalidatePrice,
  getBooking,
  checkTicketStatus,
  getSeatsRest,
  assignSeats,
  addAncillarySSR,
  getSabreConfig,
  clearSabreConfigCache,
  // Section 24: Void
  voidTickets,
  // Section 23: Refund
  refundPrice,
  refundFulfill,
  // Section 25: FLIFO
  getFlightStatus,
  // Section 17: Stateless Ancillaries
  getAncillariesStateless,
  // Section 18: Add Ancillary + EMD
  addAncillaryStateless,
  fulfillTickets,
  // Section 26: FF Update
  updateFrequentFlyer,
};
