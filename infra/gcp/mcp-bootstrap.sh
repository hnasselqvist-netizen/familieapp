#!/usr/bin/env bash
# Engangsoppsett i GCP for MCP-serveren (Issue #27). Kjøres ÉN gang av
# prosjekteier i Cloud Shell for prosjektet familieapp-a5d15, etter eksplisitt
# Kontrolltårn-beslutning om IAM-minimumet under. Idempotent: kan kjøres på
# nytt uten å lage duplikater. Tørrkjøring som standard:
#
#   bash infra/gcp/mcp-bootstrap.sh            # viser hva som ville blitt gjort
#   bash infra/gcp/mcp-bootstrap.sh --apply    # utfører det
#
# Hva det gir (og ingenting mer):
#  - API-er: Cloud Run, Artifact Registry, IAM, IAM Credentials, STS.
#  - Artifact Registry-repo `hverdagsflyt` (Docker) i europe-west1.
#  - Kjøretidsidentitet hverdagsflyt-mcp@… med KUN roles/firebasedatabase.viewer
#    (lesefasen; skriving er av i koden og i workflowen).
#  - Deployidentitet hverdagsflyt-mcp-deployer@…, uten nøkkel, med:
#      roles/run.developer          KUN på tjenesten hverdagsflyt-mcp
#      roles/artifactregistry.writer KUN på repoet hverdagsflyt
#      roles/iam.serviceAccountUser KUN på kjøretidsidentiteten
#  - Workload Identity Federation: GitHub Actions kan bli deployidentiteten
#    KUN fra hnasselqvist-netizen/familieapp, ref refs/heads/main, environment
#    mcp-production. Ingen andre repoer, brancher eller environments.
#  - Tjenesten hverdagsflyt-mcp opprettes som et IKKE-NÅBART skall:
#    Googles «hello»-image med `--ingress=internal` (kan ikke nås fra
#    internett) og uten Invoker-IAM-sjekk. Den første kjøringen av
#    deploy-workflowen erstatter imaget med MCP-serveren og setter
#    `--ingress=all`. Den første offentlige tjenesten er altså vår egen.
#
#    Hvorfor skallet må finnes på forhånd (Cloud Run/IAM-kontrakten):
#     1. Å slå av Invoker-IAM-sjekken krever run.services.setIamPolicy
#        (roles/run.admin). Den rettigheten skal deployidentiteten ikke ha,
#        så prosjekteier setter den her, én gang. ChatGPT har ingen
#        Google-identitet; autentiseringen skjer i appen med OAuth.
#     2. roles/run.developer kan bare bindes til én tjeneste når tjenesten
#        finnes. Uten skallet måtte deployidentiteten fått run.developer på
#        hele prosjektet.
#
# Ingen nøkkelfiler, ingen hemmeligheter, ingen endring i Realtime Database.
set -euo pipefail

PROJECT_ID=familieapp-a5d15
PROJECT_NUMBER=1075494790067
REGION=europe-west1
SERVICE=hverdagsflyt-mcp
AR_REPO=hverdagsflyt
RUNTIME_SA="hverdagsflyt-mcp@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="hverdagsflyt-mcp-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
POOL=github
PROVIDER=familieapp
GH_REPO=hnasselqvist-netizen/familieapp
GH_ENV=mcp-production
WIF_SUBJECT="repo:${GH_REPO}:environment:${GH_ENV}"
PLACEHOLDER_IMAGE=us-docker.pkg.dev/cloudrun/container/hello

APPLY=false
[ "${1:-}" = "--apply" ] && APPLY=true

run() {
  printf '+ %s\n' "$*"
  if $APPLY; then "$@"; fi
}
exists() { "$@" >/dev/null 2>&1; }

# Nyopprettede tjenestekontoer blir først etter hvert synlige overalt i GCP
# (eventual consistency): IAM-API-et
# kjenner dem straks, men andre tjenesters policyvalidering (observert:
# Artifact Registry, Issue #27 5959253093) kan svare «Service account …
# does not exist» i opptil et par minutter. run_principal gjentar derfor
# KUN den feilen, med avgrenset venting (10 pauser: 5+10+8×20 s ≈ 3 min). Alle
# andre feil stopper skriptet umiddelbart, som før.
run_principal() {
  printf '+ %s\n' "$*"
  $APPLY || return 0
  local attempt=1 max=11 delay=5 out
  while :; do
    if out=$("$@" 2>&1); then
      printf '%s\n' "$out"
      return 0
    fi
    if [ "$attempt" -lt "$max" ] && grep -q "does not exist" <<<"$out"; then
      echo "  … kontoen er ikke synlig ennå (forsøk $attempt/$max), venter ${delay}s"
      sleep "$delay"
      attempt=$((attempt + 1))
      delay=$((delay * 2 > 20 ? 20 : delay * 2))
      continue
    fi
    printf '%s\n' "$out" >&2
    return 1
  done
}

# Vern: riktig prosjekt, og prosjektnummeret som Auth0-identifieren bygger på.
actual_number=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
if [ "$actual_number" != "$PROJECT_NUMBER" ]; then
  echo "Stopp: $PROJECT_ID har prosjektnummer $actual_number, ikke $PROJECT_NUMBER." >&2
  exit 1
fi
G=(--project="$PROJECT_ID" --quiet)

echo "== API-er"
run gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com "${G[@]}"

echo "== Artifact Registry"
exists gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" "${G[@]}" ||
  run gcloud artifacts repositories create "$AR_REPO" --repository-format=docker \
    --location="$REGION" --description="Hverdagsflyt MCP-server (Issue #27)" "${G[@]}"

echo "== Tjenesteidentiteter"
exists gcloud iam service-accounts describe "$RUNTIME_SA" "${G[@]}" ||
  run gcloud iam service-accounts create hverdagsflyt-mcp \
    --display-name="Hverdagsflyt MCP (kjøretid)" "${G[@]}"
exists gcloud iam service-accounts describe "$DEPLOY_SA" "${G[@]}" ||
  run gcloud iam service-accounts create hverdagsflyt-mcp-deployer \
    --display-name="Hverdagsflyt MCP (deploy fra GitHub Actions)" "${G[@]}"

echo "== Kjøretid: kun lesing av Realtime Database"
run_principal gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" --role=roles/firebasedatabase.viewer \
  --condition=None --quiet

echo "== Deploy: actAs kun på kjøretidsidentiteten, push kun til repoet"
run_principal gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/iam.serviceAccountUser "${G[@]}"
run_principal gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" --location="$REGION" \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/artifactregistry.writer "${G[@]}"

echo "== Workload Identity Federation (GitHub OIDC)"
exists gcloud iam workload-identity-pools describe "$POOL" --location=global "${G[@]}" ||
  run gcloud iam workload-identity-pools create "$POOL" --location=global \
    --display-name="GitHub Actions" "${G[@]}"
exists gcloud iam workload-identity-pools providers describe "$PROVIDER" \
  --workload-identity-pool="$POOL" --location=global "${G[@]}" ||
  run gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --workload-identity-pool="$POOL" --location=global \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='${GH_REPO}' && assertion.ref=='refs/heads/main' && assertion.sub=='${WIF_SUBJECT}'" \
    "${G[@]}"
run_principal gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/subject/${WIF_SUBJECT}" \
  "${G[@]}"

echo "== Tjenesteskallet (ikke nåbart fra internett før første ekte deploy)"
exists gcloud run services describe "$SERVICE" --region="$REGION" "${G[@]}" ||
  run_principal gcloud run deploy "$SERVICE" --image="$PLACEHOLDER_IMAGE" --region="$REGION" \
    --service-account="$RUNTIME_SA" --ingress=internal --no-invoker-iam-check \
    --min-instances=0 --max-instances=1 "${G[@]}"
run_principal gcloud run services add-iam-policy-binding "$SERVICE" --region="$REGION" \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/run.developer "${G[@]}"

if $APPLY; then
  echo "== Ferdig. Tjenestens URL-er:"
  gcloud run services describe "$SERVICE" --region="$REGION" "${G[@]}" \
    --format='value(metadata.annotations."run.googleapis.com/urls")'
else
  echo "Tørrkjøring — ingenting er endret. Kjør med --apply for å utføre."
fi
