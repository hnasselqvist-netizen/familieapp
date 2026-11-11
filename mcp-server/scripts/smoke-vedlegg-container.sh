#!/usr/bin/env bash
# Røyktest av et ferdigbygd vedleggsimage (CI og deploy-vedlegg-cloudrun.yml).
# Ingen sky, ingen database, ingen bøtte: tjenesten pekes mot emulator-
# adresser som ikke trenger å finnes, fordi ingen av sjekkene her når
# tokenverifisering, medlemskap eller lager (alt avvises før det).
#
#   scripts/smoke-vedlegg-container.sh hverdagsflyt-vedlegg:local
set -euo pipefail

IMAGE="${1:?bruk: smoke-vedlegg-container.sh <image>}"
PORT="${SMOKE_PORT:-18081}"
BASE="http://127.0.0.1:${PORT}"
NAME="vedlegg-smoke-$$"
EMU=(
  -e FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9
  -e FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9
  -e "FIREBASE_DATABASE_URL=http://127.0.0.1:9/?ns=demo-familieapp-default-rtdb"
)
SHA0=$(printf '0%.0s' $(seq 1 64))

fail() {
  echo "SMOKE FEIL: $*" >&2
  docker logs "$NAME" 2>&1 | tail -20 >&2 || true
  exit 1
}
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Forventer at containeren IKKE starter, og at feilen nevner $2.
nekter() {
  local hva="$1" tekst="$2" out
  shift 2
  if out=$(docker run --rm "$@" "$IMAGE" 2>&1); then
    fail "$hva: tjenesten startet"
  fi
  grep -q "$tekst" <<<"$out" || fail "$hva: uventet feil: $out"
}

echo "1) Nekter ekte Firebase uten eksplisitt beslutning"
nekter "uten opt-in" "Nekter å koble til ekte Firebase" \
  -e FIREBASE_DATABASE_URL=https://x.firebaseio.com -e VEDLEGG_LAGER=gcs -e VEDLEGG_BUCKET=b

echo "2) Nekter ekte GCS mot emulatoren, også med opt-in"
nekter "gcs mot emulator" "Ekte GCS-lager er ikke tillatt mot emulatoren" \
  "${EMU[@]}" -e VEDLEGG_LAGER=gcs -e VEDLEGG_BUCKET=b -e VEDLEGG_ALLOW_PRODUCTION=true

echo "3) Nekter halv emulator, også med opt-in"
nekter "halv emulator" "Blandet emulatoroppsett" \
  -e FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9 -e FIREBASE_DATABASE_URL=https://x.firebaseio.com \
  -e VEDLEGG_ALLOW_PRODUCTION=true -e VEDLEGG_LAGER=gcs -e VEDLEGG_BUCKET=b

echo "4) Nekter minnelager utenfor emulator"
nekter "minne i produksjon" "Minnelager er bare for emulator" \
  -e FIREBASE_DATABASE_URL=https://x.firebaseio.com -e VEDLEGG_ALLOW_PRODUCTION=true

echo "5) Starter mot emulatoradresser med minnelager, ikke-root"
docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:8080" "${EMU[@]}" "$IMAGE" >/dev/null
for _ in $(seq 1 50); do
  docker logs "$NAME" 2>&1 | grep -q '"hendelse":"vedlegg_server_startet"' && break
  sleep 0.2
done
docker logs "$NAME" 2>&1 | grep -q '"hendelse":"vedlegg_server_startet".*"lager":"minne"' ||
  fail "vedlegg_server_startet med lager minne mangler"
[ "$(docker exec "$NAME" id -u)" != "0" ] || fail "kjører som root"

echo "6) Uten token → 401 JSON med nosniff (opplasting og nedlasting)"
hdr=$(curl -sS -o /tmp/vedlegg-smoke-body.$$ -D - -X POST --data-binary x "${BASE}/api/vedlegg/f/r")
grep -q "^HTTP/1.1 401" <<<"$hdr" || fail "POST forventet 401: $hdr"
grep -qi "^x-content-type-options: nosniff" <<<"$hdr" || fail "POST mangler nosniff: $hdr"
grep -q '"feil":"mangler_token"' /tmp/vedlegg-smoke-body.$$ || fail "POST-body: $(cat /tmp/vedlegg-smoke-body.$$)"
rm -f /tmp/vedlegg-smoke-body.$$
code=$(curl -sS -o /dev/null -w '%{http_code}' "${BASE}/api/vedlegg/f/r/${SHA0}")
[ "$code" = "401" ] || fail "GET forventet 401, fikk $code"

echo "7) Ukjent rute → 400, ikke noe annet innhold"
code=$(curl -sS -o /dev/null -w '%{http_code}' "${BASE}/")
[ "$code" = "400" ] || fail "/ forventet 400, fikk $code"

echo "Røyktest OK: $IMAGE"
