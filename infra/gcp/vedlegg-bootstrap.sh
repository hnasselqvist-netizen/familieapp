#!/usr/bin/env bash
# Engangsoppsett i GCP for vedleggstjenesten (kvitteringsfiler, #59 B; R1/O1 i
# docs/drift/kvitteringsvedlegg.md). Kjøres av prosjekteier i Cloud Shell for
# familieapp-a5d15, og FØRST etter Helens samlede godkjenning av pakken.
#
#   bash infra/gcp/vedlegg-preflight.sh              # skrivefri førtilstand (anbefalt først)
#   bash infra/gcp/vedlegg-bootstrap.sh              # tørrkjøring: viser endringslisten
#   bash infra/gcp/vedlegg-bootstrap.sh --apply      # utfører den
#
# Rekkefølge og vern:
#  1. Prosjektvern: prosjektnummeret må stemme. Ellers stopper skriptet før noe annet.
#  2. ALLE førtilstandssjekker kjøres (bare lesing) før én eneste endring:
#     - MCP-oppsettet må finnes: Artifact Registry-repoet `hverdagsflyt` og
#       deployidentiteten hverdagsflyt-mcp-deployer@…. De endres ikke.
#     - Finnes bøtta, kjøretidsidentiteten eller tjenesten fra før, må den være
#       vår: merket `formaal=hverdagsflyt-vedlegg` (bøtte og tjeneste) eller ha
#       beskrivelsen «hverdagsflyt-vedlegg» (identitet), og ha riktige
#       innstillinger. Ellers STOPP. Skriptet overtar eller svekker aldri en
#       ukjent ressurs.
#  3. Endringslisten skrives ut i sin helhet.
#  4. Bare med --apply utføres den, i rekkefølge, og stopper ved første feil.
#
# Endringslisten (og ingenting mer):
#  - Aktiverer Cloud Storage-API-et.
#  - Bøtte gs://familieapp-a5d15-kvitteringer (kan overstyres med VEDLEGG_BUCKET) i europe-west1:
#    Standard, uniform bucket-level access, public access prevention, merket.
#    Den er ikke koblet til Firebase Storage: ingen klientvei, ingen regler, ingen CORS.
#  - Kjøretidsidentitet hverdagsflyt-vedlegg@….
#  - IAM, bare ADDITIVT (add-iam-policy-binding). Aldri set-iam-policy, remove eller delete.
#    Eksisterende policy bevares.
#      bøtta:     roles/storage.objectCreator, roles/storage.objectViewer → kjøretidsidentiteten
#      prosjektet: roles/firebasedatabase.viewer, roles/firebaseauth.viewer → kjøretidsidentiteten
#      kjøretidsidentiteten: roles/iam.serviceAccountUser → deployidentiteten
#      tjenesten: roles/run.developer → deployidentiteten
#    Ingen sletterett, ingen RTDB-skriving, ingen run.admin eller setIamPolicy til deployeren.
#  - Tjenesteskallet hverdagsflyt-vedlegg: Googles «hello»-image med
#    `--ingress=internal` (ikke nåbart) og `--no-invoker-iam-check`. Det siste er
#    den ENESTE endringen av Invoker-sjekken, og den gjøres her av prosjekteier.
#    Firebase Hosting-rewrite krever kall uten Google-identitet. Appen
#    autentiserer selv hver forespørsel. deploy-vedlegg-cloudrun.yml bytter
#    senere bare image/env og setter `--ingress=all`, uten Invoker- eller IAM-flagg.
#
# Gjør IKKE: budsjettvarsel (O2), Hosting-rewrite (R3), web-flagget (R4), deploy
# av kode, skriving til bøtta eller RTDB, sletting eller opprydding.
set -euo pipefail

PROJECT_ID=familieapp-a5d15
PROJECT_NUMBER=1075494790067
REGION=europe-west1
SERVICE=hverdagsflyt-vedlegg
BUCKET="${VEDLEGG_BUCKET:-familieapp-a5d15-kvitteringer}"
AR_REPO=hverdagsflyt
RUNTIME_NAME=hverdagsflyt-vedlegg
RUNTIME_SA="${RUNTIME_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="hverdagsflyt-mcp-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
PLACEHOLDER_IMAGE=us-docker.pkg.dev/cloudrun/container/hello
MERKE_NOKKEL=formaal
MERKE=hverdagsflyt-vedlegg
SA_BESKRIVELSE=hverdagsflyt-vedlegg

APPLY=false
case "${1:-}" in
  "") ;;
  --apply) APPLY=true ;;
  *)
    echo "Ukjent argument: $1 (bare --apply)" >&2
    exit 2
    ;;
esac

stopp() {
  echo "STOPP: $*" >&2
  exit 1
}
exists() { "$@" >/dev/null 2>&1; }
lc() { tr '[:upper:]' '[:lower:]' <<<"$1"; }
G=(--project="$PROJECT_ID" --quiet)

# ── 1. Prosjektvern ─────────────────────────────────────────────────
actual_number=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)') ||
  stopp "kunne ikke lese prosjektet $PROJECT_ID."
[ "$actual_number" = "$PROJECT_NUMBER" ] ||
  stopp "$PROJECT_ID har prosjektnummer '$actual_number', ikke $PROJECT_NUMBER."

# ── 2. Førtilstand (bare lesing) ────────────────────────────────────
echo "== Førtilstand (bare lesing)"
exists gcloud iam service-accounts describe "$DEPLOY_SA" "${G[@]}" ||
  stopp "deployidentiteten $DEPLOY_SA finnes ikke (MCP-oppsettet mangler)."
exists gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" "${G[@]}" ||
  stopp "Artifact Registry-repoet $AR_REPO finnes ikke i $REGION."
echo "  MCP-oppsett: $DEPLOY_SA og $AR_REPO finnes (endres ikke)."

LAG_BOTTE=true
if exists gcloud storage buckets describe "gs://${BUCKET}" "${G[@]}"; then
  IFS=$'\t' read -r loc ubla pap merke < <(gcloud storage buckets describe "gs://${BUCKET}" "${G[@]}" \
    --format="value(location,uniform_bucket_level_access,public_access_prevention,labels.${MERKE_NOKKEL})")
  [ "${merke:-}" = "$MERKE" ] ||
    stopp "bøtta gs://${BUCKET} finnes, men er ikke merket ${MERKE_NOKKEL}=${MERKE}. Den overtas ikke."
  [ "$(lc "${loc:-}")" = "$REGION" ] || stopp "bøtta ligger i '${loc:-}', ikke $REGION."
  [ "$(lc "${ubla:-}")" = "true" ] || stopp "bøtta har ikke uniform bucket-level access."
  [ "${pap:-}" = "enforced" ] || stopp "bøtta har public access prevention '${pap:-}', ikke 'enforced'."
  LAG_BOTTE=false
  echo "  Bøtte: finnes, er vår og har riktige innstillinger."
else
  echo "  Bøtte: finnes ikke — opprettes."
fi

LAG_SA=true
if exists gcloud iam service-accounts describe "$RUNTIME_SA" "${G[@]}"; then
  beskrivelse=$(gcloud iam service-accounts describe "$RUNTIME_SA" "${G[@]}" --format='value(description)')
  [ "$beskrivelse" = "$SA_BESKRIVELSE" ] ||
    stopp "$RUNTIME_SA finnes, men har beskrivelsen '$beskrivelse'. Den overtas ikke."
  LAG_SA=false
  echo "  Kjøretidsidentitet: finnes og er vår."
else
  echo "  Kjøretidsidentitet: finnes ikke — opprettes."
fi

LAG_TJENESTE=true
if exists gcloud run services describe "$SERVICE" --region="$REGION" "${G[@]}"; then
  IFS=$'\t' read -r merke sa < <(gcloud run services describe "$SERVICE" --region="$REGION" "${G[@]}" \
    --format="value(metadata.labels.${MERKE_NOKKEL},spec.template.spec.serviceAccountName)")
  [ "${merke:-}" = "$MERKE" ] ||
    stopp "tjenesten $SERVICE finnes, men er ikke merket ${MERKE_NOKKEL}=${MERKE}. Den overtas ikke."
  [ "${sa:-}" = "$RUNTIME_SA" ] ||
    stopp "tjenesten $SERVICE kjører som '${sa:-}', ikke $RUNTIME_SA."
  LAG_TJENESTE=false
  echo "  Tjeneste: finnes og er vår (røres ikke; bare deploybindingen sikres)."
else
  echo "  Tjeneste: finnes ikke — opprettes som ikke-nåbart skall."
fi

# ── 3. Endringslisten ───────────────────────────────────────────────
ENDRINGER=()
plan() { ENDRINGER+=("$(printf '%q ' "$@")"); }

plan gcloud services enable storage.googleapis.com "${G[@]}"
$LAG_BOTTE && plan gcloud storage buckets create "gs://${BUCKET}" --location="$REGION" \
  --default-storage-class=STANDARD --uniform-bucket-level-access --public-access-prevention \
  --update-labels="${MERKE_NOKKEL}=${MERKE}" "${G[@]}"
$LAG_SA && plan gcloud iam service-accounts create "$RUNTIME_NAME" \
  --display-name="Hverdagsflyt vedlegg (kjøretid)" --description="$SA_BESKRIVELSE" "${G[@]}"
for role in roles/storage.objectCreator roles/storage.objectViewer; do
  plan gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member="serviceAccount:${RUNTIME_SA}" --role="$role" "${G[@]}"
done
for role in roles/firebasedatabase.viewer roles/firebaseauth.viewer; do
  plan gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${RUNTIME_SA}" --role="$role" --condition=None --quiet
done
plan gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/iam.serviceAccountUser "${G[@]}"
$LAG_TJENESTE && plan gcloud run deploy "$SERVICE" --image="$PLACEHOLDER_IMAGE" --region="$REGION" \
  --service-account="$RUNTIME_SA" --ingress=internal --no-invoker-iam-check \
  --labels="${MERKE_NOKKEL}=${MERKE}" --min-instances=0 --max-instances=1 "${G[@]}"
plan gcloud run services add-iam-policy-binding "$SERVICE" --region="$REGION" \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/run.developer "${G[@]}"

echo "== Endringsliste (${#ENDRINGER[@]} kall, i rekkefølge)"
for e in "${ENDRINGER[@]}"; do printf '+ %s\n' "$e"; done

if ! $APPLY; then
  echo "Tørrkjøring — ingenting er endret. Kjør med --apply for å utføre listen over."
  exit 0
fi

# ── 4. Utførelse (--apply) ──────────────────────────────────────────
# Nyopprettede tjenestekontoer blir først etter hvert synlige for andre
# tjenesters policyvalidering (samme som mcp-bootstrap.sh, #27 5959253093).
# Gjentar KUN «does not exist», med avgrenset venting (≈ 3 min). Alt annet stopper.
utfor() {
  local attempt=1 max=11 delay=5 out
  while :; do
    if out=$(eval "$1" 2>&1); then
      [ -n "$out" ] && printf '%s\n' "$out"
      return 0
    fi
    if [ "$attempt" -lt "$max" ] && grep -q "does not exist" <<<"$out"; then
      echo "  … ikke synlig ennå (forsøk $attempt/$max), venter ${delay}s"
      sleep "$delay"
      attempt=$((attempt + 1))
      delay=$((delay * 2 > 20 ? 20 : delay * 2))
      continue
    fi
    printf '%s\n' "$out" >&2
    stopp "kallet feilet: $1"
  done
}

echo "== Utfører"
for e in "${ENDRINGER[@]}"; do
  printf '+ %s\n' "$e"
  utfor "$e"
done
echo "== Ferdig. Skallet er fortsatt internal; neste steg er deploy-vedlegg-cloudrun.yml (R2)."
gcloud run services describe "$SERVICE" --region="$REGION" "${G[@]}" \
  --format='value(metadata.annotations."run.googleapis.com/urls")' || true
