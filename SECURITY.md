# Seven Trip — Security Documentation

> All security measures, authentication flow, and best practices implemented in the platform.
> Last updated: 2026-03-17 (v4.1.5)

---

## 🔐 Authentication System

### JWT Token Flow

```
Login → POST /auth/login
     → Server validates credentials (bcryptjs compare)
     → Issues access token (15 min) + refresh token (7 days)
     → Client stores in localStorage: auth_token, refresh_token, user

API Call → Client sends Authorization: Bearer <access_token>
        → Middleware verifies JWT signature + expiry
        → If expired (401) → Client calls POST /auth/refresh
        → Server issues new access + refresh tokens
        → Original request retried with new token

Logout → POST /auth/logout { refreshToken }
      → Server deletes refresh token from DB
      → Client clears localStorage
```

### Token Configuration

| Token | Expiry | Storage | Purpose |
|-------|--------|---------|---------|
| Access Token | 15 minutes | `localStorage.auth_token` | API authorization |
| Refresh Token | 7 days | `localStorage.refresh_token` | Token renewal |
| OTP Code | 10 minutes | Database `users.otp_code` | Password reset |
| Reset Token | 1 hour | Database `users.reset_token` | Post-OTP password reset |

### Password Security

- Hashed with **bcryptjs** (default salt rounds)
- Minimum 8 characters enforced on frontend (Zod schema) and backend
- No plaintext passwords stored anywhere

---

## 🛡 API Security

### Middleware Stack

| Middleware | Purpose |
|-----------|---------|
| **Helmet.js** | Sets security HTTP headers (XSS, HSTS, X-Frame-Options, X-Content-Type-Options) |
| **CORS** | Whitelist: only `seven-trip.com.bd` origin allowed |
| **express-rate-limit** | Rate limiting on auth endpoints |
| **Morgan** | HTTP request logging (audit trail) |
| **JWT verify** | Route-level authentication via `authenticate` middleware |
| **Role guard** | `isAdmin` middleware for admin-only routes |

### HTTP Security Headers

```
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### API Key Storage

**Critical rule:** No API keys in `.env` files or source code.

All third-party API credentials stored in MySQL `system_settings` table:
- Read at runtime via `getXxxConfig()` functions
- 5-minute cache to reduce DB queries
- Cache invalidated when admin saves settings
- Only accessible to admin users via Admin → Settings → API Integrations

### CORS Configuration

```javascript
cors({
  origin: process.env.FRONTEND_URL,  // https://seven-trip.com.bd
  credentials: true
})
```

---

## 🔒 Route Protection

### Frontend Guards

| Guard | File | Protects | Behavior |
|-------|------|----------|----------|
| `ProtectedRoute` | `src/components/ProtectedRoute.tsx` | `/dashboard/*` | Redirects to `/auth/login` if not logged in |
| `AdminRoute` | `src/components/AdminRoute.tsx` | `/admin/*` | Redirects to `/admin/login`; shows "Access Denied" if logged in but not admin |
| `AuthGateModal` | `src/components/AuthGateModal.tsx` | Booking flows | Inline login popup (no page redirect) |

### Backend Guards

```javascript
// Require authentication
router.get('/dashboard/stats', authenticate, handler);

// Require admin role
router.get('/admin/users', authenticate, isAdmin, handler);

// Public endpoint (no guard)
router.get('/flights/search', handler);
```

---

## 📋 Document Security

### Passport & ID Verification

- **NID/Passport upload mandatory** after registration (social + email)
- **IdUploadModal** blocks access to booking features until ID is uploaded
- **Passport OCR** (v3.3+) validates MRZ data against ICAO 9303 standard:
  - Check digit validation (passport number, DOB, expiry, composite)
  - QR/Barcode cross-validation with MRZ data
  - Confidence scoring per field

### International Flight Document Gating

- International flight payments blocked until passport + visa copies uploaded
- `TravelDocVerificationModal` opens on "Pay Now" for international bookings
- MRZ auto-correction: if OCR data differs from passenger info, system corrects from passport (trusted source)
- Verification results show confidence percentage and corrected fields

---

## 🔥 SSL/TLS Configuration

### Certificate

```
Provider: Let's Encrypt
Type: Domain Validated (DV)
Domains: seven-trip.com.bd, www.seven-trip.com.bd, api.seventrip.com.bd
Auto-renewal: certbot timer (every 60 days)
```

### Nginx SSL Settings

```nginx
ssl_certificate /etc/letsencrypt/live/seventrip.com.bd/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/seventrip.com.bd/privkey.pem;
include /etc/letsencrypt/options-ssl-nginx.conf;
ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
```

### HTTP → HTTPS Redirect

All HTTP traffic automatically redirected to HTTPS via Nginx:
```nginx
server {
    listen 80;
    server_name seven-trip.com.bd www.seven-trip.com.bd;
    return 301 https://$server_name$request_uri;
}
```

---

## 🔐 Social Login Security

### Google Sign-In

- OAuth 2.0 via Google Identity Services (GSI)
- Server-side token verification at `POST /auth/social/google`
- Client ID stored in `system_settings` (admin-configurable)
- ID token verified against Google's public keys

### Facebook Login

- OAuth via Facebook SDK v19.0
- Server-side access token verification at `POST /auth/social/facebook`
- App ID/Secret stored in `system_settings`
- Token exchanged for user profile data server-side

---

## 🛡 Firewall & Network

### UFW Rules

```bash
sudo ufw allow OpenSSH       # SSH (port 22)
sudo ufw allow 'Nginx Full'  # HTTP (80) + HTTPS (443)
sudo ufw enable
```

**Port 3001 (API) is NOT exposed** — Nginx proxies all API requests internally.

### Rate Limiting

- Auth endpoints: limited requests per IP per window
- Nginx-level rate limiting for API proxy
- PM2 auto-restart on process crash

---

## 📝 Security Checklist

- [x] JWT with short-lived access tokens (15 min)
- [x] Refresh token rotation on each use
- [x] Password hashing (bcryptjs)
- [x] API keys in database, not source code
- [x] CORS whitelist (single origin)
- [x] Helmet.js security headers
- [x] Rate limiting on auth endpoints
- [x] SSL/TLS with auto-renewal
- [x] Firewall (UFW) with minimal open ports
- [x] Role-based access control (customer/admin/super_admin)
- [x] Social login server-side verification
- [x] Document verification (passport OCR + MRZ)
- [x] International flight document gating
- [x] Input validation (Zod schemas frontend, SQL parameterized queries backend)
- [x] Error messages don't leak sensitive data
- [x] Admin panel on hidden route (`/admin/login`)
- [x] Archived bookings excluded from all queries
