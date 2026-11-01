#!/usr/bin/env bash
# Skrivefri kontroll av en deployet vedleggstjeneste (avsnitt 7a i
# docs/drift/kvitteringsvedlegg.md). Små kall UTEN token: ingenting lagres,
# RTDB røres ikke. Kontrollen bekrefter rute og avvisning — den beviser
# IKKE body-grensen gjennom Hosting (U1).
#
#   scripts/verify-vedlegg-deployed.sh https://hverdagsflyt-vedlegg-….run.app
#   scripts/verify-vedlegg-deployed.sh https://familieapp-a5d15.web.app   # etter R3
set -euo pipefail

BASE="${1:?bruk: verify-vedlegg-deployed.sh <base-url>}"
BASE="${BASE%/}"
SHA0=$(printf '0%.0s' $(seq 1 64))
fail() {
  echo "VERIFISERING FEILET: $*" >&2
  exit 1
}

echo "1) POST uten token → 401 JSON (mangler_token) med nosniff"
body=$(mktemp)
hdr=$(curl -sS --max-time 20 -o "$body" -D - -X POST --data-binary x "${BASE}/api/vedlegg/x/y")
grep -qE "^HTTP/[0-9.]+ 401" <<<"$hdr" || fail "forventet 401: $(head -1 <<<"$hdr")"
grep -qi "^content-type: application/json" <<<"$hdr" || fail "forventet JSON (ikke index.html)"
grep -qi "^x-content-type-options: nosniff" <<<"$hdr" || fail "mangler nosniff"
grep -q '"feil":"mangler_token"' "$body" || fail "uventet body: $(cat "$body")"
rm -f "$body"

echo "2) GET uten token → 401"
code=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "${BASE}/api/vedlegg/x/y/${SHA0}")
[ "$code" = "401" ] || fail "GET forventet 401, fikk $code"

echo "Verifisert (skrivefritt): ${BASE}"
