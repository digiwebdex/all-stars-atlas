# Seven Trip — Development Chat History & Decision Log

> Complete timeline of all development conversations, decisions made, bugs discovered, and features implemented.
> This serves as the institutional memory of the project — every significant interaction is recorded.
> Last updated: 2026-04-06 (v4.2.0 — Wallet-Centric Finance, Ticket Issue Requests)

---

## 📊 Summary

| Metric | Count |
|--------|-------|
| **Development Days** | 37 (Mar 1–Apr 6, 2026) |
| **Total Versions Released** | 60+ |
| **Bugs Discovered & Fixed** | 51 |
| **GDS Providers Integrated** | 5 (TTI, BDFare, FlyHub, Sabre REST, Sabre SOAP) |
| **Sabre Features** | 26/26 (100% coverage) |
| **VPS Deployments** | 12 |
| **Documentation Files** | 20+ |

---

## Phase 1: Foundation (Mar 1–2, 2026)

### v1.0 — Mar 1 — Initial Scaffold
- **Decision**: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Created**: Homepage with hero video, parallax effects, animated counters
- **Result**: Basic SPA scaffold with routing and error handling

### v1.1 — Mar 2 — Service Pages + Theme
- **Created**: All 10 service pages (Flights, Hotels, Visa, Holidays, Medical, Cars, eSIM, Recharge, PayBill)
- **Created**: Static pages (About, Contact, Blog, FAQ, Careers, Terms, Privacy, Refund Policy)
- **Created**: Responsive header/footer
- **Implemented**: Dark/light theme with system preference detection
- **Result**: 27 public pages complete

---

## Phase 2: Auth & Admin (Mar 3–4, 2026)

### v1.2 — Mar 3 — Authentication System
- **Decision**: JWT with 15min access + 7-day refresh tokens
- **Created**: Login, Register, Forgot Password, OTP Verification pages
- **Implemented**: Email registration with mandatory NID/Passport upload
- **Implemented**: Role-based routing (customer/admin/super_admin)
- **Result**: Full auth system with token rotation

### v1.3 — Mar 4 — Admin Panel
- **Created**: 17 admin modules (Dashboard, Bookings, Users, Payments, Invoices, Reports, Visa, Settings, etc.)
- **Created**: Revenue analytics with Recharts
- **Implemented**: Hidden admin login at `/admin/login`
- **Result**: Complete admin panel

---

## Phase 3: Dashboard & CMS (Mar 5–8, 2026)

### v1.4 — Mar 5 — Search Widget & Booking Flow
- **Created**: 10-tab unified search widget on homepage
- **Created**: 740+ airports database (`src/lib/airports.ts`)
- **Created**: Multi-city flight search (2-5 segments)
- **Created**: AuthGateModal for inline booking authentication
- **Result**: Core search and booking infrastructure

### v1.5 — Mar 6 — Complete User Dashboard
- **Created**: 12 dashboard pages (all functional, zero "Coming Soon")
- **Created**: E-ticket PDF download (jsPDF), traveller profiles CRUD, wishlist, pay later tracking
- **Result**: Complete user self-service portal

### v1.6 — Mar 7 — Enterprise CMS Suite
- **Created**: 10 CMS modules (Homepage editor, Pages, Blog, Promotions, Media, Email Templates, Destinations, SEO, Footer, Popups)
- **Created**: Dynamic booking form builder
- **Created**: Google Drive integration for visa documents
- **Result**: Full content management system

### v1.7 — Mar 8 — Blog Editor & Popups
- **Created**: WYSIWYG + HTML blog editor with 16 default articles
- **Created**: Popups & Banners module with exit-intent support
- **Result**: Complete CMS suite

---

## Phase 4: Production Hardening (Mar 8, 2026)

### v1.8 — Social Login
- **Decision**: Google GSI OAuth 2.0 + Facebook SDK v19.0
- **Created**: `social-auth.js` backend routes for server-side token verification
- **Created**: IdUploadModal for mandatory ID upload after social signup
- **Created**: `sitemap.xml` with 20 pages
- **Bug Fixed**: Homepage trustStrip double-render

### v1.9 — SMS + Email Notifications
- **Decision**: BulkSMSBD for SMS, Resend for email
- **Created**: 10 notification triggers (register, OTP, booking, payment, visa, contact)
- **Created**: 10 branded HTML email templates
- **Implemented**: Unified notification dispatcher (SMS + Email parallel)
- **Security**: Helmet.js, CORS, rate limiting, morgan logging

### v2.0 — Full Production Audit
- **Removed**: All mock data dependencies from 18+ pages
- **Enhanced**: DataLoader with status-specific error messages
- **Fixed**: Network errors now throw structured `NETWORK_ERROR` code

### v2.1 — API Response Alignment
- **🔴 Bug C13**: All listing pages empty — frontend expected `.flights`/`.hotels`, backend sends `.data`
- **🔴 Bug C14**: Admin SQL GROUP BY error — `only_full_group_by` mode in MySQL 8
- **🔴 Bug C15**: JSON.parse crashes — created `safeJsonParse()` utility
- **Implemented**: Server warm-up on first visit, route prefetching on hover

### v2.2 — Final Audit
- **Verified**: All 70+ pages functional
- **Fixed**: DashboardETransactions field mapping, DashboardSearchHistory summary, DashboardPayLater data key
- **Fixed**: Dashboard pie chart percentage conversion
- **Added**: Newsletter subscribe + booking confirmation email endpoints

---

## Phase 5: Enterprise Booking (Mar 8–9, 2026)

### v2.3 — Enterprise Flight Cards
- **🟡 Bug M08**: Results pages showing data without search criteria — added validation guards
- **🟡 Bug M09**: FlightBooking showing hardcoded "07:30 DAC → 08:35 CXB" — fetches real data now
- **🟡 Bug M10**: BookingConfirmation always showing plane icon — dynamic by booking type

### v2.4 — Mandatory Validations
- **Enforced**: All 9 service searches require dates before navigation
- **Enforced**: All results pages show "No Search Criteria" when params missing
- **Enforced**: All booking buttons pass full context (dates, IDs, locations)

### v2.5 — TTI/ZENITH GDS Integration
- **Decision**: Real-time GDS flight search via TTI/ZENITH API
- **Created**: `backend/src/routes/tti-flights.js` — proxy with DB-backed credentials, 5-min cache
- **Created**: Parallel data merge — Local DB + TTI results via `Promise.allSettled`
- **Security Decision**: All API keys moved from `.env` to `system_settings` DB table
- **Created**: Google Flights-style UI with airline logos (60+ airlines via Kiwi CDN)

### v2.7 — Enterprise 4-Step Booking & Mobile Overhaul
- **🟢 Bug U09**: White space on mobile — logo images 144-192px → normalized to 40-48px
- **🟢 Bug U10**: Broken CSS class names in mobile sidebar
- **Created**: 4-step booking flow (Itinerary → Passenger → Extras → Review)
- **Created**: Round-trip flight pairing with sticky total bar
- **Created**: Professional e-ticket PDF with airline logos, segment boxes, LAST/FIRST format

### v2.8 — Company Rebrand
- **Updated**: Phone, address, company name across all pages, PDFs, emails
- **Created**: Money Receipt PDF generator with QR codes
- **Enhanced**: Invoice PDF with multi-line items, auto-pagination, grand total in words

---

## Phase 6: Full Audit v2 & GDS Operations (Mar 10, 2026)

### v3.0 — Complete Platform Audit v2
- **🟡 Bug M07**: eSIM/Holiday/Medical/Car booking not persisted — added real `POST /xxx/book` calls
- **Enforced**: Zero-mock policy v2 — searched entire codebase for hardcoded values
- **🟡 Bug M06**: Taxes using hardcoded 12% — now uses `flight.taxes` from GDS

### v3.1 — Admin Booking Lifecycle
- **Created**: Archive booking (soft-delete), permanent delete, status transitions
- **Created**: Real-time GDS operations in admin (ticket/cancel/void)
- **Fixed**: E-ticket PDF logo aspect ratio, TTI date parsing

---

## Phase 7: Multi-City, OCR & Document Validation (Mar 11, 2026)

### v3.3 — Multi-Provider Flight Engine & OCR v7
- **🟡 Bug M05**: Cabin class always showing Economy — shows real API cabin class now
- **Created**: OCR Engine v5 (MRZ name priority, nationality auto-derive)
- **Created**: OCR Engine v6 (ICAO 9303 check digits, cross-validation)
- **Created**: OCR Engine v7 (QR/Barcode detection & cross-validation)
- **Created**: 70+ country/nationality mappings
- **Fixed**: Admin markup config persistence, invoice payment reminders

### v3.5 — Sabre SOAP Integration & Enterprise Booking
- **🔴 Bug C12**: Booking page crash — `paxTypes` TDZ error
- **Created**: Sabre SOAP session manager (BinarySecurityToken, 14-min cache)
- **Created**: EnhancedSeatMapRQ v6 for real-time seat maps
- **Created**: GetAncillaryOffersRQ v3 for meal/baggage offers
- **Created**: 16 SSR meal codes, wheelchair, medical, UMNR, pets, FF#, DOCA, OSI
- **Created**: Interactive aircraft-aware seat map component

### v3.5.1 — Route Validation
- **🟡 Bug M04**: International scope allowing domestic routes after swap
- **Created**: Centralized `isScopeInvalidRoute()` and `getScopedDestinationAirports()` validators

### v3.6 — Deferred Document Verification
- **Architecture change**: Passport upload moved from booking Step 2 to dashboard "Pay Now"
- **Created**: TravelDocVerificationModal with MRZ auto-correction

---

## Phase 8: Sabre SOAP, Branded Fares & Rewards (Mar 12, 2026)

**Peak development day — 12 releases**

### v3.7.0 — Zero-Mock Enforcement for Ancillaries
- **Removed**: `generateSeatLayout()` mock (random 30% occupancy)
- **Removed**: `STANDARD_BAGGAGE` array (8 fake options)
- **Removed**: `STANDARD_MEALS` array (9 fake meals)
- **Enforced**: Backend returns `{ available: false }` when no real seat map exists

### v3.7.2 — Reward Points System
- **🔴 Bug C10**: API crash — `authenticateToken` undefined, should be `authenticate`
- **🔴 Bug C11**: DB migration FK error 3780 — INT vs CHAR(36) mismatch
- **🟢 Bug U03**: Flight cards overflow on 1024-1280px screens
- **Created**: Reward points (earn 1%, redeem as coupons), 4 database tables
- **Created**: Dashboard rewards page

### v3.7.3 — White Search Bar
- **🟢 Bug U02**: Search bar too dark (`bg-foreground` → `bg-card`)
- **Redesigned**: Search modification bar with muted chips, larger text

### v3.7.4 — Dark Mode Softened
- **🟢 Bug U01**: Pure black dark mode (6% lightness → 14% lightness)

### v3.7.5–3.7.6 — Multi-City Improvements
- **🟢 Bug U04**: Multi-city airline filter hidden
- **🟢 Bug U05**: Multi-city details minimal — added full 5-tab detail panel
- **Architecture change**: Multi-city from per-segment parallel → single BFM request

### v3.7.7 — BDFare Normalizer Rewrite
- **🔴 Bug C08**: BDFare returning 0 results — v1 response shape vs v2 API
- **🟡 Bug M01**: Carrier filter not working
- **🟡 Bug M02**: Duration showing "NaN" — BDFare `"17h 50m"` format

### v3.7.8 — Round-Trip Deduplication Fix
- **🔴 Bug C09**: Round-trip showing 1 result — dedup key only used first-leg data

### v3.7.9 — Branded Fares
- **Created**: Sabre branded fare extraction (Economy Light/Smart)
- **Created**: Per-brand baggage, refund, rebooking policies

### v3.8 — Animated Flight Timeline
- **Created**: Glowing teal plane animation on compact cards
- **Created**: SVG arc animation with pulsing dots for expanded view

### v3.9.0 — Auto-Ticketing & Post-Booking Ancillaries
- **Created**: `auto-ticket.js` service — auto-tickets on payment confirmation
- **Created**: Post-booking extras page (`/dashboard/bookings/:id/extras`)
- **Decision**: Pay Later deadlines exclusively from airline GDS timeLimit (no hardcoded fallbacks)

---

## Phase 9: Critical Bug Fixes (Mar 12–13, 2026)

### v3.9.1 — Sabre Compressed Response Fix
- **🔴 Bug C06**: Sabre search returning 0 flights — `CompressResponse: true` returned base64 gzip blob
- **Fix**: Removed flag + added gzip decompression fallback

### v3.9.2 — Sabre DateTime Fix
- **🔴 Bug C05**: PNR DateTime validation — timezone offsets in datetimes
- **Fix**: `toSabreDateTime()` strips timezone

### v3.9.3 — Sabre DOCS Schema Fix
- **🔴 Bug C04**: DOCS validation error — unsupported fields in `AdvancePassenger.Document`
- **Fix**: Stripped to schema-safe fields only

### v3.9.6 — TTI Cancellation Fix
- **🔴 Bug C03**: TTI cancel using wrong ID — sent internal TTI ID instead of airline PNR
- **Investigation**: Probe matrix of 6 payload combinations → `{ BookingID: airlinePNR }` is correct
- **🔴 Bug C07**: `cancelPnrViaSoap` crashing — missing import
- **Investigated**: NDC fares — PCC J4YL lacks entitlements (Sabre account issue, not code)

### v3.9.7 — Sabre PNR NamePrefix Fix & SOAP Retry (LATEST)
- **🔴 Bug C01**: Sabre PNR creation failing (400) — `NamePrefix` property not allowed
- **Fix**: Removed `NamePrefix`, title appended to `GivenName` (e.g., `"JOHN MR"`)
- **🔴 Bug C02**: Seat map returning null on production — stale SOAP session token
- **Fix**: Auto-retry with session cache clearing
- **✅ Verified on VPS**:
  - PNR `JIUKMY` created successfully
  - Seat maps: AI (126 rows), EK (276 rows), SQ (159 rows)

---

## 🔍 Key Architecture Decisions Made

| Decision | Context | Chosen | Alternative Considered |
|----------|---------|--------|----------------------|
| API keys storage | Security requirement | Database `system_settings` table | `.env` files (rejected — too easy to leak) |
| GDS search strategy | Multi-provider | `Promise.allSettled` parallel | Sequential (rejected — too slow) |
| Sabre integration | REST vs SOAP | Hybrid (REST for PNR/search, SOAP for seat maps/ancillaries) | REST-only (no seat map API) |
| Seat map data | Real vs mock | Zero-mock (API-only) | Mock fallback (rejected — misleading) |
| Document upload timing | UX vs compliance | Deferred to dashboard "Pay Now" | During booking Step 2 (rejected — blocked flow) |
| Pay Later deadlines | Hardcoded vs API | Exclusively from GDS `timeLimit` | 48h domestic / 7d international fallback (rejected) |
| Multi-city search | Per-segment vs combined | Single BFM request | Per-segment parallel (rejected — not priced as unit) |
| Dark mode | Pure black vs soft | Soft dark (14% lightness) | Pure black 6% (rejected — too harsh) |
| Cabin class display | Searched vs actual | Show real API cabin class | Override with searched class (rejected — misleading) |

---

## 📝 Recurring Patterns Identified

### Pattern 1: Schema Strictness (Sabre)
Sabre REST API rejects any extra/wrong field with 400. Lesson: always validate against published schema.
- Occurred: v3.9.1 (CompressResponse), v3.9.2 (DateTime), v3.9.3 (DOCS), v3.9.7 (NamePrefix)

### Pattern 2: Response Format Mismatches
GDS providers return data in unexpected formats. Lesson: add defensive parsing with format fallbacks.
- Occurred: v2.1 (backend `.data` vs frontend `.flights`), v3.7.7 (BDFare v2 shape), v3.7.7 (duration `"17h 50m"`)

### Pattern 3: Cache Staleness
Cached tokens expire but cache doesn't self-invalidate. Lesson: always add retry-with-fresh-cache.
- Occurred: v3.9.7 (SOAP BinarySecurityToken), v3.9.6 (Sabre config import)

### Pattern 4: Mock Data Leakage
Placeholder data persisting in production code. Lesson: zero-mock audit + automated search.
- Occurred: v2.1–v3.0 (hardcoded flights, taxes, phone numbers, growth indicators)

---

## 📋 Complete Bug Fix Timeline

| # | Version | Date | Severity | Bug | Fix |
|---|---------|------|----------|-----|-----|
| 1 | v2.1 | Mar 8 | 🔴 | All listing pages empty | Fallback `.data \|\| .flights` |
| 2 | v2.1 | Mar 8 | 🔴 | Admin SQL GROUP BY error | Added non-aggregated columns |
| 3 | v2.1 | Mar 8 | 🔴 | JSON.parse crashes | `safeJsonParse()` utility |
| 4 | v2.2 | Mar 8 | 🟢 | Homepage trustStrip double render | Removed duplicate |
| 5 | v2.2 | Mar 8 | 🟢 | Dashboard stats fake growth | Only show when API provides |
| 6 | v2.3 | Mar 9 | 🟡 | FlightBooking hardcoded data | Fetch real via API |
| 7 | v2.3 | Mar 9 | 🟡 | BookingConfirmation always plane icon | Dynamic by type |
| 8 | v2.4 | Mar 9 | 🟡 | Results pages no search criteria | Added validation guards |
| 9 | v2.7 | Mar 9 | 🟢 | White space on mobile | Logo 144px → 40px |
| 10 | v2.7 | Mar 9 | 🟢 | Broken CSS classes (mobile) | Fixed class names |
| 11 | v2.8 | Mar 9 | 🟢 | Old phone numbers in PDFs | Updated to real |
| 12 | v3.0 | Mar 10 | 🟡 | Booking not persisted (eSIM/Holiday/Medical/Car) | Added real POST calls |
| 13 | v3.3 | Mar 11 | 🟡 | Cabin class always Economy | Show real API class |
| 14 | v3.3 | Mar 11 | 🟡 | Taxes hardcoded 12% | Use `flight.taxes` |
| 15 | v3.3 | Mar 11 | 🟢 | Duplicate cabin mismatch banner | Removed extra alert |
| 16 | v3.3 | Mar 11 | 🟢 | Document scanner shows "BD" | Added country mappings |
| 17 | v3.5 | Mar 12 | 🔴 | Booking page crash (TDZ) | Moved declarations |
| 18 | v3.5.1 | Mar 12 | 🟡 | International scope domestic routes | Centralized validator |
| 19 | v3.7.2 | Mar 12 | 🔴 | API crash (502) rewards route | Fixed import name |
| 20 | v3.7.2 | Mar 12 | 🔴 | DB migration FK error 3780 | CHAR(36) user_id |
| 21 | v3.7.2 | Mar 12 | 🟢 | Flight card overflow (1024-1280px) | Reduced widths |
| 22 | v3.7.2 | Mar 12 | 🟡 | Round-trip price filter wrong | Use totalPrice |
| 23 | v3.7.3 | Mar 12 | 🟢 | Search bar too dark | bg-card + bg-muted |
| 24 | v3.7.4 | Mar 12 | 🟢 | Dark mode pure black | 14% lightness |
| 25 | v3.7.6 | Mar 12 | 🟢 | Multi-city airline filter hidden | Removed exclusion |
| 26 | v3.7.6 | Mar 12 | 🟢 | Multi-city details minimal | Full 5-tab panel |
| 27 | v3.7.7 | Mar 12 | 🔴 | BDFare returning 0 results | Normalizer rewrite |
| 28 | v3.7.7 | Mar 12 | 🟡 | Carrier filter not working | Added param extraction |
| 29 | v3.7.7 | Mar 12 | 🟡 | Duration showing "NaN" | Regex parser |
| 30 | v3.7.8 | Mar 12 | 🔴 | Round-trip showing 1 result | All-legs dedup key |
| 31 | v3.9.1 | Mar 12 | 🔴 | Sabre search 0 flights | Removed CompressResponse |
| 32 | v3.9.2 | Mar 12 | 🔴 | Sabre PNR DateTime validation | toSabreDateTime() |
| 33 | v3.9.3 | Mar 12 | 🔴 | Sabre PNR DOCS validation | Stripped fields |
| 34 | v3.9.6 | Mar 13 | 🔴 | TTI cancel wrong ID | Airline PNR priority chain |
| 35 | v3.9.6 | Mar 13 | 🔴 | cancelPnrViaSoap crashing | Added import + export |
| 36 | v3.9.7 | Mar 13 | 🔴 | Sabre PNR NamePrefix rejected | Title → GivenName |
| 37 | v3.9.7 | Mar 13 | 🔴 | Seat map null on production | Auto-retry fresh session |
| 38 | v3.9.8 | Mar 13 | 🟡 | Post-booking ancillaries always empty | Removed restrictive source check |
| 39 | v3.9.8 | Mar 13 | 🟡 | Post-booking seat map missing | Added SOAP seat map in dashboard endpoint |
| 40 | v3.9.8 | Mar 13 | 🟡 | Post-booking extras missing seat UI | Added SeatMap component |
| 41 | v3.9.9.7 | Mar 13 | 🔴 | Sabre DOCS silently dropped (passport field was file path) | Smart passport field detection + DOCS strict mode |
| 42 | v3.9.9.7 | Mar 13 | 🔴 | AreaCityCode validation error | Removed AreaCityCode from ContactNumber |
| 43 | v3.9.9.9 | Mar 13 | 🔴 | Sabre SOAP cancel blocked — Host TA exhaustion | `resetSoapSessionCacheWithClose()` + retry gate + session close in finally |
| 44 | v3.9.9.9 | Mar 13 | 🔴 | Cancel using wrong PNR type (airline vs GDS) | `resolveCancelLocators()` ensures GDS PNR |

---

## Phase 7: Full Sabre Endpoint Coverage (Mar 13, 2026)

### v3.9.9 — Mar 13 — Complete Sabre REST API Coverage
- **Added**: `revalidatePrice()` — `/v4/shop/flights/revalidate` for pre-booking fare verification
- **Added**: `getBooking()` — `/v1/trip/orders/getBooking` for PNR retrieval via REST
- **Added**: `checkTicketStatus()` — `/v1/trip/orders/checkFlightTickets` for ticket verification
- **Added**: `getSeatsRest()` — `/v1/offers/getseats` as REST alternative to SOAP seat maps
- **Upgraded**: Ticketing from `/v1.2.1/air/ticket` to `/v1.3.0/air/ticket`
- **Enhanced**: 3-tier seat map fallback: SOAP → REST → TTI
- **New routes**: `POST /flights/revalidate-price`, `GET /flights/booking/:pnr`, `GET /flights/ticket-status/:pnr`, `GET /flights/seats-rest`
- **Result**: All 12 Sabre cert endpoints now implemented

### v3.9.9.9 — Mar 13 — Sabre Cancel Hardening + Host TA Recovery
- **🔴 Bug C00z**: Sabre SOAP cancel blocked — "You have reached the limit of Host TAs allocated to you"
- **Root Cause**: Concurrent SOAP sessions (seat maps + cancel retries) leaked without proper close, exhausting TA pool
- **Fix**: `resetSoapSessionCacheWithClose()`, `isSoapSessionError()` retry gate, always-close in finally
- **Added**: `resolveCancelLocators()` — ensures GDS PNR used for cancel (not airline PNR)
- **Added**: Cancel safety guard — local status only changes on GDS confirmation
- **Verified**: PNR AQDAMJ (airline PNR FDDPE6) cancelled successfully after TA pool recovery

### v3.9.9.7 — Mar 13 — Sabre DOCS Strict Mode + Airline PNR from CreatePNR
- **Analysis**: Studied Ticketlagbe HAR logs (`combined-air-booking`) and BDFare HAR — both use same Sabre backend and send full DOCS server-side
- **Fixed**: `passport` field file path detection (was being sent as passport number to Sabre)
- **Added**: DOCS strict mode — `no_special_req` fallback disabled when passport DOCS exist
- **Added**: `extractDistinctSabreAirlinePnr()` runs on CreatePNR response before GetBooking
- **Added**: `airlinePnr` and `createVariant` in `createBooking()` return object
- **Fixed**: `AreaCityCode` removed from ContactNumber (Sabre schema rejection)
- **Enhanced**: Extended alias support for `prefix`, `passportNo`, `passportEx`, `nationalityCountry`, `contactPhone`, `contactEmail`

---

## Phase 8: Complete Sabre GDS — All 26 Features (Mar 14, 2026)

### v4.0.0 — Mar 14 — All 26 Sabre GDS Sections Implemented
- **Added 10 new API endpoints** completing full Sabre GDS coverage:
  - `POST /flights/void` — Section 24: Void Flight Tickets
  - `POST /flights/refund/price` + `/refund/fulfill` — Section 23: Refund (2-step)
  - `POST /flights/exchange` — Section 22: Exchange/Reissue via SOAP
  - `GET /flights/fare-rules` — Section 20: Structured Fare Rules via SOAP
  - `GET /flights/status` — Section 25: Flight Status (FLIFO)
  - `POST /flights/ancillaries-stateless` — Section 17: Stateless Ancillaries REST
  - `POST /flights/add-ancillary-stateless` — Section 18: Add Ancillary Stateless
  - `POST /flights/fulfill-tickets` — Section 18: EMD Issuance
  - `POST /flights/update-frequent-flyer` — Section 26: Post-booking FF Update
- **8 new functions in `sabre-flights.js`**: `voidTickets()`, `refundPrice()`, `refundFulfill()`, `getFlightStatus()`, `getAncillariesStateless()`, `addAncillaryStateless()`, `fulfillTickets()`, `updateFrequentFlyer()`
- **2 new functions in `sabre-soap.js`**: `getStructuredFareRules()`, `exchangeBooking()`
- **Result**: 100% Sabre GDS feature coverage (26/26 sections), 100+ total API endpoints

---

## Phase 9: Dashboard Hardening & E-Ticket Fix (Mar 17, 2026)

### v4.1.6 — Mar 17 — Dashboard Hardening & API Resilience
- **🔴 Bug C16**: E-ticket PDF shows garbled text (`Ø<ßâ`, `Ø>Ýó`) — jsPDF Helvetica cannot render Unicode emojis
- **Fix**: Replaced all non-Latin-1 chars with ASCII alternatives (emojis→[1][2][3][4], ৳→BDT, →→-)
- **🔴 Bug C17**: Flight Status crashes with "Unexpected end of JSON input" — Sabre FLIFO returns empty body
- **Fix**: `sabreRequest()` handles empty/non-JSON responses gracefully; FlightStatusBadge shows user-friendly fallback
- **🔴 Bug C18**: Fare Rules title shows duplicated airline code (`WYWY318`)
- **Fix**: `cleanFlightNum()` strips airline prefix before display; handles empty response objects
- **Verified**: SSR History popup correctly fetches and displays data from `/dashboard/ssr-history`
- **Verified**: All 15+ dashboard modules (Bookings, Wallet, E-Tickets, Transactions, Travellers, Payments, SSR History, Search History, Settings, Wishlist, Rewards, Invoices, Reports, Support Tickets, Pay Later) — all API-connected and functional

---

## Phase 10: Wallet-Centric Finance System (Mar 18–Apr 6, 2026)

### v4.2.0 — Apr 6 — Wallet-Centric Finance & Ticket Issue Requests
- **Architecture Decision**: Wallet as single payment source — users must deposit first, then pay bookings from wallet balance
- **Created**: `DashboardIssueWithBalance.tsx` — dedicated page listing all payable bookings with wallet balance and one-click pay
- **Created**: `DashboardWallet.tsx` (enhanced) — bank transfer deposit with admin-configured bank dropdown (searchable Select component), receipt upload, add funds dialog
- **Created**: `DashboardAccountLedger.tsx` — full debit/credit running balance with signed transaction history
- **Created**: `AdminTicketRequests.tsx` — admin page for viewing/processing ticket issue requests (approve → GDS ticketing, reject with notes)
- **Created**: Admin 9-tab booking detail — Itinerary, Passengers, Fare Breakdown, Invoice, Activity, Debug, Supplier, Terminal (GDS command window), Actions
- **Implemented**: Atomic `POST /dashboard/wallet/pay` — MySQL transaction with `FOR UPDATE` row locking:
  1. Verify wallet balance ≥ booking amount (server-side, 0.1% tolerance)
  2. INSERT debit transaction
  3. UPDATE booking payment_status='paid'
  4. UPDATE wallet balance
  5. INSERT ticket_issue_request
  6. COMMIT (all-or-nothing)
- **Implemented**: `PUT /admin/ticket-issue-requests/:id` — admin processes request: issue (triggers GDS ticketing) or reject
- **Implemented**: Payment approval wallet credit — admin approving deposit now credits `wallet` table with INSERT/UPDATE fallback
- **🔴 Bug C19**: Issue With Balance "Payment failed" — wallet deduction was 3 separate non-transactional calls; fixed with MySQL transaction
- **🔴 Bug C20**: Wallet balance ৳0 — `syncWalletFromDerivedBalance()` had swapped UPDATE parameters; payment approval wasn't crediting wallet table
- **🔴 Bug C21**: Transactions page 500 — missing `wallet` table caused uncaught SQL error; added `isMissingTableError()` guard
- **🔴 Bug C22**: Payment approval not crediting wallet — `ON DUPLICATE KEY UPDATE` failed without unique constraint; replaced with SELECT→UPDATE/INSERT
- **Removed**: "Send Payment Request" concept — replaced by wallet deposit + Issue With Balance
- **Upgraded**: Sabre Terminal `SabreCommandLLSRQ` from deprecated v1.8.1 to v2.0.0+
- **Result**: Complete wallet-centric financial architecture with atomic transactions, admin ticket management, and 9-tab booking detail
