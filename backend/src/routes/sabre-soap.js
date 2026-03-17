/**
 * Sabre SOAP API integration — Session-based services
 * Used for EnhancedSeatMapRQ and GetAncillaryOffersRQ which require SOAP sessions.
 * REST is used for booking (CreatePNR) and search (BFM).
 *
 * SOAP Endpoint:
 *   CERT: https://webservices.cert.platform.sabre.com
 *   PROD: https://webservices.platform.sabre.com
 *
 * Auth: SessionCreateRQ v2.0.0 with EPR/Password/PCC + JV_BD ClientId/ClientSecret
 */

const db = require('../config/db');

// Local Sabre config loader (kept here to avoid circular dependency with sabre-flights)
let _sabreConfigCache = null;
let _sabreConfigCacheTime = 0;
const SABRE_CONFIG_TTL = 5 * 60 * 1000;

async function getSabreConfig() {
  if (_sabreConfigCache && Date.now() - _sabreConfigCacheTime < SABRE_CONFIG_TTL) {
    return _sabreConfigCache;
  }

  try {
    const [rows] = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'api_sabre'");
    if (rows.length === 0 || !rows[0].setting_value) return null;

    const cfg = JSON.parse(rows[0].setting_value || '{}');
    if (cfg.enabled !== 'true' && cfg.enabled !== true) return null;

    const pick = (...vals) => vals.find(v => typeof v === 'string' && v.trim().length > 0)?.trim() || '';
    const isProd = cfg.environment === 'production' || cfg.environment === 'prod';

    const epr = pick(cfg.epr);
    const agencyPassword = isProd
      ? pick(cfg.prodPassword, cfg.agency_password)
      : pick(cfg.agencyPassword, cfg.agency_password);
    const pcc = pick(cfg.pcc, cfg.scCode);

    if (!epr || !agencyPassword || !pcc) {
      console.error('[Sabre SOAP] Missing epr/agencyPassword/pcc in api_sabre settings');
      return null;
    }

    _sabreConfigCache = {
      environment: cfg.environment || 'cert',
      epr,
      agencyPassword,
      pcc,
    };
    _sabreConfigCacheTime = Date.now();
    return _sabreConfigCache;
  } catch (err) {
    console.error('[Sabre SOAP] Config load error:', err.message);
    return null;
  }
}

// ── SOAP endpoint mapping ──
function getSoapEndpoint(config) {
  const isProd = config.environment === 'production' || config.environment === 'prod';
  return isProd
    ? 'https://webservices.platform.sabre.com'
    : 'https://webservices.cert.platform.sabre.com';
}

// ── SOAP client credentials (per Sabre JV_BD docs) ──
function getSoapClientCredentials(config) {
  const isProd = config.environment === 'production' || config.environment === 'prod';
  return {
    clientId: '5B0K-JvBdOta',
    clientSecret: isProd ? 'M1uty91x' : 'Pl67azTy',
  };
}

// ── Session token cache (reuse across calls, 15min TTL) ──
let _sessionCache = { token: null, conversationId: null, expiresAt: 0 };

const SOAP_SESSION_ERROR_RE = /(binarysecuritytoken|security token|invalid session|session not found|stale session|authentication failed|host tas allocated|limit of host tas|not authorized)/i;

function isSoapSessionError(message) {
  return SOAP_SESSION_ERROR_RE.test(String(message || ''));
}

async function resetSoapSessionCacheWithClose(config) {
  const hadToken = !!_sessionCache.token;
  const { token, conversationId } = _sessionCache;
  _sessionCache = { token: null, conversationId: null, expiresAt: 0 };

  if (hadToken && token) {
    await closeSession(config, token, conversationId);
  }
}

/**
 * Create a SOAP session — returns BinarySecurityToken
 */
async function createSession(config) {
  // Reuse cached session if still valid
  if (_sessionCache.token && Date.now() < _sessionCache.expiresAt) {
    return { token: _sessionCache.token, conversationId: _sessionCache.conversationId };
  }

  const soapUrl = getSoapEndpoint(config);
  const { clientId, clientSecret } = getSoapClientCredentials(config);
  const conversationId = `SevenTrip.${Date.now()}`;

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Header>
    <MessageHeader xmlns="http://www.ebxml.org/namespaces/messageHeader">
      <From><PartyId>Agency</PartyId></From>
      <To><PartyId>Sabre_API</PartyId></To>
      <ConversationId>${conversationId}</ConversationId>
      <Action>SessionCreateRQ</Action>
    </MessageHeader>
    <Security xmlns="http://schemas.xmlsoap.org/ws/2002/12/secext">
      <UsernameToken>
        <Username>${config.epr}</Username>
        <Password>${config.agencyPassword}</Password>
        <Organization>${config.pcc}</Organization>
        <Domain>DEFAULT</Domain>
        <ClientId>${clientId}</ClientId>
        <ClientSecret>${clientSecret}</ClientSecret>
      </UsernameToken>
    </Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <SessionCreateRQ returnContextID="true" Version="2.0.0" xmlns="http://www.opentravel.org/0TA/2002/11"/>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  const res = await fetch(soapUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'SessionCreateRQ' },
    body: envelope,
    signal: AbortSignal.timeout(15000),
  });

  const xml = await res.text();

  // Extract BinarySecurityToken
  const tokenMatch = xml.match(/BinarySecurityToken[^>]*>([^<]+)/);
  if (!tokenMatch) {
    const err = xml.match(/faultstring>([^<]+)/) || xml.match(/Message>([^<]+)/);
    throw new Error(`SOAP SessionCreate failed: ${err ? err[1] : xml.slice(0, 300)}`);
  }

  const token = tokenMatch[1];
  // Cache for 14 minutes (Sabre sessions last ~15min)
  _sessionCache = { token, conversationId, expiresAt: Date.now() + 14 * 60 * 1000 };
  console.log('[Sabre SOAP] Session created successfully');
  return { token, conversationId };
}

/**
 * Close a SOAP session
 */
async function closeSession(config, token, conversationId) {
  try {
    const soapUrl = getSoapEndpoint(config);
    const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Header>
    <MessageHeader xmlns="http://www.ebxml.org/namespaces/messageHeader">
      <From><PartyId>Agency</PartyId></From>
      <To><PartyId>Sabre_API</PartyId></To>
      <ConversationId>${conversationId}</ConversationId>
      <Action>SessionCloseRQ</Action>
    </MessageHeader>
    <Security xmlns="http://schemas.xmlsoap.org/ws/2002/12/secext">
      <BinarySecurityToken>${token}</BinarySecurityToken>
    </Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <SessionCloseRQ Version="1.0.0" xmlns="http://www.opentravel.org/OTA/2002/11"/>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

    await fetch(soapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'SessionCloseRQ' },
      body: envelope,
      signal: AbortSignal.timeout(10000),
    });
    // Invalidate cache
    _sessionCache = { token: null, conversationId: null, expiresAt: 0 };
    console.log('[Sabre SOAP] Session closed');
  } catch (err) {
    console.log('[Sabre SOAP] Session close error (non-critical):', err.message);
  }
}

/**
 * EnhancedSeatMapRQ v6.0.0 — query seat map for any airline via Sabre SOAP
 * @param {Object} params - { origin, destination, departureDate, marketingCarrier, flightNumber, cabinClass }
 * @returns {Object|null} parsed seat map data or null
 */
async function getSeatMap(params, _retried = false) {
  const config = await getSabreConfig();
  if (!config) return null;

  const { token, conversationId } = await createSession(config);
  const soapUrl = getSoapEndpoint(config);

  // Map cabin class to RBD code
  const rbdMap = { 'Economy': 'Y', 'Premium Economy': 'W', 'Business': 'C', 'First': 'F' };
  const rbd = rbdMap[params.cabinClass] || 'Y';

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:eb="http://www.ebxml.org/namespaces/messageHeader"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <SOAP-ENV:Header>
    <eb:MessageHeader SOAP-ENV:mustUnderstand="1" eb:version="1.0">
      <eb:From><eb:PartyId>Agency</eb:PartyId></eb:From>
      <eb:To><eb:PartyId>Sabre_API</eb:PartyId></eb:To>
      <eb:CPAId>${config.pcc}</eb:CPAId>
      <eb:ConversationId>${conversationId}</eb:ConversationId>
      <eb:Service>EnhancedSeatMapRQ</eb:Service>
      <eb:Action>EnhancedSeatMapRQ</eb:Action>
    </eb:MessageHeader>
    <wsse:Security xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext">
      <wsse:BinarySecurityToken>${token}</wsse:BinarySecurityToken>
    </wsse:Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <EnhancedSeatMapRQ xmlns="http://stl.sabre.com/Merchandising/v6" version="6">
      <SeatMapQueryEnhanced>
        <RequestType>Payload</RequestType>
        <Flight origin="${params.origin}" destination="${params.destination}">
          <DepartureDate>${params.departureDate}</DepartureDate>
          <Marketing carrier="${params.marketingCarrier}">${params.flightNumber}</Marketing>
        </Flight>
        <CabinDefinition>
          <RBD>${rbd}</RBD>
        </CabinDefinition>
        <POS>
          <PCC>${config.pcc}</PCC>
        </POS>
      </SeatMapQueryEnhanced>
    </EnhancedSeatMapRQ>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  try {
    const res = await fetch(soapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'EnhancedSeatMapRQ' },
      body: envelope,
      signal: AbortSignal.timeout(20000),
    });

    const xml = await res.text();
    console.log(`[Sabre SOAP] SeatMap response length: ${xml.length}`);
    console.log(`[Sabre SOAP] SeatMap XML (first 3000): ${xml.substring(0, 3000)}`);

    // Check for SOAP fault or error — retry once only for session/auth issues
    if (xml.includes('faultstring') || xml.includes('ErrorRS') || xml.includes('status="NotProcessed"') || xml.includes('status="Incomplete"')) {
      const errMatch = xml.match(/faultstring>([^<]+)/) || xml.match(/Message[^>]*>([^<]+)/) || xml.match(/ShortText="([^"]+)"/) || xml.match(/SystemSpecificResults[^>]*>[\s\S]*?Message[^>]*>([^<]+)/);
      const errMsg = errMatch ? errMatch[1] : 'Unknown error';
      console.log(`[Sabre SOAP] SeatMap error: ${errMsg}`);

      const shouldRetry = !_retried && isSoapSessionError(errMsg);
      if (shouldRetry) {
        console.log('[Sabre SOAP] SeatMap: session/auth error, retrying with fresh session...');
        await resetSoapSessionCacheWithClose(config);
        return getSeatMap(params, true);
      }

      return { _error: true, message: errMsg, rawXml: xml.substring(0, 5000) };
    }

    // Parse seat map XML
    const parsed = parseSeatMapXml(xml);
    if (!parsed) {
      console.log('[Sabre SOAP] SeatMap: parser returned null, returning raw XML');
      return { _error: true, message: 'Parser returned no data', rawXml: xml.substring(0, 5000) };
    }
    return parsed;
  } catch (err) {
    console.error('[Sabre SOAP] SeatMap request failed:', err.message);

    const netErr = /timeout|network|fetch failed|econnreset|etimedout/i.test(String(err?.message || ''));
    const shouldRetry = !_retried && (netErr || isSoapSessionError(err?.message));

    if (shouldRetry) {
      console.log('[Sabre SOAP] SeatMap: retrying with fresh session after request error...');
      await resetSoapSessionCacheWithClose(config);
      return getSeatMap(params, true);
    }

    return { _error: true, message: err.message };
  }
}

/**
 * GetAncillaryOffersRQ v3.0.0 — query available ancillaries (baggage, meals, etc.)
 * IMPORTANT: This API requires an existing PNR context. Use only POST-BOOKING.
 * @param {Object} params - { origin, destination, departureDate, departureTime, marketingCarrier, flightNumber, cabinClass, pnr }
 * @returns {Object|null} parsed ancillary offers or null
 */
async function getAncillaryOffers(params) {
  // GAO requires PNR context — reject early if no PNR
  if (!params.pnr) {
    console.log('[Sabre SOAP] GAO skipped: no PNR provided (use BFM data for pre-booking)');
    return { _error: true, message: 'GetAncillaryOffersRQ requires PNR (post-booking only)' };
  }

  const config = await getSabreConfig();
  if (!config) return null;

  const { token, conversationId } = await createSession(config);
  const soapUrl = getSoapEndpoint(config);

  // With PNR: use stateful mode — Sabre retrieves PNR in session context
  // First retrieve the PNR into the session, then query ancillaries
  console.log(`[Sabre SOAP] GAO: Retrieving PNR ${params.pnr} for ancillary query`);

  // Step 1: Retrieve PNR into session (TravelItineraryReadRQ or GetReservationRQ)
  const retrieveEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:eb="http://www.ebxml.org/namespaces/messageHeader">
  <SOAP-ENV:Header>
    <eb:MessageHeader SOAP-ENV:mustUnderstand="1" eb:version="1.0">
      <eb:From><eb:PartyId>Agency</eb:PartyId></eb:From>
      <eb:To><eb:PartyId>Sabre_API</eb:PartyId></eb:To>
      <eb:CPAId>${config.pcc}</eb:CPAId>
      <eb:ConversationId>${conversationId}</eb:ConversationId>
      <eb:Service>TravelItineraryReadRQ</eb:Service>
      <eb:Action>TravelItineraryReadRQ</eb:Action>
    </eb:MessageHeader>
    <wsse:Security xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext">
      <wsse:BinarySecurityToken>${token}</wsse:BinarySecurityToken>
    </wsse:Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <TravelItineraryReadRQ xmlns="http://services.sabre.com/res/tir/v3_10" Version="3.10.0">
      <MessagingDetails>
        <SubjectAreas>
          <SubjectArea>FULL</SubjectArea>
        </SubjectAreas>
      </MessagingDetails>
      <UniqueID ID="${params.pnr}"/>
    </TravelItineraryReadRQ>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  try {
    const retrieveRes = await fetch(soapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'TravelItineraryReadRQ' },
      body: retrieveEnvelope,
      signal: AbortSignal.timeout(15000),
    });
    const retrieveXml = await retrieveRes.text();
    if (retrieveXml.includes('faultstring') || retrieveXml.includes('ErrorRS')) {
      const errMatch = retrieveXml.match(/faultstring>([^<]+)/) || retrieveXml.match(/Message[^>]*>([^<]+)/);
      console.log(`[Sabre SOAP] PNR retrieval failed: ${errMatch ? errMatch[1] : 'unknown'}`);
      return { _error: true, message: `PNR retrieval failed: ${errMatch ? errMatch[1] : 'unknown'}`, rawXml: retrieveXml.substring(0, 3000) };
    }
    console.log(`[Sabre SOAP] PNR ${params.pnr} retrieved into session`);
  } catch (err) {
    return { _error: true, message: `PNR retrieval error: ${err.message}` };
  }

  // Step 2: Now call GAO in stateful mode (PNR is in session context)
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:eb="http://www.ebxml.org/namespaces/messageHeader">
  <SOAP-ENV:Header>
    <eb:MessageHeader SOAP-ENV:mustUnderstand="1" eb:version="1.0">
      <eb:From><eb:PartyId>Agency</eb:PartyId></eb:From>
      <eb:To><eb:PartyId>Sabre_API</eb:PartyId></eb:To>
      <eb:CPAId>${config.pcc}</eb:CPAId>
      <eb:ConversationId>${conversationId}</eb:ConversationId>
      <eb:Service>GetAncillaryOffersRQ</eb:Service>
      <eb:Action>GetAncillaryOffersRQ</eb:Action>
    </eb:MessageHeader>
    <wsse:Security xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext">
      <wsse:BinarySecurityToken>${token}</wsse:BinarySecurityToken>
    </wsse:Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <ns9:GetAncillaryOffersRQ
      xmlns:ns9="http://services.sabre.com/merch/ancillary/offer/v03"
      version="3.0.0">
      <ns9:RequestType>stateful</ns9:RequestType>
      <ns9:SummaryOnly>false</ns9:SummaryOnly>
    </ns9:GetAncillaryOffersRQ>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  try {
    const res = await fetch(soapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'GetAncillaryOffersRQ' },
      body: envelope,
      signal: AbortSignal.timeout(20000),
    });

    const xml = await res.text();
    console.log(`[Sabre SOAP] Ancillary response length: ${xml.length}`);
    console.log(`[Sabre SOAP] Ancillary XML (first 3000): ${xml.substring(0, 3000)}`);

    if (xml.includes('faultstring') || xml.includes('ErrorRS') || xml.includes('status="NotProcessed"') || xml.includes('status="Incomplete"')) {
      const errMatch = xml.match(/faultstring>([^<]+)/) || xml.match(/Message[^>]*>([^<]+)/) || xml.match(/ShortText="([^"]+)"/);
      const errMsg = errMatch ? errMatch[1] : 'Unknown error';
      console.log(`[Sabre SOAP] Ancillary error: ${errMsg}`);
      return { _error: true, message: errMsg, rawXml: xml.substring(0, 5000) };
    }

    const parsed = parseAncillaryXml(xml);
    if (!parsed) {
      console.log('[Sabre SOAP] Ancillary: parser returned null, returning raw XML');
      return { _error: true, message: 'Parser returned no data', rawXml: xml.substring(0, 5000) };
    }
    return parsed;
  } catch (err) {
    console.error('[Sabre SOAP] Ancillary request failed:', err.message);
    return { _error: true, message: err.message };
  }
}

// ── XML parsers (regex-based, avoids xml2js dependency) ──

function parseSeatMapXml(xml) {
  const rows = [];
  const columns = new Set();

  // Extract all Row elements (handle namespaced and non-namespaced)
  const rowMatches = xml.matchAll(/<(?:\w+:)?Row(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?Row>/gi);
  for (const match of rowMatches) {
    const rowXml = match[1];
    const rowNum = (rowXml.match(/<(?:\w+:)?RowNumber>(\d+)<\//) || [])[1];
    if (!rowNum) continue;

    const seats = [];
    const seatMatches = rowXml.matchAll(/<(?:\w+:)?Seat(?:\s[^>]*)?>(([\s\S]*?))<\/(?:\w+:)?Seat>/gi);
    for (const seatMatch of seatMatches) {
      const seatXml = seatMatch[0]; // full match including attributes
      const seatInner = seatMatch[1];
      
      // v6 uses <Number>A</Number>, older uses <Column>A</Column>
      const col = (seatInner.match(/<(?:\w+:)?Number>([A-Z])<\//) || seatInner.match(/<(?:\w+:)?Column>([A-Z])<\//) || [])[1];
      if (!col) continue;
      columns.add(col);

      // Check availability via occupiedInd attribute or Occupation detail
      const occupiedAttr = seatXml.match(/occupiedInd="(true|false)"/);
      const inoperativeAttr = seatXml.match(/inoperativeInd="(true|false)"/);
      const hasSeatIsFree = seatInner.includes('SeatIsFree');
      const hasOccupied = seatInner.includes('SeatIsOccupied') || seatInner.includes('Occupied');
      const hasBlocked = seatInner.includes('Blocked') || (inoperativeAttr && inoperativeAttr[1] === 'true');
      
      let available;
      if (occupiedAttr) {
        available = occupiedAttr[1] === 'false' && !hasBlocked;
      } else {
        available = hasSeatIsFree || (!hasOccupied && !hasBlocked);
      }

      // Location details
      const isExit = seatXml.includes('exitRowInd="true"') || seatInner.includes('ExitRow') || seatInner.includes('EXIT');
      const isWindow = seatInner.includes('Window');
      const isAisle = seatInner.includes('Aisle');
      const isMiddle = seatInner.includes('Middle');
      const isPremium = seatXml.includes('premiumInd="true"');
      const isChargeable = seatXml.includes('chargeableInd="true"');

      // v6 price: <Offer><Price><TotalAmount>...</TotalAmount></Price></Offer>
      // Also try <BasePrice> and older <Amount>
      const priceMatch = seatInner.match(/<(?:\w+:)?TotalAmount>([0-9.]+)<\//) 
        || seatInner.match(/<(?:\w+:)?BasePrice>([0-9.]+)<\//)
        || seatInner.match(/<(?:\w+:)?Amount[^>]*>([0-9.]+)<\//);
      const currencyMatch = seatInner.match(/currencyCode="([A-Z]+)"/) 
        || seatInner.match(/<(?:\w+:)?Currency[^>]*>([A-Z]+)<\//);

      let type = 'standard';
      if (isExit) type = 'exit-row';
      else if (isPremium) type = 'premium';
      else if (isWindow) type = 'window';
      else if (isAisle) type = 'aisle';
      else if (isMiddle) type = 'middle';

      seats.push({
        id: `${rowNum}${col}`,
        row: parseInt(rowNum),
        col,
        type,
        status: available ? 'available' : 'occupied',
        price: priceMatch ? parseFloat(priceMatch[1]) : 0,
        currency: currencyMatch ? currencyMatch[1] : 'BDT',
        label: `${rowNum}${col}`,
        isExit,
        isPremium,
        isChargeable,
      });
    }

    if (seats.length > 0) {
      rows.push({ rowNumber: parseInt(rowNum), seats });
    }
  }

  if (rows.length === 0) return null;

  // Detect aisles from column layout
  const sortedCols = [...columns].sort();
  const aisleAfter = [];
  for (let i = 0; i < sortedCols.length - 1; i++) {
    const gap = sortedCols[i + 1].charCodeAt(0) - sortedCols[i].charCodeAt(0);
    if (gap > 1) aisleAfter.push(i);
  }

  const exitRows = rows.filter(r => r.seats.some(s => s.isExit)).map(r => r.rowNumber);

  return {
    columns: sortedCols,
    totalRows: rows.length,
    rows,
    exitRows,
    aisleAfter,
    source: 'sabre-soap',
  };
}

function parseAncillaryXml(xml) {
  const meals = [];
  const baggage = [];
  const other = [];

  // Extract ancillary offers
  const offerMatches = xml.matchAll(/<Offer[^>]*>([\s\S]*?)<\/Offer>/gi);
  for (const match of offerMatches) {
    const offerXml = match[1];

    const name = (offerXml.match(/<CommercialName>([^<]+)<\/CommercialName>/) || [])[1] || '';
    const code = (offerXml.match(/<SubCode>([^<]+)<\/SubCode>/) || [])[1] || '';
    const group = (offerXml.match(/<GroupCode>([^<]+)<\/GroupCode>/) || [])[1] || '';
    const priceMatch = offerXml.match(/<TotalAmount>([0-9.]+)<\/TotalAmount>/) || offerXml.match(/<Amount>([0-9.]+)<\/Amount>/);
    const price = priceMatch ? parseFloat(priceMatch[1]) : 0;
    const currency = (offerXml.match(/<Currency>([A-Z]+)<\/Currency>/) || [])[1] || 'BDT';

    const item = {
      id: code || `anc_${meals.length + baggage.length + other.length}`,
      code,
      name: name || code,
      price,
      currency,
      group,
    };

    // Categorize by group code
    // BG = Baggage, ML = Meal, SA = Seat, PT = Pet, etc.
    if (group === 'BG' || group === 'CY' || name.toLowerCase().includes('baggage') || name.toLowerCase().includes('bag')) {
      // Extract weight if in name
      const weightMatch = name.match(/(\d+)\s*kg/i);
      baggage.push({
        ...item,
        weight: weightMatch ? parseInt(weightMatch[1]) : null,
        description: name,
        type: 'checked',
      });
    } else if (group === 'ML' || name.toLowerCase().includes('meal') || name.toLowerCase().includes('food')) {
      meals.push({
        ...item,
        description: name,
        category: 'airline',
      });
    } else {
      other.push(item);
    }
  }

  if (meals.length === 0 && baggage.length === 0 && other.length === 0) return null;

  return {
    meals,
    baggage,
    other,
    source: 'sabre-soap',
  };
}

/**
 * Cancel a PNR via SOAP OTA_CancelLLSRQ within a stateful session.
 * This works when REST cancel returns 403 NOT_AUTHORIZED.
 * Flow: SessionCreate → Retrieve PNR → Cancel segments → EndTransaction → SessionClose
 */
async function cancelPnrViaSoap(pnr) {
  const config = await getSabreConfig();
  if (!config) throw new Error('Sabre API not configured');

  console.log(`[Sabre SOAP] Cancel PNR via SOAP: ${pnr}`);

  // Reuse cached session if valid; otherwise create one.
  // This avoids unnecessary SessionCreate calls and reduces Host TA exhaustion.
  let session;
  try {
    session = await createSession(config);
  } catch (err) {
    throw new Error(`SOAP session failed: ${err.message}`);
  }

  const soapUrl = getSoapEndpoint(config);
  const { token, conversationId } = session;

  try {
    // Step 1: Retrieve PNR (TravelItineraryReadRQ)
    const retrieveEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Header>
    <MessageHeader xmlns="http://www.ebxml.org/namespaces/messageHeader">
      <From><PartyId>Agency</PartyId></From>
      <To><PartyId>Sabre_API</PartyId></To>
      <ConversationId>${conversationId}</ConversationId>
      <Action>TravelItineraryReadRQ</Action>
    </MessageHeader>
    <Security xmlns="http://schemas.xmlsoap.org/ws/2002/12/secext">
      <BinarySecurityToken>${token}</BinarySecurityToken>
    </Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <TravelItineraryReadRQ Version="3.10.0" xmlns="http://services.sabre.com/res/tir/v3_10">
      <MessagingDetails><SubjectAreas><SubjectArea>FULL</SubjectArea></SubjectAreas></MessagingDetails>
      <UniqueID ID="${pnr}"/>
    </TravelItineraryReadRQ>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

    const retrieveRes = await fetch(soapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'TravelItineraryReadRQ' },
      body: retrieveEnvelope,
      signal: AbortSignal.timeout(15000),
    });
    const retrieveXml = await retrieveRes.text();

    // Check if PNR was retrieved successfully
    const faultMatch = retrieveXml.match(/faultstring>([^<]+)/);
    if (faultMatch) {
      throw new Error(`PNR retrieve failed: ${faultMatch[1]}`);
    }

    console.log(`[Sabre SOAP] PNR ${pnr} retrieved in session, proceeding to cancel`);

    // Step 2: Cancel all segments via OTA_CancelLLSRQ
    const cancelEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Header>
    <MessageHeader xmlns="http://www.ebxml.org/namespaces/messageHeader">
      <From><PartyId>Agency</PartyId></From>
      <To><PartyId>Sabre_API</PartyId></To>
      <ConversationId>${conversationId}</ConversationId>
      <Action>OTA_CancelLLSRQ</Action>
    </MessageHeader>
    <Security xmlns="http://schemas.xmlsoap.org/ws/2002/12/secext">
      <BinarySecurityToken>${token}</BinarySecurityToken>
    </Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <OTA_CancelRQ Version="2.0.2" xmlns="http://webservices.sabre.com/sabreXML/2011/10">
      <Segment Type="entire"/>
    </OTA_CancelRQ>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

    const cancelRes = await fetch(soapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'OTA_CancelLLSRQ' },
      body: cancelEnvelope,
      signal: AbortSignal.timeout(15000),
    });
    const cancelXml = await cancelRes.text();

    const cancelFault = cancelXml.match(/faultstring>([^<]+)/);
    const cancelError = cancelXml.match(/<Error[^>]*>([^<]*)</) || cancelXml.match(/ErrorMessage>([^<]+)/);
    if (cancelFault) {
      throw new Error(`SOAP cancel fault: ${cancelFault[1]}`);
    }

    console.log(`[Sabre SOAP] Cancel response received for ${pnr}`);

    // Step 3: End Transaction to save changes
    const etEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Header>
    <MessageHeader xmlns="http://www.ebxml.org/namespaces/messageHeader">
      <From><PartyId>Agency</PartyId></From>
      <To><PartyId>Sabre_API</PartyId></To>
      <ConversationId>${conversationId}</ConversationId>
      <Action>EndTransactionLLSRQ</Action>
    </MessageHeader>
    <Security xmlns="http://schemas.xmlsoap.org/ws/2002/12/secext">
      <BinarySecurityToken>${token}</BinarySecurityToken>
    </Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <EndTransactionRQ Version="2.0.9" xmlns="http://webservices.sabre.com/sabreXML/2011/10">
      <EndTransaction Ind="true"/>
      <Source ReceivedFrom="SEVEN TRIP API CANCEL"/>
    </EndTransactionRQ>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

    const etRes = await fetch(soapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'EndTransactionLLSRQ' },
      body: etEnvelope,
      signal: AbortSignal.timeout(15000),
    });
    const etXml = await etRes.text();

    const etFault = etXml.match(/faultstring>([^<]+)/);
    if (etFault) {
      console.warn(`[Sabre SOAP] EndTransaction warning: ${etFault[1]}`);
    }

    console.log(`[Sabre SOAP] PNR ${pnr} cancelled and saved successfully`);
    return { success: true, method: 'soap-cancel', pnr };

  } catch (err) {
    const rawError = err?.message || 'SOAP cancel failed';
    const enrichedError = /limit of host tas|host tas allocated/i.test(rawError)
      ? `${rawError} | Sabre Host TA limit reached on PCC. Wait for active sessions to expire or ask Sabre to increase/release TA allocation.`
      : rawError;

    console.error(`[Sabre SOAP] Cancel failed for ${pnr}:`, enrichedError);
    return { success: false, error: enrichedError, method: 'soap-cancel' };
  } finally {
    // Always close session
    await closeSession(config, token, conversationId);
  }
}

/**
 * Invalidate the SOAP session cache (e.g. after config change)
 */
function clearSoapSessionCache() {
  _sessionCache = { token: null, conversationId: null, expiresAt: 0 };
}

// ═══════════════════════════════════════════════════════════════
// SECTION 20: Structured Fare Rules (StructureFareRulesRQ v3.0.1)
// ═══════════════════════════════════════════════════════════════
async function getStructuredFareRules(params) {
  const config = await getSabreConfig();
  if (!config) return { success: false, error: 'Sabre SOAP not configured' };

  let token, conversationId;
  try {
    ({ token, conversationId } = await createSession(config));
  } catch (err) {
    return { success: false, error: `Session failed: ${err.message}` };
  }

  const soapUrl = getSoapEndpoint(config);
  const { origin, destination, departureDate, arrivalDate, airlineCode, flightNumber, fareBasis, bookingClass, passengerType = 'ADT', passengerCount = 1 } = params;

  const rbd = bookingClass || 'Y';
  const depDate = departureDate || '';
  const arrDate = arrivalDate || depDate;

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:eb="http://www.ebxml.org/namespaces/messageHeader"
  xmlns:xlink="http://www.w3.org/1999/xlink">
  <SOAP-ENV:Header>
    <eb:MessageHeader SOAP-ENV:mustUnderstand="1" eb:version="1.0">
      <eb:From><eb:PartyId>Agency</eb:PartyId></eb:From>
      <eb:To><eb:PartyId>Sabre_API</eb:PartyId></eb:To>
      <eb:CPAId>${config.pcc}</eb:CPAId>
      <eb:ConversationId>${conversationId}</eb:ConversationId>
      <eb:Service>StructureFareRulesRQ</eb:Service>
      <eb:Action>StructureFareRulesRQ</eb:Action>
    </eb:MessageHeader>
    <wsse:Security xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext">
      <wsse:BinarySecurityToken>${token}</wsse:BinarySecurityToken>
    </wsse:Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <StructureFareRulesRQ xmlns="http://webservices.sabre.com/sabreXML/2003/07" Version="3.0.1">
      <PriceRequestInformation BuyingDate="${new Date().toISOString().split('.')[0]}">
        <PassengerTypes>
          <PassengerType Code="${passengerType}" Count="${passengerCount}"/>
        </PassengerTypes>
        <ReturnFareComponentPenalties Ind="true"/>
      </PriceRequestInformation>
      <AirItinerary>
        <OriginDestinationOptions>
          <OriginDestinationOption>
            <FlightSegment ArrivalDate="${arrDate}T23:59:00" DepartureDate="${depDate}T00:00:00"
              FlightNumber="${String(flightNumber || '').replace(/\D/g, '')}" RealReservationStatus="HK"
              ResBookDesigCode="${rbd}" SegmentNumber="1" SegmentType="A">
              <DepartureAirport LocationCode="${origin}"/>
              <ArrivalAirport LocationCode="${destination}"/>
              <MarketingAirline Code="${airlineCode}"/>
              <OperatingAirline Code="${airlineCode}"/>
            </FlightSegment>
            <SegmentInformation SegmentNumber="1"/>
            <PaxTypeInformation FareBasisCode="${fareBasis || rbd + 'OW'}" FareComponentNumber="1" PassengerType="${passengerType}"/>
          </OriginDestinationOption>
        </OriginDestinationOptions>
      </AirItinerary>
    </StructureFareRulesRQ>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  try {
    const res = await fetch(soapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'StructureFareRulesRQ' },
      body: envelope,
      signal: AbortSignal.timeout(20000),
    });

    const xml = await res.text();
    console.log(`[Sabre SOAP] FareRules response length: ${xml.length}`);

    // Check for SOAP fault
    const faultMatch = xml.match(/faultstring>([^<]+)/);
    if (faultMatch) {
      return { success: false, error: faultMatch[1], source: 'sabre-soap' };
    }

    // Parse fare rules from XML
    const rules = [];
    const ruleRegex = /<Category[^>]*Number="(\d+)"[^>]*>[\s\S]*?<\/Category>/g;
    let match;
    while ((match = ruleRegex.exec(xml)) !== null) {
      rules.push({ categoryNumber: match[1], rawXml: match[0] });
    }

    // Parse penalty information
    const penalties = [];
    const penaltyRegex = /<Penalty[^>]*Type="([^"]*)"[^>]*>[\s\S]*?<\/Penalty>/g;
    while ((match = penaltyRegex.exec(xml)) !== null) {
      const type = match[1];
      const amountMatch = match[0].match(/Amount="([^"]*)"/);
      const currencyMatch = match[0].match(/Currency[Cc]ode="([^"]*)"/);
      const applicabilityMatch = match[0].match(/Applicability="([^"]*)"/);
      penalties.push({
        type,
        amount: amountMatch ? parseFloat(amountMatch[1]) : null,
        currency: currencyMatch ? currencyMatch[1] : 'BDT',
        applicability: applicabilityMatch ? applicabilityMatch[1] : null,
      });
    }

    // Parse specific rules text
    const exchangePenalty = penalties.find(p => /exchange|reissue|change/i.test(p.type));
    const refundPenalty = penalties.find(p => /refund|cancel/i.test(p.type));
    const noShowPenalty = penalties.find(p => /no.?show/i.test(p.type));

    return {
      success: true,
      source: 'sabre-soap',
      fareRules: {
        fareBasis: fareBasis || '',
        airlineCode,
        origin,
        destination,
        penalties,
        exchangePenalty: exchangePenalty || null,
        refundPenalty: refundPenalty || null,
        noShowPenalty: noShowPenalty || null,
        categories: rules.length,
      },
      rawXml: xml.substring(0, 5000),
    };
  } catch (err) {
    console.error(`[Sabre SOAP] FareRules failed:`, err.message);
    return { success: false, error: err.message, source: 'sabre-soap' };
  } finally {
    await closeSession(config, token, conversationId);
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 22: Exchange / Reissue (ExchangeBookingRQ v1.1.0)
// ═══════════════════════════════════════════════════════════════
async function exchangeBooking(params) {
  const config = await getSabreConfig();
  if (!config) return { success: false, error: 'Sabre SOAP not configured' };

  let token, conversationId;
  try {
    ({ token, conversationId } = await createSession(config));
  } catch (err) {
    return { success: false, error: `Session failed: ${err.message}` };
  }

  const soapUrl = getSoapEndpoint(config);
  const {
    pnr, originalTicketNumber, cancelSegments = [1],
    newSegments = [], nameNumber = '1.1',
    priceIncreaseTolerance = 10, priceDecreaseTolerance = 10,
  } = params;

  // Build new flight segments XML — ensure datetimes are never empty
  const toSoapDT = (val) => {
    if (!val) return '';
    const raw = String(val).trim();
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
    if (m) return `${m[1]}T${m[2]}:00`;
    return raw.replace('Z', '').split('.')[0].replace(/[+-]\d{2}:?\d{2}$/, '');
  };

  const segmentsXml = newSegments.map(seg => {
    const depDT = toSoapDT(seg.departureTime);
    const arrDT = toSoapDT(seg.arrivalTime) || depDT; // fallback to departure if arrival missing
    if (!depDT) return ''; // skip segments with no datetime
    return `
        <FlightSegment DepartureDateTime="${depDT}" ArrivalDateTime="${arrDT}"
          FlightNumber="${String(seg.flightNumber || '').replace(/\D/g, '')}" NumberInParty="${seg.partySize || 1}"
          ResBookDesigCode="${seg.bookingClass || 'Y'}" Status="NN">
          <DestinationLocation LocationCode="${seg.destination || ''}"/>
          <MarketingAirline Code="${seg.airlineCode || ''}" FlightNumber="${String(seg.flightNumber || '').replace(/\D/g, '')}"/>
          <OriginLocation LocationCode="${seg.origin || ''}"/>
        </FlightSegment>`;
  }).filter(Boolean).join('');

  const cancelXml = cancelSegments.map(n => `<Segment Number="${n}"/>`).join('');

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:eb="http://www.ebxml.org/namespaces/messageHeader">
  <SOAP-ENV:Header>
    <eb:MessageHeader SOAP-ENV:mustUnderstand="1" eb:version="1.0">
      <eb:From><eb:PartyId>Agency</eb:PartyId></eb:From>
      <eb:To><eb:PartyId>Sabre_API</eb:PartyId></eb:To>
      <eb:CPAId>${config.pcc}</eb:CPAId>
      <eb:ConversationId>${conversationId}</eb:ConversationId>
      <eb:Service>ExchangeBookingRQ</eb:Service>
      <eb:Action>ExchangeBookingRQ</eb:Action>
    </eb:MessageHeader>
    <wsse:Security xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext">
      <wsse:BinarySecurityToken>${token}</wsse:BinarySecurityToken>
    </wsse:Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <ExchangeBookingRQ xmlns="http://services.sabre.com/sp/exchange/booking/v1_1" version="1.1.0">
      <Itinerary id="${pnr}">
        <SegmentPricing>
          <SegmentSelect number="1"/>
        </SegmentPricing>
      </Itinerary>
      <Cancel>${cancelXml}</Cancel>
      <AirBook>
        <HaltOnStatus Code="HL"/>
        <HaltOnStatus Code="KK"/>
        <HaltOnStatus Code="LL"/>
        <HaltOnStatus Code="NN"/>
        <HaltOnStatus Code="NO"/>
        <HaltOnStatus Code="UC"/>
        <HaltOnStatus Code="US"/>
        <OriginDestinationInformation>${segmentsXml}
        </OriginDestinationInformation>
      </AirBook>
      <AutomatedExchanges>
        <ExchangeComparison OriginalTicketNumber="${originalTicketNumber || ''}">
          <PriceRequestInformation>
            <OptionalQualifiers>
              <PricingQualifiers>
                <NameSelect NameNumber="${nameNumber}"/>
              </PricingQualifiers>
            </OptionalQualifiers>
          </PriceRequestInformation>
        </ExchangeComparison>
        <PriceComparison amountSpecified="0">
          <AcceptablePriceIncrease haltOnNonAcceptablePrice="false">
            <Percent>${priceIncreaseTolerance}</Percent>
          </AcceptablePriceIncrease>
          <AcceptablePriceDecrease haltOnNonAcceptablePrice="false">
            <Percent>${priceDecreaseTolerance}</Percent>
          </AcceptablePriceDecrease>
        </PriceComparison>
      </AutomatedExchanges>
      <PostProcessing returnPQRInfo="true">
        <EndTransaction>
          <Source ReceivedFrom="SEVEN TRIP EXCHANGE"/>
        </EndTransaction>
      </PostProcessing>
    </ExchangeBookingRQ>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  try {
    const res = await fetch(soapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'ExchangeBookingRQ' },
      body: envelope,
      signal: AbortSignal.timeout(30000),
    });

    const xml = await res.text();
    console.log(`[Sabre SOAP] Exchange response length: ${xml.length}`);
    console.log(`[Sabre SOAP] Exchange XML (first 3000): ${xml.substring(0, 3000)}`);

    // Check for SOAP fault
    const faultMatch = xml.match(/faultstring>([^<]+)/);
    if (faultMatch) {
      return { success: false, error: faultMatch[1], source: 'sabre-soap' };
    }

    // Check for ExchangeBookingRS error
    const errorMatch = xml.match(/ErrorMessage[^>]*>([^<]+)/) || xml.match(/Message[^>]*>([^<]+)/);

    // Extract new PNR from response
    const newPnrMatch = xml.match(/ItineraryRef[^>]*ID="([A-Z]{6})"/) || xml.match(/Locator[^>]*>([A-Z]{6})</);
    const newTicketMatch = xml.match(/DocumentNumber[^>]*>(\d{13})</) || xml.match(/TicketNumber[^>]*>(\d{13})</);

    if (newPnrMatch || !errorMatch) {
      return {
        success: true,
        method: 'exchange',
        pnr: newPnrMatch ? newPnrMatch[1] : pnr,
        newTicketNumber: newTicketMatch ? newTicketMatch[1] : null,
        rawXml: xml.substring(0, 5000),
      };
    } else {
      return {
        success: false,
        error: errorMatch ? errorMatch[1] : 'Exchange failed — check response',
        method: 'exchange',
        rawXml: xml.substring(0, 5000),
      };
    }
  } catch (err) {
    console.error(`[Sabre SOAP] Exchange failed for PNR ${pnr}:`, err.message);
    return { success: false, error: err.message, method: 'exchange' };
  } finally {
    await closeSession(config, token, conversationId);
  }
}

// ══════════════════════════════════════════════
//  SOAP HOTEL SEARCH — OTA_HotelAvailLLSRQ v2.3.0
// ══════════════════════════════════════════════

const HOTEL_AVAIL_ACTION_VARIANTS = [
  { label: 'llsrq', service: 'OTA_HotelAvailLLSRQ', action: 'OTA_HotelAvailLLSRQ', soapAction: 'OTA_HotelAvailLLSRQ' },
  { label: 'rq', service: 'OTA_HotelAvailRQ', action: 'OTA_HotelAvailRQ', soapAction: 'OTA_HotelAvailRQ' },
  { label: 'mixed-1', service: 'OTA_HotelAvailLLSRQ', action: 'OTA_HotelAvailRQ', soapAction: 'OTA_HotelAvailRQ' },
  { label: 'mixed-2', service: 'OTA_HotelAvailRQ', action: 'OTA_HotelAvailLLSRQ', soapAction: 'OTA_HotelAvailLLSRQ' },
];

const HOTEL_DETAILS_ACTION_VARIANTS = [
  { label: 'llsrq', service: 'HotelPropertyDescriptionLLSRQ', action: 'HotelPropertyDescriptionLLSRQ', soapAction: 'HotelPropertyDescriptionLLSRQ' },
  { label: 'rq', service: 'HotelPropertyDescriptionRQ', action: 'HotelPropertyDescriptionRQ', soapAction: 'HotelPropertyDescriptionRQ' },
  { label: 'mixed-1', service: 'HotelPropertyDescriptionLLSRQ', action: 'HotelPropertyDescriptionRQ', soapAction: 'HotelPropertyDescriptionRQ' },
  { label: 'mixed-2', service: 'HotelPropertyDescriptionRQ', action: 'HotelPropertyDescriptionLLSRQ', soapAction: 'HotelPropertyDescriptionLLSRQ' },
];

let hotelLlsUnavailableUntil = 0;
let hotelLlsUnavailableReason = '';

function markHotelLlsUnavailable(reason, minutes = 30) {
  hotelLlsUnavailableUntil = Date.now() + minutes * 60 * 1000;
  hotelLlsUnavailableReason = reason || 'Unknown Hotel LLS error';
  console.warn(`[Sabre SOAP] Hotel LLS temporarily disabled (${minutes}m): ${hotelLlsUnavailableReason}`);
}

function isHotelLlsUnavailable() {
  return Date.now() < hotelLlsUnavailableUntil;
}

function isInvalidEbxmlAction(messageOrXml = '') {
  return /Action specified in EbxmlMessage does not exist|USG_INVALID_ACTION|Client\.InvalidAction/i.test(String(messageOrXml || ''));
}

/**
 * Search hotels by city code using OTA_HotelAvailLLSRQ
 * Uses session-based SOAP (same credentials as flights)
 * @param {Object} params - { cityCode, cityName, checkIn (YYYY-MM-DD), checkOut (YYYY-MM-DD), guests, rooms }
 * @returns {Array} list of hotel availability results
 */
async function getHotelAvail(params, _retried = false) {
  const config = await getSabreConfig();
  if (!config) return [];

  let token, conversationId;
  try {
    ({ token, conversationId } = await createSession(config));
  } catch (err) {
    if (!_retried && isSoapSessionError(err.message)) {
      await resetSoapSessionCacheWithClose(config);
      return getHotelAvail(params, true);
    }
    console.error('[Sabre SOAP] Hotel session failed:', err.message);
    return [];
  }

  const soapUrl = getSoapEndpoint(config);
  const guestCount = Math.max(1, parseInt(params.guests || params.adults || 2, 10) || 2);

  // TimeSpan uses MM-DD format for Sabre LLS
  const startMD = params.checkIn ? params.checkIn.slice(5) : '';
  const endMD = params.checkOut ? params.checkOut.slice(5) : '';
  const cityName = escapeXml(params.cityName || params.cityCode || '');
  const cityType = String(params.cityType || '1');

  const buildEnvelope = (criterionXml, actionVariant) => {
    const serviceTag = actionVariant.service
      ? `<eb:Service eb:type="sabreXML">${actionVariant.service}</eb:Service>`
      : '<eb:Service eb:type="sabreXML"/>';

    return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:eb="http://www.ebxml.org/namespaces/messageHeader"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <SOAP-ENV:Header>
    <eb:MessageHeader SOAP-ENV:mustUnderstand="1" eb:version="1.0">
      <eb:From><eb:PartyId eb:type="URI">Agency</eb:PartyId></eb:From>
      <eb:To><eb:PartyId eb:type="URI">Sabre_API</eb:PartyId></eb:To>
      <eb:CPAId>${config.pcc}</eb:CPAId>
      <eb:ConversationId>${conversationId}</eb:ConversationId>
      ${serviceTag}
      <eb:Action>${actionVariant.action}</eb:Action>
      <eb:MessageData>
        <eb:MessageId>${Date.now()}.${Math.random().toString(36).slice(2, 10)}</eb:MessageId>
        <eb:Timestamp>${new Date().toISOString()}</eb:Timestamp>
      </eb:MessageData>
    </eb:MessageHeader>
    <wsse:Security xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext">
      <wsse:BinarySecurityToken>${token}</wsse:BinarySecurityToken>
    </wsse:Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <OTA_HotelAvailRQ Version="2.3.0" ReturnHostCommand="true" xmlns="http://webservices.sabre.com/sabreXML/2011/10"
      xmlns:xs="http://www.w3.org/2001/XMLSchema"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <AvailRequestSegment>
        <GuestCounts Count="${guestCount}"/>
        <HotelSearchCriteria>
          <Criterion>
            ${criterionXml}
          </Criterion>
        </HotelSearchCriteria>
        <TimeSpan End="${endMD}" Start="${startMD}"/>
      </AvailRequestSegment>
    </OTA_HotelAvailRQ>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
  };

  const criteriaAttempts = [
    {
      label: 'city+address',
      criterionXml: `<Address><CityName>${cityName}</CityName></Address><HotelRef HotelCityCode="${params.cityCode}" RefPointType="${cityType}"/>`,
    },
    {
      label: 'city-code-only',
      criterionXml: `<HotelRef HotelCityCode="${params.cityCode}" RefPointType="${cityType}"/>`,
    },
    {
      label: 'city-code-no-type',
      criterionXml: `<HotelRef HotelCityCode="${params.cityCode}"/>`,
    },
  ];

  try {
    console.log(`[Sabre SOAP] Hotel search: ${params.cityCode}, ${params.checkIn} → ${params.checkOut}, ${guestCount} guests`);

    let lastDiagnostics = null;
    for (const actionVariant of HOTEL_AVAIL_ACTION_VARIANTS) {
      let actionRejected = false;

      for (const criteriaAttempt of criteriaAttempts) {
        const attemptLabel = `${actionVariant.label}:${criteriaAttempt.label}`;
        const envelope = buildEnvelope(criteriaAttempt.criterionXml, actionVariant);

        const res = await fetch(soapUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': actionVariant.soapAction },
          body: envelope,
          signal: AbortSignal.timeout(30000),
        });

        const xml = await res.text();
        const diagnostics = extractSoapDiagnostics(xml);
        lastDiagnostics = diagnostics;
        console.log(`[Sabre SOAP] Hotel search response length (${attemptLabel}): ${xml.length}`);

        if (xml.length < 3000) {
          try { require('fs').writeFileSync('/tmp/sabre-hotel-response.xml', xml); } catch {}
          console.log(`[Sabre SOAP] Hotel FULL XML (${attemptLabel}) written to /tmp/sabre-hotel-response.xml`);
          console.log(`[Sabre SOAP] Hotel XML preview (${attemptLabel}): ${xml.replace(/\n/g, ' ').slice(0, 500)}`);
        }

        const faultMsg = xml.match(/faultstring>([^<]+)/i)?.[1] || '';
        if (faultMsg) {
          if (!_retried && isSoapSessionError(faultMsg)) {
            await resetSoapSessionCacheWithClose(config);
            return getHotelAvail(params, true);
          }

          if (isInvalidEbxmlAction(faultMsg)) {
            actionRejected = true;
            console.error(`[Sabre SOAP] Hotel search invalid action (${attemptLabel}): ${faultMsg}`);
            break;
          }

          console.error(`[Sabre SOAP] Hotel search fault (${attemptLabel}): ${faultMsg}`);
          continue;
        }

        if (diagnostics.status) {
          console.warn(`[Sabre SOAP] Hotel search status (${attemptLabel})=${diagnostics.status}`);
        }
        if (diagnostics.messages.length > 0) {
          console.warn(`[Sabre SOAP] Hotel search messages (${attemptLabel}): ${diagnostics.messages.join(' | ')}`);
        }

        const hotels = parseHotelAvailResponse(xml, params);
        if (hotels.length > 0) {
          console.log(`[Sabre SOAP] Hotel search success via ${attemptLabel}: ${hotels.length} hotels`);
          return hotels;
        }

        if (diagnostics.hostCommand) {
          console.warn(`[Sabre SOAP] HostCommand (${attemptLabel}): ${diagnostics.hostCommand}`);
        }
        if (diagnostics.xmlHint) {
          console.warn(`[Sabre SOAP] Hotel search empty result hint (${attemptLabel}): ${diagnostics.xmlHint}`);
        }
        if (diagnostics.rawPreview) {
          console.warn(`[Sabre SOAP] Hotel search raw preview (${attemptLabel}): ${diagnostics.rawPreview}`);
        }
      }

      if (actionRejected) {
        continue;
      }
    }

    if (lastDiagnostics?.messages?.length) {
      console.warn(`[Sabre SOAP] Hotel search exhausted all action/request variants: ${lastDiagnostics.messages.join(' | ')}`);
    }
    console.warn('[Sabre SOAP] Hotel search failed across all action variants; if this persists, ask Sabre to enable Hotel LLS actions for PCC J4YL.');
    return [];
  } catch (err) {
    if (!_retried && isSoapSessionError(err.message)) {
      await resetSoapSessionCacheWithClose(config);
      return getHotelAvail(params, true);
    }
    console.error('[Sabre SOAP] Hotel search error:', err.message);
    return [];
  }
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function extractSoapDiagnostics(xml) {
  const compactXml = String(xml || '').replace(/\s+/g, ' ').trim();

  const status =
    xml.match(/<(?:\w+:)?ApplicationResults[^>]*\bstatus="([^"]+)"/i)?.[1]
    || xml.match(/<(?:\w+:)?ApplicationResults[^>]*\bStatus="([^"]+)"/i)?.[1]
    || null;

  const textMessageMatches = [
    ...xml.matchAll(/<(?:\w+:)?Message(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?Message>/gi),
    ...xml.matchAll(/<(?:\w+:)?Error(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?Error>/gi),
    ...xml.matchAll(/<(?:\w+:)?Warning(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?Warning>/gi),
    ...xml.matchAll(/<(?:\w+:)?Diagnostic(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?Diagnostic>/gi),
  ].map(m => m?.[1] || '');

  const attrMessageMatches = [
    ...xml.matchAll(/\bShortText="([^"]+)"/gi),
    ...xml.matchAll(/\bErrorCode="([^"]+)"/gi),
    ...xml.matchAll(/\bCode="([^"]+)"/gi),
    ...xml.matchAll(/\bMessage="([^"]+)"/gi),
    ...xml.matchAll(/\bType="([^"]+)"/gi),
  ].map(m => m?.[1] || '');

  const messages = [...new Set([
    ...textMessageMatches,
    ...attrMessageMatches,
  ]
    .map(s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean))]
    .slice(0, 8);

  const xmlHint =
    compactXml.match(/<(?:\w+:)?ApplicationResults[\s\S]*?<\/(?:\w+:)?ApplicationResults>/i)?.[0]?.slice(0, 700)
    || compactXml.match(/<(?:\w+:)?Errors?[\s\S]*?<\/(?:\w+:)?Errors?>/i)?.[0]?.slice(0, 700)
    || compactXml.match(/<(?:\w+:)?Warnings?[\s\S]*?<\/(?:\w+:)?Warnings?>/i)?.[0]?.slice(0, 700)
    || '';

  const hostCommand =
    xml.match(/<(?:\w+:)?HostCommand(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?HostCommand>/i)?.[1]?.replace(/\s+/g, ' ').trim()
    || xml.match(/\bHostCommand="([^"]+)"/i)?.[1]
    || null;

  const rawPreview = compactXml.slice(0, 700);

  return { status, messages, xmlHint, hostCommand, rawPreview };
}

function firstMatchFloat(text, patterns) {
  for (const pattern of patterns) {
    const raw = text.match(pattern)?.[1];
    if (!raw) continue;
    const value = Number.parseFloat(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

/**
 * Parse OTA_HotelAvailRS XML into normalized hotel objects
 */
function parseHotelAvailResponse(xml, params) {
  const hotels = [];
  try {
    const availBlocks = [
      ...[...xml.matchAll(/<(?:\w+:)?HotelAvailInfo\b[\s\S]*?<\/(?:\w+:)?HotelAvailInfo>/gi)].map(m => m[0]),
      ...[...xml.matchAll(/<(?:\w+:)?HotelAvailInfo\b[^>]*\/>/gi)].map(m => m[0]),
    ];
    const roomStayBlocks = [
      ...[...xml.matchAll(/<(?:\w+:)?RoomStay\b[\s\S]*?<\/(?:\w+:)?RoomStay>/gi)].map(m => m[0]),
      ...[...xml.matchAll(/<(?:\w+:)?RoomStay\b[^>]*\/>/gi)].map(m => m[0]),
    ];
    const fallbackBlocks = [
      ...[...xml.matchAll(/<(?:\w+:)?BasicPropertyInfo\b[\s\S]*?(?:\/>|<\/(?:\w+:)?BasicPropertyInfo>)/gi)].map(m => m[0]),
      ...[...xml.matchAll(/<(?:\w+:)?HotelRef\b[\s\S]*?(?:\/>|<\/(?:\w+:)?HotelRef>)/gi)].map(m => m[0]),
    ];
    const blocks = availBlocks.length > 0 ? availBlocks : (roomStayBlocks.length > 0 ? roomStayBlocks : fallbackBlocks);

    const nights = params.checkIn && params.checkOut
      ? Math.max(1, Math.ceil((new Date(params.checkOut) - new Date(params.checkIn)) / 86400000))
      : 1;

    for (const block of blocks) {
      const propertyXml = block.match(/<(?:\w+:)?BasicPropertyInfo\b[\s\S]*?(?:\/>|<\/(?:\w+:)?BasicPropertyInfo>)/i)?.[0] || block;
      const attr = (src, name) => src.match(new RegExp(`\\b${name}="([^"]+)"`, 'i'))?.[1] || '';
      const tagText = (src, tag) => src.match(new RegExp(`<(?:\\w+:)?${tag}>([^<]+)<\\/(?:\\w+:)?${tag}>`, 'i'))?.[1]?.trim() || '';

      const hotelCode = attr(propertyXml, 'HotelCode') || tagText(block, 'HotelCode');
      const hotelName = attr(propertyXml, 'HotelName') || tagText(block, 'HotelName') || tagText(block, 'PropertyName') || tagText(block, 'Name');
      if (!hotelCode) continue;
      const resolvedHotelName = hotelName || `Hotel ${hotelCode}`;

      const cityCode = attr(propertyXml, 'HotelCityCode') || tagText(block, 'HotelCityCode') || params.cityCode || '';
      const latitude = attr(propertyXml, 'Latitude') || tagText(block, 'Latitude');
      const longitude = attr(propertyXml, 'Longitude') || tagText(block, 'Longitude');
      const distance = attr(propertyXml, 'Distance') || tagText(block, 'Distance');
      const chainCode = attr(propertyXml, 'ChainCode') || tagText(block, 'ChainCode');
      const brandCode = attr(propertyXml, 'BrandCode');

      const addressLine = tagText(block, 'AddressLine');
      const cityName = tagText(block, 'CityName');
      const countryCode = tagText(block, 'CountryCode');

      const sabreRatingRaw = attr(propertyXml, 'Rating');
      const starRating = Number.isFinite(Number.parseFloat(sabreRatingRaw))
        ? Number.parseFloat(sabreRatingRaw)
        : 0;

      const minRate = firstMatchFloat(block, [
        /<(?:\w+:)?RateRange[^>]*\bMin="([^"]+)"/i,
        /<(?:\w+:)?RateRange[^>]*\bMinRate="([^"]+)"/i,
        /\bMin="([^"]+)"/i,
        /\bMinRate="([^"]+)"/i,
        /\bAmountBeforeTax="([^"]+)"/i,
        /\bAmount="([^"]+)"/i,
      ]);
      const maxRate = firstMatchFloat(block, [
        /<(?:\w+:)?RateRange[^>]*\bMax="([^"]+)"/i,
        /<(?:\w+:)?RateRange[^>]*\bMaxRate="([^"]+)"/i,
        /\bMax="([^"]+)"/i,
        /\bMaxRate="([^"]+)"/i,
      ]);
      const price = minRate > 0 ? minRate : maxRate;
      const currencyCode =
        block.match(/<(?:\w+:)?RateRange[^>]*\bCurrencyCode="([^"]+)"/i)?.[1]
        || attr(propertyXml, 'CurrencyCode')
        || 'USD';

      const tags = [];
      if (starRating >= 5) tags.push('Luxury');
      else if (starRating >= 4) tags.push('Top Rated');

      hotels.push({
        id: `sabre-${hotelCode}`,
        sabreHotelCode: hotelCode,
        source: 'sabre',
        name: resolvedHotelName,
        city: cityName || cityCode,
        country: countryCode,
        address: addressLine,
        latitude: latitude ? Number.parseFloat(latitude) : null,
        longitude: longitude ? Number.parseFloat(longitude) : null,
        starRating,
        stars: starRating,
        userRating: starRating > 0 ? Number((starRating * 0.9).toFixed(1)) : null,
        rating: starRating > 0 ? Number((starRating * 0.9).toFixed(1)) : null,
        reviewCount: 0,
        reviews: 0,
        pricePerNight: price > 0 ? Math.round(price) : 0,
        price: price > 0 ? Math.round(price) : 0,
        totalPrice: price > 0 ? Math.round(price * nights) : 0,
        originalPrice: maxRate > 0 ? Math.round(maxRate) : null,
        currency: currencyCode,
        img: null,
        images: [],
        amenities: [],
        description: '',
        tags,
        tag: tags[0] || null,
        location: `${cityName || cityCode}, ${countryCode}`.replace(/, $/, ''),
        cancelPolicy: null,
        isFreeCancellation: false,
        rateKey: null,
        nights,
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        chainCode,
        brandCode,
        distance: distance ? Number.parseFloat(distance) : null,
      });
    }

    console.log(`[Sabre SOAP] Parsed ${hotels.length} hotels from OTA_HotelAvailRS`);
  } catch (err) {
    console.error('[Sabre SOAP] Hotel parse error:', err.message);
  }
  return hotels;
}

/**
 * Get hotel property description (details) using HotelPropertyDescriptionLLSRQ
 * @param {Object} params - { hotelCode, checkIn, checkOut, guests }
 * @returns {Object|null} hotel details
 */
async function getHotelPropertyDescription(params, _retried = false) {
  const config = await getSabreConfig();
  if (!config) return null;

  let token, conversationId;
  try {
    ({ token, conversationId } = await createSession(config));
  } catch (err) {
    if (!_retried && isSoapSessionError(err.message)) {
      await resetSoapSessionCacheWithClose(config);
      return getHotelPropertyDescription(params, true);
    }
    return null;
  }

  const soapUrl = getSoapEndpoint(config);
  const guestCount = parseInt(params.guests || params.adults || 2);
  const startMD = params.checkIn ? params.checkIn.slice(5) : '';
  const endMD = params.checkOut ? params.checkOut.slice(5) : '';

  const buildEnvelope = (actionVariant) => `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:eb="http://www.ebxml.org/namespaces/messageHeader"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <SOAP-ENV:Header>
    <eb:MessageHeader SOAP-ENV:mustUnderstand="1" eb:version="1.0">
      <eb:From><eb:PartyId eb:type="URI">Agency</eb:PartyId></eb:From>
      <eb:To><eb:PartyId eb:type="URI">Sabre_API</eb:PartyId></eb:To>
      <eb:CPAId>${config.pcc}</eb:CPAId>
      <eb:ConversationId>${conversationId}</eb:ConversationId>
      <eb:Service eb:type="sabreXML">${actionVariant.service}</eb:Service>
      <eb:Action>${actionVariant.action}</eb:Action>
      <eb:MessageData>
        <eb:MessageId>${Date.now()}.${Math.random().toString(36).slice(2, 10)}</eb:MessageId>
        <eb:Timestamp>${new Date().toISOString()}</eb:Timestamp>
      </eb:MessageData>
    </eb:MessageHeader>
    <wsse:Security xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext">
      <wsse:BinarySecurityToken>${token}</wsse:BinarySecurityToken>
    </wsse:Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <HotelPropertyDescriptionRQ Version="2.3.0" xmlns="http://webservices.sabre.com/sabreXML/2011/10"
      xmlns:xs="http://www.w3.org/2001/XMLSchema"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <AvailRequestSegment>
        <GuestCounts Count="${guestCount}"/>
        <HotelSearchCriteria>
          <Criterion>
            <HotelRef HotelCode="${params.hotelCode}"/>
          </Criterion>
        </HotelSearchCriteria>
        <TimeSpan End="${endMD}" Start="${startMD}"/>
      </AvailRequestSegment>
    </HotelPropertyDescriptionRQ>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  try {
    console.log(`[Sabre SOAP] Hotel details: code=${params.hotelCode}`);

    for (const actionVariant of HOTEL_DETAILS_ACTION_VARIANTS) {
      const res = await fetch(soapUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': actionVariant.soapAction },
        body: buildEnvelope(actionVariant),
        signal: AbortSignal.timeout(20000),
      });

      const xml = await res.text();
      const faultMsg = xml.match(/faultstring>([^<]+)/i)?.[1] || '';
      if (faultMsg) {
        if (!_retried && isSoapSessionError(faultMsg)) {
          await resetSoapSessionCacheWithClose(config);
          return getHotelPropertyDescription(params, true);
        }

        if (isInvalidEbxmlAction(faultMsg)) {
          console.warn(`[Sabre SOAP] Hotel details invalid action (${actionVariant.label}): ${faultMsg}`);
          continue;
        }

        console.error(`[Sabre SOAP] Hotel details fault (${actionVariant.label}): ${faultMsg}`);
        continue;
      }

      const parsed = parseHotelPropertyDescription(xml, params);
      if (parsed) {
        return parsed;
      }
    }

    console.warn('[Sabre SOAP] Hotel details failed across all action variants; this usually indicates Hotel LLS entitlement is missing for current PCC.');
    return null;
  } catch (err) {
    if (!_retried && isSoapSessionError(err.message)) {
      await resetSoapSessionCacheWithClose(config);
      return getHotelPropertyDescription(params, true);
    }
    console.error('[Sabre SOAP] Hotel details error:', err.message);
    return null;
  }
}

function parseHotelPropertyDescription(xml, params) {
  try {
    const hotelCode = xml.match(/HotelCode="([^"]+)"/)?.[1] || params.hotelCode;
    const hotelName = xml.match(/HotelName="([^"]+)"/)?.[1] || '';
    const addressLine = xml.match(/<AddressLine>([^<]+)/)?.[1] || '';
    const cityName = xml.match(/<CityName>([^<]+)/)?.[1] || '';
    const countryCode = xml.match(/<CountryCode>([^<]+)/)?.[1] || '';
    const postalCode = xml.match(/<PostalCode>([^<]+)/)?.[1] || '';
    const latitude = xml.match(/Latitude="([^"]+)"/)?.[1];
    const longitude = xml.match(/Longitude="([^"]+)"/)?.[1];
    const phone = xml.match(/<Phone[^>]*>([^<]+)/)?.[1] || '';
    const fax = xml.match(/<Fax[^>]*>([^<]+)/)?.[1] || '';
    const sabreRating = xml.match(/Rating="([^"]+)"/)?.[1];
    const starRating = sabreRating ? parseInt(sabreRating) : 0;

    // Extract description text
    const descTexts = xml.match(/<Text>([^<]+)/g) || [];
    const description = descTexts.map(t => t.replace('<Text>', '')).join(' ').trim();

    // Extract amenities from PropertyOptionInfo or Text blocks
    const amenities = [];
    const amenityMatches = xml.match(/Ind="true"[^/]*\/>/g) || [];
    // Also look for named amenities
    if (xml.includes('POOL')) amenities.push('Swimming Pool');
    if (xml.includes('FREE WIFI') || xml.includes('INTERNET')) amenities.push('Free WiFi');
    if (xml.includes('RESTAURANT') || xml.includes('DINING')) amenities.push('Restaurant');
    if (xml.includes('PARKING')) amenities.push('Parking');
    if (xml.includes('GYM') || xml.includes('FITNESS')) amenities.push('Fitness Center');
    if (xml.includes('SPA')) amenities.push('Spa');
    if (xml.includes('ROOM SERVICE')) amenities.push('Room Service');
    if (xml.includes('BREAKFAST')) amenities.push('Breakfast');
    if (xml.includes('BAR') || xml.includes('LOUNGE')) amenities.push('Bar/Lounge');
    if (xml.includes('AIRPORT')) amenities.push('Airport Shuttle');
    if (xml.includes('LAUNDRY')) amenities.push('Laundry');
    if (xml.includes('BUSINESS CENTER')) amenities.push('Business Center');

    // Extract room rates
    const rooms = [];
    const rateBlocks = xml.match(/<RoomRate[\s\S]*?<\/RoomRate>/g) || [];
    for (const block of rateBlocks) {
      const roomType = block.match(/RoomType="([^"]+)"/)?.[1] || 'Standard';
      const rateAmount = block.match(/Amount="([^"]+)"/)?.[1];
      const rateCurrency = block.match(/CurrencyCode="([^"]+)"/)?.[1] || 'USD';
      const rateDesc = block.match(/<Text>([^<]+)/)?.[1] || '';
      const guaranteeRequired = block.includes('GuaranteeRequired="true"');
      
      if (rateAmount) {
        const nights = params.checkIn && params.checkOut
          ? Math.max(1, Math.ceil((new Date(params.checkOut) - new Date(params.checkIn)) / 86400000))
          : 1;
        const nightly = parseFloat(rateAmount);
        rooms.push({
          id: `room-${rooms.length + 1}`,
          name: rateDesc || `${roomType} Room`,
          type: roomType,
          bedType: 'Double',
          maxGuests: parseInt(params.guests || 2),
          price: Math.round(nightly),
          totalPrice: Math.round(nightly * nights),
          nights,
          currency: rateCurrency,
          cancellationPolicy: 'Contact hotel for cancellation policy',
          isRefundable: false,
          mealPlan: null,
          rateKey: null,
          bookingKey: null,
          amenities: [],
          source: 'sabre',
          guaranteeRequired,
        });
      }
    }

    rooms.sort((a, b) => a.price - b.price);

    return {
      id: `sabre-${hotelCode}`,
      sabreHotelCode: hotelCode,
      source: 'sabre',
      name: hotelName,
      city: cityName,
      country: countryCode,
      address: addressLine,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      starRating,
      stars: starRating,
      userRating: starRating > 0 ? starRating * 0.9 : null,
      rating: starRating > 0 ? starRating * 0.9 : null,
      reviewCount: 0,
      reviews: 0,
      images: [],
      amenities,
      description,
      policies: [],
      checkInTime: '15:00',
      checkOutTime: '11:00',
      contactInfo: { phone, fax },
      rooms,
    };
  } catch (err) {
    console.error('[Sabre SOAP] Hotel property parse error:', err.message);
    return null;
  }
}

module.exports = {
  createSession,
  closeSession,
  getSeatMap,
  getAncillaryOffers,
  cancelPnrViaSoap,
  clearSoapSessionCache,
  getStructuredFareRules,
  exchangeBooking,
  // Hotel SOAP
  getHotelAvail,
  getHotelPropertyDescription,
};
