## Scope

Everything below is admin-panel + auth work. No changes to booking/GDS flows.

### 1. Admin Theme / Colour
- Admin → Settings → **Appearance** tab: primary colour, accent, sidebar bg, logo scale — persisted to `system_settings` (`admin_theme_*`).
- Applied via CSS vars on `AdminLayout`.

### 2. Commission — Domestic / International / SOTO (per airline)
- Extend `airline_markups` table with `scope ENUM('domestic','international','soto') DEFAULT 'domestic'` (unique on `airline_code + scope`).
- Admin → Markup: 3 tabs (Dom / Intl / SOTO), each has the existing per-airline table.
- Backend fare pipeline picks scope by itinerary: both endpoints in BD → domestic; both outside BD → SOTO; else international.

### 3. Partial Payment — dual control
- Global toggles already exist (`b2c_partial_enabled`) — add `b2b_partial_enabled`.
- New table `user_partial_permission (user_id, enabled, updated_by, updated_at)`.
- Admin → Users → row action **"Partial: On/Off"**.
- Eligibility check = `global_toggle_for_role AND (per_user_override ?? true)`.

### 4. Secondary Admin role
- Add `app_role` enum values: `admin`, `super_admin`, `secondary_admin` (already partly exist).
- Permissions bitmap on user: `can_manage_bookings`, `can_toggle_partial`, `can_approve_payments` (last one already exists as `can_approve_deposits`).
- `AdminRoute` allows secondary_admin; individual pages gate on the specific flag.
- Settings/Enterprise/CMS pages → super_admin only.
- Admin → Users → "Make Secondary Admin" with checkbox permissions.

### 5. Forgot Password
- Already exists at `/auth/forgot-password` + OTP verify + reset. Audit + wire "Forgot Password?" link into `LoginModal` and Admin login. Ensure email/SMS both work through existing OTP path.

### 6. Google / Facebook login
- Backend `/auth/social/*` and `src/lib/social-auth.ts` already exist. Add the Google/FB buttons to `LoginModal`, `Login.tsx`, `Register.tsx` (only render when admin has configured client IDs — check `/auth/social/config`).

### 7. OTP Login (SMS + Email, user chooses)
- New backend endpoints: `POST /auth/otp/request { identifier }` (auto-detects email vs phone; sends via existing email service or BulkSMSBD) and `POST /auth/otp/verify { identifier, otp }` → returns JWT.
- Rate-limit: 1 request / 60s / identifier; 5 attempts / 15min.
- New page `/auth/login-otp`: single input "Email or Phone" → OTP screen → auto-login.
- Add "Login with OTP" link on `LoginModal` and `Login.tsx`.

## Technical

**Migration** `backend/database/admin-controls-migration.sql`:
- `ALTER TABLE airline_markups ADD COLUMN scope` + drop old unique, add new composite unique.
- `CREATE TABLE user_partial_permission`.
- `ALTER TABLE users ADD COLUMN role_flags JSON` (or reuse `can_approve_deposits` + add `can_manage_bookings TINYINT`, `can_toggle_partial TINYINT`).
- `CREATE TABLE otp_login_codes (identifier VARCHAR(255), code VARCHAR(6), expires_at, attempts, created_at, INDEX)`.
- `INSERT INTO system_settings` defaults for `b2b_partial_enabled`, `admin_theme_primary`, `admin_theme_accent`.

**Files to touch**:
- Backend: `routes/admin.js` (markup scope, partial toggle, secondary admin), `routes/auth.js` (OTP endpoints), fare pipeline scope resolver.
- Frontend: `AdminMarkup.tsx` (3 tabs), `AdminUsers.tsx` (partial toggle + secondary admin), `AdminSettings.tsx` (Appearance tab), `AdminLayout.tsx` (apply theme), `AdminRoute.tsx` (allow secondary_admin), `LoginModal.tsx` + `Login.tsx` (Google/FB + OTP buttons), new `pages/auth/LoginOTP.tsx`.

**Deploy** (VPS after `git pull`): run the new migration with `--force`, `npm run build`, `rsync dist/`, `pm2 restart seventrip-api`.

## Not in scope
- Changing existing partial-payment 30/70 logic
- Any booking/GDS behaviour
- Changing customer-facing theme (only admin panel)