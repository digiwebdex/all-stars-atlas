# Seven Trip — API Changelog

> All backend API changes, new endpoints, breaking changes, and schema updates per version.
> Last updated: 2026-03-17 (v4.1.6)

---

## v4.1.6 — 2026-03-17

### Changed (Backend — Sabre API Resilience)
- **`sabreRequest()`** in `sabre-flights.js` now gracefully handles empty or non-JSON Sabre responses
- Prevents `Unexpected end of JSON input` crashes when Sabre FLIFO or Fare Rules endpoints return empty bodies
- Returns structured `{ error: 'Empty response' }` instead of throwing

### No New Endpoints

---

## v4.1.0 — 2026-03-14

### Changed (Backend — Sabre Passenger Types)
- **Child PTC codes**: `createBooking()` now calculates child age from DOB and injects `PassengerType: { Code: 'C05'–'C11' }` per Sabre v2.4.0
- **Infant marker**: Infants include `Infant: { Ind: true, DateOfBirth: 'YYYY-MM-DD' }` on PersonName
- **NumberInParty**: Excludes infants (lap infants) — prevents overbooking seats

### Changed (Frontend — No API Impact)
- SearchWidget supports `initialFlightValues` and `compact` props
- Flight results compact pill bar replaces full-widget modification
- AnimatedFlightArc redesigned with animated chevrons and custom plane SVG

---

## v4.0.0 — 2026-03-14

### Added — 10 New Endpoints (Sabre Sections 17–26 Complete)

| Method | Endpoint | Sabre API | Section |
|--------|----------|-----------|---------|
| `POST` | `/flights/void` | `POST /v1/trip/orders/voidFlightTickets` | 24 |
| `POST` | `/flights/refund/price` | `POST /v1/offers/refund/price` | 23 |
| `POST` | `/flights/refund/fulfill` | `POST /v1/offers/refund/fulfill` | 23 |
| `POST` | `/flights/exchange` | SOAP `ExchangeBookingRQ v1.1.0` | 22 |
| `GET` | `/flights/fare-rules` | SOAP `StructureFareRulesRQ v3.0.1` | 20 |
| `GET` | `/flights/status` | `GET /products/air/flight/status` | 25 |
| `POST` | `/flights/ancillaries-stateless` | `POST /v1/offers/getAncillaries` | 17 |
| `POST` | `/flights/add-ancillary-stateless` | `POST /v1/offers/addAncillaries` | 18 |
| `POST` | `/flights/fulfill-tickets` | `POST /v1/trip/orders/fulfillOrder` | 18 |
| `POST` | `/flights/update-frequent-flyer` | UpdatePNR v2.4.0 FQTV SSR | 26 |

### New Backend Functions
- `sabre-flights.js` (8 new): `voidTickets()`, `refundPrice()`, `refundFulfill()`, `getFlightStatus()`, `getAncillariesStateless()`, `addAncillaryStateless()`, `fulfillTickets()`, `updateFrequentFlyer()`
- `sabre-soap.js` (2 new): `getStructuredFareRules()`, `exchangeBooking()`

---

## v3.9.9.9 — 2026-03-13

### Changed
- **Sabre SOAP cancel hardening**: `cancelPnrViaSoap()` now creates a dedicated session per cancel (not reused from seat map cache) to prevent Host TA exhaustion
- **SOAP session management**: Added `resetSoapSessionCacheWithClose()` — properly closes stale sessions before retry, reducing leaked TAs
- **SOAP retry filter**: `isSoapSessionError()` regex now gates retries to session/auth/network errors only — prevents Host TA waste on application-level errors
- **Cancel PNR resolution**: `resolveCancelLocators()` ensures GDS PNR (not airline PNR) is always used for cancellation
- **Cancel safety**: `/flights/cancel` blocks local status update when no valid GDS PNR exists
- **Enhanced cancel logging**: Shows `bookingRef`, `gdsPnr`, and `airlinePnr` separately in cancel logs

### Production Notes
- REST cancel endpoints (`/v2.0.2/booking/cancel`, `/v2.0.0/booking/cancel`) return 403 NOT_AUTHORIZED — PCC J4YL lacks REST cancel privileges
- SOAP cancel (`OTA_CancelLLSRQ`) is the confirmed working method
- Host TA pool can be exhausted if too many concurrent SOAP sessions are opened — sessions auto-recover after ~15-30 min

---

## v3.9.9.8 — 2026-03-13

### Changed (Frontend Only)
- All dashboards (user + admin) now display dual PNR: "Booking ID" (GDS PNR) + "Airlines PNR" (airline confirmation)
- E-Ticket PDF generator renders separate "BOOKING ID" and "AIRLINES PNR" header sections
- Post-booking success screen (`FlightBooking.tsx`) shows `airlinePnr` from booking response
- `BookingConfirmation.tsx`, `DashboardTickets.tsx` pass `airlinePnr` to PDF generator
- No backend API changes — `airlinePnr` already returned in `POST /flights/book` response since v3.9.9.7

---

## v3.9.9.7 — 2026-03-13

### Changed
- `POST /flights/book` Sabre path now returns `airlinePnr` extracted from CreatePNR response (before falling back to separate GetBooking call)
- `createBooking()` in `sabre-flights.js` returns `{ success, pnr, airlinePnr, createVariant, ticketTimeLimit, rawResponse }`
- **DOCS strict mode**: When passport DOCS entries exist in AdvancePassenger, the `no_special_req` fallback variant is disabled — booking must succeed with DOCS or fail explicitly
- Passport field resolution: detects file paths (e.g., `traveller/passport/xxx.jpg`) in `passport` field and skips them; checks `passportNumber`, `passportNo`, `documentNumber`, `travelDocumentNumber` in priority order
- Extended vendor locator regex: `reservationNumber` and `confirmationNumber` keys now included in airline PNR deep scan
- Removed `AreaCityCode` from Sabre `ContactNumber` schema (caused validation error)
- Contact info fallbacks: `contactPhone`/`contactEmail` aliases now supported alongside `phone`/`email`

---

## v3.9.9.6 — 2026-03-13

### Changed
- `POST /flights/book` now enforces passport DOCS SSR for both Sabre and TTI providers — all passengers must include `passportNumber`, `passportExpiry`, `dateOfBirth`, `gender`
- Backend normalizer in `flights.js` maps frontend field aliases (`passport` → `passportNumber`, `dob` → `dateOfBirth`)
- TTI CreateBooking payload includes `PassportNumber`, `PassportExpiry`, `DocumentInfo` for Air Astra
- Frontend booking form requires passport fields for all flights (domestic + international)

---

## v3.9.9.5 — 2026-03-13

### Changed
- `POST /flights/book` response now includes `gdsError` field when GDS booking fails
- `GET /flights/seats-rest` automatically falls back to SOAP for pre-booking seat maps (no PNR required)
- Airline PNR extraction uses 4-method deep scan of GetBooking response (GDS PNR ≠ Airline PNR)
- Sabre config auto-resolves to production (`api.platform.sabre.com`) when prod credentials present
- Advanced logging: every CreatePNR attempt logs environment, segments, passport DOCS, and errors

### Production Endpoints (Confirmed)
| Service | URL |
|---------|-----|
| REST | `https://api.platform.sabre.com` |
| SOAP | `https://webservices.platform.sabre.com` |
| Auth | `/v3/auth/token` (OAuth v3 password grant) |
| Book | `/v2.4.0/passenger/records?mode=create` |
| Retrieve | `/v1/trip/orders/getBooking` |
| Seats | `/v1/offers/getseats` |

---

## v3.9.9.4 — 2026-03-13

### Fixed
- `GET /flights/seats-rest` now probes **both** Sabre contracts: v3 (`/v3/offers/getseats/byPnrLocator`) and v1 (`/v1/offers/getseats`)
- Added explicit handling for PNR ownership/viewership errors (`code 700102`) with actionable `hint` in response
- Added automatic fallback to SOAP `EnhancedSeatMapRQ` when REST variants fail, so seat maps still return for supported carriers
- `debugAttempts` now includes endpoint-qualified variant names for faster root-cause analysis

### Confirmed Sabre Endpoints (from developer portal)
- Auth: `/v2/auth/token`
- Search: `/v4/offers/shop`
- Revalidate: `/v4/shop/flights/revalidate`
- Book: `/v2.4.0/passenger/records?mode=create`
- Cancel: `/v1/trip/orders/cancelBooking`
- Retrieve: `/v1/trip/orders/getBooking`
- Ticket: `/v1.3.0/air/ticket`
- Ticket Status: `/v1/trip/orders/checkFlightTickets`
- **Seats: `/v1/offers/getseats`**
- SOAP: `https://webservices.cert.platform.sabre.com`

### Verified — Airline Support Matrix
- **Pre-booking seat maps working**: EK (33 rows), SQ (35), AI (23), TG (26), TK (35), CZ (35) — all via Sabre SOAP
- **Not working from DAC**: BG, BS, 2A, QR, SV, GF, KU, WY, EY, FZ, G9, MH, CX, 6E, UL (Sabre limitation, not code bug)
- **Post-booking ancillaries**: GAO requires active PNR (auto-cancelled PNRs return "Proper request mode" error)

---

## v3.9.9 — 2026-03-13

### New Endpoints
- `POST /flights/revalidate-price` — Sabre BFM revalidation (`/v4/shop/flights/revalidate`) to verify fare before booking
- `GET /flights/booking/:pnr` — Retrieve PNR details via Sabre REST (`/v1/trip/orders/getBooking`)
- `GET /flights/ticket-status/:pnr` — Check ticket issuance status (`/v1/trip/orders/checkFlightTickets`)
- `GET /flights/seats-rest` — REST seat map via `/v2/offers/getseats` (requires PNR)

### Backend Changes
- **Ticketing upgraded**: `issueTicket()` now uses `/v1.3.0/air/ticket` (was v1.2.1)
- **3-tier seat map fallback**: SOAP EnhancedSeatMapRQ → REST GetSeats → TTI in `ancillaries.js`
- **New exports from `sabre-flights.js`**: `revalidatePrice`, `getBooking`, `checkTicketStatus`, `getSeatsRest`

---

## v3.9.7 — 2026-03-13

### Backend Changes
- **Sabre PNR fix**: Removed `NamePrefix` from `PersonName` in `CreatePassengerNameRecordRQ` — title appended to `GivenName` (e.g., `"JOHN MR"`)
- **SOAP retry logic**: `sabre-soap.js` now clears BinarySecurityToken cache on SOAP fault/NotProcessed and retries once with fresh session
- **shouldRetry regex**: Updated in `sabre-flights.js` to catch `PersonName`, `NamePrefix`, and `not allowed` validation errors

### No New Endpoints

---

## v3.9.6 — 2026-03-13

### Backend Changes
- **TTI cancel fix**: `cancelBooking()` now sends airline PNR (not internal TTI ID) — extracts from `gdsResponse` priority chain: `RecordLocator` → `BookingReference` → `PNR` → `ETTicketFares[0].Ref`
- **Sabre SOAP cancel**: Fixed missing `getSabreConfig` import, added `cancelPnrViaSoap` to exports

### No New Endpoints

---

## v3.9.3 — 2026-03-12

### Backend Changes
- **Sabre DOCS fix**: Stripped unsupported fields from `AdvancePassenger.Document` (`DateOfBirth`, `FirstName`, `LastName`, `Gender`) — now sends only `Type`, `Number`, `IssueCountry`, `NationalityCountry`, `ExpirationDate`

---

## v3.9.2 — 2026-03-12

### Backend Changes
- **DateTime normalization**: Added `toSabreDateTime()` to strip timezone offsets from segment datetimes before PNR creation

---

## v3.9.1 — 2026-03-12

### Backend Changes
- **Compressed response fix**: Removed `CompressResponse: true` from BFM request; added `zlib.gunzipSync` fallback decompression

---

## v3.9.0 — 2026-03-12

### New Endpoints
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/dashboard/bookings/:id/ancillaries` | Yes | Fetch Sabre GAO meal/baggage offers for a booking's PNR |

### Backend Changes
- **Auto-ticketing**: Payment callbacks (SSLCommerz/bKash/Nagad) now call `autoTicketAfterPayment()` — issues real GDS tickets on payment confirmation
- **Pay Later deadlines**: Removed hardcoded fallbacks; deadlines now exclusively from airline GDS `timeLimit`

### New Files
- `backend/src/services/auto-ticket.js`

---

## v3.8.0 — 2026-03-12

### No API Changes
Frontend-only: animated flight timeline

---

## v3.7.9 — 2026-03-12

### Backend Changes
- **Branded fares**: BFM normalizer extracts brand names from `fareComponentDescs` — returns `fareDetails[]` with `brandName`, `baggage`, `handBaggage`, `mealIncluded`, `seatSelection`, `rebookingAllowed`, `cancellationAllowed`
- **Dedup fix**: Key now includes ALL leg flight numbers, arrival time, direction, per-leg departure times

---

## v3.7.7 — 2026-03-12

### Backend Changes
- **BDFare normalizer rewrite**: Matches actual API v2 structure (`Response.Results[]`, `segments[].Airline`, `Fares[].BaseFare/Tax`)
- **Carrier filter**: Added `carrier` query param to `/flights/search` — post-aggregation IATA code filter
- **Duration parser**: Handles BDFare `"17h 50m"` format

---

## v3.7.2 — 2026-03-12

### New Endpoints
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/rewards/balance` | Yes | Current points balance |
| GET | `/rewards/history` | Yes | Transaction history (paginated) |
| GET | `/rewards/coupons` | Yes | User's coupon list |
| POST | `/rewards/redeem` | Yes | Convert points → coupon |
| POST | `/rewards/validate-coupon` | Yes | Check coupon validity |
| POST | `/rewards/apply-coupon` | Yes | Apply coupon to booking |
| GET | `/rewards/earn-rate` | No | Public earn rates |

### New Database Tables
- `user_points` — Per-user balance
- `point_transactions` — Earn/redeem ledger
- `reward_coupons` — Generated coupons
- `points_rules` — Admin earn rates per service

### Migration
```bash
mysql seventrip < backend/database/reward-points-migration.sql
```

---

## v3.5.0 — 2026-03-12

### New Endpoints
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/flights/seat-map` | Yes | Real-time seat map (Sabre SOAP EnhancedSeatMapRQ) |
| GET | `/flights/ancillaries` | Yes | Meal + baggage offers (Sabre SOAP GAO) |

### Backend Changes
- **Sabre SOAP session manager** (`sabre-soap.js`): SessionCreateRQ, EnhancedSeatMapRQ v6, GetAncillaryOffersRQ v3, SessionCloseRQ
- **Sabre REST PNR**: SSR injection (meals, wheelchair, medical, UMNR, pets, FF#, DOCA, OSI)
- **Ancillaries priority chain**: Sabre SOAP → TTI → Standard fallback

### New Files
- `backend/src/routes/sabre-soap.js`

---

## v3.3.0 — 2026-03-11

### Backend Changes
- **Admin markup config**: Settings PUT handles `markup_config` JSON
- **Invoice reminders**: `POST /admin/invoices/:id/remind` sends real email
- **Cabin class**: Sent to all GDS providers (TTI, BDFare, FlyHub, Sabre)

---

## v3.1.0 — 2026-03-10

### New Endpoints
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| PATCH | `/admin/bookings/:id/archive` | Admin | Soft-archive booking |
| DELETE | `/admin/bookings/:id` | Admin | Permanently delete booking |

### Backend Changes
- **GDS operations**: Admin can ticket/cancel/void via real GDS APIs (TTI, BDFare, FlyHub, Sabre)
- **Archived booking filter**: All 8 booking-related queries exclude archived bookings

---

## v3.0.0 — 2026-03-10

### Backend Changes
- **Booking APIs**: eSIM, Holiday, Medical, Car booking endpoints now persist to database and return real booking references
- **Zero-mock audit v2**: Removed all hardcoded fallback data

---

## v2.8.0 — 2026-03-09

### Backend Changes
- Company info update across all email templates and PDF generators

---

## v2.5.0 — 2026-03-09

### New Endpoints
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/flights/search` | No | Multi-GDS parallel flight search |
| POST | `/flights/book` | Yes | Create booking + PNR |
| POST | `/flights/upload-travel-docs` | Yes | Upload passport/visa |
| GET | `/flights/travel-docs/:bookingId` | Yes | Get uploaded documents |

### New Files
- `backend/src/routes/tti-flights.js`
- `backend/src/routes/bdf-flights.js`
- `backend/src/routes/flyhub-flights.js`
- `backend/src/routes/sabre-flights.js`

### Backend Changes
- **Database-backed API config**: All API keys moved from `.env` to `system_settings` table
- **TTI/BDFare/FlyHub/Sabre** integrated with parallel search via `Promise.allSettled`

---

## v2.2.0 — 2026-03-08

### New Endpoints
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/contact/subscribe` | No | Newsletter subscription |
| POST | `/dashboard/bookings/send-confirmation` | Yes | Email booking confirmation |

### Backend Changes
- **E-Transactions field mapping**: Returns `method`, `fee`, `date`
- **Dashboard pie chart**: Returns raw counts (frontend converts to %)

---

## v2.1.0 — 2026-03-08

### Backend Changes
- **Response shape standardization**: All listing endpoints return `{ data: [...] }`
- **SQL GROUP BY fix**: `only_full_group_by` compatibility
- **`safeJsonParse()`**: Prevents JSON.parse crashes on malformed DB data

### New Files
- `backend/src/utils/json.js`

---

## v1.9.0 — 2026-03-08

### New Files
- `backend/src/services/email.js` (Resend)
- `backend/src/services/sms.js` (BulkSMSBD)
- `backend/src/services/notify.js` (unified dispatcher)

### Backend Changes
- 10 notification triggers (register, OTP, booking, payment, visa, contact)

---

## v1.8.0 — 2026-03-08

### New Endpoints
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/social/google` | No | Google OAuth verification |
| POST | `/auth/social/facebook` | No | Facebook OAuth verification |
| GET | `/auth/social/config` | No | Public OAuth client IDs |

### New Files
- `backend/src/routes/social-auth.js`

### Database Migration
```bash
mysql seventrip < backend/database/social-auth-migration.sql
```

---

## v1.2.0 — 2026-03-03

### Initial API
All core endpoints created:
- Auth: login, register, logout, refresh, forgot-password, verify-otp, reset-password
- Dashboard: stats, bookings, transactions, travellers, payments, tickets, wishlist, settings
- Admin: dashboard, users, bookings, payments, reports, settings, visa
- CMS: pages, blog, promotions, destinations, media, email-templates
- Services: flights, hotels, holidays, visa, medical, cars, esim, recharge, paybill
- Contact: submit
