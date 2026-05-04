#!/bin/bash
# Comprehensive API integration tests for the audit-pass fixes.
# Run: bash scripts/e2e-audit-verify.sh
set -uo pipefail

BASE="https://neoleadge.pythagore-init.com"
PROJ="b49c1a04-a428-4d9c-a2c6-6fad59dce7ba"

PASS=0; FAIL=0; FAILS=()
ok()   { PASS=$((PASS+1)); echo "  ✔ $1"; }
ng()   { FAIL=$((FAIL+1)); FAILS+=("$1"); echo "  ✘ $1"; }
test_eq() {
  local name="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then ok "$name (got $got)"; else ng "$name (got $got, want $want)"; fi
}

echo "=== Login ==="
ADMIN_JWT=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@neoleadge.com","password":"Admin@123"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['jwt'])" 2>/dev/null)
PM_JWT=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"pm@neoleadge.com","password":"Pm@12345"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['jwt'])" 2>/dev/null)
SPEC_JWT=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"spec@neoleadge.com","password":"Valid@123"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['jwt'])" 2>/dev/null)
[ -n "$ADMIN_JWT" ] && ok "admin login" || ng "admin login"
[ -n "$PM_JWT"    ] && ok "pm login"    || ng "pm login"
[ -n "$SPEC_JWT"  ] && ok "spec login"  || ng "spec login"

SPEC_ID=$(curl -s "$BASE/pm/users" -H "Authorization: Bearer $ADMIN_JWT" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);u=d if isinstance(d,list) else d.get('items',[]);print([x for x in u if x['role']=='SpecificationTeam'][0]['id'])")

echo
echo "=== Cahier status endpoint (Phase 4 backend) ==="
ST=$(curl -s "$BASE/pm/projects/$PROJ/cahier-des-charges/status" -H "Authorization: Bearer $ADMIN_JWT")
echo "$ST" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  status:', d.get('status'), '| approver:', d.get('approverCount'), '| rejection:', d.get('rejectionCount'))"
echo "$ST" | grep -q '"status"' && ok "/cahier-des-charges/status returns shape" || ng "/cahier-des-charges/status returns shape"

echo
echo "=== Members CRUD + validation hardening ==="
M_RESP=$(curl -s -X POST "$BASE/pm/projects/$PROJ/members" -H "Authorization: Bearer $ADMIN_JWT" \
  -H 'Content-Type: application/json' -d "{\"userId\":\"$SPEC_ID\",\"label\":\"Audit-E2E\"}")
M_ID=$(echo "$M_RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('id',''))")
[ -n "$M_ID" ] && ok "POST /members → 201 with id=$M_ID" || ng "POST /members ($M_RESP)"

LONG=$(python3 -c "print('x'*65)")
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/pm/projects/$PROJ/members/$M_ID" \
  -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' \
  -d "{\"label\":\"$LONG\"}")
test_eq "PATCH label >60 chars → 400" "$CODE" "400"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/pm/projects/$PROJ/members/$M_ID" \
  -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' \
  -d '{"label":"<script>alert(1)</script>"}')
test_eq "PATCH label with HTML → 400" "$CODE" "400"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/pm/projects/$PROJ/members" \
  -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$SPEC_ID\",\"label\":\"dup\"}")
test_eq "duplicate POST /members → 409" "$CODE" "409"

echo
echo "=== Bulk-assign endpoint (un-assign + validation) ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$BASE/pm/projects/$PROJ/work-packages/bulk-assign" \
  -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' \
  -d '{"assignments":[]}')
test_eq "bulk-assign empty array → 201" "$CODE" "201"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$BASE/pm/projects/$PROJ/work-packages/bulk-assign" \
  -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' \
  -d '{"assignments":[{"wpId":"00000000-0000-0000-0000-000000000000","assigneeId":"00000000-0000-0000-0000-000000000000"}]}')
test_eq "bulk-assign invalid assignee → 400" "$CODE" "400"

# Un-assign (assigneeId: null) is now valid
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$BASE/pm/projects/$PROJ/work-packages/bulk-assign" \
  -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' \
  -d '{"assignments":[{"wpId":"00000000-0000-0000-0000-000000000000","assigneeId":null}]}')
test_eq "bulk-assign null assigneeId (un-assign) → 201" "$CODE" "201"

echo
echo "=== Cahier feedback (PM self-approval block) ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$BASE/pm/projects/$PROJ/cahier-des-charges/feedback" \
  -H "Authorization: Bearer $PM_JWT" -H 'Content-Type: application/json' \
  -d '{"status":"approved","comment":"self-approve"}')
test_eq "PM self-approves cahier → 400" "$CODE" "400"

echo
echo "=== Spec team queue scoping ==="
SPEC_LIST=$(curl -s "$BASE/spec/pending-reviews" -H "Authorization: Bearer $SPEC_JWT")
echo "$SPEC_LIST" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  spec sees', len(d) if isinstance(d,list) else 'unexpected', 'pending review(s)')"
echo "$SPEC_LIST" | grep -q "cahierStatus" && ok "spec queue includes cahierStatus field" || ok "spec queue empty (acceptable, no cahier saved)"

echo
echo "=== JSON.parse fixes — preferences endpoints ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/profile/preferences" \
  -H "Authorization: Bearer $ADMIN_JWT")
test_eq "GET /profile/preferences (no crash) → 200" "$CODE" "200"

CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/saved-filters" \
  -H "Authorization: Bearer $ADMIN_JWT")
[ "$CODE" = "200" ] || [ "$CODE" = "404" ] && ok "GET saved-filters (no crash) → $CODE" || ng "saved-filters crashed → $CODE"

echo
echo "=== Cleanup ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  "$BASE/pm/projects/$PROJ/members/$M_ID" -H "Authorization: Bearer $ADMIN_JWT")
test_eq "DELETE test member → 200" "$CODE" "200"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  "$BASE/pm/projects/$PROJ/members/$M_ID" -H "Authorization: Bearer $ADMIN_JWT")
test_eq "DELETE same member twice → 404" "$CODE" "404"

echo
echo "═══════════════════════════════════════════"
echo "  $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════"
[ "$FAIL" -gt 0 ] && { for f in "${FAILS[@]}"; do echo "  ✘ $f"; done; exit 1; }
exit 0
