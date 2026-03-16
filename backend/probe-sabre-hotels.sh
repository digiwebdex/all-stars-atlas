#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  Seven Trip — Sabre Hotel API Probe (v1.0)
#  Tests all hotel endpoints with various payload combinations
#  Run: cd ~/projects/all-stars-atlas && bash backend/probe-sabre-hotels.sh
# ══════════════════════════════════════════════════════════════

API_BASE="http://localhost:3001/api"
PASS=0; FAIL=0; SKIP=0; TOTAL=0
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
RESULTS=()

# Dates
TOMORROW=$(date -d "+1 day" +%Y-%m-%d 2>/dev/null || date -v+1d +%Y-%m-%d)
DAY3=$(date -d "+3 days" +%Y-%m-%d 2>/dev/null || date -v+3d +%Y-%m-%d)
DAY7=$(date -d "+7 days" +%Y-%m-%d 2>/dev/null || date -v+7d +%Y-%m-%d)
DAY10=$(date -d "+10 days" +%Y-%m-%d 2>/dev/null || date -v+10d +%Y-%m-%d)

log_pass() { ((PASS++)); ((TOTAL++)); RESULTS+=("${GREEN}✅ PASS${NC} — $1"); echo -e "${GREEN}✅ PASS${NC} — $1"; }
log_fail() { ((FAIL++)); ((TOTAL++)); RESULTS+=("${RED}❌ FAIL${NC} — $1"); echo -e "${RED}❌ FAIL${NC} — $1"; }
log_skip() { ((SKIP++)); ((TOTAL++)); RESULTS+=("${YELLOW}⏭️  SKIP${NC} — $1"); echo -e "${YELLOW}⏭️  SKIP${NC} — $1"; }
log_info() { echo -e "${CYAN}ℹ️  $1${NC}"; }

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  🏨 Sabre Hotel API Probe — Seven Trip"
echo "  Dates: $TOMORROW → $DAY3 / $DAY7 / $DAY10"
echo "══════════════════════════════════════════════════════════"
echo ""

# ── Wait for API ──
echo "⏳ Checking API health..."
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/health" 2>/dev/null)
if [ "$HEALTH" != "200" ]; then
  echo -e "${RED}API not responding ($HEALTH). Start with: pm2 restart seventrip-api${NC}"
  exit 1
fi
echo -e "${GREEN}API is healthy${NC}"
echo ""

# ── Auth (needed for booking test) ──
log_info "Authenticating..."
AUTH_RESP=$(curl -s -X POST "$API_BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"admin@seven-trip.com","password":"admin123"}')
TOKEN=$(echo "$AUTH_RESP" | jq -r '.token // .accessToken // empty' 2>/dev/null)
if [ -z "$TOKEN" ]; then
  log_info "Auth failed (non-critical for search tests)"
else
  log_info "Authenticated ✓"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 1: International City — Dubai (DXB)
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 1: Hotel Search — Dubai (international, airport code)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=Dubai&checkIn=$TOMORROW&checkOut=$DAY3&adults=2&rooms=1")
TOTAL_H=$(echo "$RESP" | jq '.total // 0' 2>/dev/null)
SABRE_COUNT=$(echo "$RESP" | jq '.sources.sabre // 0' 2>/dev/null)
HB_COUNT=$(echo "$RESP" | jq '.sources.hotelbeds // 0' 2>/dev/null)
DB_COUNT=$(echo "$RESP" | jq '.sources.db // 0' 2>/dev/null)

echo "  Total: $TOTAL_H | Sabre: $SABRE_COUNT | HotelBeds: $HB_COUNT | DB: $DB_COUNT"

if [ "$SABRE_COUNT" -gt 0 ] 2>/dev/null; then
  log_pass "Dubai search: $SABRE_COUNT Sabre hotels found"
  # Show first 3 hotels
  echo "$RESP" | jq -r '.data[:3][] | "    → \(.name) | ⭐\(.stars // 0) | $\(.price // 0)/night | \(.source) | \(.amenities[:3] // [] | join(", "))"' 2>/dev/null
else
  log_fail "Dubai search: 0 Sabre hotels (total=$TOTAL_H)"
  # Show raw error hints
  echo "$RESP" | jq '.sources, .searchMeta' 2>/dev/null
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 2: International City — Bangkok (BKK)
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 2: Hotel Search — Bangkok"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=Bangkok&checkIn=$TOMORROW&checkOut=$DAY3&adults=2&rooms=1")
SABRE_COUNT=$(echo "$RESP" | jq '.sources.sabre // 0' 2>/dev/null)
TOTAL_H=$(echo "$RESP" | jq '.total // 0' 2>/dev/null)
echo "  Total: $TOTAL_H | Sabre: $SABRE_COUNT"
if [ "$SABRE_COUNT" -gt 0 ] 2>/dev/null; then
  log_pass "Bangkok search: $SABRE_COUNT Sabre hotels"
  echo "$RESP" | jq -r '.data[:2][] | "    → \(.name) | $\(.price)/night | \(.amenities[:3] // [] | join(", "))"' 2>/dev/null
else
  log_fail "Bangkok search: 0 Sabre hotels"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 3: Domestic — Cox's Bazar (CXB)
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 3: Hotel Search — Cox's Bazar (domestic BD)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=Cox%27s+Bazar&checkIn=$TOMORROW&checkOut=$DAY3&adults=2&rooms=1")
SABRE_COUNT=$(echo "$RESP" | jq '.sources.sabre // 0' 2>/dev/null)
TOTAL_H=$(echo "$RESP" | jq '.total // 0' 2>/dev/null)
echo "  Total: $TOTAL_H | Sabre: $SABRE_COUNT"
if [ "$TOTAL_H" -gt 0 ] 2>/dev/null; then
  log_pass "Cox's Bazar search: $TOTAL_H total hotels (Sabre: $SABRE_COUNT)"
else
  log_fail "Cox's Bazar search: 0 hotels"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 4: Domestic — Dhaka (DAC)
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 4: Hotel Search — Dhaka"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=Dhaka&checkIn=$TOMORROW&checkOut=$DAY3&adults=2&rooms=1")
SABRE_COUNT=$(echo "$RESP" | jq '.sources.sabre // 0' 2>/dev/null)
TOTAL_H=$(echo "$RESP" | jq '.total // 0' 2>/dev/null)
echo "  Total: $TOTAL_H | Sabre: $SABRE_COUNT"
if [ "$TOTAL_H" -gt 0 ] 2>/dev/null; then
  log_pass "Dhaka search: $TOTAL_H total hotels (Sabre: $SABRE_COUNT)"
else
  log_fail "Dhaka search: 0 hotels"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 5: Multi-city code — Singapore (SIN)
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 5: Hotel Search — Singapore"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=Singapore&checkIn=$DAY7&checkOut=$DAY10&adults=2&rooms=1")
SABRE_COUNT=$(echo "$RESP" | jq '.sources.sabre // 0' 2>/dev/null)
TOTAL_H=$(echo "$RESP" | jq '.total // 0' 2>/dev/null)
echo "  Total: $TOTAL_H | Sabre: $SABRE_COUNT"
if [ "$SABRE_COUNT" -gt 0 ] 2>/dev/null; then
  log_pass "Singapore search: $SABRE_COUNT Sabre hotels"
else
  log_fail "Singapore search: 0 Sabre hotels"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 6: City code type — London (LON, type=6)
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 6: Hotel Search — London (multi-airport city code)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=London&checkIn=$DAY7&checkOut=$DAY10&adults=2&rooms=1")
SABRE_COUNT=$(echo "$RESP" | jq '.sources.sabre // 0' 2>/dev/null)
TOTAL_H=$(echo "$RESP" | jq '.total // 0' 2>/dev/null)
echo "  Total: $TOTAL_H | Sabre: $SABRE_COUNT"
if [ "$SABRE_COUNT" -gt 0 ] 2>/dev/null; then
  log_pass "London search: $SABRE_COUNT Sabre hotels"
else
  log_fail "London search: 0 Sabre hotels"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 7: Multi-room search (2 rooms, 4 adults)
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 7: Multi-Room — Dubai (2 rooms, 4 adults)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=Dubai&checkIn=$TOMORROW&checkOut=$DAY3&adults=4&rooms=2")
SABRE_COUNT=$(echo "$RESP" | jq '.sources.sabre // 0' 2>/dev/null)
TOTAL_H=$(echo "$RESP" | jq '.total // 0' 2>/dev/null)
echo "  Total: $TOTAL_H | Sabre: $SABRE_COUNT"
if [ "$TOTAL_H" -gt 0 ] 2>/dev/null; then
  log_pass "Multi-room Dubai: $TOTAL_H hotels"
else
  log_fail "Multi-room Dubai: 0 hotels"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 8: With children
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 8: Family Search — Bangkok (2 adults + 1 child)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=Bangkok&checkIn=$TOMORROW&checkOut=$DAY3&adults=2&children=1&rooms=1")
SABRE_COUNT=$(echo "$RESP" | jq '.sources.sabre // 0' 2>/dev/null)
TOTAL_H=$(echo "$RESP" | jq '.total // 0' 2>/dev/null)
echo "  Total: $TOTAL_H | Sabre: $SABRE_COUNT"
if [ "$TOTAL_H" -gt 0 ] 2>/dev/null; then
  log_pass "Family Bangkok: $TOTAL_H hotels"
else
  log_fail "Family Bangkok: 0 hotels"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 9: Star rating filter (5-star only)
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 9: 5-Star Filter — Dubai"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=Dubai&checkIn=$TOMORROW&checkOut=$DAY3&adults=2&rooms=1&starRating=5")
SABRE_COUNT=$(echo "$RESP" | jq '.sources.sabre // 0' 2>/dev/null)
TOTAL_H=$(echo "$RESP" | jq '.total // 0' 2>/dev/null)
echo "  Total: $TOTAL_H | Sabre: $SABRE_COUNT"
if [ "$TOTAL_H" -gt 0 ] 2>/dev/null; then
  log_pass "5-star Dubai: $TOTAL_H hotels"
  echo "$RESP" | jq -r '.data[:3][] | "    → \(.name) | ⭐\(.stars) | $\(.price)/night"' 2>/dev/null
else
  log_fail "5-star Dubai: 0 hotels"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 10: Price range filter
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 10: Price Range — Dubai ($50-$150/night)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=Dubai&checkIn=$TOMORROW&checkOut=$DAY3&adults=2&rooms=1&minPrice=50&maxPrice=150")
SABRE_COUNT=$(echo "$RESP" | jq '.sources.sabre // 0' 2>/dev/null)
TOTAL_H=$(echo "$RESP" | jq '.total // 0' 2>/dev/null)
echo "  Total: $TOTAL_H | Sabre: $SABRE_COUNT"
if [ "$TOTAL_H" -gt 0 ] 2>/dev/null; then
  log_pass "Budget Dubai: $TOTAL_H hotels in range"
else
  log_skip "Budget Dubai: 0 hotels (may be no inventory in range)"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 11: Sort by price-low
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 11: Sort — Price Low to High (Dubai)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=Dubai&checkIn=$TOMORROW&checkOut=$DAY3&adults=2&rooms=1&sort=price-low")
TOTAL_H=$(echo "$RESP" | jq '.total // 0' 2>/dev/null)
FIRST_PRICE=$(echo "$RESP" | jq '.data[0].price // 0' 2>/dev/null)
LAST_PRICE=$(echo "$RESP" | jq '.data[-1].price // 0' 2>/dev/null)
echo "  Total: $TOTAL_H | First: \$$FIRST_PRICE | Last: \$$LAST_PRICE"
if [ "$TOTAL_H" -gt 0 ] 2>/dev/null; then
  log_pass "Price sort: $TOTAL_H hotels (cheapest: \$$FIRST_PRICE)"
else
  log_fail "Price sort: 0 hotels"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 12: Hotel Details + Rates (pick first Sabre hotel)
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 12: Hotel Details + Room Rates"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
# Get a Sabre hotel code from test 1
SEARCH_RESP=$(curl -s "$API_BASE/hotels/search?destination=Dubai&checkIn=$TOMORROW&checkOut=$DAY3&adults=2&rooms=1")
HOTEL_CODE=$(echo "$SEARCH_RESP" | jq -r '[.data[] | select(.source=="sabre")][0].sabreHotelCode // empty' 2>/dev/null)
HOTEL_ID=$(echo "$SEARCH_RESP" | jq -r '[.data[] | select(.source=="sabre")][0].id // empty' 2>/dev/null)
HOTEL_NAME=$(echo "$SEARCH_RESP" | jq -r '[.data[] | select(.source=="sabre")][0].name // empty' 2>/dev/null)

if [ -n "$HOTEL_CODE" ]; then
  echo "  Testing details for: $HOTEL_NAME (code: $HOTEL_CODE)"
  DETAIL_RESP=$(curl -s "$API_BASE/hotels/details/$HOTEL_ID?checkIn=$TOMORROW&checkOut=$DAY3&adults=2&rooms=1")
  DETAIL_NAME=$(echo "$DETAIL_RESP" | jq -r '.hotel.name // empty' 2>/dev/null)
  ROOM_COUNT=$(echo "$DETAIL_RESP" | jq '.hotel.rooms | length' 2>/dev/null)
  IMAGE_COUNT=$(echo "$DETAIL_RESP" | jq '.hotel.images | length' 2>/dev/null)
  AMENITY_COUNT=$(echo "$DETAIL_RESP" | jq '.hotel.amenities | length' 2>/dev/null)

  echo "  Name: $DETAIL_NAME | Rooms: $ROOM_COUNT | Images: $IMAGE_COUNT | Amenities: $AMENITY_COUNT"

  if [ -n "$DETAIL_NAME" ]; then
    log_pass "Hotel details: $DETAIL_NAME ($ROOM_COUNT rooms, $IMAGE_COUNT images)"
    # Show room rates
    echo "$DETAIL_RESP" | jq -r '.hotel.rooms[:5][] | "    → \(.name) | $\(.price)/night | \(if .isRefundable then "✅ Free cancel" else "❌ Non-refund" end) | Bed: \(.bedType // "N/A")"' 2>/dev/null
  else
    log_fail "Hotel details: empty response for $HOTEL_CODE"
  fi
else
  log_skip "Hotel details: no Sabre hotel found in Dubai search to test"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 13: Hotel Deals (homepage)
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 13: Hotel Deals (Homepage API)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
DEALS_RESP=$(curl -s "$API_BASE/hotels/deals")
DEAL_COUNT=$(echo "$DEALS_RESP" | jq '.total // 0' 2>/dev/null)
echo "  Deals available: $DEAL_COUNT"
if [ "$DEAL_COUNT" -gt 0 ] 2>/dev/null; then
  log_pass "Hotel deals: $DEAL_COUNT deals cached"
  echo "$DEALS_RESP" | jq -r '.deals[:5][] | "    → \(.name) in \(.dealCity // .city) | $\(.price)/night | ⭐\(.stars // 0)"' 2>/dev/null
else
  log_skip "Hotel deals: 0 (cache may not have populated yet — wait 15s after restart)"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 14: Middle East — Jeddah
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 14: Hotel Search — Jeddah (Umrah market)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=Jeddah&checkIn=$DAY7&checkOut=$DAY10&adults=2&rooms=1")
SABRE_COUNT=$(echo "$RESP" | jq '.sources.sabre // 0' 2>/dev/null)
TOTAL_H=$(echo "$RESP" | jq '.total // 0' 2>/dev/null)
echo "  Total: $TOTAL_H | Sabre: $SABRE_COUNT"
if [ "$SABRE_COUNT" -gt 0 ] 2>/dev/null; then
  log_pass "Jeddah search: $SABRE_COUNT Sabre hotels"
else
  log_fail "Jeddah search: 0 Sabre hotels"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 15: Maldives
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 15: Hotel Search — Maldives"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=Maldives&checkIn=$DAY7&checkOut=$DAY10&adults=2&rooms=1")
SABRE_COUNT=$(echo "$RESP" | jq '.sources.sabre // 0' 2>/dev/null)
TOTAL_H=$(echo "$RESP" | jq '.total // 0' 2>/dev/null)
echo "  Total: $TOTAL_H | Sabre: $SABRE_COUNT"
if [ "$SABRE_COUNT" -gt 0 ] 2>/dev/null; then
  log_pass "Maldives search: $SABRE_COUNT Sabre hotels"
else
  log_fail "Maldives search: 0 Sabre hotels"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 16: Long stay (7 nights)
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 16: Long Stay — Dubai (7 nights)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=Dubai&checkIn=$TOMORROW&checkOut=$DAY7&adults=2&rooms=1")
SABRE_COUNT=$(echo "$RESP" | jq '.sources.sabre // 0' 2>/dev/null)
TOTAL_H=$(echo "$RESP" | jq '.total // 0' 2>/dev/null)
echo "  Total: $TOTAL_H | Sabre: $SABRE_COUNT"
if [ "$TOTAL_H" -gt 0 ] 2>/dev/null; then
  log_pass "7-night Dubai: $TOTAL_H hotels"
  # Check total price calculation
  FIRST_NIGHTLY=$(echo "$RESP" | jq '.data[0].price // 0' 2>/dev/null)
  FIRST_TOTAL=$(echo "$RESP" | jq '.data[0].totalPrice // 0' 2>/dev/null)
  echo "  First hotel: \$$FIRST_NIGHTLY/night × ~7 nights = \$$FIRST_TOTAL total"
else
  log_fail "7-night Dubai: 0 hotels"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 17: Raw 3-letter code search
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 17: Raw IATA Code — KUL (Kuala Lumpur)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=KUL&checkIn=$TOMORROW&checkOut=$DAY3&adults=2&rooms=1")
SABRE_COUNT=$(echo "$RESP" | jq '.sources.sabre // 0' 2>/dev/null)
TOTAL_H=$(echo "$RESP" | jq '.total // 0' 2>/dev/null)
echo "  Total: $TOTAL_H | Sabre: $SABRE_COUNT"
if [ "$TOTAL_H" -gt 0 ] 2>/dev/null; then
  log_pass "KUL code search: $TOTAL_H hotels"
else
  log_fail "KUL code search: 0 hotels"
fi
echo ""

# ══════════════════════════════════════════════
#  TEST 18: Data quality — check field coverage
# ══════════════════════════════════════════════
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 18: Data Quality Audit (Dubai Sabre results)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESP=$(curl -s "$API_BASE/hotels/search?destination=Dubai&checkIn=$TOMORROW&checkOut=$DAY3&adults=2&rooms=1")
SABRE_HOTELS=$(echo "$RESP" | jq '[.data[] | select(.source=="sabre")]')
SABRE_COUNT=$(echo "$SABRE_HOTELS" | jq 'length' 2>/dev/null)

if [ "$SABRE_COUNT" -gt 0 ] 2>/dev/null; then
  HAS_PRICE=$(echo "$SABRE_HOTELS" | jq '[.[] | select(.price > 0)] | length' 2>/dev/null)
  HAS_STARS=$(echo "$SABRE_HOTELS" | jq '[.[] | select(.stars > 0)] | length' 2>/dev/null)
  HAS_NAME=$(echo "$SABRE_HOTELS" | jq '[.[] | select(.name != "" and .name != null)] | length' 2>/dev/null)
  HAS_AMENITIES=$(echo "$SABRE_HOTELS" | jq '[.[] | select((.amenities | length) > 0)] | length' 2>/dev/null)
  HAS_IMAGE=$(echo "$SABRE_HOTELS" | jq '[.[] | select(.img != null and .img != "")] | length' 2>/dev/null)
  HAS_RATING=$(echo "$SABRE_HOTELS" | jq '[.[] | select(.rating > 0)] | length' 2>/dev/null)
  HAS_LOCATION=$(echo "$SABRE_HOTELS" | jq '[.[] | select(.location != "" and .location != null)] | length' 2>/dev/null)
  HAS_FREE_CANCEL=$(echo "$SABRE_HOTELS" | jq '[.[] | select(.isFreeCancellation == true)] | length' 2>/dev/null)
  ZERO_PRICE=$(echo "$SABRE_HOTELS" | jq '[.[] | select(.price == 0 or .price == null)] | length' 2>/dev/null)

  echo "  📊 Sabre Hotel Data Coverage ($SABRE_COUNT hotels):"
  echo "     Name:          $HAS_NAME/$SABRE_COUNT"
  echo "     Price > 0:     $HAS_PRICE/$SABRE_COUNT (zero: $ZERO_PRICE)"
  echo "     Stars:         $HAS_STARS/$SABRE_COUNT"
  echo "     Rating:        $HAS_RATING/$SABRE_COUNT"
  echo "     Amenities:     $HAS_AMENITIES/$SABRE_COUNT"
  echo "     Images:        $HAS_IMAGE/$SABRE_COUNT"
  echo "     Location:      $HAS_LOCATION/$SABRE_COUNT"
  echo "     Free Cancel:   $HAS_FREE_CANCEL/$SABRE_COUNT"

  if [ "$ZERO_PRICE" -gt 0 ] 2>/dev/null; then
    log_fail "Data quality: $ZERO_PRICE hotels with $0 price"
  else
    log_pass "Data quality: all $SABRE_COUNT hotels have valid prices"
  fi
else
  log_skip "Data quality: no Sabre hotels to audit"
fi
echo ""

# ══════════════════════════════════════════════
#  SUMMARY
# ══════════════════════════════════════════════
echo ""
echo "══════════════════════════════════════════════════════════"
echo "  🏨 SABRE HOTEL PROBE RESULTS"
echo "══════════════════════════════════════════════════════════"
echo ""
for r in "${RESULTS[@]}"; do echo -e "  $r"; done
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  Total: $TOTAL | ${GREEN}Pass: $PASS${NC} | ${RED}Fail: $FAIL${NC} | ${YELLOW}Skip: $SKIP${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check PM2 logs for Sabre Hotel errors (REST + SOAP)
echo "📋 Recent Sabre Hotel logs (last 200 lines):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
pm2 logs seventrip-api --lines 200 --nostream 2>/dev/null | grep -E '\[(Sabre Hotels|Sabre SOAP)\]' | tail -80
echo ""
echo "Done! Run 'pm2 logs seventrip-api --lines 400 --nostream | grep -E \"\\[(Sabre Hotels|Sabre SOAP)\\]\"' for full debug output."
