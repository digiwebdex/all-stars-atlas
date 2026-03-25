# Seven Trip — Troubleshooting Guide

> Solutions for every known issue encountered during development and production.
> Last updated: 2026-03-17 (v4.1.6)

---

## 🔴 Critical Issues

### 1. Sabre PNR Creation Fails (400 Validation Error)

**Symptoms:** `ERR.SP.CLIENT.VALIDATION_FAILED`, booking stuck at "processing"

**Possible causes & fixes:**

| Error Message | Root Cause | Fix |
|---------------|-----------|-----|
| `NamePrefix property not allowed` | Sabre schema rejects `NamePrefix` in `PersonName` | Remove `NamePrefix`, append title to `GivenName` (e.g., `"JOHN MR"`) |
| `NotProcessed` with DateTime | Timezone offsets in segment datetimes | Use `toSabreDateTime()` to strip timezone suffix |
| `Document` validation error | Unsupported fields in `AdvancePassenger.Document` | Only send `Type`, `Number`, `IssueCountry`, `NationalityCountry`, `ExpirationDate` |

### 2. Sabre Using CERT Instead of Production

**Symptoms:** Bookings fail for certain routes, limited flight inventory

**Check:** `pm2 logs seventrip-api --lines 10 | grep 'Config loaded'`
- If it shows `env=cert` or `baseUrl=api.cert.platform.sabre.com` → **NOT production**
- Fix: Update `system_settings` → `api_sabre` → set `environment` to `"production"`

```sql
-- Check current config
SELECT JSON_EXTRACT(setting_value, '$.environment') FROM system_settings WHERE setting_key = 'api_sabre';

-- Fix: Set to production
UPDATE system_settings SET setting_value = JSON_SET(setting_value, '$.environment', 'production') WHERE setting_key = 'api_sabre';
```

**Production URLs:**
- REST: `https://api.platform.sabre.com`
- SOAP: `https://webservices.platform.sabre.com`
- CERT (pre-prod): `https://api.cert.platform.sabre.com`

### 3. Sabre Search Returns 0 Flights

**Check in order:**
1. **Environment set to production?** See issue #2 above
2. **Compressed response?** Remove `CompressResponse: true` from BFM request
3. **OAuth token expired?** Check `getSabreToken()` returns valid token
4. **PCC permissions?** Verify PCC J4YL has BFM access (contact Sabre)
5. **Network?** `curl -X POST https://api.platform.sabre.com/v5/offers/shop` from VPS

### 4. Seat Map Returns `layout: null`

**Root Cause:** Stale SOAP BinarySecurityToken (14-min TTL expired but cache not cleared)

**Fix Applied (v3.9.7):** Auto-retry with session cache clearing. If still fails:
```bash
pm2 restart seventrip-api  # Clears all in-memory caches
```

### 5. Sabre Cancel Fails — "Host TAs Allocated" (v3.9.9.9)

**Symptoms:** All SOAP calls fail with `You have reached the limit of Host TAs allocated to you`

**Root Cause:** Too many concurrent SOAP sessions leaked without proper `SessionCloseRQ`, exhausting Sabre's Host Terminal Address pool for PCC J4YL.

**Immediate fix:** Wait 15-30 minutes for stale sessions to auto-expire, then:
```bash
pm2 restart seventrip-api  # Clears session cache
# Verify SOAP is working:
curl -s "http://localhost:3001/api/flights/sabre-soap-diagnostic?origin=DAC&destination=BOM&departureDate=2026-03-20&airlineCode=AI&flightNumber=2184" | jq '.seatMap.success'
```

**If persistent:** Contact Sabre to increase TA allocation for PCC J4YL / TAM pool ABBDJ4YL.

**Prevention (v3.9.9.9):**
- `resetSoapSessionCacheWithClose()` properly closes stale sessions before creating new ones
- SOAP retries only trigger on session/auth/network errors (not application errors)
- Cancel always closes session in `finally` block

### 6. Sabre REST Cancel Returns 403 NOT_AUTHORIZED

**Not a code bug.** PCC J4YL lacks REST cancel API privileges. SOAP cancel (`OTA_CancelLLSRQ`) is the confirmed working method.

### 7. Sabre Hotel Search Returns 0 Results (REST + SOAP)

**Root Cause (confirmed 2026-03-17):** PCC J4YL is NOT provisioned for Sabre Hotel APIs:
- **REST CSL** (`havail.sabre.com`): `"Invalid CustomerAppId"` — no CSL hotel subscription
- **SOAP LLS** (`OTA_HotelAvailLLSRQ`): `"Action specified in EbxmlMessage does not exist"` — Hotel LLS not enabled

**This is NOT a code bug.** Sabre hotel search is disabled by default via `api_sabre.hotels_enabled` flag.

**To fix:** Contact Sabre account manager to activate Hotel APIs (CSL + LLS) for PCC J4YL. Then:
```sql
UPDATE system_settings SET setting_value = JSON_SET(setting_value, '$.hotels_enabled', 'true') WHERE setting_key = 'api_sabre';
```

### 4. TTI Cancellation Fails

**Root Cause:** Sending internal TTI booking ID instead of airline PNR

**Correct payload:** `{ BookingID: airlinePNR }` where `airlinePNR` is extracted from `booking.details.gdsResponse` using priority chain: `RecordLocator` → `BookingReference` → `PNR` → `ETTicketFares[0].Ref`

### 5. Server Crash (502 Bad Gateway)

```bash
# Check PM2
pm2 status
pm2 logs seventrip-api --lines 50

# Common causes:
# 1. Missing import (check for undefined middleware)
# 2. Out of memory (add swap: sudo fallocate -l 2G /swapfile)
# 3. Unhandled promise rejection

# Quick fix
pm2 restart seventrip-api
```

---

## 🟡 Database Issues

### MySQL ERROR 3780 (FK Type Mismatch)

**Symptom:** Migration fails with `Referencing column and referenced column are incompatible`

**Cause:** FK column type doesn't match referenced PK type (e.g., `INT` vs `CHAR(36)`)

**Fix:** Ensure all FK columns use `CHAR(36)` to match `users.id` UUID format

### SQL `only_full_group_by` Error

**Symptom:** `Expression is not in GROUP BY clause and contains nonaggregated column`

**Fix:** Add all non-aggregated columns to GROUP BY clause, or use `ANY_VALUE()` for display-only columns

### JSON.parse Crashes

**Symptom:** 500 error when reading JSON columns from database

**Fix:** Use `safeJsonParse()` from `backend/src/utils/json.js`:
```javascript
const { safeJsonParse } = require('../utils/json');
const images = safeJsonParse(row.images, []);
```

---

## 🟢 Frontend Issues

### All Listing Pages Empty

**Symptom:** Flights, hotels, holidays pages show no data

**Cause:** Frontend expects `.flights`, `.hotels`, backend returns `.data`

**Fix:** Use fallback: `apiData.data || apiData.flights || []`

### White Space on Mobile (Right Side)

**Cause:** Oversized logo images (144-192px height)

**Fix:** Normalize to `h-10` (40px) / `h-12` (48px) across all layouts

### Dark Mode Too Dark (Pure Black)

**Cause:** Background lightness at 6%

**Fix:** Set `--background: 222 47% 14%` in `.dark` section of `index.css`

### Flight Card Overflow (1024-1280px)

**Cause:** Fixed-width columns too wide for sidebar + content layout

**Fix:** Reduce airline column to `sm:w-36 lg:w-40`, add `min-w-0` on flex children

### Booking Page Crash

**Symptom:** White screen on `/flights/book`

**Cause:** Temporal Dead Zone (TDZ) — variable referenced before declaration

**Fix:** Move `const paxTypes = ...` and `const passengers = ...` declarations before any `useState` that depends on them

---

## 🔧 Build & Deploy Issues

### Build Fails with Chunk Warning

**Symptom:** Warning about chunk > 500KB

**Fix:** Already configured in `vite.config.ts` with manual chunks for vendor, UI, charts, PDF, motion

### Nginx "gzip duplicate" Error

**Cause:** Gzip directives in both `nginx.conf` and site config

**Fix:** Only configure gzip in one location (usually `nginx.conf`)

### `Route.get() requires a callback function`

**Cause:** Wrong middleware import name (e.g., `authenticateToken` vs `authenticate`)

**Fix:** Check `backend/src/middleware/auth.js` exports and match import name

### Mixed Content Warnings

**Cause:** `VITE_API_BASE_URL` uses `http://` but site is on `https://`

**Fix:** Set `VITE_API_BASE_URL=https://api.seven-trip.com/api` and rebuild

### Pages Return 404 (Except Homepage)

**Cause:** Nginx not configured for SPA routing

**Fix:** Add `try_files $uri $uri/ /index.html;` to Nginx location block

---

## 🌐 GDS-Specific Issues

### BDFare Returns 0 Results

**Check:** Normalizer must match API v2 structure: `Response.Results[]` with `segments[].Airline`

### BDFare Duration Shows "NaN"

**Cause:** BDFare returns `"17h 50m"` string, not minutes number

**Fix:** Regex parser: `/(\d+)h\s*(\d+)m/` → convert to total minutes

### NDC Fares Not Appearing

**Not a code issue.** PCC J4YL lacks NDC entitlements. Contact Sabre account manager to activate NDC carrier agreements.

### Round-Trip Shows Only 1 Result

**Cause:** Dedup key only uses first-leg data

**Fix:** Include ALL legs in dedup key: `flightNumber + depTime + arrTime + dest + stops + stopCodes + direction + [all legs' flightNo@depTime]`

---

## 📋 Quick Diagnostic Commands

```bash
# Server health
pm2 status && sudo systemctl status nginx && sudo systemctl status mysql

# API logs
pm2 logs seventrip-api --lines 100

# Nginx errors
sudo tail -f /var/log/nginx/error.log

# Disk space
df -h

# Memory
free -m

# Test API
curl -s https://seven-trip.com/api/health

# Test Nginx config
sudo nginx -t

# SSL expiry
sudo certbot certificates

# MySQL test
mysql -u root -p -e "SELECT COUNT(*) FROM seventrip.users;"
```
