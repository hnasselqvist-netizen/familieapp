#!/usr/bin/env bash
# Skrivefri førtilstand for vedleggstjenesten (#59 B; docs/drift/kvitteringsvedlegg.md).
# Kjøres av prosjekteier (eller den som får lesetilgang) i Cloud Shell, FØR
# vedlegg-bootstrap.sh. Skriptet ENDRER INGENTING: bare describe, list og
# get-iam-policy. Det skriver ut svarene. Tolkningen og beslutningen skjer i
# review, ikke her.
#
#   bash infra/gcp/vedlegg-preflight.sh
#
# Svarer på:
#  L1/U2  Er billing aktiv?
#  L2/U4  Hvilken identitet deployer Hosting, og hvilke roller har den?
#         Hemmeligheten FIREBASE_SERVICE_ACCOUNT leses IKKE. I stedet listes
#         prosjektets tjenestekontoer som `firebase init hosting:github`
#         oppretter (github-action-*), med prosjektroller. Finnes ingen eller
#         flere enn én, står det i utskriften, og det er den minste
#         opplysningen som mangler.
#  U3     Effektive org-policyer som kan stoppe bootstrap (bare listing).
#  R1     Finnes MCP-oppsettet (AR-repo, deployidentitet, WIF-provider), og
#         finnes bøtte, kjøretidsidentitet eller tjeneste fra før? Er de i så fall merket som våre?
set -uo pipefail

PROJECT_ID=familieapp-a5d15
PROJECT_NUMBER=1075494790067
REGION=europe-west1
SERVICE=hverdagsflyt-vedlegg
BUCKET="${VEDLEGG_BUCKET:-familieapp-a5d15-kvitteringer}"
AR_REPO=hverdagsflyt
RUNTIME_SA="hverdagsflyt-vedlegg@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="hverdagsflyt-mcp-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
G=(--project="$PROJECT_ID")

svar() { printf '  %-34s %s\n' "$1" "$2"; }
finnes() { "$@" >/dev/null 2>&1 && echo ja || echo nei; }

echo "== Prosjekt"
nummer=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null || echo "?")
svar "prosjektnummer" "$nummer (forventet $PROJECT_NUMBER)"
if [ "$nummer" != "$PROJECT_NUMBER" ]; then
  echo "STOPP: feil prosjekt eller ingen lesetilgang. Ingenting mer leses." >&2
  exit 1
fi

echo "== L1/U2 Billing"
svar "billingEnabled" "$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null || echo 'ukjent (mangler lesetilgang?)')"

echo "== R1 MCP-oppsett (gjenbrukes, endres ikke)"
svar "AR-repo $AR_REPO" "$(finnes gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" "${G[@]}")"
svar "deployidentitet" "$(finnes gcloud iam service-accounts describe "$DEPLOY_SA" "${G[@]}")"
svar "WIF-provider github/familieapp" "$(finnes gcloud iam workload-identity-pools providers describe familieapp \
  --workload-identity-pool=github --location=global "${G[@]}")"

echo "== R1 Vedleggsressurser (skal normalt ikke finnes ennå)"
if gcloud storage buckets describe "gs://${BUCKET}" "${G[@]}" >/dev/null 2>&1; then
  svar "bøtte gs://${BUCKET}" "finnes: $(gcloud storage buckets describe "gs://${BUCKET}" "${G[@]}" \
    --format='value(location,uniform_bucket_level_access,public_access_prevention,labels.formaal)' | tr '\t' ' ')"
else
  svar "bøtte gs://${BUCKET}" "finnes ikke"
fi
if gcloud iam service-accounts describe "$RUNTIME_SA" "${G[@]}" >/dev/null 2>&1; then
  svar "kjøretidsidentitet" "finnes: beskrivelse='$(gcloud iam service-accounts describe "$RUNTIME_SA" "${G[@]}" --format='value(description)')'"
else
  svar "kjøretidsidentitet" "finnes ikke"
fi
if gcloud run services describe "$SERVICE" --region="$REGION" "${G[@]}" >/dev/null 2>&1; then
  svar "tjeneste $SERVICE" "finnes: $(gcloud run services describe "$SERVICE" --region="$REGION" "${G[@]}" \
    --format='value(metadata.labels.formaal,spec.template.spec.serviceAccountName)' | tr '\t' ' ')"
else
  svar "tjeneste $SERVICE" "finnes ikke"
fi

echo "== L2/U4 Hosting-deployidentitet (kandidater; hemmeligheten leses ikke)"
kandidater=$(gcloud iam service-accounts list "${G[@]}" --filter='email~^github-action-' --format='value(email)' 2>/dev/null || true)
antall=$(grep -c . <<<"$kandidater" || true)
svar "antall github-action-*" "$antall"
while read -r e; do
  [ -n "$e" ] || continue
  roller=$(gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' \
    --filter="bindings.members:serviceAccount:${e}" --format='value(bindings.role)' 2>/dev/null | tr '\n' ' ')
  svar "$e" "${roller:-ingen prosjektroller funnet}"
done <<<"$kandidater"
if [ "$antall" != "1" ]; then
  echo "  MANGLER: entydig Hosting-deployidentitet. Minste opplysning som trengs er"
  echo "  «client_email» i FIREBASE_SERVICE_ACCOUNT. Den kan leses av den som eier hemmeligheten,"
  echo "  uten å dele selve nøkkelen."
fi

echo "== U3 Effektive org-policyer på prosjektet (bare listing)"
gcloud org-policies list "${G[@]}" --format='value(constraint)' 2>/dev/null | sed 's/^/  /' ||
  echo "  ukjent (mangler lesetilgang til org-policyer)"

echo "Ferdig. Ingenting er endret."
