#!/usr/bin/env bash
# Seven Trip — DAC → JED airline coverage test
# Purpose: prove how many airlines TripLover (the new API) actually returns,
# and which providers contributed, with Sabre paused.
#
# Usage on VPS:
#   cd ~/projects/all-stars-atlas/backend && bash test-jed-search.sh
#   bash test-jed-search.sh 2026-09-15        # custom departure date

set -u
API="${API:-http://localhost:3001}"
DATE="${1:-$(date -d '+21 days' +%Y-%m-%d)}"
ROUTE_FROM="${ROUTE_FROM:-DAC}"
ROUTE_TO="${ROUTE_TO:-JED}"

echo "=============================================="
echo " Seven Trip flight coverage test"
echo " Route : $ROUTE_FROM → $ROUTE_TO"
echo " Date  : $DATE"
echo " API   : $API"
echo "=============================================="

echo
echo "── 1. Provider pause state ───────────────────"
mysql -u root -N -B seventrip -e \
  "SELECT setting_value FROM system_settings WHERE setting_key='provider_pause';" 2>/dev/null \
  || echo "(could not read provider_pause — run as root or check DB name)"

echo
echo "── 2. TripLover direct integration probe ──────"
# Uses the exact configured credentials, login endpoint and search payload from
# the application without printing any credential or bearer token.
ROUTE_FROM="$ROUTE_FROM" ROUTE_TO="$ROUTE_TO" DATE="$DATE" node - <<'NODE'
require('dotenv').config({ path: process.cwd() + '/.env' });
const { searchFlights } = require('./src/routes/triplover-flights');
const started = Date.now();
searchFlights({
  origin: process.env.ROUTE_FROM,
  destination: process.env.ROUTE_TO,
  departDate: process.env.DATE,
  adults: 1,
  cabinClass: 'economy',
}).then(rows => {
  const airlines = [...new Set(rows.map(row => `${row.airlineCode || '??'} ${row.airline || ''}`.trim()))];
  console.log(`direct TripLover: ${rows.length} fares in ${((Date.now() - started) / 1000).toFixed(2)}s`);
  console.log(`direct airlines (${airlines.length}): ${airlines.join(', ') || 'none'}`);
  process.exit(0);
}).catch(error => {
  console.error('direct TripLover failed:', error.message);
  process.exit(1);
});
NODE

echo
echo "── 3. Aggregated search through our API ──────"
URL="$API/api/flights/search?origin=$ROUTE_FROM&destination=$ROUTE_TO&departDate=$DATE&adults=1&cabin=economy&tripType=oneway"
curl -s -o /tmp/jed-search.json -w "search HTTP %{http_code} in %{time_total}s (size %{size_download} bytes)\n" "$URL"

echo
echo "── 4. Airline breakdown ──────────────────────"
node -e '
const fs = require("fs");
let d;
try { d = JSON.parse(fs.readFileSync("/tmp/jed-search.json","utf8")); }
catch (e) { console.log("Could not parse response:", e.message); process.exit(0); }
const rows = d.data || d.flights || [];
console.log("total fares returned :", rows.length, "| API total field:", d.total ?? "n/a");
console.log("sources              :", JSON.stringify(d.sources || {}));
const byAirline = {}, bySource = {};
for (const f of rows) {
  const k = `${f.airlineCode || "??"} ${f.airline || ""}`.trim();
  byAirline[k] = (byAirline[k] || 0) + 1;
  bySource[f.source || "?"] = (bySource[f.source || "?"] || 0) + 1;
}
console.log("\nfares per provider:");
for (const [k,v] of Object.entries(bySource).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(14)} ${v}`);
console.log(`\nairlines found (${Object.keys(byAirline).length}):`);
for (const [k,v] of Object.entries(byAirline).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(30)} ${v} fares`);
const cheapest = rows.slice().sort((a,b)=>(a.price||0)-(b.price||0))[0];
if (cheapest) console.log(`\ncheapest: ${cheapest.airlineCode} ${cheapest.flightNumber} BDT ${cheapest.price} (${cheapest.stops} stops, ${cheapest.duration})`);
'

echo
echo "── 5. Repeat call (cache check) ──────────────"
curl -s -o /dev/null -w "repeat HTTP %{http_code} in %{time_total}s\n" "$URL"

echo
echo "── 6. Recent provider timings from PM2 log ───"
grep -a "\[Search\] Provider" /root/.pm2/logs/seventrip-api-out.log | tail -20

echo
echo "── 7. TripLover failures (last 10) ───────────"
grep -a "triplover\|TripLover" /root/.pm2/logs/seventrip-api-out.log | tail -10

echo
echo "Done. Paste this whole output back into the chat."
