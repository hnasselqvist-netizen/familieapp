#!/usr/bin/env bash
# Verifiserer en deployet MCP-tjeneste fra utsiden (deploy-workflowen og
# manuelt). Leser ingen data og sender aldri et token.
#
#   scripts/verify-deployed.sh https://hverdagsflyt-mcp-….run.app https://{tenant}.eu.auth0.com/
set -euo pipefail

BASE="${1:?bruk: verify-deployed.sh <base-url> <issuer>}"
ISSUER="${2:?bruk: verify-deployed.sh <base-url> <issuer>}"
BASE="${BASE%/}"
RESOURCE="${BASE}/mcp"

fail() { echo "VERIFISERING FEILET: $*" >&2; exit 1; }

echo "1) /healthz (venter på ny revisjon)"
for _ in $(seq 1 30); do
  body=$(curl -sS --max-time 10 "${BASE}/healthz" 2>/dev/null || true)
  [ "$body" = '{"ok":true}' ] && break
  sleep 2
done
[ "$body" = '{"ok":true}' ] || fail "/healthz svarte '${body}' (403 betyr at Invoker-IAM-sjekken er på eller ingress er stengt)"

echo "2) RFC 9728-metadata"
meta=$(curl -fsS --max-time 10 "${BASE}/.well-known/oauth-protected-resource/mcp")
python3 - "$meta" "$RESOURCE" "$ISSUER" <<'PY'
import json, sys
meta, resource, issuer = json.loads(sys.argv[1]), sys.argv[2], sys.argv[3]
assert meta.get("resource") == resource, f"resource={meta.get('resource')!r}, forventet {resource!r}"
assert meta.get("authorization_servers") == [issuer], f"authorization_servers={meta.get('authorization_servers')!r}"
assert set(meta.get("scopes_supported", [])) == {"shopping:read", "shopping:write"}, meta.get("scopes_supported")
print("   resource, authorization_servers og scopes stemmer")
PY

echo "3) /mcp uten token → 401 + WWW-Authenticate"
hdr=$(curl -sS --max-time 10 -o /dev/null -D - -X POST "${RESOURCE}" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
grep -qE "^HTTP/[0-9.]+ 401" <<<"$hdr" || fail "forventet 401: $(head -1 <<<"$hdr")"
grep -qi "^www-authenticate: Bearer resource_metadata=\"${BASE}/.well-known/oauth-protected-resource/mcp\"" <<<"$hdr" \
  || fail "WWW-Authenticate mangler eller peker feil: $(grep -i '^www-authenticate' <<<"$hdr")"

echo "Verifisert: ${BASE}"
