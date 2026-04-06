# Seven Trip — VPS Production Session Log

> All terminal commands executed on the production VPS with their outputs.
> This serves as the audit trail for every production action taken.
> Last updated: 2026-04-06 (v4.2.0)

---

## 🖥 Server Info

```
Host: root@srv1460607 (187.77.137.249)
OS: Ubuntu 24.04 LTS
Project: ~/projects/all-stars-atlas
Backend: PM2 process "seventrip-api" on port 3001
Frontend: /var/www/seventrip/
```

---

## Session 1 — 2026-03-09 — Initial Server Setup & First Deployment

### Server Preparation
```bash
ssh root@187.77.137.249
apt update && apt upgrade -y
apt install -y curl wget git unzip nginx mysql-server software-properties-common
```

### Node.js Installation
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
npm install -g pm2
```

### Clone & Build
```bash
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/digiwebdex/all-stars-atlas-f50e6db8.git all-stars-atlas
cd all-stars-atlas
cp .env.example .env
# Edited: VITE_API_BASE_URL=https://seven-trip.com/api
npm install && npm run build
sudo mkdir -p /var/www/seventrip
sudo cp -r dist/* /var/www/seventrip/
```

### Backend Setup
```bash
cd backend
cp .env.example .env
# Edited: DB_HOST, DB_PASSWORD, JWT_SECRET, FRONTEND_URL
npm install
pm2 start server.js --name seventrip-api
pm2 save
pm2 startup
```

### Database Setup
```bash
mysql -u root -p -e "CREATE DATABASE seventrip;"
mysql -u root -p seventrip < database/migration.sql
mysql -u root -p seventrip < database/social-auth-migration.sql
```

### Nginx Configuration
```bash
sudo cp backend/nginx-optimized.conf /etc/nginx/sites-available/seventrip
sudo ln -s /etc/nginx/sites-available/seventrip /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### SSL Setup
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d seven-trip.com -d www.seven-trip.com -d seven-trip.com
```

### Firewall
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

---

## Session 2 — 2026-03-10 — GDS Operations Deployment

```bash
cd ~/projects/all-stars-atlas && git pull origin main && npm install && npm run build && sudo cp -r dist/* /var/www/seventrip/ && cd backend && npm install && pm2 restart seventrip-api
```

---

## Session 3 — 2026-03-11 — Multi-City & OCR Engine Deployment

```bash
cd ~/projects/all-stars-atlas && git pull origin main && npm install && npm run build && sudo cp -r dist/* /var/www/seventrip/ && cd backend && npm install && pm2 restart seventrip-api
```

### Nginx Optimization
```bash
cd ~/projects/all-stars-atlas && git pull origin main
sudo cp backend/nginx-optimized.conf /etc/nginx/sites-available/seventrip
sudo nginx -t && sudo systemctl reload nginx
```

---

## Session 4 — 2026-03-12 — Sabre SOAP, Rewards & Major Feature Deployment

### Full Stack Deploy
```bash
cd ~/projects/all-stars-atlas && git pull origin main && npm install && npm run build && sudo cp -r dist/* /var/www/seventrip/ && cd backend && npm install && pm2 restart seventrip-api
```

### Reward Points Database Migration
```bash
cd ~/projects/all-stars-atlas && git pull origin main
mysql -u root -p seventrip < backend/database/reward-points-migration.sql
```

**Output:** Migration successful (4 tables created: `user_points`, `point_transactions`, `reward_coupons`, `points_rules`)

### Hotfix — Rewards Route Crash (502)
```bash
# Error: Route.get() requires a callback function
# Cause: authenticateToken undefined (should be authenticate)
cd ~/projects/all-stars-atlas && git pull origin main && cd backend && pm2 restart seventrip-api
pm2 logs seventrip-api --lines 30
```

### Hotfix — Rewards Migration FK Error 3780
```bash
# Error: Referencing column 'user_id' and referenced column 'id' are incompatible
# Cause: INT vs CHAR(36) mismatch
cd ~/projects/all-stars-atlas && git pull origin main
mysql -u root -p seventrip < backend/database/reward-points-migration.sql
```

---

## Session 5 — 2026-03-13 — TTI Cancel Fix, Sabre PNR Fix & SOAP Retry

### Pull & Restart
```bash
cd ~/projects/all-stars-atlas && git pull origin main && cd backend && pm2 restart seventrip-api && sleep 3
```

**Output:**
```
remote: Enumerating objects: 45, done.
remote: Counting objects: 100% (45/45), done.
remote: Compressing objects: 100% (3/3), done.
remote: Total 35 (delta 33), reused 34 (delta 32), pack-reused 0 (from 0)
Unpacking objects: 100% (35/35), 5.09 KiB | 162.00 KiB/s, done.
From https://github.com/digiwebdex/all-stars-atlas
 * branch            main       -> FETCH_HEAD
   8b2b25a..95176ea  main       -> origin/main
Updating 8b2b25a..95176ea
Fast-forward
 CHANGELOG.md                        | 11 +++++++++++
 DEPLOYMENT_COMMANDS.md              |  4 ++--
 README.md                           |  6 +++---
 backend/src/routes/sabre-flights.js | 12 +++++-------
 backend/src/routes/sabre-soap.js    | 20 ++++++++++++++++++--
 developer_documentation.md          |  6 +++++-
 6 files changed, 44 insertions(+), 15 deletions(-)

┌────┬──────────────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┬──────────┐
│ id │ name             │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │ cpu      │ mem      │ user     │ watching │
├────┼──────────────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┼──────────┼──────────┼──────────┼──────────┤
│ 0  │ seventrip-api    │ default     │ 1.0.0   │ fork    │ 64217    │ 0s     │ 364  │ online    │ 0%       │ 25.8mb   │ root     │ disabled │
└────┴──────────────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┴──────────┘
```

### Seat Map Verification Test
```bash
USER_TOKEN=$(curl -s http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"rahim@gmail.com","password":"User@123456"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('accessToken',''))")

# Test Air India seat map
curl -s "http://localhost:3001/api/flights/seat-map?airlineCode=AI&origin=DAC&destination=DXB&flightNumber=2184&departureDate=2026-04-15&cabinClass=Economy" \
  -H "Authorization: Bearer $USER_TOKEN" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print('Available:',d.get('available'),'Source:',d.get('source'),'Rows:',len(d.get('layout',{}).get('rows',[])))"
```

**Output:**
```
Available: True Source: sabre_soap Rows: 126
```

### Emirates Seat Map Test
```bash
curl -s "http://localhost:3001/api/flights/seat-map?airlineCode=EK&origin=DAC&destination=DXB&flightNumber=585&departureDate=2026-04-15&cabinClass=Economy" \
  -H "Authorization: Bearer $USER_TOKEN" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print('Available:',d.get('available'),'Source:',d.get('source'),'Rows:',len(d.get('layout',{}).get('rows',[])))"
```

**Output:**
```
Available: True Source: sabre_soap Rows: 276
```

### Singapore Airlines Seat Map Test
```bash
curl -s "http://localhost:3001/api/flights/seat-map?airlineCode=SQ&origin=DAC&destination=SIN&flightNumber=447&departureDate=2026-04-15&cabinClass=Economy" \
  -H "Authorization: Bearer $USER_TOKEN" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print('Available:',d.get('available'),'Source:',d.get('source'),'Rows:',len(d.get('layout',{}).get('rows',[])))"
```

**Output:**
```
Available: True Source: sabre_soap Rows: 159
```

### PNR Creation Test (Sabre)
```bash
curl -s -X POST http://localhost:3001/api/flights/book \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{
    "flightData": <sabre_flight_object>,
    "passengers": [{
      "type": "adult",
      "title": "Mr",
      "firstName": "TEST",
      "lastName": "BOOKING",
      "gender": "male",
      "dateOfBirth": "1990-05-15",
      "nationality": "BD",
      "passportNumber": "BK0098765",
      "passportExpiry": "2028-12-01",
      "passportCountry": "BD"
    }],
    "contactInfo": {
      "email": "test@seventrip.com",
      "phone": "+8801700000000"
    },
    "payLater": true,
    "totalAmount": 40000
  }' | python3 -m json.tool
```

**Output:**
```json
{
    "id": "c0c01779-a735-474e-8782-1ea5917664b9",
    "bookingRef": "JIUKMY",
    "status": "on_hold",
    "payLater": true,
    "paymentDeadline": "2026-03-20T23:59:59.000Z",
    "totalAmount": 40000,
    "currency": "BDT",
    "bookingType": "flight",
    "pnr": "JIUKMY",
    "airlinePnr": "JIUKMY",
    "gdsBookingId": null,
    "gdsBooked": true,
    "createdAt": "2026-03-13T09:11:47.417Z"
}
```

**Result:** ✅ PNR `JIUKMY` created successfully via `full_payload` variant (no NamePrefix, no fallback needed)

### Full Frontend + Backend Deploy
```bash
cd ~/projects/all-stars-atlas && git pull origin main && npm install && npm run build && sudo cp -r dist/* /var/www/seventrip/ && cd backend && npm install && pm2 restart seventrip-api
```

---

## Session 6 — 2026-03-25 — Nginx Gzip Crash Fix (3.5h Outage)

### Diagnosis
```bash
sudo systemctl status nginx
# Active: failed — "gzip" directive is duplicate in /etc/nginx/sites-enabled/seventrip:15
pm2 status
# seventrip-api: online (port 3001)
sudo ufw status
# Ports 80/443 open
```

### Fix — Replace site config (no gzip, correct port)
```bash
sudo tee /etc/nginx/sites-available/seventrip > /dev/null << 'NGINX'
# (clean config without gzip directives, API proxy to port 3001)
NGINX
sudo ln -sf /etc/nginx/sites-available/seventrip /etc/nginx/sites-enabled/seventrip
sudo nginx -t && sudo systemctl start nginx
```

### Fix API proxy port (was 5000, should be 3001)
```bash
sudo sed -i 's|proxy_pass http://127.0.0.1:5000/api/;|proxy_pass http://127.0.0.1:3001/api/;|' /etc/nginx/sites-available/seventrip
sudo nginx -t && sudo systemctl reload nginx
```

### Verification
```bash
sudo systemctl status nginx --no-pager
# Active: active (running)
curl -sI https://seven-trip.com | head -5
# HTTP/2 200
```

**Outage:** 06:12 UTC → 09:34 UTC (~3.5 hours)
**Root Cause:** Duplicate gzip directive in site config vs /etc/nginx/nginx.conf
**Prevention:** Repo `nginx-optimized.conf` has NO gzip directives

---

## 📊 PM2 Process History

```bash
pm2 status
```

| Metric | Value |
|--------|-------|
| **Process Name** | seventrip-api |
| **PID** | 192711 (latest) |
| **Restarts** | 811 (includes all hotfixes + deploys) |
| **Mode** | fork |
| **Memory** | ~69.4 MB |
| **Status** | online |

---

## 📝 Useful Monitoring Commands Used

```bash
# Check process status
pm2 status

# View real-time logs
pm2 logs seventrip-api --lines 50

# Check Nginx
sudo nginx -t
sudo systemctl status nginx

# Check MySQL
sudo systemctl status mysql

# Disk space
df -h

# Memory
free -m

# SSL certificate status
sudo certbot certificates

# Test API health
curl -s https://seven-trip.com/api/health
```

---

## 🔑 Test Credentials Used

| User | Email | Role |
|------|-------|------|
| Test User | rahim@gmail.com | Customer |
| Test Booking | test@seventrip.com | Booking contact |

> **Note:** All test bookings use `payLater: true` to avoid triggering real payment flows.
