# shellcheck shell=bash
# Felles for vedlegg-bootstrap.sh og vedlegg-preflight.sh (#59 B). Kildes, kjøres ikke.
#
# Konstantene ligger fast for denne pakken. Bøttenavnet kan IKKE overstyres:
# bøttenavn er globale, og prosjektvernet skal også gjelde bøtta.
PROJECT_ID=familieapp-a5d15
PROJECT_NUMBER=1075494790067
REGION=europe-west1
SERVICE=hverdagsflyt-vedlegg
BUCKET=familieapp-a5d15-kvitteringer
AR_REPO=hverdagsflyt
RUNTIME_NAME=hverdagsflyt-vedlegg
RUNTIME_SA="${RUNTIME_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="hverdagsflyt-mcp-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
MERKE_NOKKEL=formaal
MERKE=hverdagsflyt-vedlegg
SA_BESKRIVELSE=hverdagsflyt-vedlegg

# Tretilstands lesing (review 5729887292 P1). Kjører et LESENDE gcloud-kall og
# setter:
#   LES_TILSTAND = finnes | mangler | ukjent
#   LES_UT       = stdout ved finnes, ellers feilteksten
# «mangler» krever en POSITIV ikke-funnet-melding fra gcloud. Leseavslag,
# deaktivert API, tidsavbrudd, transport- eller formatfeil og alt annet ukjent
# blir «ukjent». Avslag og liknende vinner over en eventuell ikke-funnet-tekst
# i samme utskrift.
#
# Feilmønstrene er IKKE verifisert mot ekte gcloud-utskrift fra Claude-økten.
# En feiltolkning gir «ukjent», og dermed STOPP: lukket, aldri opprettelse.
les() {
  local ut rc
  # Eksplisitt rc: under `set -e` ville en feilende kommandosubstitusjon ellers avslutte skriptet.
  ut=$("$@" 2>&1) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    LES_TILSTAND=finnes
    LES_UT=$ut
    return 0
  fi
  LES_UT=$ut
  if grep -qiE 'PERMISSION_DENIED|AccessDenied|403|UNAUTHENTICATED|401|SERVICE_DISABLED|has not been used|is disabled|DEADLINE_EXCEEDED|timed out|timeout|connection|UNAVAILABLE|INTERNAL|unrecognized arguments|invalid' <<<"$ut"; then
    LES_TILSTAND=ukjent
  elif grep -qE 'NOT_FOUND|NotFoundError|not found: 404|Cannot find service' <<<"$ut"; then
    LES_TILSTAND=mangler
  else
    LES_TILSTAND=ukjent
  fi
  return 0
}

# Første linje av feilteksten, til utskrift.
kort() { head -n 1 <<<"$1" | cut -c1-160; }
