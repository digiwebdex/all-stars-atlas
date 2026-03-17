# Seven Trip — Complete Deployment History

> Every deployment to production with exact commands, what changed, and verification steps.
> Last updated: 2026-03-17 (v4.1.5 — Cabin Class Accuracy & Branded Fare Naming)

---

## 🖥 Server Details

| Property | Value |
|----------|-------|
| **Provider** | Hostinger KVM 2 VPS |
| **OS** | Ubuntu 24.04 LTS |
| **IP** | 187.77.137.249 |
| **Domain** | seven-trip.com.bd / www.seven-trip.com.bd |
| **API Domain** | api.seventrip.com.bd |
| **Frontend Path** | `/var/www/seventrip/` |
| **Backend Path** | `~/projects/all-stars-atlas/backend/` |
| **Process Manager** | PM2 (process name: `seventrip-api`) |
| **Web Server** | Nginx with HTTP/2 + SSL |
| **SSL** | Let's Encrypt (auto-renewal via certbot) |
| **Node.js** | v20.x (via nvm) |
| **Database** | MySQL 8 / MariaDB 10.6+ |

---

## 📋 Deployment Records

### Deploy #1 — 2026-03-09 — Initial Production Deployment

**Version:** v2.5.0  
**Type:** Full Stack (Frontend + Backend + Database)  
**Duration:** ~45 minutes

**What was deployed:**
- React frontend (27 public pages, 12 dashboard pages, 17 admin modules)
- Node.js Express backend with MySQL
- TTI/ZENITH GDS integration
- JWT authentication + social login
- SMS + Email notification system
- 20-table database schema

**Commands executed:**
```bash
# Server setup
ssh root@187.77.137.249
apt update && apt upgrade -y
apt install -y curl wget git unzip nginx mysql-server

# Node.js via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc && nvm install 20
npm install -g pm2

# Clone & build
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/digiwebdex/all-stars-atlas-f50e6db8.git all-stars-atlas
cd all-stars-atlas
cp .env.example .env  # Set VITE_API_BASE_URL=https://api.seventrip.com.bd/api
npm install && npm run build
sudo mkdir -p /var/www/seventrip && sudo cp -r dist/* /var/www/seventrip/

# Backend
cd backend
cp .env.example .env  # Configure DB, JWT, SMTP
npm install
pm2 start server.js --name seventrip-api
pm2 save && pm2 startup

# Database
mysql -u root -p -e "CREATE DATABASE seventrip;"
mysql -u root -p seventrip < database/migration.sql
mysql -u root -p seventrip < database/social-auth-migration.sql

# Nginx
sudo cp nginx-optimized.conf /etc/nginx/sites-available/seventrip
sudo ln -s /etc/nginx/sites-available/seventrip /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# SSL
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d seven-trip.com.bd -d www.seven-trip.com.bd -d api.seventrip.com.bd

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

**Verification:**
- ✅ https://seven-trip.com.bd loads
- ✅ API responds at https://api.seventrip.com.bd/api/health
- ✅ Login/register works
- ✅ Flight search returns TTI results

---

### Deploy #2 — 2026-03-10 — GDS Operations & Admin Lifecycle

**Version:** v3.0–v3.1  
**Type:** Full Stack

**What changed:**
- All booking flows now call real APIs (eSIM, Holiday, Medical, Car)
- Zero-mock audit v2 — removed all hardcoded fallback data
- Admin booking lifecycle (archive, delete, status transitions)
- GDS operations in admin (ticket/cancel/void via TTI, BDFare, FlyHub, Sabre)
- E-ticket PDF logo aspect ratio fix

**Command:**
```bash
cd ~/projects/all-stars-atlas && git pull origin main && npm install && npm run build && sudo cp -r dist/* /var/www/seventrip/ && cd backend && npm install && pm2 restart seventrip-api
```

**Verification:**
- ✅ eSIM/Holiday/Medical/Car bookings persist in DB
- ✅ Admin can archive and permanently delete bookings
- ✅ E-ticket PDF renders correctly with logo

---

### Deploy #3 — 2026-03-11 — Multi-City, OCR Engine & Document Validation

**Version:** v3.3  
**Type:** Full Stack

**What changed:**
- Multi-city flight search (2-5 segments) with date validation
- Passport OCR engine v5-v7 (MRZ, QR/barcode, ICAO 9303 check digits)
- Document expiry validation (6-month passport rule for international)
- Cabin class sent to all GDS providers
- Multi-traveller form with color-coded borders
- 70+ country/nationality mappings

**Command:**
```bash
cd ~/projects/all-stars-atlas && git pull origin main && npm install && npm run build && sudo cp -r dist/* /var/www/seventrip/ && cd backend && npm install && pm2 restart seventrip-api
```

**Verification:**
- ✅ Multi-city search returns combined itineraries
- ✅ Passport OCR extracts MRZ data correctly
- ✅ Expired passport blocked with error message

---

### Deploy #4 — 2026-03-11 — Nginx Optimization

**Version:** N/A (Infrastructure)  
**Type:** Nginx Config Only

**What changed:**
- HTTP/2 enabled for both frontend and API
- Static asset caching (1 year for assets/, 30 days for images/)
- Rate limiting on API endpoints
- Gzip compression with optimized levels
- Security headers (HSTS, X-Frame-Options, etc.)

**Command:**
```bash
cd ~/projects/all-stars-atlas && git pull origin main && sudo cp backend/nginx-optimized.conf /etc/nginx/sites-available/seventrip && sudo nginx -t && sudo systemctl reload nginx
```

**Verification:**
- ✅ `curl -I https://seven-trip.com.bd` shows HTTP/2, gzip, security headers
- ✅ Assets served with `Cache-Control: public, immutable`

---

### Deploy #5 — 2026-03-12 — Sabre SOAP, Rewards & Branded Fares

**Version:** v3.5–v3.8  
**Type:** Full Stack + Database Migration

**What changed:**
- Sabre SOAP session manager (EnhancedSeatMapRQ v6 + GetAncillaryOffersRQ v3)
- 4-step mandatory booking flow with SSR injection
- Interactive seat map with aircraft-aware layout
- Branded fares from Sabre (Economy Light/Smart)
- Reward points system (earn/redeem/coupons)
- Animated flight timeline with glowing plane arc
- Round-trip deduplication fix
- BDFare normalizer rewrite for API v2
- White search bar redesign + dark mode softened

**Commands:**
```bash
# Full deployment
cd ~/projects/all-stars-atlas && git pull origin main && npm install && npm run build && sudo cp -r dist/* /var/www/seventrip/ && cd backend && npm install && pm2 restart seventrip-api

# Database migration
mysql -u root -p seventrip < backend/database/reward-points-migration.sql
```

**Verification:**
- ✅ Seat map renders for Sabre flights
- ✅ Branded fares show Economy Light/Smart labels
- ✅ Reward points page accessible at /dashboard/rewards
- ✅ BDFare returns 700+ results for round-trip searches

---

### Deploy #6 — 2026-03-12 — Reward Points Database Migration

**Version:** v3.7.2 (hotfix)  
**Type:** Database Only

**What changed:**
- Fixed FK type mismatch: rewards tables used `INT` user_id but `users.id` is `CHAR(36)` UUID
- Changed all FK columns to `CHAR(36)` in `user_points`, `point_transactions`, `reward_coupons`, `points_rules`

**Command:**
```bash
cd ~/projects/all-stars-atlas && git pull origin main && mysql -u root -p seventrip < backend/database/reward-points-migration.sql
```

**Verification:**
- ✅ Migration runs without ERROR 3780
- ✅ Rewards endpoints return 200

---

### Deploy #7 — 2026-03-13 — TTI Cancel Fix, Sabre PNR Fix & SOAP Retry

**Version:** v3.9.6–v3.9.7  
**Type:** Full Stack

**What changed:**
- TTI cancellation: uses airline PNR (not internal TTI ID) — probe matrix identified correct payload
- Sabre PNR creation: removed `NamePrefix` from `PersonName` (400 schema error), title appended to `GivenName`
- Sabre SOAP cancel fallback: local config loader + export fix
- SOAP seat map: auto-retry with fresh session on stale BinarySecurityToken
- NDC investigation: BFM request correct, PCC J4YL lacks NDC entitlements (Sabre account issue)

**Command:**
```bash
cd ~/projects/all-stars-atlas && git pull origin main && npm install && npm run build && sudo cp -r dist/* /var/www/seventrip/ && cd backend && npm install && pm2 restart seventrip-api
```

**Verification:**
- ✅ PNR `JIUKMY` created successfully via `full_payload` variant
- ✅ Seat maps returning real data: AI (126 seats), EK (276 seats), SQ (159 seats)
- ✅ TTI cancel sends airline PNR correctly

---

### Deploy #8 — 2026-03-13 — Sabre Cancel Hardening (v3.9.9.9)

**Version:** v3.9.9.9
**Type:** Backend Only
**Duration:** ~2 minutes

**What was deployed:**
- SOAP session management hardening: `resetSoapSessionCacheWithClose()`, retry-only on session/auth errors
- Cancel PNR resolution: `resolveCancelLocators()` ensures GDS PNR used
- Cancel safety guard: blocks local status change without GDS confirmation
- Enhanced cancel logging: shows bookingRef, gdsPnr, airlinePnr

**Command:**
```bash
cd ~/projects/all-stars-atlas && git pull origin main && cd backend && npm install && pm2 restart seventrip-api
```

**Verification:**
- ✅ PNR AQDAMJ (airline PNR FDDPE6) cancelled successfully via SOAP
- ✅ SOAP diagnostic confirms session creation working
- ✅ Host TA pool recovered after stale sessions expired

---

## 📊 Deployment Statistics

| Metric | Value |
|--------|-------|
| **Total Deployments** | 9 |
| **Full Stack** | 5 |
| **Backend Only** | 3 |
| **Nginx Only** | 1 |
| **Database Only** | 1 |
| **Average Deploy Time** | ~3 minutes (git pull → build → copy → restart) |
| **Zero-Downtime** | Yes (PM2 restart, Nginx reload) |
| **Rollback Required** | 0 |

---

## 🔧 Deployment Checklist

Before every deployment:

- [ ] Run `npm run build` locally to verify no build errors
- [ ] Check CHANGELOG.md is updated
- [ ] Check DEPLOYMENT_COMMANDS.md change log is updated
- [ ] Verify `.env` has correct `VITE_API_BASE_URL`
- [ ] If DB changes: prepare migration SQL and test locally first
- [ ] If Nginx changes: test with `sudo nginx -t` before reload

After every deployment:

- [ ] Check `pm2 status` — seventrip-api is `online`
- [ ] Check `pm2 logs seventrip-api --lines 10` — no startup errors
- [ ] Visit https://seven-trip.com.bd — homepage loads
- [ ] Visit https://api.seventrip.com.bd/api/health — API responds
- [ ] Test the specific feature that was deployed
- [ ] Check browser console for errors
