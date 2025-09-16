#!/usr/bin/env bash
# Simple smoke test for Mega Construct prototype
# Requires server running at http://localhost:3000

set -e
BASE=http://localhost:3000
echo "Starting smoke test against $BASE"

# Login as owner to create test users
OWNER_EMAIL=${OWNER_EMAIL:-owner@example.com}
OWNER_PW=${OWNER_PASSWORD:-ownerpass}
OWNER_LOGIN=$(curl -s -X POST "$BASE/api/login" -H 'content-type: application/json' -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PW\"}")
OWNER_TOKEN=$(echo "$OWNER_LOGIN" | node -e "const s=require('fs').readFileSync(0,'utf8'); try{console.log(JSON.parse(s).token)}catch(e){}")
if [ -z "$OWNER_TOKEN" ]; then echo "Failed to login as owner: $OWNER_LOGIN"; exit 1; fi

echo "Owner logged in"

# Owner creates a staff user and a client user
STAFF_EMAIL="staff+test@example.com"
STAFF_PW="staffpass"
STAFF_NAME="Staff Tester"
CREATED_STAFF=$(curl -s -X POST "$BASE/api/users" -H "Authorization: Bearer $OWNER_TOKEN" -H 'content-type: application/json' -d "{\"name\":\"$STAFF_NAME\",\"email\":\"$STAFF_EMAIL\",\"password\":\"$STAFF_PW\",\"role\":\"staff\"}")
STAFF_ID=$(echo "$CREATED_STAFF" | node -e "const s=require('fs').readFileSync(0,'utf8'); try{console.log(JSON.parse(s).id)}catch(e){}")
if [ -z "$STAFF_ID" ]; then echo "Failed to create staff: $CREATED_STAFF"; exit 1; fi

CLIENT_EMAIL="client+test@example.com"
CLIENT_PW="clientpass"
CLIENT_NAME="Client Tester"
CREATED_CLIENT=$(curl -s -X POST "$BASE/api/users" -H "Authorization: Bearer $OWNER_TOKEN" -H 'content-type: application/json' -d "{\"name\":\"$CLIENT_NAME\",\"email\":\"$CLIENT_EMAIL\",\"password\":\"$CLIENT_PW\",\"role\":\"client\"}")
CLIENT_ID=$(echo "$CREATED_CLIENT" | node -e "const s=require('fs').readFileSync(0,'utf8'); try{console.log(JSON.parse(s).id)}catch(e){}")
if [ -z "$CLIENT_ID" ]; then echo "Failed to create client: $CREATED_CLIENT"; exit 1; fi

echo "Created staff ($STAFF_ID) and client ($CLIENT_ID)"

# Login as the created staff to get a token
STAFF_LOGIN=$(curl -s -X POST "$BASE/api/login" -H 'content-type: application/json' -d "{\"email\":\"$STAFF_EMAIL\",\"password\":\"$STAFF_PW\"}")
STAFF_TOKEN=$(echo "$STAFF_LOGIN" | node -e "const s=require('fs').readFileSync(0,'utf8'); try{console.log(JSON.parse(s).token)}catch(e){}")
if [ -z "$STAFF_TOKEN" ]; then echo "Failed to login as created staff: $STAFF_LOGIN"; exit 1; fi
echo "Staff logged in"

# Use the created client credentials to login and get token later
CLIENT_EMAIL="$CLIENT_EMAIL"
CLIENT_PW="$CLIENT_PW"
echo "Using client id $CLIENT_ID"

# Submit a timesheet
TS_RESPONSE=$(curl -s -X POST "$BASE/api/timesheets" -H "Authorization: Bearer $STAFF_TOKEN" -H 'content-type: application/json' -d "{\"date\":\"2025-09-13\",\"hours\":8,\"clientId\":\"$CLIENT_ID\",\"notes\":\"Smoke test\"}")
TS_ID=$(echo "$TS_RESPONSE" | node -e "const fs=require('fs');const s=fs.readFileSync(0,'utf8'); try{console.log(JSON.parse(s).id)}catch(e){}")
if [ -z "$TS_ID" ]; then echo "Failed to submit timesheet: $TS_RESPONSE"; exit 1; fi

echo "Submitted timesheet id $TS_ID"

# Login as client (seeded credentials)
CLIENT_LOGIN=$(curl -s -X POST "$BASE/api/login" -H 'content-type: application/json' -d "{\"email\":\"$CLIENT_EMAIL\",\"password\":\"$CLIENT_PW\"}")
CLIENT_TOKEN=$(echo "$CLIENT_LOGIN" | node -e "const s=fs.readFileSync(0,'utf8'); try{console.log(JSON.parse(s).token)}catch(e){}")
if [ -z "$CLIENT_TOKEN" ]; then echo "Failed to login as client: $CLIENT_LOGIN"; exit 1; fi

echo "Client logged in"

# Approve timesheet
APPROVE=$(curl -s -X POST "$BASE/api/timesheets/$TS_ID/approve" -H "Authorization: Bearer $CLIENT_TOKEN")
if echo "$APPROVE" | grep -q 'approved'; then echo "Timesheet approved"; else echo "Approve failed: $APPROVE"; exit 1; fi

# Login as owner and list approved
OWNER_EMAIL=${OWNER_EMAIL:-owner@example.com}
OWNER_PW=${OWNER_PASSWORD:-ownerpass}
OWNER_LOGIN=$(curl -s -X POST "$BASE/api/login" -H 'content-type: application/json' -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PW\"}")
OWNER_TOKEN=$(echo "$OWNER_LOGIN" | node -e "const s=fs.readFileSync(0,'utf8'); try{console.log(JSON.parse(s).token)}catch(e){}")
if [ -z "$OWNER_TOKEN" ]; then echo "Failed to login as owner: $OWNER_LOGIN"; exit 1; fi

APPROVED=$(curl -s -X GET "$BASE/api/timesheets/approved" -H "Authorization: Bearer $OWNER_TOKEN")
if echo "$APPROVED" | grep -q "$TS_ID"; then echo "Owner sees approved timesheet: OK"; else echo "Owner does not see timesheet: $APPROVED"; exit 1; fi

echo "Smoke test completed successfully"
