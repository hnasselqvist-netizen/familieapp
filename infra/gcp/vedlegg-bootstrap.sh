#!/usr/bin/env bash
# Engangsoppsett i GCP for vedleggstjenesten (kvitteringsfiler, #59 B; R1/O1 i
# docs/drift/kvitteringsvedlegg.md). INAKTIV KODE: kjøres bare av prosjekteier
# i Cloud Shell for familieapp-a5d15, og FØRST etter Helens samlede godkjenning.
#
#   bash infra/gcp/vedlegg-preflight.sh              # skrivefri førtilstand (først)
#   bash infra/gcp/vedlegg-bootstrap.sh              # tørrkjøring: viser endringslisten
#   bash infra/gcp/vedlegg-bootstrap.sh --apply      # utfører den
#
# Rekkefølge og vern:
#  1. Prosjektvern: prosjektnummeret må stemme. Ellers stopper skriptet før noe annet.
#  2. HELE førtilstanden leses før én eneste endring, med tretilstands lesing
#     (vedlegg-felles.sh): finnes | bekreftet mangler | ukjent. «Ukjent» gir
#     ALLTID STOPP: leseavslag, deaktivert API, tidsavbrudd, transport- eller
#     formatfeil og ukjent feil. Bare en positiv ikke-funnet-melding gir opprettelse.
#     - Cloud Storage-API-et må allerede være aktivert. Skriptet aktiverer ikke
#       API-er. Er det av, stopper skriptet med instruks om et eget, godkjent steg.
#     - MCP-oppsettet må finnes: Artifact Registry-repoet og deployidentiteten.
#     - Bøtta (fast navn, ingen overstyring) må enten
#         a) være oppført blant PROSJEKTETS egne bøtter, være merket og ha riktige
#            innstillinger, eller
#         b) positivt ikke finnes noe sted.
#       Finnes den utenfor prosjektet, eller kan det ikke avgjøres: STOPP.
#     - Kjøretidsidentiteten og tjenesten: bekreftet mangler, eller finnes og er vår
#       (riktig beskrivelse, merke og identitet). Ellers STOPP.
#  3. Endringslisten skrives ut i sin helhet.
#  4. Bare med --apply utføres den, i rekkefølge, og stopper ved første feil.
#
# Endringslisten (og ingenting mer):
#  - Bøtta gs://familieapp-a5d15-kvitteringer i europe-west1: Standard, uniform
#    bucket-level access, public access prevention, merket
#    (`--labels`, review 5729887292). Den er ikke koblet til Firebase Storage.
#  - Kjøretidsidentiteten hverdagsflyt-vedlegg@….
#  - IAM, bare ADDITIVT (add-iam-policy-binding). Aldri set-iam-policy, remove eller delete:
#      bøtta:     roles/storage.objectCreator, roles/storage.objectViewer → kjøretidsidentiteten
#      prosjektet: roles/firebasedatabase.viewer, roles/firebaseauth.viewer → kjøretidsidentiteten
#      kjøretidsidentiteten: roles/iam.serviceAccountUser → deployidentiteten
#      tjenesten: roles/run.developer → deployidentiteten
#  - Tjenesteskallet: «hello»-image, `--ingress=internal` og `--no-invoker-iam-check`.
#    Dette er den ENESTE endringen av Invoker-sjekken, og den gjøres av prosjekteier.
#    deploy-vedlegg-cloudrun.yml bytter senere bare image/env og setter `--ingress=all`.
#
# Gjør IKKE: API-aktivering, budsjettvarsel (O2), Hosting-rewrite (R3),
# web-flagget (R4), deploy av kode, skriving til bøtta eller RTDB, sletting eller opprydding.
set -euo pipefail
# shellcheck source=infra/gcp/vedlegg-felles.sh
. "$(dirname "${BASH_SOURCE[0]}")/vedlegg-felles.sh"
PLACEHOLDER_IMAGE=us-docker.pkg.dev/cloudrun/container/hello

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
lc() { tr '[:upper:]' '[:lower:]' <<<"$1"; }
G=(--project="$PROJECT_ID" --quiet)

# ── 1. Prosjektvern ─────────────────────────────────────────────────
les gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)'
[ "$LES_TILSTAND" = finnes ] || stopp "kunne ikke lese prosjektet $PROJECT_ID: $(kort "$LES_UT")"
[ "$LES_UT" = "$PROJECT_NUMBER" ] ||
  stopp "$PROJECT_ID har prosjektnummer '$LES_UT', ikke $PROJECT_NUMBER."

# ── 2. Førtilstand (bare lesing) ────────────────────────────────────
echo "== Førtilstand (bare lesing)"

les gcloud services list --enabled "${G[@]}" --format='value(config.name)'
[ "$LES_TILSTAND" = finnes ] || stopp "kunne ikke lese aktiverte API-er: $(kort "$LES_UT")"
grep -qx 'storage.googleapis.com' <<<"$LES_UT" ||
  stopp "Cloud Storage-API-et er ikke aktivert. Aktiver det som eget godkjent steg
  (gcloud services enable storage.googleapis.com --project=$PROJECT_ID) og kjør tørrkjøringen på nytt."
echo "  Cloud Storage-API: aktivert."

les gcloud iam service-accounts describe "$DEPLOY_SA" "${G[@]}" --format='value(email)'
[ "$LES_TILSTAND" = finnes ] ||
  stopp "deployidentiteten $DEPLOY_SA: $LES_TILSTAND ($(kort "$LES_UT")). MCP-oppsettet må finnes og være lesbart."
les gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" "${G[@]}" --format='value(name)'
[ "$LES_TILSTAND" = finnes ] ||
  stopp "Artifact Registry-repoet $AR_REPO: $LES_TILSTAND ($(kort "$LES_UT"))."
echo "  MCP-oppsett: $DEPLOY_SA og $AR_REPO finnes (endres ikke)."

# Bøtte: eierskap via prosjektets egen bøtteliste, deretter innstillinger.
les gcloud storage buckets list "${G[@]}" --format='value(name)'
[ "$LES_TILSTAND" = finnes ] || stopp "kunne ikke liste prosjektets bøtter: $(kort "$LES_UT")"
if grep -qx "$BUCKET" <<<"$LES_UT"; then
  les gcloud storage buckets describe "gs://${BUCKET}" "${G[@]}" \
    --format="value(location,uniform_bucket_level_access,public_access_prevention,labels.${MERKE_NOKKEL})"
  [ "$LES_TILSTAND" = finnes ] || stopp "bøtta gs://${BUCKET} kunne ikke leses: $(kort "$LES_UT")"
  IFS=$'\t' read -r loc ubla pap merke <<<"$LES_UT"
  [ "${merke:-}" = "$MERKE" ] ||
    stopp "bøtta gs://${BUCKET} er ikke merket ${MERKE_NOKKEL}=${MERKE}. Den overtas ikke."
  [ "$(lc "${loc:-}")" = "$REGION" ] || stopp "bøtta ligger i '${loc:-}', ikke $REGION."
  [ "$(lc "${ubla:-}")" = "true" ] || stopp "bøtta har ikke uniform bucket-level access."
  [ "${pap:-}" = "enforced" ] || stopp "bøtta har public access prevention '${pap:-}', ikke 'enforced'."
  LAG_BOTTE=false
  echo "  Bøtte: tilhører prosjektet, er merket og har riktige innstillinger."
else
  # Ikke i prosjektets liste. Den må positivt ikke finnes noe sted (globalt navn).
  les gcloud storage buckets describe "gs://${BUCKET}" "${G[@]}" --format='value(name)'
  case "$LES_TILSTAND" in
    mangler) LAG_BOTTE=true && echo "  Bøtte: finnes ikke — opprettes." ;;
    finnes) stopp "gs://${BUCKET} finnes, men ikke i prosjektet $PROJECT_ID. Den overtas ikke." ;;
    *) stopp "kan ikke avgjøre om gs://${BUCKET} finnes eller hvem som eier den: $(kort "$LES_UT")" ;;
  esac
fi

les gcloud iam service-accounts describe "$RUNTIME_SA" "${G[@]}" --format='value(description)'
case "$LES_TILSTAND" in
  mangler) LAG_SA=true && echo "  Kjøretidsidentitet: finnes ikke — opprettes." ;;
  finnes)
    [ "$LES_UT" = "$SA_BESKRIVELSE" ] ||
      stopp "$RUNTIME_SA finnes, men har beskrivelsen '$LES_UT'. Den overtas ikke."
    LAG_SA=false
    echo "  Kjøretidsidentitet: finnes og er vår."
    ;;
  *) stopp "kjøretidsidentiteten $RUNTIME_SA kan ikke avgjøres: $(kort "$LES_UT")" ;;
esac

les gcloud run services describe "$SERVICE" --region="$REGION" "${G[@]}" \
  --format="value(metadata.labels.${MERKE_NOKKEL},spec.template.spec.serviceAccountName)"
case "$LES_TILSTAND" in
  mangler) LAG_TJENESTE=true && echo "  Tjeneste: finnes ikke — opprettes som ikke-nåbart skall." ;;
  finnes)
    IFS=$'\t' read -r merke sa <<<"$LES_UT"
    [ "${merke:-}" = "$MERKE" ] ||
      stopp "tjenesten $SERVICE er ikke merket ${MERKE_NOKKEL}=${MERKE}. Den overtas ikke."
    [ "${sa:-}" = "$RUNTIME_SA" ] || stopp "tjenesten $SERVICE kjører som '${sa:-}', ikke $RUNTIME_SA."
    LAG_TJENESTE=false
    echo "  Tjeneste: finnes og er vår (røres ikke; bare deploybindingen sikres)."
    ;;
  *) stopp "tjenesten $SERVICE kan ikke avgjøres: $(kort "$LES_UT")" ;;
esac

# ── 3. Endringslisten ───────────────────────────────────────────────
ENDRINGER=()
plan() { ENDRINGER+=("$(printf '%q ' "$@")"); }

$LAG_BOTTE && plan gcloud storage buckets create "gs://${BUCKET}" --location="$REGION" \
  --default-storage-class=STANDARD --uniform-bucket-level-access --public-access-prevention \
  --labels="${MERKE_NOKKEL}=${MERKE}" "${G[@]}"
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
