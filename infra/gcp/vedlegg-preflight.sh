#!/usr/bin/env bash
# Skrivefri førtilstand for vedleggstjenesten (#59 B; docs/drift/kvitteringsvedlegg.md).
# INAKTIV KODE: kjøres av prosjekteier (eller den som får lesetilgang) i Cloud Shell,
# FØR vedlegg-bootstrap.sh. Skriptet ENDRER INGENTING: bare describe, list og
# get-iam-policy. Svarene skrives ut; tolkning og beslutning skjer i review.
#
#   bash infra/gcp/vedlegg-preflight.sh
#   HOSTING_SA_EMAIL=<client_email> bash infra/gcp/vedlegg-preflight.sh   # se U4
#
# Hvert svar er finnes | mangler (positiv ikke-funnet-melding) | ukjent (avslag,
# deaktivert API, tidsavbrudd, formatfeil, ukjent feil). «Ukjent» er aldri
# «finnes ikke».
#
#  L1/U2  Billing.
#  R1     Cloud Storage-API, MCP-oppsett (AR-repo, deployidentitet, WIF-provider),
#         og om bøtte, kjøretidsidentitet eller tjeneste finnes fra før (bøtta også
#         om den tilhører prosjektet).
#  L2/U4  Hosting-deployidentiteten. Hemmeligheten FIREBASE_SERVICE_ACCOUNT leses
#         IKKE. `github-action-*`-kontoer listes som KANDIDATER med roller. En unik
#         kandidat er ikke bevis for koblingen, så U4 forblir ukjent til operatøren
#         oppgir bare «client_email» (HOSTING_SA_EMAIL) eller koblingen er
#         verifisert fra en trygg konfigkilde.
#  U3     Effektive org-policyer for de begrensningene som kan stoppe bootstrap,
#         lest enkeltvis med --effective. Kan en ikke leses, står den som ukjent.
#         Arvede policyer utover disse er ikke kartlagt.
set -uo pipefail
# shellcheck source=infra/gcp/vedlegg-felles.sh
. "$(dirname "${BASH_SOURCE[0]}")/vedlegg-felles.sh"
G=(--project="$PROJECT_ID")

svar() { printf '  %-36s %s\n' "$1" "$2"; }
# Leser i GJELDENDE skall (ikke subshell) og setter TEKST for utskrift.
tilstand() {
  les "$@"
  case "$LES_TILSTAND" in
    finnes) TEKST="finnes" ;;
    mangler) TEKST="finnes ikke" ;;
    *) TEKST="UKJENT ($(kort "$LES_UT"))" ;;
  esac
}

echo "== Prosjekt"
les gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)'
if [ "$LES_TILSTAND" != finnes ] || [ "$LES_UT" != "$PROJECT_NUMBER" ]; then
  svar "prosjektnummer" "UKJENT/AVVIK ($(kort "$LES_UT"))"
  echo "STOPP: feil prosjekt eller ingen lesetilgang. Ingenting mer leses." >&2
  exit 1
fi
svar "prosjektnummer" "$LES_UT (som forventet)"

echo "== L1/U2 Billing"
les gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)'
[ "$LES_TILSTAND" = finnes ] && svar "billingEnabled" "$LES_UT" ||
  svar "billingEnabled" "UKJENT ($(kort "$LES_UT"))"

echo "== R1 API og MCP-oppsett (gjenbrukes, endres ikke)"
les gcloud services list --enabled "${G[@]}" --format='value(config.name)'
if [ "$LES_TILSTAND" = finnes ]; then
  grep -qx 'storage.googleapis.com' <<<"$LES_UT" && svar "Cloud Storage-API" "aktivert" ||
    svar "Cloud Storage-API" "IKKE aktivert (bootstrap stopper; eget godkjent steg)"
else
  svar "Cloud Storage-API" "UKJENT ($(kort "$LES_UT"))"
fi
tilstand gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" "${G[@]}" --format='value(name)'
svar "AR-repo $AR_REPO" "$TEKST"
tilstand gcloud iam service-accounts describe "$DEPLOY_SA" "${G[@]}" --format='value(email)'
svar "deployidentitet" "$TEKST"
tilstand gcloud iam workload-identity-pools providers describe familieapp \
  --workload-identity-pool=github --location=global "${G[@]}" --format='value(name)'
svar "WIF-provider github/familieapp" "$TEKST"

echo "== R1 Vedleggsressurser (skal normalt ikke finnes ennå)"
les gcloud storage buckets list "${G[@]}" --format='value(name)'
if [ "$LES_TILSTAND" != finnes ]; then
  svar "bøtte gs://${BUCKET}" "UKJENT (prosjektets bøtter kan ikke listes: $(kort "$LES_UT"))"
elif grep -qx "$BUCKET" <<<"$LES_UT"; then
  les gcloud storage buckets describe "gs://${BUCKET}" "${G[@]}" \
    --format="value(location,uniform_bucket_level_access,public_access_prevention,labels.${MERKE_NOKKEL})"
  [ "$LES_TILSTAND" = finnes ] && svar "bøtte gs://${BUCKET}" "i prosjektet: $(tr '\t' ' ' <<<"$LES_UT")" ||
    svar "bøtte gs://${BUCKET}" "i prosjektet, men UKJENT ($(kort "$LES_UT"))"
else
  les gcloud storage buckets describe "gs://${BUCKET}" "${G[@]}" --format='value(name)'
  case "$LES_TILSTAND" in
    mangler) svar "bøtte gs://${BUCKET}" "finnes ikke" ;;
    finnes) svar "bøtte gs://${BUCKET}" "FINNES UTENFOR PROSJEKTET (bootstrap stopper)" ;;
    *) svar "bøtte gs://${BUCKET}" "UKJENT ($(kort "$LES_UT"))" ;;
  esac
fi
tilstand gcloud iam service-accounts describe "$RUNTIME_SA" "${G[@]}" --format='value(description)'
[ "$LES_TILSTAND" = finnes ] && TEKST="finnes: beskrivelse='$LES_UT'"
svar "kjøretidsidentitet" "$TEKST"
tilstand gcloud run services describe "$SERVICE" --region="$REGION" "${G[@]}" \
  --format="value(metadata.labels.${MERKE_NOKKEL},spec.template.spec.serviceAccountName)"
[ "$LES_TILSTAND" = finnes ] && TEKST="finnes: $(tr '\t' ' ' <<<"$LES_UT")"
svar "tjeneste $SERVICE" "$TEKST"

echo "== L2/U4 Hosting-deployidentitet (hemmeligheten leses ikke)"
roller() {
  les gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' \
    --filter="bindings.members:serviceAccount:$1" --format='value(bindings.role)'
  [ "$LES_TILSTAND" = finnes ] && tr '\n' ' ' <<<"${LES_UT:-ingen prosjektroller}" ||
    echo "UKJENT ($(kort "$LES_UT"))"
}
les gcloud iam service-accounts list "${G[@]}" --filter='email~^github-action-' --format='value(email)'
if [ "$LES_TILSTAND" != finnes ]; then
  svar "github-action-*-kandidater" "UKJENT (leseavslag eller feil: $(kort "$LES_UT"))"
else
  kandidater=$LES_UT
  svar "github-action-*-kandidater" "$(grep -c . <<<"$kandidater" || true) (kandidater, IKKE bevist kobling)"
  while read -r e; do
    [ -n "$e" ] && svar "  kandidat $e" "$(roller "$e")"
  done <<<"$kandidater"
fi
if [ -n "${HOSTING_SA_EMAIL:-}" ]; then
  svar "oppgitt client_email" "$HOSTING_SA_EMAIL (oppgitt av operatør)"
  svar "  roller" "$(roller "$HOSTING_SA_EMAIL")"
else
  echo "  U4 UKJENT: koblingen mellom FIREBASE_SERVICE_ACCOUNT og en konto er ikke bevist."
  echo "  Minste opplysning som mangler: «client_email» fra hemmeligheten (ikke nøkkelen),"
  echo "  oppgitt som HOSTING_SA_EMAIL av den som eier hemmeligheten."
fi

echo "== U3 Effektive org-policyer (enkeltvis; arvede policyer utover disse er ikke kartlagt)"
for c in iam.disableServiceAccountCreation gcp.resourceLocations run.allowedIngress \
  run.managed.requireInvokerIam storage.publicAccessPrevention storage.uniformBucketLevelAccess \
  iam.allowedPolicyMemberDomains; do
  les gcloud org-policies describe "$c" --effective "${G[@]}" --format=json
  if [ "$LES_TILSTAND" = finnes ]; then
    svar "$c" "$(tr -d '\n' <<<"$LES_UT" | tr -s ' ' | cut -c1-140)"
  else
    svar "$c" "UKJENT ($(kort "$LES_UT"))"
  fi
done

echo "Ferdig. Ingenting er endret."
