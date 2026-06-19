#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Seven Trip — Comprehensive 30-Route Booking Test Suite
# SEARCHES REAL FLIGHTS FIRST, then books with actual GDS data
# ALL passenger data is randomized with valid values
# Usage: bash backend/test-bookings.sh
# ═══════════════════════════════════════════════════════════════════

BASE="https://seventrip.net/api"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'
PASS=0; FAIL=0; TOTAL=0; SKIP=0
ALL_PNRS=()

echo -e "\n${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   SEVEN TRIP — 30-ROUTE BOOKING TEST SUITE (LIVE SEARCH)${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}\n"

# ─── Login ───
echo -e "${CYAN}[AUTH] Logging in as rahim@gmail.com ...${NC}"
LOGIN=$(curl -s "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"rahim@gmail.com","password":"User@123456"}')
TOKEN=$(echo "$LOGIN" | jq -r '.accessToken // empty')

if [ -z "$TOKEN" ]; then
  echo -e "${RED}✗ Login failed:${NC} $LOGIN"
  exit 1
fi
echo -e "${GREEN}✓ Login OK${NC}\n"

# ─── Random Data Generators ───
MALE_FIRST=("KAMAL" "JAMAL" "RAHIM" "SHAKIB" "TAMIM" "MUSHFIQ" "LITON" "SHANTO" "TASKIN" "MEHEDI" "NAZMUL" "FARHAN" "IMRAN" "SABBIR" "SOUMYA" "RUBEL" "MASUD" "TANVIR" "ASHRAF" "MAHBUB")
FEMALE_FIRST=("FATIMA" "AYESHA" "NADIA" "SHARMIN" "TASLIMA" "RAZIA" "HASINA" "SULTANA" "NASREEN" "ROKEYA" "SABINA" "MOMENA" "RUMANA" "SUMAIYA" "FARZANA" "TANIA" "LABONI" "SADIA" "NAHIDA" "RABEYA")
CHILD_MALE_FIRST=("ARHAM" "ZAYN" "RAFSAN" "ARIYAN" "SAIF" "REHAN" "NABIL" "ABRAR" "FAHIM" "YUSUF")
CHILD_FEMALE_FIRST=("MARYAM" "ZARA" "ANIKA" "RAISA" "LAMISA" "NAFISA" "TASNEEM" "SAFIYA" "AYRA" "INAYA")
SURNAMES=("HOSSAIN" "AHMED" "KHAN" "ISLAM" "RAHMAN" "ALAM" "UDDIN" "CHOWDHURY" "MIAH" "SARKER" "HAQUE" "BEGUM" "KARIM" "SIDDIQUI" "SHEIKH")

rand_element() {
  local arr=("$@")
  echo "${arr[$((RANDOM % ${#arr[@]}))]}"
}

rand_passport() {
  local PREFIX=$1
  printf "%s%08d" "$PREFIX" $((RANDOM * RANDOM % 100000000))
}

rand_phone() {
  local PREFIXES=("01712" "01819" "01612" "01912" "01512")
  local PFX=$(rand_element "${PREFIXES[@]}")
  printf "%s%06d" "$PFX" $((RANDOM % 1000000))
}

# Generate adult DOB: 20-55 years ago
rand_adult_dob() {
  local YEARS_AGO=$((20 + RANDOM % 35))
  local MONTH=$((1 + RANDOM % 12))
  local DAY=$((1 + RANDOM % 28))
  printf "%04d-%02d-%02d" $(($(date +%Y) - YEARS_AGO)) $MONTH $DAY
}

# Generate child DOB: 2-11 years ago
rand_child_dob() {
  local YEARS_AGO=$((2 + RANDOM % 9))
  local MONTH=$((1 + RANDOM % 12))
  local DAY=$((1 + RANDOM % 28))
  printf "%04d-%02d-%02d" $(($(date +%Y) - YEARS_AGO)) $MONTH $DAY
}

# Generate infant DOB: 3-18 months ago
rand_infant_dob() {
  local MONTHS_AGO=$((3 + RANDOM % 15))
  date -d "-${MONTHS_AGO} months" +%Y-%m-%d 2>/dev/null || date -v-${MONTHS_AGO}m +%Y-%m-%d
}

# Passport expiry: 3-8 years from now
rand_passport_expiry() {
  local YEARS_AHEAD=$((3 + RANDOM % 5))
  local MONTH=$((1 + RANDOM % 12))
  local DAY=$((1 + RANDOM % 28))
  printf "%04d-%02d-%02d" $(($(date +%Y) + YEARS_AHEAD)) $MONTH $DAY
}

# ─── Build random passenger JSON ───
gen_adult_male() {
  local FNAME=$(rand_element "${MALE_FIRST[@]}")
  local LNAME=$(rand_element "${SURNAMES[@]}")
  local DOB=$(rand_adult_dob)
  local PP=$(rand_passport "A")
  local EXP=$(rand_passport_expiry)
  local PH=$(rand_phone)
  echo "{\"title\":\"Mr\",\"firstName\":\"$FNAME\",\"lastName\":\"$LNAME\",\"dob\":\"$DOB\",\"gender\":\"Male\",\"nationality\":\"Bangladeshi\",\"passport\":\"$PP\",\"passportExpiry\":\"$EXP\",\"documentCountry\":\"BD\",\"email\":\"rahim@gmail.com\",\"phone\":\"$PH\",\"type\":\"adult\",\"dateOfBirth\":\"$DOB\",\"passportNumber\":\"$PP\",\"passportCountry\":\"BD\"}"
}

gen_adult_female() {
  local FNAME=$(rand_element "${FEMALE_FIRST[@]}")
  local LNAME=$(rand_element "${SURNAMES[@]}")
  local DOB=$(rand_adult_dob)
  local PP=$(rand_passport "B")
  local EXP=$(rand_passport_expiry)
  local PH=$(rand_phone)
  echo "{\"title\":\"Ms\",\"firstName\":\"$FNAME\",\"lastName\":\"$LNAME\",\"dob\":\"$DOB\",\"gender\":\"Female\",\"nationality\":\"Bangladeshi\",\"passport\":\"$PP\",\"passportExpiry\":\"$EXP\",\"documentCountry\":\"BD\",\"email\":\"rahim@gmail.com\",\"phone\":\"$PH\",\"type\":\"adult\",\"dateOfBirth\":\"$DOB\",\"passportNumber\":\"$PP\",\"passportCountry\":\"BD\"}"
}

gen_child() {
  local GENDER=$((RANDOM % 2))
  local FNAME TITLE
  if [ $GENDER -eq 0 ]; then
    FNAME=$(rand_element "${CHILD_MALE_FIRST[@]}")
    TITLE="Master"
  else
    FNAME=$(rand_element "${CHILD_FEMALE_FIRST[@]}")
    TITLE="Miss"
  fi
  local LNAME=$(rand_element "${SURNAMES[@]}")
  local DOB=$(rand_child_dob)
  local PP=$(rand_passport "C")
  local EXP=$(rand_passport_expiry)
  local GEN=$( [ $GENDER -eq 0 ] && echo "Male" || echo "Female" )
  echo "{\"title\":\"$TITLE\",\"firstName\":\"$FNAME\",\"lastName\":\"$LNAME\",\"dob\":\"$DOB\",\"gender\":\"$GEN\",\"nationality\":\"Bangladeshi\",\"passport\":\"$PP\",\"passportExpiry\":\"$EXP\",\"documentCountry\":\"BD\",\"email\":\"\",\"phone\":\"\",\"type\":\"child\",\"dateOfBirth\":\"$DOB\",\"passportNumber\":\"$PP\",\"passportCountry\":\"BD\"}"
}

gen_infant() {
  local GENDER=$((RANDOM % 2))
  local FNAME TITLE
  if [ $GENDER -eq 0 ]; then
    FNAME=$(rand_element "${CHILD_MALE_FIRST[@]}")
    TITLE="Master"
  else
    FNAME=$(rand_element "${CHILD_FEMALE_FIRST[@]}")
    TITLE="Miss"
  fi
  local LNAME=$(rand_element "${SURNAMES[@]}")
  local DOB=$(rand_infant_dob)
  local PP=$(rand_passport "D")
  local EXP=$(rand_passport_expiry)
  local GEN=$( [ $GENDER -eq 0 ] && echo "Male" || echo "Female" )
  echo "{\"title\":\"$TITLE\",\"firstName\":\"$FNAME\",\"lastName\":\"$LNAME\",\"dob\":\"$DOB\",\"gender\":\"$GEN\",\"nationality\":\"Bangladeshi\",\"passport\":\"$PP\",\"passportExpiry\":\"$EXP\",\"documentCountry\":\"BD\",\"email\":\"\",\"phone\":\"\",\"type\":\"infant\",\"dateOfBirth\":\"$DOB\",\"passportNumber\":\"$PP\",\"passportCountry\":\"BD\"}"
}

CONTACT='{"email":"rahim@gmail.com","phone":"01724597352"}'

SSR1='{"perPassenger":[{"meal":"MOML","wheelchair":"none","frequentFlyer":{}}]}'
SSR2='{"perPassenger":[{"meal":"MOML","wheelchair":"none","frequentFlyer":{}},{"meal":"VGML","wheelchair":"none","frequentFlyer":{}}]}'
SSR3='{"perPassenger":[{"meal":"MOML","wheelchair":"none","frequentFlyer":{}},{"meal":"VGML","wheelchair":"none","frequentFlyer":{}},{"meal":"CHML","wheelchair":"none","frequentFlyer":{}}]}'
SSR4='{"perPassenger":[{"meal":"MOML","wheelchair":"none","frequentFlyer":{}},{"meal":"VGML","wheelchair":"none","frequentFlyer":{}},{"meal":"CHML","wheelchair":"none","frequentFlyer":{}},{"meal":"BBML","wheelchair":"none","frequentFlyer":{}}]}'

# Calculate dates: 30-45 days from now (randomized per section)
DEPART_DATE=$(date -d "+$((30 + RANDOM % 15)) days" +%Y-%m-%d 2>/dev/null || date -v+33d +%Y-%m-%d)
RETURN_DATE=$(date -d "+$((45 + RANDOM % 10)) days" +%Y-%m-%d 2>/dev/null || date -v+50d +%Y-%m-%d)

echo -e "${CYAN}[DATES] Departure: $DEPART_DATE | Return: $RETURN_DATE${NC}"
echo -e "${CYAN}[DATA] All passengers randomized with valid BD passports${NC}\n"

# ─── Search helper: find real flight from API ───
search_flight() {
  local FROM=$1 TO=$2 DATE=$3 ADULTS=${4:-1} CHILDREN=${5:-0} INFANTS=${6:-0} PREFERRED_SOURCE=${7:-""} RETURN_DATE_PARAM=${8:-""}
  
  local URL="$BASE/flights/search?from=$FROM&to=$TO&date=$DATE&adults=$ADULTS&children=$CHILDREN&infants=$INFANTS&cabinClass=Economy&page=1&limit=5"
  if [ -n "$RETURN_DATE_PARAM" ]; then
    URL="${URL}&returnDate=$RETURN_DATE_PARAM"
  fi
  
  local SEARCH_RESULT
  SEARCH_RESULT=$(curl -s --max-time 60 "$URL" -H "Authorization: Bearer $TOKEN")
  
  local FLIGHT_COUNT
  FLIGHT_COUNT=$(echo "$SEARCH_RESULT" | jq -r '.total // 0' 2>/dev/null)
  
  if [ "$FLIGHT_COUNT" = "0" ] || [ -z "$FLIGHT_COUNT" ]; then
    echo ""
    return 1
  fi
  
  # Pick first flight matching preferred source, or first flight
  # API returns .data[] not .flights[]
  local FLIGHT
  if [ -n "$PREFERRED_SOURCE" ]; then
    FLIGHT=$(echo "$SEARCH_RESULT" | jq -c --arg src "$PREFERRED_SOURCE" '[.data[] | select(.source == $src)] | first // empty' 2>/dev/null)
  fi
  if [ -z "$FLIGHT" ] || [ "$FLIGHT" = "null" ]; then
    FLIGHT=$(echo "$SEARCH_RESULT" | jq -c '.data[0] // empty' 2>/dev/null)
  fi
  
  echo "$FLIGHT"
}

# ─── Book with real search data ───
search_and_book() {
  local TEST_NUM=$1
  local LABEL=$2
  local FROM=$3
  local TO=$4
  local PAX_JSON=$5
  local SSR_JSON=$6
  local IS_ROUND=$7
  local IS_DOMESTIC=${8:-false}
  local PREFERRED_SOURCE=${9:-"sabre"}
  local ADULTS=${10:-1}
  local CHILDREN=${11:-0}
  local INFANTS=${12:-0}
  
  TOTAL=$((TOTAL + 1))
  echo -e "\n${BOLD}── TEST $TEST_NUM: $LABEL ──${NC}"
  
  # Search for a real flight
  local RETURN_DATE_ARG=""
  if [ "$IS_ROUND" = "true" ]; then
    RETURN_DATE_ARG="$RETURN_DATE"
  fi
  
  echo -e "  ${CYAN}Searching $FROM→$TO on $DEPART_DATE...${NC}"
  local FLIGHT
  FLIGHT=$(search_flight "$FROM" "$TO" "$DEPART_DATE" "$ADULTS" "$CHILDREN" "$INFANTS" "$PREFERRED_SOURCE" "$RETURN_DATE_ARG")
  
  if [ -z "$FLIGHT" ] || [ "$FLIGHT" = "null" ]; then
    echo -e "  ${YELLOW}⊘ SKIPPED${NC} — No flights found for $FROM→$TO on $DEPART_DATE"
    SKIP=$((SKIP + 1))
    FAIL=$((FAIL + 1))
    return
  fi
  
  local SRC AIRLINE FLIGHT_NO BOOK_CLASS
  SRC=$(echo "$FLIGHT" | jq -r '.source // "unknown"')
  AIRLINE=$(echo "$FLIGHT" | jq -r '.airline // "Unknown"')
  FLIGHT_NO=$(echo "$FLIGHT" | jq -r '.flightNumber // "?"')
  BOOK_CLASS=$(echo "$FLIGHT" | jq -r '.bookingClass // "Y"')
  echo -e "  ${GREEN}Found:${NC} $AIRLINE $FLIGHT_NO ($SRC) class=$BOOK_CLASS"
  
  # For Sabre, ensure _sabreSource flag
  if [ "$SRC" = "sabre" ]; then
    FLIGHT=$(echo "$FLIGHT" | jq -c '. + {"_sabreSource": true}')
  fi
  
  # Build booking payload
  local PAYLOAD
  if [ "$IS_ROUND" = "true" ]; then
    # Search for return flight
    echo -e "  ${CYAN}Searching return $TO→$FROM on $RETURN_DATE...${NC}"
    local RET_FLIGHT
    RET_FLIGHT=$(search_flight "$TO" "$FROM" "$RETURN_DATE" "$ADULTS" "$CHILDREN" "$INFANTS" "$PREFERRED_SOURCE")
    
    if [ -z "$RET_FLIGHT" ] || [ "$RET_FLIGHT" = "null" ]; then
      echo -e "  ${YELLOW}⊘ SKIPPED${NC} — No return flights found for $TO→$FROM on $RETURN_DATE"
      SKIP=$((SKIP + 1))
      FAIL=$((FAIL + 1))
      return
    fi
    
    local RET_SRC RET_AIRLINE RET_FLIGHT_NO
    RET_SRC=$(echo "$RET_FLIGHT" | jq -r '.source // "unknown"')
    RET_AIRLINE=$(echo "$RET_FLIGHT" | jq -r '.airline // "Unknown"')
    RET_FLIGHT_NO=$(echo "$RET_FLIGHT" | jq -r '.flightNumber // "?"')
    echo -e "  ${GREEN}Return:${NC} $RET_AIRLINE $RET_FLIGHT_NO ($RET_SRC)"
    
    if [ "$RET_SRC" = "sabre" ]; then
      RET_FLIGHT=$(echo "$RET_FLIGHT" | jq -c '. + {"_sabreSource": true}')
    fi
    
    local TOTAL_PRICE
    TOTAL_PRICE=$(echo "$FLIGHT" | jq -r '.totalRoundTripPrice // .price // 50000')
    local BASE_FARE
    BASE_FARE=$(echo "$FLIGHT" | jq -r '.baseFare // 40000')
    local TAXES
    TAXES=$(echo "$FLIGHT" | jq -r '.taxes // 10000')
    
    PAYLOAD=$(jq -n \
      --argjson flightData "$FLIGHT" \
      --argjson returnFlightData "$RET_FLIGHT" \
      --argjson passengers "[$PAX_JSON]" \
      --argjson contactInfo "$CONTACT" \
      --argjson specialServices "$SSR_JSON" \
      --argjson totalAmount "$TOTAL_PRICE" \
      --argjson baseFare "$BASE_FARE" \
      --argjson taxes "$TAXES" \
      '{
        flightData: $flightData,
        returnFlightData: $returnFlightData,
        passengers: $passengers,
        contactInfo: $contactInfo,
        isRoundTrip: true,
        isDomestic: false,
        payLater: true,
        totalAmount: $totalAmount,
        baseFare: $baseFare,
        taxes: $taxes,
        serviceCharge: 0,
        specialServices: $specialServices
      }')
  else
    local TOTAL_PRICE
    TOTAL_PRICE=$(echo "$FLIGHT" | jq -r '.price // 50000')
    local BASE_FARE
    BASE_FARE=$(echo "$FLIGHT" | jq -r '.baseFare // 40000')
    local TAXES
    TAXES=$(echo "$FLIGHT" | jq -r '.taxes // 10000')
    
    PAYLOAD=$(jq -n \
      --argjson flightData "$FLIGHT" \
      --argjson passengers "[$PAX_JSON]" \
      --argjson contactInfo "$CONTACT" \
      --argjson specialServices "$SSR_JSON" \
      --argjson totalAmount "$TOTAL_PRICE" \
      --argjson baseFare "$BASE_FARE" \
      --argjson taxes "$TAXES" \
      --argjson isDomestic "$IS_DOMESTIC" \
      '{
        flightData: $flightData,
        passengers: $passengers,
        contactInfo: $contactInfo,
        isRoundTrip: false,
        isDomestic: $isDomestic,
        payLater: true,
        totalAmount: $totalAmount,
        baseFare: $baseFare,
        taxes: $taxes,
        serviceCharge: 0,
        specialServices: $specialServices
      }')
  fi
  
  # Book
  RESULT=$(curl -s -w "\n%{http_code}" --max-time 90 "$BASE/flights/book" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "$PAYLOAD")

  HTTP_CODE=$(echo "$RESULT" | tail -1)
  BODY=$(echo "$RESULT" | sed '$d')

  PNR=$(echo "$BODY" | jq -r '.pnr // "null"' 2>/dev/null)
  AIRLINE_PNR=$(echo "$BODY" | jq -r '.airlinePnr // "null"' 2>/dev/null)
  GDS_BOOKED=$(echo "$BODY" | jq -r '.gdsBooked // false' 2>/dev/null)
  GDS_ERROR=$(echo "$BODY" | jq -r '.gdsError // "none"' 2>/dev/null)
  BREF=$(echo "$BODY" | jq -r '.bookingRef // "?"' 2>/dev/null)
  STATUS=$(echo "$BODY" | jq -r '.status // "?"' 2>/dev/null)

  if [ "$GDS_BOOKED" = "true" ] && [ "$PNR" != "null" ] && [ "$PNR" != "" ]; then
    local APNR_DISPLAY="$AIRLINE_PNR"
    if [ "$AIRLINE_PNR" = "null" ] || [ "$AIRLINE_PNR" = "$PNR" ]; then
      APNR_DISPLAY="(same as GDS or pending ticketing)"
    fi
    echo -e "  ${GREEN}✓ SUCCESS${NC} | GDS PNR: ${GREEN}$PNR${NC} | Airline PNR: ${CYAN}$APNR_DISPLAY${NC} | Ref: $BREF | Status: $STATUS"
    PASS=$((PASS + 1))
    ALL_PNRS+=("$PNR")
  else
    echo -e "  ${RED}✗ FAILED${NC} | HTTP: $HTTP_CODE | Source: $SRC | Ref: $BREF"
    echo -e "    GDS Error: ${RED}$GDS_ERROR${NC}"
    FAIL=$((FAIL + 1))
  fi
}

# ═══════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   SECTION 1: ONE-WAY INTERNATIONAL (1 Adult)${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"

# Test 1-6: One-way single adult to various destinations
A1=$(gen_adult_female)
search_and_book 1 "ONE-WAY DAC→DXB (1 adult)" "DAC" "DXB" "$A1" "$SSR1" "false" "false" "sabre" 1 0 0

A1=$(gen_adult_male)
search_and_book 2 "ONE-WAY DAC→SIN (1 adult)" "DAC" "SIN" "$A1" "$SSR1" "false" "false" "sabre" 1 0 0

A1=$(gen_adult_female)
search_and_book 3 "ONE-WAY DAC→DOH (1 adult)" "DAC" "DOH" "$A1" "$SSR1" "false" "false" "sabre" 1 0 0

A1=$(gen_adult_male)
search_and_book 4 "ONE-WAY DAC→IST (1 adult)" "DAC" "IST" "$A1" "$SSR1" "false" "false" "sabre" 1 0 0

A1=$(gen_adult_female)
search_and_book 5 "ONE-WAY DAC→CCU (1 adult)" "DAC" "CCU" "$A1" "$SSR1" "false" "false" "sabre" 1 0 0

A1=$(gen_adult_male)
search_and_book 6 "ONE-WAY DAC→BKK (1 adult)" "DAC" "BKK" "$A1" "$SSR1" "false" "false" "sabre" 1 0 0

# ═══════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   SECTION 2: ONE-WAY INTERNATIONAL (Multi-Pax)${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"

# Test 7: 2 adults
A1=$(gen_adult_male); A2=$(gen_adult_female)
search_and_book 7 "ONE-WAY DAC→BKK (2 adults)" "DAC" "BKK" "$A1,$A2" "$SSR2" "false" "false" "sabre" 2 0 0

# Test 8: 1 adult + 1 child
A1=$(gen_adult_female); C1=$(gen_child)
search_and_book 8 "ONE-WAY DAC→KUL (1a+1c)" "DAC" "KUL" "$A1,$C1" "$SSR2" "false" "false" "sabre" 1 1 0

# Test 9: 2 adults + 1 child
A1=$(gen_adult_male); A2=$(gen_adult_female); C1=$(gen_child)
search_and_book 9 "ONE-WAY DAC→LHR (2a+1c)" "DAC" "LHR" "$A1,$A2,$C1" "$SSR3" "false" "false" "sabre" 2 1 0

# Test 10: 1 adult + 1 infant
A1=$(gen_adult_female); I1=$(gen_infant)
search_and_book 10 "ONE-WAY DAC→DEL (1a+1i)" "DAC" "DEL" "$A1,$I1" "$SSR2" "false" "false" "sabre" 1 0 1

# ═══════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   SECTION 3: ROUND-TRIP INTERNATIONAL${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"

# Test 11: RT 1 adult
A1=$(gen_adult_male)
search_and_book 11 "ROUND-TRIP DAC↔DXB (1 adult)" "DAC" "DXB" "$A1" "$SSR1" "true" "false" "sabre" 1 0 0

# Test 12: RT 2 adults
A1=$(gen_adult_female); A2=$(gen_adult_male)
search_and_book 12 "ROUND-TRIP DAC↔SIN (2 adults)" "DAC" "SIN" "$A1,$A2" "$SSR2" "true" "false" "sabre" 2 0 0

# Test 13: RT 1a+1c
A1=$(gen_adult_male); C1=$(gen_child)
search_and_book 13 "ROUND-TRIP DAC↔BKK (1a+1c)" "DAC" "BKK" "$A1,$C1" "$SSR2" "true" "false" "sabre" 1 1 0

# Test 14: RT 2a+1c+1i (full family)
A1=$(gen_adult_male); A2=$(gen_adult_female); C1=$(gen_child); I1=$(gen_infant)
search_and_book 14 "ROUND-TRIP DAC↔DOH (2a+1c+1i)" "DAC" "DOH" "$A1,$A2,$C1,$I1" "$SSR4" "true" "false" "sabre" 2 1 1

# Test 15: RT 1 adult
A1=$(gen_adult_female)
search_and_book 15 "ROUND-TRIP DAC↔IST (1 adult)" "DAC" "IST" "$A1" "$SSR1" "true" "false" "sabre" 1 0 0

# Test 16: RT 2 adults
A1=$(gen_adult_male); A2=$(gen_adult_female)
search_and_book 16 "ROUND-TRIP DAC↔KUL (2 adults)" "DAC" "KUL" "$A1,$A2" "$SSR2" "true" "false" "sabre" 2 0 0

# ═══════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   SECTION 4: DOMESTIC FLIGHTS (TTI / Air Astra)${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"

# Test 17: Domestic 1 adult
A1=$(gen_adult_male)
search_and_book 17 "ONE-WAY DAC→CXB (1 adult)" "DAC" "CXB" "$A1" "$SSR1" "false" "true" "tti" 1 0 0

# Test 18: Domestic 2 adults
A1=$(gen_adult_female); A2=$(gen_adult_male)
search_and_book 18 "ONE-WAY DAC→CXB (2 adults)" "DAC" "CXB" "$A1,$A2" "$SSR2" "false" "true" "tti" 2 0 0

# Test 19: Domestic 1a+1c
A1=$(gen_adult_male); C1=$(gen_child)
search_and_book 19 "ONE-WAY DAC→CGP (1a+1c)" "DAC" "CGP" "$A1,$C1" "$SSR2" "false" "true" "tti" 1 1 0

# Test 20: Domestic 1 adult ZYL
A1=$(gen_adult_female)
search_and_book 20 "ONE-WAY DAC→ZYL (1 adult)" "DAC" "ZYL" "$A1" "$SSR1" "false" "true" "tti" 1 0 0

# Test 21: Domestic round-trip 2 adults
A1=$(gen_adult_male); A2=$(gen_adult_female)
search_and_book 21 "ROUND-TRIP DAC↔CXB (2 adults)" "DAC" "CXB" "$A1,$A2" "$SSR2" "true" "true" "tti" 2 0 0

# Test 22: Domestic round-trip 1a+1c+1i
A1=$(gen_adult_female); C1=$(gen_child); I1=$(gen_infant)
search_and_book 22 "ROUND-TRIP DAC↔CGP (1a+1c+1i)" "DAC" "CGP" "$A1,$C1,$I1" "$SSR3" "true" "true" "tti" 1 1 1

# ═══════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   SECTION 5: ADDITIONAL ROUTES & EDGE CASES${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"

# Test 23: JED
A1=$(gen_adult_male)
search_and_book 23 "ONE-WAY DAC→JED (1 adult)" "DAC" "JED" "$A1" "$SSR1" "false" "false" "sabre" 1 0 0

# Test 24: CMB
A1=$(gen_adult_female)
search_and_book 24 "ONE-WAY DAC→CMB (1 adult)" "DAC" "CMB" "$A1" "$SSR1" "false" "false" "sabre" 1 0 0

# Test 25: RT MCT
A1=$(gen_adult_male)
search_and_book 25 "ROUND-TRIP DAC↔MCT (1 adult)" "DAC" "MCT" "$A1" "$SSR1" "true" "false" "sabre" 1 0 0

# Test 26: RT BAH 2a+1i
A1=$(gen_adult_male); A2=$(gen_adult_female); I1=$(gen_infant)
search_and_book 26 "ROUND-TRIP DAC↔BAH (2a+1i)" "DAC" "BAH" "$A1,$A2,$I1" "$SSR3" "true" "false" "sabre" 2 0 1

# Test 27: DEL round-trip
A1=$(gen_adult_female)
search_and_book 27 "ROUND-TRIP DAC↔DEL (1 adult)" "DAC" "DEL" "$A1" "$SSR1" "true" "false" "sabre" 1 0 0

# Test 28: BKK 1a+1i
A1=$(gen_adult_male); I1=$(gen_infant)
search_and_book 28 "ONE-WAY DAC→BKK (1a+1i)" "DAC" "BKK" "$A1,$I1" "$SSR2" "false" "false" "sabre" 1 0 1

# Test 29: RT DOH 1 adult
A1=$(gen_adult_female)
search_and_book 29 "ROUND-TRIP DAC↔DOH (1 adult)" "DAC" "DOH" "$A1" "$SSR1" "true" "false" "sabre" 1 0 0

# Test 30: RT SIN 1a+1c
A1=$(gen_adult_male); C1=$(gen_child)
search_and_book 30 "ROUND-TRIP DAC↔SIN (1a+1c)" "DAC" "SIN" "$A1,$C1" "$SSR2" "true" "false" "sabre" 1 1 0

# ═══════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   SECTION 6: SEAT MAP & ANCILLARIES${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"

# Post-booking seat map with first PNR
if [ ${#ALL_PNRS[@]} -gt 0 ]; then
  FIRST_PNR="${ALL_PNRS[0]}"
  echo -e "\n${BOLD}── SEAT MAP: Post-booking PNR $FIRST_PNR ──${NC}"
  SEAT_POST=$(curl -s --max-time 30 "$BASE/flights/seats-rest?pnr=$FIRST_PNR" \
    -H "Authorization: Bearer $TOKEN")
  SP_SOURCE=$(echo "$SEAT_POST" | jq -r '.source // "none"' 2>/dev/null)
  if [ "$SP_SOURCE" != "none" ] && [ "$SP_SOURCE" != "null" ]; then
    echo -e "  ${GREEN}✓${NC} | Source: $SP_SOURCE"
  else
    echo -e "  ${RED}✗ Post-booking seat map FAILED${NC}"
  fi
fi

# ═══════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   SECTION 7: PNR VERIFICATION (GetBooking)${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"

for PNR_CHECK in "${ALL_PNRS[@]}"; do
  echo -e "\n${BOLD}── GetBooking: $PNR_CHECK ──${NC}"
  GB_RESULT=$(curl -s --max-time 15 "$BASE/flights/booking/$PNR_CHECK" \
    -H "Authorization: Bearer $TOKEN")
  GB_SUCCESS=$(echo "$GB_RESULT" | jq -r '.success // false' 2>/dev/null)
  GB_FLIGHTS=$(echo "$GB_RESULT" | jq -r '.flights // 0' 2>/dev/null)
  GB_PAX=$(echo "$GB_RESULT" | jq -r '.passengers // 0' 2>/dev/null)
  echo -e "  Success: ${GB_SUCCESS} | Flights: $GB_FLIGHTS | Passengers: $GB_PAX"
done

# ═══════════════════════════════════════════════════════════
echo -e "\n${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   FINAL SUMMARY${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "  Total Tests:  $TOTAL"
echo -e "  ${GREEN}Passed:       $PASS${NC}"
echo -e "  ${RED}Failed:       $FAIL${NC}"
echo -e "  ${YELLOW}Skipped:      $SKIP${NC} (no flights found on route)"
if [ $TOTAL -gt 0 ]; then
  RATE=$((PASS * 100 / TOTAL))
  echo -e "  Success Rate: ${RATE}%"
fi

echo ""
echo -e "  PNRs Created: ${#ALL_PNRS[@]}"
for P in "${ALL_PNRS[@]}"; do
  echo -e "    → $P"
done

echo ""
echo -e "PM2 logs for debugging:"
echo -e "  pm2 logs seventrip-api --lines 200 | grep -E 'CreatePNR|PNR created|REJECTED|CHECK FLIGHT|TTI BOOKING|InvalidData'"
echo -e "\n${BOLD}═══════════════════════════════════════════════════════════${NC}"
