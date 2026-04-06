# Seven Trip — GDS Integration History & Troubleshooting

> Complete timeline of all GDS provider integrations, issues encountered, and solutions applied.
> Last updated: 2026-04-06 (v4.2.0 — Wallet-Centric Finance, Ticket Issue Requests)

---

## 📋 Provider Overview

| Provider | Type | First Integrated | File | Auth Method |
|----------|------|-----------------|------|-------------|
| TTI/ZENITH | WCF SOAP-like | v2.5 (Mar 9) | `tti-flights.js` | API Key (DB) |
| BDFare | REST API v2 | v2.5 (Mar 9) | `bdf-flights.js` | Token auth (DB) |
| FlyHub | REST API | v2.5 (Mar 9) | `flyhub-flights.js` | Token auth (DB) |
| Sabre REST | REST API v5 | v3.5 (Mar 12) | `sabre-flights.js` | OAuth v3 password grant (DB) |
| Sabre SOAP | SOAP/XML | v3.5 (Mar 12) | `sabre-soap.js` | BinarySecurityToken session |

---

## 🔧 TTI/ZENITH (Air Astra) Integration

### Timeline
| Date | Version | Event |
|------|---------|-------|
| Mar 9 | v2.5 | Initial integration — SearchFlights + CreateBooking |
| Mar 10 | v3.0 | Enhanced seat availability extraction from AirCoupons |
| Mar 11 | v3.3 | Cabin class mapping (case-insensitive) |
| Mar 13 | v3.9.6 | **Critical fix**: Cancel API requires airline PNR, not TTI booking ID |
| Mar 13 | v3.9.9.6 | **CHLD/INFT SSR fix**: Added SpecialServices with DateOfBirth for child/infant passengers |
| Mar 13 | v3.9.6 | **Critical fix**: Cancel API requires airline PNR, not TTI booking ID |

### Issues & Resolutions

#### Issue #1: Cancel API Wrong ID (v3.9.6)
- **Symptom**: Cancellation requests failing silently
- **Root Cause**: `cancelBooking()` sent internal TTI ID (e.g., `STTTI-xxx`) instead of airline PNR (e.g., `S2240313001234`)
- **Investigation**: Probe matrix of 6 payload combinations:
  1. `{ BookingID: ttiBookingId }` → ❌
  2. `{ BookingID: airlinePNR }` → ✅
  3. `{ PNR: airlinePNR }` → ❌
  4. `{ RecordLocator: airlinePNR }` → ❌
  5. `{ BookingReference: airlinePNR }` → ❌
  6. `{ BookingID: bookingRef }` → ❌
- **Fix**: Extract airline PNR from `booking.details.gdsResponse` with priority chain: `RecordLocator` → `BookingReference` → `PNR` → `ETTicketFares[0].Ref`

#### Issue #2: Cabin Class Always Economy (v3.3)
- **Symptom**: Business/First class searches returned Economy labels
- **Root Cause**: TTI doesn't differentiate cabin classes for ATR 72-600 aircraft
- **Fix**: Case-insensitive cabin mapping; amber banner when searched class unavailable

#### Issue #3: Date Parsing Errors (v3.1)
- **Symptom**: "Invalid Date" in e-ticket PDFs
- **Root Cause**: TTI returns dates in WCF `/Date(ms+offset)/` format
- **Fix**: Robust date parser handling WCF, ISO, and epoch formats

---

## 🔧 BDFare Integration

### Timeline
| Date | Version | Event |
|------|---------|-------|
| Mar 9 | v2.5 | Initial integration |
| Mar 12 | v3.7.7 | **Complete normalizer rewrite** to match actual API v2 structure |
| Mar 13 | v3.9.9.6 | **Booking wired** — `createBooking()` now called from `POST /flights/book` for BDFare-sourced flights |

### Issues & Resolutions

#### Issue #1: Zero Results Returned (v3.7.7)
- **Symptom**: BDFare searches returned 0 flights
- **Root Cause**: Normalizer expected v1 response shape (`flights[]`), but API v2 returns `Response.Results[]` with `segments[].Airline`, `segments[].Origin/Destination`, `Fares[].BaseFare/Tax`
- **Fix**: Complete rewrite of `normalizeBDFareResponse`

#### Issue #2: Carrier Filter Not Working (v3.7.7)
- **Symptom**: Preferred airline dropdown had no effect
- **Root Cause**: `carrier` query param not extracted from URL and not applied post-search
- **Fix**: Added `carrier` param extraction and case-insensitive IATA code filtering

#### Issue #3: Duration Parsing (v3.7.7)
- **Symptom**: Flight duration showing "NaN"
- **Root Cause**: BDFare returns duration as `"17h 50m"` string, not minutes
- **Fix**: Added regex parser for BDFare-specific duration format

---

## 🔧 Sabre REST Integration

### Timeline
| Date | Version | Event |
|------|---------|-------|
| Mar 12 | v3.5 | Initial BFM v5 search + PNR creation |
| Mar 12 | v3.7.9 | Branded fares extraction |
| Mar 12 | v3.9.1 | Compressed response fix |
| Mar 12 | v3.9.2 | DateTime schema fix for PNR |
| Mar 12 | v3.9.3 | DOCS schema fix (remove unsupported fields) |
| Mar 13 | v3.9.7 | **NamePrefix removal** — title appended to GivenName |
| Mar 13 | v3.9.9 | **Full endpoint coverage**: revalidatePrice, getBooking, checkTicketStatus, getSeatsRest; ticketing upgraded to v1.3.0 |
| Mar 13 | v3.9.9.4 | **REST GetSeats resilience**: v3+v1 contract probing, explicit PNR viewership handling (700102), SOAP fallback when REST fails |
| Mar 13 | v3.9.9.6 | **Full DOCS payload**: Type, Number, ExpirationDate, DateOfBirth, Gender, IssueCountry, Nationality, GivenName, Surname |
| Mar 13 | v3.9.9.7 | **DOCS strict mode**: no fallback to `no_special_req` when passport DOCS exist; airline PNR from CreatePNR response; smart passport field detection (file path vs number); AreaCityCode removed |

### Issues & Resolutions

#### Issue #1: Compressed Response — 0 Flights (v3.9.1)
- **Symptom**: All Sabre searches returned 0 flights
- **Root Cause**: `CompressResponse: true` in BFM request caused Sabre to return base64-gzip blob under `compressedResponse` key; normalizer only handled `groupedItineraryResponse`
- **Fix**: Removed `CompressResponse` flag; added `zlib.gunzipSync` fallback decompression

#### Issue #2: PNR DateTime Validation Error (v3.9.2)
- **Symptom**: `NotProcessed` status on PNR creation
- **Root Cause**: Segment datetimes sent with timezone offsets (`2026-04-15T21:55:00+06:00`), violating Sabre schema
- **Fix**: Added `toSabreDateTime()` normalizer to strip timezone suffixes

#### Issue #3: DOCS Schema Validation (v3.9.3)
- **Symptom**: 400 validation error on PNR creation
- **Root Cause**: `AdvancePassenger.Document` included unsupported fields
- **Fix**: Initially stripped to minimal fields, later (v3.9.9.6) expanded to full payload with correct field names

#### Issue #4: NamePrefix Rejection (v3.9.7)
- **Symptom**: `ERR.SP.CLIENT.VALIDATION_FAILED` — `NamePrefix` property not allowed in `PersonName`
- **Root Cause**: Sabre schema does not accept `NamePrefix` as a property of `PersonName`
- **Fix**: Removed `NamePrefix`; title appended to `GivenName` (e.g., `"MR JOHN"`) per Sabre standard

#### Issue #5: Round-Trip Deduplication (v3.7.8)
- **Symptom**: Round-trip search showing only 1 result instead of hundreds
- **Root Cause**: Dedup key used only first-leg flight number + departure time, collapsing all combos sharing same outbound
- **Fix**: Dedup key now includes ALL leg flight numbers, arrival times, direction, and per-leg departure times

#### Issue #6: NDC Fares Not Appearing
- **Status**: Not a code issue — PCC J4YL lacks NDC entitlements
- **Action Required**: Contact Sabre account manager to activate NDC carrier agreements

#### Issue #7: REST GetSeats PNR Access/Schema Mismatch (v3.9.9.4)
- **Symptom**: `/flights/seats-rest` returned 400 or viewership errors
- **Fix**: Probe v3 and v1 payload variants, surface `hint` for viewership restrictions, auto-fallback to SOAP

#### Issue #8: DOCS Not Appearing in Sabre (v3.9.9.6–v3.9.9.7)
- **Symptom**: PNR created successfully but `*PD` command shows no passport data
- **Root Cause (v3.9.9.6)**: Bare-minimum DOCS fields silently rejected by Sabre; `VendorPrefs.Airline.Hosted: true` wrong
- **Root Cause (v3.9.9.7)**: `passport` field contained file upload path not passport number; `no_special_req` fallback created PNR without DOCS
- **Fix**: Full DOCS payload (9 fields) + `Hosted: false` + airline Code + smart passport field detection + DOCS strict mode
- **Reference**: Analyzed Ticketlagbe and BDFare HAR logs — both send same expanded DOCS payload server-side

#### Issue #9: AreaCityCode Validation Error (v3.9.9.7)
- **Symptom**: `ERR.SP.CLIENT.VALIDATION_FAILED` — `AreaCityCode` not allowed in `ContactNumber`
- **Fix**: Removed `AreaCityCode` field from ContactNumbers mapping

---

## 🔧 Sabre SOAP Integration

### Timeline
| Date | Version | Event |
|------|---------|-------|
| Mar 12 | v3.5 | SessionCreateRQ, EnhancedSeatMapRQ v6, GetAncillaryOffersRQ v3 |
| Mar 13 | v3.9.6 | Cancel PNR via SOAP fallback (when REST fails) |
| Mar 13 | v3.9.7 | **Seat map retry** with session cache clearing |
| Mar 13 | v3.9.9.9 | **Host TA exhaustion fix**: `resetSoapSessionCacheWithClose()`, retry-only on session errors, proper session close |

### Issues & Resolutions

#### Issue #1: Seat Map Returning Null on Production (v3.9.7)
- **Symptom**: `{ layout: null, source: "none", available: false }` intermittently on production
- **Root Cause**: Cached SOAP BinarySecurityToken expired (14-min TTL) but cache didn't invalidate
- **Fix**: On SOAP fault or `NotProcessed`, clear session cache and retry once with fresh token
- **Verification**: AI (126 seats), EK (276 seats), SQ (159 seats) all returning data

#### Issue #2: Missing getSabreConfig Import (v3.9.6)
- **Symptom**: `cancelPnrViaSoap` crashing — `getSabreConfig is not defined`
- **Root Cause**: `sabre-soap.js` had its own `getSabreConfig` but cancel function used undefined variable
- **Fix**: Added local config loader + exported `cancelPnrViaSoap`

#### Issue #3: Host TA Pool Exhaustion (v3.9.9.9)
- **Symptom**: All SOAP calls failing with "You have reached the limit of Host TAs allocated to you"
- **Root Cause**: Multiple concurrent SOAP sessions (seat maps + cancel retries) leaked without proper `SessionCloseRQ`, exhausting Sabre's Host Terminal Address pool for PCC J4YL / TAM pool ABBDJ4YL
- **Fix**: 
  1. `resetSoapSessionCacheWithClose()` — closes stale session before creating new one
  2. `isSoapSessionError()` regex gate — only retries on session/auth/network errors, not application errors
  3. `cancelPnrViaSoap()` always closes session in `finally` block
- **Recovery**: TA pool auto-recovers after stale sessions expire (~15-30 min)
- **Verification**: PNR AQDAMJ (airline PNR FDDPE6) cancelled successfully after TA pool recovery

### Session Management
- Token cached with 14-minute TTL (Sabre sessions expire at 15 min)
- `createSession()` → `SessionCreateRQ` → extracts `BinarySecurityToken`
- `closeSession()` → `SessionCloseRQ` → invalidates cache
- `resetSoapSessionCacheWithClose()` — closes stale session then clears cache (v3.9.9.9)
- All SOAP calls share the cached session token
- Automatic retry with fresh session on fault detection (gated by `isSoapSessionError()` regex)
- **Host TA limit**: PCC J4YL has finite TA allocation. If exhausted, wait ~30 min or contact Sabre to release/increase

---

## 🔧 Multi-Provider Search Architecture

### Search Flow
```
GET /flights/search?from=DAC&to=DXB&date=2026-04-15&adults=1

    ┌──────────────────────────────────────────┐
    │           Promise.allSettled              │
    │                                          │
    │  ┌────────┐  ┌────────┐  ┌────────┐     │
    │  │  TTI   │  │ BDFare │  │ FlyHub │     │
    │  └────┬───┘  └────┬───┘  └────┬───┘     │
    │       │           │           │          │
    │  ┌────┴───┐  ┌────┴───┐               │
    │  │ Sabre  │  │Galileo │  (planned)      │
    │  └────┬───┘  └────┴───┘               │
    │       │                                  │
    │  ┌────▼─────────────────────────┐        │
    │  │  Normalize + Dedup + Sort    │        │
    │  └──────────────────────────────┘        │
    └──────────────────────────────────────────┘
```

### Deduplication Key
```
key = flightNumber + departureTime + arrivalTime + destination + stops +
      stopCodes + direction + [all legs' flightNumber@departureTime]
```

### Provider Priority for Ancillaries
```
Seat Map:  Sabre SOAP EnhancedSeatMapRQ (pre+post) → Sabre REST GetSeats v1 (post-booking PNR only) → TTI → "Not Available"
Seat Assignment: POST /flights/assign-seats → Sabre UpdatePNR SSR RQST (post-booking) → TTI UpdateBooking SpecialService SEAT
Meals:     Sabre SOAP GetAncillaryOffersRQ (post-booking only) → Stateless REST (v4.0.0) → TTI → empty
Baggage:   Sabre SOAP GetAncillaryOffersRQ (post-booking only) → Stateless REST (v4.0.0) → TTI → empty
Ancillary Purchase: POST /flights/purchase-ancillary → Sabre UpdatePNR SSR (XBAG, meal codes) via addAncillarySSR
Ancillary Stateless: POST /flights/ancillaries-stateless → Sabre REST /v1/offers/getAncillaries (v4.0.0)
Add Ancillary: POST /flights/add-ancillary-stateless → Sabre REST /v1/offers/addAncillaries (v4.0.0)
EMD Fulfill: POST /flights/fulfill-tickets → Sabre REST /v1/trip/orders/fulfillOrder (v4.0.0)
SSR:       REST CreatePNR (at booking time) — meals, wheelchair, medical, FF#
Void:      POST /flights/void → Sabre REST /v1/trip/orders/voidFlightTickets (v4.0.0)
Refund:    POST /flights/refund/price + /refund/fulfill → Sabre REST stateless refunds (v4.0.0)
Exchange:  POST /flights/exchange → Sabre SOAP ExchangeBookingRQ v1.1.0 (v4.0.0)
Fare Rules: GET /flights/fare-rules → Sabre SOAP StructureFareRulesRQ v3.0.1 (v4.0.0)
FLIFO:     GET /flights/status → Sabre REST /products/air/flight/status (v4.0.0)
FF Update: POST /flights/update-frequent-flyer → Sabre UpdatePNR FQTV SSR (v4.0.0)
```

> **Note**: Sabre REST GetSeats v1 (`/v1/offers/getseats`) requires a PNR or offerId — it cannot do raw flight+date lookups like SOAP EnhancedSeatMapRQ. SOAP remains the primary seat map provider for pre-booking.

### Ticket Issuance Flow (v4.2.0)
```
User pays from wallet → POST /dashboard/wallet/pay (atomic transaction)
  → Deducts wallet balance
  → Updates booking payment_status='paid'
  → Creates ticket_issue_request (status='pending')

Admin processes → PUT /admin/ticket-issue-requests/:id { action: 'issue' }
  → Detects GDS source from booking.details (sabre/tti/bdfare/flyhub)
  → Calls provider's issueTicket() function with PNR
  → On success: booking status='ticketed', ticket row created, request status='issued'
  → On failure: request status reverts to 'pending' with GDS error note
```

### Production Airline Support Matrix (Verified 2026-03-17)
```
✅ SEAT MAP WORKING (6 airlines):
   EK (Emirates) 33 rows | SQ (Singapore) 35 rows | AI (Air India) 23 rows
   TG (Thai) 26 rows | TK (Turkish) 35 rows | CZ (China Southern) 35 rows

❌ NO SEAT MAP (15 airlines — Sabre SOAP returns no data for these carriers from DAC):
   BG (Biman) | BS (US-Bangla) | 2A (Air Astra) | QR (Qatar) | SV (Saudia)
   GF (Gulf Air) | KU (Kuwait) | WY (Oman Air) | EY (Etihad) | FZ (flydubai)
   G9 (Air Arabia) | MH (Malaysia) | CX (Cathay Pacific) | 6E (IndiGo) | UL (SriLankan)

📋 ANCILLARIES (meals/baggage/seat selection):
   Pre-booking: NOT available (GAO requires PNR context)
   Post-booking: Available for airlines with active GAO support
   SSR injection: Available at PNR creation for ALL carriers

🎫 CABIN CLASS DISPLAY (v4.1.5):
   Card labels derive cabin from booking class letter (J→Business, V→Economy, F→First)
   Fare options sorted: searched cabin first → other cabins by price
   Branded names: Economy Convenience (V), Business Saver (C), First Class (F), etc.
```

---

## 📊 API Response Time Benchmarks (Production VPS)

| Operation | Provider | Typical Response Time |
|-----------|----------|----------------------|
| Flight Search | Sabre BFM | 2-5 seconds |
| Flight Search | BDFare | 3-6 seconds |
| Flight Search | TTI | 1-3 seconds |
| Seat Map | Sabre SOAP | 1-3 seconds |
| Seat Map | Sabre REST | 1-3 seconds |
| Ancillaries | Sabre SOAP GAO | 2-4 seconds |
| PNR Creation | Sabre REST | 3-8 seconds |
| Price Revalidation | Sabre REST | 2-4 seconds |
| Get Booking | Sabre REST | 1-2 seconds |
| Ticket Status | Sabre REST | 1-2 seconds |
| Ticketing | Sabre REST v1.3.0 | 3-8 seconds |
| Booking Cancel | Sabre SOAP (primary) | 3-8 seconds |
| Booking Cancel | Sabre REST (403 blocked) | N/A — PCC lacks privileges |
| Booking Cancel | TTI | 1-2 seconds |

---

## 🔑 Credential Management

All GDS credentials stored in `system_settings` table with key `api_<provider>`:
- `api_tti` — TTI/ZENITH URL, API key, Agency ID
- `api_bdf` — BDFare token, URL
- `api_flyhub` — FlyHub username, API key
- `api_sabre` — Sabre EPR, PCC, agency password, client ID/secret, environment (cert/prod)

**Cache:** All configs cached for 5 minutes with `clearXxxConfigCache()` functions called on admin settings save.

**Security:** No API keys in `.env` files or source code. All read from database at runtime.
