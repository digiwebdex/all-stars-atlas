# Seven Trip — Working Deployment Commands

> **Auto-updated** with every change. Copy-paste ready commands for your VPS.
> Last updated: 2026-03-25 (v4.1.7 — Nginx Gzip Fix, Domain Migration to seven-trip.com)

---

## 🚀 Standard Deployment (Frontend + Backend)

Use this after any code change:

```bash
cd ~/projects/all-stars-atlas && git pull origin main && npm install && npm run build && sudo cp -r dist/* /var/www/seventrip/ && cd backend && npm install && pm2 restart seventrip-api
```

---

## 🔧 Nginx Config Update

Only needed when `backend/nginx-optimized.conf` changes:

```bash
cd ~/projects/all-stars-atlas && git pull origin main && sudo cp backend/nginx-optimized.conf /etc/nginx/sites-available/seventrip && sudo nginx -t && sudo systemctl reload nginx
```

---

## 📦 Frontend Only (No Backend Changes)

```bash
cd ~/projects/all-stars-atlas && git pull origin main && npm install && npm run build && sudo cp -r dist/* /var/www/seventrip/
```

---

## 🖥️ Backend Only (No Frontend Changes)

```bash
cd ~/projects/all-stars-atlas && git pull origin main && cd backend && npm install && pm2 restart seventrip-api
```

---

## ✈️ Run 30-Route Booking Test Suite

After deploying backend changes, validate all booking modes:

```bash
cd ~/projects/all-stars-atlas && git pull origin main && pm2 restart seventrip-api && sleep 5 && bash backend/test-bookings.sh
```

## ✈️ Run 10-Test SSR Probe (Quick Validation)

Fast validation of Sabre + TTI booking across all passenger types:

```bash
cd ~/projects/all-stars-atlas && git pull origin main && cd backend && pm2 restart seventrip-api && sleep 5 && bash probe-ssr-capabilities.sh
```

Check detailed logs after test:
```bash
pm2 logs seventrip-api --lines 300 | grep -E '\[Sabre\]|\[Booking\]|\[TTI\]' | head -200
```

---

## 🗄️ Database Migration

When new migration files are added in `backend/database/`:

```bash
cd ~/projects/all-stars-atlas && git pull origin main && mysql -u root -p seventrip < backend/database/<migration-file>.sql
```

---

## 📊 Useful Monitoring Commands

```bash
pm2 status                # Check API status
pm2 logs seventrip-api    # View API logs
pm2 monit                 # Real-time monitoring
sudo nginx -t             # Test Nginx config
sudo systemctl status nginx  # Nginx status
```

---

## 🔑 SSL Certificate Renewal

```bash
sudo certbot renew --dry-run   # Test renewal
sudo certbot renew             # Force renewal
```

---

## ⚠️ Troubleshooting

### Nginx "gzip duplicate" error (CRITICAL)
The gzip/brotli directives are in `/etc/nginx/nginx.conf` — do NOT add them in site configs. This caused a 3.5-hour outage on 2026-03-25. Always deploy from `backend/nginx-optimized.conf` which has NO gzip.

### API not responding
```bash
pm2 restart seventrip-api && pm2 logs seventrip-api --lines 50
```

### SyntaxError: Unexpected token '...'
Cause: accidental literal `...` left inside a JS file (commonly from partial patch markers).

```bash
cd ~/projects/all-stars-atlas
grep -n "^\s*\.\.\.\s*$" backend/src/routes/sabre-flights.js
# if found, remove it and restart
pm2 restart seventrip-api && pm2 logs seventrip-api --lines 30 --err
```

### Sabre fallback returns 0 flights with no API error
Cause: missing helper bindings (`getResponseStats`, `normalizeParams`) or undefined decoder call in fallback block.

```bash
cd ~/projects/all-stars-atlas
# verify no undefined decoder reference remains
grep -n "decodeCompressedResponse" backend/src/routes/sabre-flights.js
# verify helper symbols exist
grep -n "getResponseStats\|normalizeParams" backend/src/routes/sabre-flights.js
cd backend && pm2 restart seventrip-api && pm2 logs seventrip-api --lines 50 | grep -E "BFM attempt|stats:|normalized|attempt failed"
```

### Build fails
```bash
cd ~/projects/all-stars-atlas && rm -rf node_modules && npm install && npm run build
```

### MySQL ERROR 3780 on reward points migration
Cause: `users.id` is UUID (`CHAR(36)`) but migration used `INT` user_id.

```bash
cd ~/projects/all-stars-atlas
git pull origin main
mysql seventrip < backend/database/reward-points-migration.sql
```

### Express error: Route.get() requires a callback function
Cause: rewards route imported `authenticateToken` but auth middleware exports `authenticate`.

```bash
cd ~/projects/all-stars-atlas
git pull origin main
cd backend && pm2 restart seventrip-api
pm2 logs seventrip-api --lines 30
```

---

## 📝 Change Log

| Date | Change | Deploy Command |
|------|--------|----------------|
| 2026-03-17 | **v4.1.6** Dashboard hardening: E-ticket PDF ASCII fix (garbled Unicode→text), Flight Status graceful error handling, Fare Rules airline code dedup, Sabre `sabreRequest()` empty response resilience. All 15+ dashboard modules verified. | Standard Deployment |
| 2026-03-14 | **v4.1.3** Sabre search recovery hotfix: restored missing `getResponseStats` + `normalizeParams` and removed undefined decoder dependency in BFM fallback flow. | Backend Only |
| 2026-03-14 | **v4.1.2** Sabre search crash hotfix: removed accidental `...` token in `backend/src/routes/sabre-flights.js` that caused Node startup `SyntaxError` and intermittent 502 on `/api/flights/search`. | Backend Only |
| 2026-03-14 | **v4.1.1** 100% production probe verified: 10/10 tests, 34 assertions, 9 PNRs created+cancelled. UI pill badges for baggage/seats/class. Full documentation overhaul. | Standard Deployment |
| 2026-03-14 | **v4.0.0** All 26 Sabre GDS features implemented: void, refund (price+fulfill), exchange, fare rules, FLIFO, stateless ancillaries, add ancillary, EMD fulfill, FF update. 10 new endpoints. | Backend Only |
| 2026-03-13 | **v3.9.9.9** Sabre cancel hardening: enforce GDS PNR-only cancellation (blocks local cancel when missing), improved cancel logs (shows GDS vs airline PNR), SOAP seat-map retry now only on session/auth/network errors to prevent Host TA exhaustion; clearer TA-limit error message | Backend Only |
| 2026-03-13 | **v3.9.9.7** Sabre DOCS strict mode: `no_special_req` fallback disabled when passport DOCS exist; airline PNR extracted from CreatePNR response; smart passport field detection (file path vs number); `AreaCityCode` removed from ContactNumber; extended vendor locator regex (`reservationNumber`, `confirmationNumber`) | Backend Only |
| 2026-03-13 | **v3.9.9.6** Full DOCS payload for Sabre (9 fields) with `VendorPrefs.Airline.Hosted=false`; CTCM/CTCE SSR auto-generation; TTI passport injection | Backend Only |
| 2026-03-13 | **v3.9.9.4** `/flights/seats-rest` hardened: probes Sabre GetSeats v3+v1, returns explicit PNR viewership hint (`700102`), and falls back to SOAP EnhancedSeatMapRQ when REST fails | Backend Only |
| 2026-03-13 | **v3.9.7** Sabre PNR fix: removed `NamePrefix` from `PersonName` (400 schema error), title appended to `GivenName`. SOAP seat map: auto-retry with fresh session on stale token. Verified PNR JIUKMY + seat maps (AI/EK/SQ) working | Standard Deployment |
| 2026-03-13 | TTI cancel fix: uses airline PNR (not internal TTI ID) for cancellation — probe matrix identified correct payload shape. Sabre SOAP cancel fallback: local config loader + export fix. NDC investigation: BFM request correct (`NDC: Enable`) but PCC J4YL lacks NDC entitlements — contact Sabre to activate. Unified flight card animations for all trip types | Standard Deployment |
| 2026-03-12 | Animated flight timeline: glowing teal plane on gradient dashed track, pulsing dots, arc animation with SVG gradients | Frontend Only |
| 2026-03-12 | Branded fares: Sabre BFM extracts brand names (Economy Light/Smart), per-brand baggage/policies; dedup fix for round-trip combos | Standard Deployment |
| 2026-03-12 | Round-trip dedup fix: key now includes all leg flight numbers/times/direction — preserves all outbound+return combinations | Backend Only |
| 2026-03-12 | BDFare normalizer rewrite: match actual API v2 structure, carrier filter fix, cabin class accuracy from all providers | Standard Deployment |
| 2026-03-12 | Multi-city detail parity: full airport names, fare table (Discount/AIT VAT), baggage table, cancellation/date change tabs — matches one-way/round-trip | Frontend Only |
| 2026-03-12 | Airline filter bar enabled for multi-city (removed `!isMultiCity` exclusion) | Frontend Only |
| 2026-03-12 | Multi-city flight details expansion: added MultiCityExpandedDetails with 4 tabs | Frontend Only |
| 2026-03-12 | Dark mode softened: pure black → softer dark gray (14% lightness) | Frontend Only |
| 2026-03-12 | Multi-city combined search: single Sabre BFM request with combined itinerary cards | Standard Deployment |
| 2026-03-12 | Search bar redesign: dark `bg-foreground` → white `bg-card` with `bg-muted` chips, larger text/padding | Frontend Only |
| 2026-03-12 | Rewards route crash hotfix: replace undefined `authenticateToken` middleware with `authenticate` | Backend Only |
| 2026-03-12 | Flight card responsiveness: reduced fixed-width columns, added `min-w-0` overflow prevention, scaled fonts for sidebar+content layout | Frontend Only |
| 2026-03-12 | Reward points migration hotfix: FK type compatibility (`CHAR(36)` user_id/booking_id) | DB Migration |
| 2026-03-12 | Reward points system (earn/redeem/coupons), flight card baggage/seats/class info row, points badge on cards | Standard + DB Migration |
| 2026-03-12 | Round-trip price filter fix: slider/filter now uses totalPrice from paired round-trip combinations | Frontend Only |
| 2026-03-12 | Sabre SOAP session manager (EnhancedSeatMap + GetAncillaryOffers), 4-step booking flow with SSR + Seat Map, ancillaries priority chain, TDZ bug fix | Standard Deployment |
| 2026-03-11 | Performance: instant video, image lazy loading, Nginx optimization | Standard Deployment |
| 2026-03-11 | Flight results: "Select" button, Non-Refundable label fix | Standard Deployment |
| 2026-03-11 | Header/logo size reduction, page padding fixes | Standard Deployment |
| 2026-03-11 | Nginx optimized config (HTTP/2, caching, rate limiting) | Nginx Config Update |
| 2026-03-11 | Fix cabin class (Business/First) not being sent to TTI GDS + case-insensitive cabin mapping for all providers | Standard Deployment |
| 2026-03-11 | Fix cabin class display in results/booking to show searched class (Business/First) instead of GDS Economy default; color-coded multi-traveller form with per-type borders (Adult=green, Child=blue, Infant=purple) | Frontend Only |
| 2026-03-11 | Multi-city flight search: date validation (segment 2+ enforces min date from previous), parallel per-segment API search, grouped results with per-segment selection, sticky booking bar | Frontend Only |
| 2026-03-11 | Flight search audit: fix per-passenger field error keys, remove 12% tax fallback (zero-mock), multi-city booking page support (step 1/review/fare sidebar), max 9 pax + infants≤adults limits, passport expiry 6-month validation, Bangladesh phone regex, passport expiry required for international | Frontend Only |
| 2026-03-11 | Fix cabin class display: remove frontend override that faked searched cabin on all results; now shows real API cabin class (Zero-Mock enforcement) | Frontend Only |
| 2026-03-11 | Add cabin class mismatch alert: when searched class (Business/First) is unavailable on route, shows amber info banner explaining results are Economy fares from airline | Frontend Only |
| 2026-03-11 | Fix duplicate cabin mismatch banner: removed extra alert outside DataLoader, kept single instance per view (one-way/round-trip inside DataLoader, multi-city inside its block) | Frontend Only |
| 2026-03-11 | Document expiry validation: block expired documents on ALL flights, enforce 6-month passport rule for international with detailed error messaging | Frontend Only |
| 2026-03-11 | Document Scanner: country field now shows full name (Bangladesh not BD), added countryCode field (BGD), labels updated to Given/First Name and Surname/Last Name, 70+ country mappings | Full Stack |
| 2026-03-11 | Nationality dropdown: free-text replaced with 70+ nationality Select dropdown, default Bangladeshi | Frontend Only |
| 2026-03-11 | OCR Engine v5: MRZ name priority enforced (rejects NID address noise), nationality auto-derived from country code, phone extraction from NID, all booking form fields auto-populated from scan | Full Stack |
| 2026-03-11 | OCR Engine v6: ICAO 9303 check digit validation (passport number, DOB, expiry, composite), MRZ nationality extraction (TD3 pos 10-12), cross-validation engine (MRZ vs visual text with confidence scoring), verified fields shown with shield badges in scanner UI | Full Stack |
| 2026-03-11 | OCR Engine v7: QR/Barcode detection & cross-validation — parses pipe-delimited, semicolon-delimited, and inline-encoded QR payloads; cross-validates QR data against MRZ and visual text; QR confirmation upgrades field confidence to 'verified'; UI shows QR detection badge | Full Stack |
