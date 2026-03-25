#!/bin/bash
# ═══════════════════════════════════════════════════════════
#   SEVEN TRIP — BULK CANCEL BOOKINGS
#   Cancels bookings via Admin bulk-cancel API and prints per-PNR status
# ═══════════════════════════════════════════════════════════

set -euo pipefail

API_BASE="${API_BASE:-https://seven-trip.com/api}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@seven-trip.com}"
ADMIN_PASS="${ADMIN_PASS:-Admin@123456}"
FILTER="${1:-reserved}"  # reserved | all_with_pnr

if ! command -v jq >/dev/null 2>&1; then
  echo "✗ jq is required. Install: apt-get install -y jq"
  exit 1
fi

request_json() {
  local method="$1"
  local url="$2"
  local payload="${3:-}"
  local token="${4:-}"

  local tmp_body
  tmp_body=$(mktemp)
  local http_code

  if [ -n "$token" ]; then
    if [ -n "$payload" ]; then
      http_code=$(curl -sS -L -A "SevenTrip-BulkCancel/1.0" -o "$tmp_body" -w "%{http_code}" \
        -X "$method" "$url" \
        -H "Accept: application/json" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $token" \
        --data "$payload")
    else
      http_code=$(curl -sS -L -A "SevenTrip-BulkCancel/1.0" -o "$tmp_body" -w "%{http_code}" \
        -X "$method" "$url" \
        -H "Accept: application/json" \
        -H "Authorization: Bearer $token")
    fi
  else
    if [ -n "$payload" ]; then
      http_code=$(curl -sS -L -A "SevenTrip-BulkCancel/1.0" -o "$tmp_body" -w "%{http_code}" \
        -X "$method" "$url" \
        -H "Accept: application/json" \
        -H "Content-Type: application/json" \
        --data "$payload")
    else
      http_code=$(curl -sS -L -A "SevenTrip-BulkCancel/1.0" -o "$tmp_body" -w "%{http_code}" \
        -X "$method" "$url" \
        -H "Accept: application/json")
    fi
  fi

  local body
  body=$(cat "$tmp_body")
  rm -f "$tmp_body"

  if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
    echo "✗ HTTP $http_code from $url" >&2
    echo "${body:0:600}" >&2
    return 1
  fi

  if ! echo "$body" | jq -e . >/dev/null 2>&1; then
    echo "✗ Non-JSON response from $url" >&2
    echo "${body:0:600}" >&2
    return 1
  fi

  echo "$body"
}

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "   SEVEN TRIP — BULK CANCEL BOOKINGS (filter: $FILTER)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Login
echo "[AUTH] Logging in as $ADMIN_EMAIL ..."
LOGIN_PAYLOAD=$(jq -nc --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PASS" '{email:$email,password:$password}')
LOGIN_RESP=$(request_json "POST" "$API_BASE/auth/login" "$LOGIN_PAYLOAD")
TOKEN=$(echo "$LOGIN_RESP" | jq -r '.accessToken // .token // empty')

if [ -z "$TOKEN" ]; then
  echo "✗ Login failed: $(echo "$LOGIN_RESP" | jq -r '.message // .error // "Unknown error"')"
  echo "Raw response: $(echo "$LOGIN_RESP" | head -c 300)"
  exit 1
fi

echo "✓ Login OK"
echo ""

# Preview impacted bookings
echo "[INFO] Fetching bookings to cancel..."
BOOKINGS=$(request_json "GET" "$API_BASE/admin/bookings?limit=1000" "" "$TOKEN")
TOTAL=$(echo "$BOOKINGS" | jq '.total // 0')

if [ "$FILTER" = "reserved" ]; then
  COUNT=$(echo "$BOOKINGS" | jq '[.data[] | select(.status == "on_hold" and .pnr != null and .pnr != "")] | length')
  echo "  Total bookings: $TOTAL"
  echo "  Reserved with PNR (to cancel): $COUNT"
elif [ "$FILTER" = "all_with_pnr" ]; then
  COUNT=$(echo "$BOOKINGS" | jq '[.data[] | select(.pnr != null and .pnr != "" and .status != "cancelled" and .status != "void" and .status != "failed")] | length')
  echo "  Total bookings: $TOTAL"
  echo "  All active with PNR (to cancel): $COUNT"
else
  echo "✗ Invalid filter '$FILTER'. Use: reserved | all_with_pnr"
  exit 1
fi

echo ""
echo "[PNRs to cancel]:"
if [ "$FILTER" = "reserved" ]; then
  echo "$BOOKINGS" | jq -r '.data[] | select(.status == "on_hold" and .pnr != null and .pnr != "") | "  \(.bookingRef) | PNR: \(.pnr) | Route: \(.details.outbound.origin // "?")→\(.details.outbound.destination // "?") | Source: \(.details.outbound.source // "unknown")"'
else
  echo "$BOOKINGS" | jq -r '.data[] | select(.pnr != null and .pnr != "" and .status != "cancelled" and .status != "void" and .status != "failed") | "  \(.bookingRef) | PNR: \(.pnr) | Status: \(.status) | Source: \(.details.outbound.source // "unknown")"'
fi

echo ""
read -r -p "Proceed with cancellation? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "[CANCELLING] Sending bulk cancel request..."
CANCEL_PAYLOAD=$(jq -nc --arg filter "$FILTER" '{filter:$filter}')
RESULT=$(request_json "POST" "$API_BASE/admin/bookings/bulk-cancel" "$CANCEL_PAYLOAD" "$TOKEN")

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "   BULK CANCEL RESULTS"
echo "═══════════════════════════════════════════════════════════"
echo ""

CANCELLED=$(echo "$RESULT" | jq '.summary.cancelled // 0')
FAILED=$(echo "$RESULT" | jq '.summary.failed // 0')
SKIPPED=$(echo "$RESULT" | jq '.summary.skipped // 0')
TOTAL_PROCESSED=$(echo "$RESULT" | jq '.summary.total // 0')

echo "  Total Processed: $TOTAL_PROCESSED"
echo "  ✓ Cancelled:     $CANCELLED"
echo "  ✗ Failed:        $FAILED"
echo "  ⊘ Skipped:       $SKIPPED"
echo ""

echo "[DETAILED RESULTS]:"
echo "$RESULT" | jq -r '.results[] | "  \(.bookingRef) | PNR: \(.pnr // "-") | \(.status) \(if .reason then "— " + .reason else "" end)"'

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Done. Check admin panel: https://seven-trip.com/admin/bookings"
echo "═══════════════════════════════════════════════════════════"
