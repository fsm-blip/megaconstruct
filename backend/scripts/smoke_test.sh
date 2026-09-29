#!/usr/bin/env bash
# Smoke test for a running MegaConstruct backend.
# Requires backend already running; does not start or stop servers.

set -euo pipefail
BASE=${BASE_URL:-http://localhost:3000}
echo "Starting smoke test against $BASE"

json_field() {
  node -e "const fs=require('fs'); const field=process.argv[1]; const s=fs.readFileSync(0,'utf8'); try { const parsed=JSON.parse(s); if (parsed[field] !== undefined && parsed[field] !== null) console.log(parsed[field]); } catch (e) {}" "$1"
}

OWNER_EMAIL=${OWNER_EMAIL:-owner@example.com}
OWNER_PW=${OWNER_PASSWORD:-}
if [ -z "$OWNER_PW" ]; then
  echo "OWNER_PASSWORD must be set for smoke test login." >&2
  exit 1
fi

OWNER_LOGIN=$(curl -s -X POST "$BASE/api/login" -H 'content-type: application/json' -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PW\"}")
OWNER_TOKEN=$(echo "$OWNER_LOGIN" | json_field token)
if [ -z "$OWNER_TOKEN" ]; then echo "Failed to login as owner: $OWNER_LOGIN"; exit 1; fi
echo "Owner logged in"

STAMP=$(date +%s)
CLIENT_EMAIL="client+smoke-$STAMP@example.com"
CLIENT_PW="client-smoke-pass-$STAMP"
CLIENT_NAME="Client Smoke $STAMP"
CREATED_CLIENT=$(curl -s -X POST "$BASE/api/users" -H "Authorization: Bearer $OWNER_TOKEN" -H 'content-type: application/json' -d "{\"name\":\"$CLIENT_NAME\",\"email\":\"$CLIENT_EMAIL\",\"password\":\"$CLIENT_PW\",\"role\":\"client\"}")
CLIENT_ID=$(echo "$CREATED_CLIENT" | json_field id)
if [ -z "$CLIENT_ID" ]; then echo "Failed to create client: $CREATED_CLIENT"; exit 1; fi

STAFF_EMAIL="staff+smoke-$STAMP@example.com"
STAFF_PW="staff-smoke-pass-$STAMP"
STAFF_NAME="Staff Smoke $STAMP"
CREATED_STAFF=$(curl -s -X POST "$BASE/api/users" -H "Authorization: Bearer $OWNER_TOKEN" -H 'content-type: application/json' -d "{\"name\":\"$STAFF_NAME\",\"email\":\"$STAFF_EMAIL\",\"password\":\"$STAFF_PW\",\"role\":\"staff\",\"clientId\":\"$CLIENT_ID\"}")
STAFF_ID=$(echo "$CREATED_STAFF" | json_field id)
if [ -z "$STAFF_ID" ]; then echo "Failed to create staff: $CREATED_STAFF"; exit 1; fi
echo "Created staff ($STAFF_ID) and client ($CLIENT_ID)"

STAFF_LOGIN=$(curl -s -X POST "$BASE/api/login" -H 'content-type: application/json' -d "{\"email\":\"$STAFF_EMAIL\",\"password\":\"$STAFF_PW\"}")
STAFF_TOKEN=$(echo "$STAFF_LOGIN" | json_field token)
if [ -z "$STAFF_TOKEN" ]; then echo "Failed to login as staff: $STAFF_LOGIN"; exit 1; fi

echo "Staff logged in"
TS_RESPONSE=$(curl -s -X POST "$BASE/api/timesheets" -H "Authorization: Bearer $STAFF_TOKEN" -H 'content-type: application/json' -d "{\"date\":\"2026-01-15\",\"hours\":8,\"clientId\":\"$CLIENT_ID\",\"notes\":\"Smoke test\"}")
TS_ID=$(echo "$TS_RESPONSE" | json_field id)
if [ -z "$TS_ID" ]; then echo "Failed to submit timesheet: $TS_RESPONSE"; exit 1; fi
echo "Submitted timesheet id $TS_ID"

CLIENT_LOGIN=$(curl -s -X POST "$BASE/api/login" -H 'content-type: application/json' -d "{\"email\":\"$CLIENT_EMAIL\",\"password\":\"$CLIENT_PW\"}")
CLIENT_TOKEN=$(echo "$CLIENT_LOGIN" | json_field token)
if [ -z "$CLIENT_TOKEN" ]; then echo "Failed to login as client: $CLIENT_LOGIN"; exit 1; fi

echo "Client logged in"
APPROVE=$(curl -s -X POST "$BASE/api/timesheets/$TS_ID/approve" -H "Authorization: Bearer $CLIENT_TOKEN")
if echo "$APPROVE" | grep -q 'approved'; then echo "Timesheet approved"; else echo "Approve failed: $APPROVE"; exit 1; fi

APPROVED=$(curl -s -X GET "$BASE/api/timesheets/approved" -H "Authorization: Bearer $OWNER_TOKEN")
if echo "$APPROVED" | grep -q "$TS_ID"; then echo "Owner sees approved timesheet: OK"; else echo "Owner does not see timesheet: $APPROVED"; exit 1; fi

echo "Smoke test completed successfully"
