#!/usr/bin/env bash
# Røyktest av et ferdigbygd MCP-image (CI og lokalt). Ingen sky, ingen
# database: serveren pekes mot en emulatoradresse som ikke trenger å finnes,
# fordi ingen av sjekkene her leser data.
#
#   scripts/smoke-container.sh hverdagsflyt-mcp:local
set -euo pipefail

IMAGE="${1:?bruk: smoke-container.sh <image>}"
PORT="${SMOKE_PORT:-18080}"
RESOURCE="http://localhost:${PORT}/mcp"
NAME="mcp-smoke-$$"
EMU=(
  -e FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9
  -e "FIREBASE_DATABASE_URL=http://127.0.0.1:9/?ns=demo-familieapp-default-rtdb"
  -e "MCP_RESOURCE_URL=${RESOURCE}"
  -e MCP_AUTH_ISSUER=https://idp.invalid/
)

fail() { echo "SMOKE FEIL: $*" >&2; docker logs "$NAME" 2>&1 | tail -20 >&2 || true; exit 1; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "1) Nekter ekte database uten eksplisitt beslutning"
if out=$(docker run --rm -e FIREBASE_DATABASE_URL=https://x.firebaseio.com \
  -e MCP_RESOURCE_URL=https://mcp.invalid/mcp -e MCP_AUTH_ISSUER=https://idp.invalid/ \
  "$IMAGE" 2>&1); then
  fail "serveren startet mot ekte RTDB uten MCP_ALLOW_PRODUCTION_DATA"
fi
grep -q "Nekter å koble til ekte Realtime Database" <<<"$out" || fail "uventet feil: $out"

echo "2) Ugyldig skrivebryter stopper oppstart"
if docker run --rm "${EMU[@]}" -e MCP_HANDLELISTE_SKRIVING=true "$IMAGE" >/dev/null 2>&1; then
  fail "MCP_HANDLELISTE_SKRIVING=true ble akseptert"
fi

echo "3) Starter (skriving av som standard, ikke-root)"
docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:8080" "${EMU[@]}" "$IMAGE" >/dev/null
for _ in $(seq 1 50); do
  curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 && break
  sleep 0.2
done
[ "$(curl -fsS "http://127.0.0.1:${PORT}/health")" = '{"ok":true}' ] || fail "/health"
[ "$(docker exec "$NAME" id -u)" != "0" ] || fail "kjører som root"
docker logs "$NAME" 2>&1 | grep -q '"event":"server_started".*"writesEnabled":false' \
  || fail "server_started mangler writesEnabled:false"

echo "4) RFC 9728-metadata"
meta=$(curl -fsS "http://127.0.0.1:${PORT}/.well-known/oauth-protected-resource/mcp")
grep -q "\"resource\":\"${RESOURCE}\"" <<<"$meta" || fail "resource i metadata: $meta"
grep -q '"authorization_servers":\["https://idp.invalid/"\]' <<<"$meta" || fail "AS i metadata: $meta"

echo "5) /mcp uten token → 401 + WWW-Authenticate"
hdr=$(curl -sS -o /dev/null -D - -X POST "http://127.0.0.1:${PORT}/mcp" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
grep -q "^HTTP/1.1 401" <<<"$hdr" || fail "forventet 401: $hdr"
grep -qi "^www-authenticate: Bearer resource_metadata=\"http://localhost:${PORT}/.well-known/oauth-protected-resource/mcp\"" <<<"$hdr" \
  || fail "WWW-Authenticate: $hdr"

echo "6) SIGTERM → ryddig stopp"
docker stop -t 9 "$NAME" >/dev/null
[ "$(docker inspect -f '{{.State.ExitCode}}' "$NAME")" = "0" ] || fail "exit-kode etter SIGTERM"
docker logs "$NAME" 2>&1 | grep -q '"event":"server_stopped"' || fail "server_stopped mangler"

echo "Røyktest OK: $IMAGE"
