# Admin Panel Enhancements

## 1. Partial Payment Date Setup
In **Admin → Enterprise → Per-Booking Override**, add a **Remaining Payment Deadline** date+time picker for any booking flipped to `payment_status='partial'`. Admin sets when the user must pay the remaining 70%. Stored in `bookings.partial_due_at` (new column). Surfaced to user on Dashboard Booking Detail as countdown.

## 2. Route-to-Route Airline Rules (Directional Blocking)
New admin page **Admin → Airline Route Rules**:
- Select Airline (e.g. SV — Saudia)
- Select **Direction**: Outbound only / Inbound only / Both / Block all
- Optional Origin & Destination country filter (e.g. block all `*→BD` for SV = no inbound to Bangladesh)
- Saved to new table `airline_route_rules`
- Flight search results filter applies rule before returning to user

Example: SV — block `Inbound to BD` → SV flights *to* DAC are hidden, but DAC→anywhere on SV still shows.

## 3. Domain Change
In **Admin → Settings → General**, add **Site Domain** field (text input). Updates `system_settings.site_domain`. Used for:
- Canonical URLs / sitemap
- Email links (booking confirmations, OTP)
- OAuth redirect base
Note: actual DNS/Nginx still managed on VPS — this only updates app-level references.

## 4. B2C Partial Payment Visibility Toggle
In **Admin → Enterprise → Partial Payment Settings**, add toggle **Show Partial Payment to B2C Customers** (on/off). When OFF, the "Request Partial Payment" button is hidden for `role='customer'` users. B2B agents always see it (if eligible). Stored in `system_settings.partial_b2c_enabled`.

## 5. Missing Airlines in Markup/Commission List
Add to `src/lib/airlines-database.ts`:
- **OV** — Salam Air (Oman)
- **X1** — Hahn Air Systems (Germany)

Both will appear in Admin → Airline Markup config dropdown.

---

## Technical Details

**New migration** `backend/database/admin-route-rules-migration.sql`:
- `ALTER TABLE bookings ADD COLUMN partial_due_at DATETIME NULL`
- `CREATE TABLE airline_route_rules (id, airline_code, direction ENUM('outbound','inbound','both','block_all'), origin_country, destination_country, enabled, created_at)` + GRANTs
- `INSERT INTO system_settings (key, value) VALUES ('partial_b2c_enabled','true'),('site_domain','booking.digiwebdex.com')`

**Backend changes**:
- `admin-enterprise.js`: add `partial_due_at` field to per-booking override endpoint; add `partial_b2c_enabled` toggle endpoint
- new `admin-route-rules.js` route: CRUD for `airline_route_rules`
- `flights.js` aggregator: post-filter results through rule engine (cheap in-memory check)
- `dashboard.js` partial endpoint: check `partial_b2c_enabled` for customer role

**Frontend changes**:
- `AdminEnterprise.tsx`: add partial deadline picker + B2C toggle
- new `AdminRouteRules.tsx` page + sidebar link + route in `App.tsx`
- `AdminSettings.tsx`: site domain field
- `DashboardBookingDetail.tsx`: hide partial button if `!partial_b2c_enabled && role==='customer'`; show `partial_due_at` countdown
- `airlines-database.ts`: append OV and X1 entries

**Deployment**: run new migration on VPS + `pm2 restart seventrip-api` + frontend rebuild.

Proceed?
