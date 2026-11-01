# Aktiveringspakke: kvitteringsfiler (B)

**Status:**

- Koden er merget (#98, `7aabb81`). Webappen er publisert med filfunksjonen **AV** (`production.yml`, run 41264129477).
- **Ingenting i denne pakken er utført.** Denne leveransen har ikke opprettet eller endret noen tjeneste, bøtte, IAM-binding, regel eller rewrite. Hva prosjektet faktisk inneholder i dag, er ikke uavhengig verifisert.

**Godkjenning:**

- Pakken skal gjennomgås av Kontrolltårnet før Helen involveres.
- Hvert operatørsteg krever Helens samlede, konkrete godkjenning (#59 6546642665).
- Ingen sikkerhets- eller driftsendring gjøres automatisk.
- Pakken gir ingen generell fullmakt til nye driftstiltak.

**Tegnforklaring for kildestatus:**

- **[kilde]** betyr at forholdet er verifisert i offisiell kilde, med lenke, av hvem og dato.
- **[repo]** betyr at forholdet er bevist i dette repoet eller i drift som allerede kjører.
- **[ukjent]** betyr at forholdet ikke er avklart, og hvordan det avklares står i teksten.

## 1. Hva som aktiveres

- **Vedleggstjenesten** (`mcp-server/src/vedlegg/`) er en egen Cloud Run-tjeneste. Den har eget image (`mcp-server/Dockerfile.vedlegg`), egen runtime-SA og ingen kode delt med MCP-tjenesten i kjøretid.
- **Tilgang** sjekkes i appen per forespørsel. Firebase ID-tokenet verifiseres med tilbakekallingssjekk, og brukeren må stå i dagens `families/{f}/members/{uid}` for familien i stien. Dette gjelder uansett om Cloud Run har Invoker-sjekk eller ikke. Tjenesten skriver aldri til RTDB.
- **Lagring:**
  - Bare originalbytes i formatene JPEG, PNG, WebP og PDF.
  - Signatur og størrelse sjekkes på serveren.
  - Hvert objekt lagres innholdsadressert i `families/{f}/kvitteringer/{receiptId}/{sha256}` med `ifGenerationMatch: 0`, altså bare opprettelse.
  - Ingen sletting, og ingen URL-er lagres.
- **Klienten** viser filkontrollene bare når bygget har `VITE_VEDLEGG_TJENESTE=aktiv`. Metadata legges i `receipts[].vedlegg`.

## 2. Forhold som er avklart

**Hosting og Cloud Run**

- **Hosting → Cloud Run har tidsavbrudd på 60 s og støtter europe-west1.** [kilde] https://firebase.google.com/docs/hosting/cloud-run, verifisert av Kontrolltårnet (#59 6552127924). Siden er ikke nåbar fra Claude-økten.
- **Hosting-guiden sier at tjenesten skal tillate kall uten autentisering** (unauthenticated invocation). [kilde] Samme side, verifisert av Kontrolltårnet (#99, review 5726242152).
- **Kall uten Invoker-sjekk:** `--no-invoker-iam-check` er dokumentert, og å slå det på eller av krever `run.services.create`/`update`/`setIamPolicy`. [kilde] https://docs.cloud.google.com/run/docs/authenticating/public, verifisert av Kontrolltårnet (review 5726242152).
- **Cloud Run tar imot request på maks 32 MiB (HTTP/1) og har request-tidsavbrudd på maks 60 min.** Bak Hosting gjelder likevel 60 s. [kilde] https://docs.cloud.google.com/run/quotas, verifisert av Kontrolltårnet (6552127924).

**Firebase Auth**

- **`checkRevoked` krever `firebaseauth.users.get`.** `verifyIdToken(token, true)` kaller `getUser` mot Firebase Auth. [repo] `firebase-admin` 14.5.0, `lib/auth/base-auth.d.ts` og `base-auth.js`.
  - GetAccountInfo krever `firebaseauth.users.get`. [kilde] https://docs.cloud.google.com/identity-platform/docs/access-control, verifisert av Work 2026-11-01 (review 5726242152).
  - **`roles/firebaseauth.viewer` inneholder `firebaseauth.users.get`.** [kilde] https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth, verifisert av Work 2026-11-01 (review 5726242152).

**Priser** (Claude hentet sidene 2026-11-01 fra cloud.google.com; brukt i avsnitt 9)

- **GCS Standard, regional europe-west1, koster $0.02 per GiB-måned** ($0.000027397 per GiB-time). [kilde] https://cloud.google.com/storage/pricing, lest fra sidens innebygde regiontabell «Belgium (europe-west1)», Data storage.
- **GCS-operasjoner koster $0.005 per 1 000 (Class A) og $0.0004 per 1 000 (Class B).** Always Free gjelder bare i US-regioner. [kilde] Samme side, 2026-10-31 (#59 6541616036).
- **Data fra GCS til en Google Cloud-tjeneste på samme sted er gratis** («Data moves within the same location … free»). [kilde] Samme side.
- **Cloud Run i europe-west1 er Tier 1.** [kilde] https://cloud.google.com/run/pricing
  - Med request-basert fakturering koster CPU $0.000024 per vCPU-s, minne $0.0000025 per GiB-s og forespørsler $0.40 per million.
  - Gratisnivået per billing-konto og måned er 180 000 vCPU-s, 360 000 GiB-s og 2 mill. forespørsler.
  - Data til Google Cloud-ressurser i samme region er gratis.
  - Utgående internett-trafikk faktureres etter Google Cloud networking-priser (Premium Tier), med 1 GiB gratis innen Nord-Amerika.
- **Internett-trafikk ut, Premium Tier, til Europa koster $0.12 per GiB for 1–1 024 GiB**, og første GiB er gratis. [kilde] https://cloud.google.com/vpc/network-pricing. Tallet er fra sidens standardvisning, og kilderegionen for visningen er ikke bekreftet.
- **Artifact Registry-lagring er gratis opp til 0,5 GiB per billing-konto.** Over det koster den $0.000136986 per GiB-time, omtrent $0.10 per GiB-måned. Data på samme sted er gratis. [kilde] https://cloud.google.com/artifact-registry/pricing

**Prosjektet**

- **Prosjekt, prosjektnummer og region:** `familieapp-a5d15`, `1075494790067`, europe-west1. [repo] `infra/gcp/mcp-bootstrap.sh`, `deploy-mcp-cloudrun.yml`
- **RTDB:** `https://familieapp-a5d15-default-rtdb.europe-west1.firebasedatabase.app`. [repo] `deploy-mcp-cloudrun.yml`
- **RTDB-lesing fra Cloud Run-SA:** forhåndsdefinert `roles/firebasedatabase.viewer` på prosjektet virker i drift (MCP-lesefasen). En egendefinert rolle ga `permission_denied` av **ukjent årsak** (#27/#88). Det er ingen konklusjon om egendefinerte roller generelt. [repo] `mcp-bootstrap.sh` og kommentaren i `deploy-mcp-cloudrun.yml`
- **Mønsteret skall først, så kode:**
  - Prosjekteier oppretter tjenesteskallet én gang med `--no-invoker-iam-check` og `--ingress=internal`.
  - Deployidentiteten har bare `roles/run.developer` **på tjenesten**. Den oppdaterer image og env og setter `--ingress=all`, men sender ingen Invoker-flagg. Det virker i drift for MCP. [repo] `mcp-bootstrap.sh`, `deploy-mcp-cloudrun.yml`
- **Artifact Registry, WIF og deployidentitet:**
  - Repoet `hverdagsflyt` ligger i europe-west1.
  - WIF-poolen `github` med provider `familieapp` godtar bare dette repoet, `main` og environment `mcp-production`.
  - Deployidentiteten er `hverdagsflyt-mcp-deployer@…`.
  - [repo] `mcp-bootstrap.sh`

## 3. Forhold som ikke er avklart

- **U1. Om Hosting har en egen grense for request-body mot Cloud Run.**
  - Er grensen lavere enn `VEDLEGG_MAKS_BYTES` (10 MiB), stoppes autentiserte opplastinger før tjenesten.
  - Et kall uten token **beviser ikke** grensen: tjenesten avviser før body leses og kan svare før hele overføringen er ferdig.
  - **Uavklart** til det enten finnes en offisiell kilde, eller en autentisert opplasting er testet i et **eksplisitt godkjent, separat testmiljø** (avsnitt 8).
  - Filfunksjonen aktiveres ikke på et antatt bevis. Alternativet er å sette `VEDLEGG_MAKS_BYTES` og `MAKS_FILBYTES` lavt nok til at en dokumentert grense ikke kan treffes.
- **U2. Om billing er aktiv.**
  - Cloud Run kjører allerede (MCP), og det er en sterk indikasjon.
  - Avklares med lesesteg L1.
- **U3. Prosjektets faktiske IAM- og org-policy.**
  - Det gjelder for eksempel begrensninger på `allUsers`, ingress eller kall uten Invoker-sjekk.
  - Kildene sier hva Cloud Run _støtter_. Om prosjektet tillater det for en ny tjeneste, er ukjent.
  - At MCP kjører slik i dag, er en indikasjon, ikke en garanti.
  - Viser seg i O1 (tørrkjøringen lister kallene). Feiler et kall, stopper skriptet.
- **U4. Om Hosting-deployidentiteten** (`FIREBASE_SERVICE_ACCOUNT` i `production.yml`) **kan deploye en rewrite til Cloud Run.**
  - Avklares med lesesteg L2: identitetens roller.
  - Ellers viser det seg ved første deploy med rewrite, og da rulles det tilbake ved revert av R3.
- **U5. GCS-adapteren mot ekte bøtte** (`ifGenerationMatch: 0`, 412 og 404).
  - Kontrakten er testet mot det falske lageret.
  - Adapteren har en **offline kontrakttest** (`mcp-server/src/vedlegg/gcsObjektlager.test.ts`). Den bruker det ekte `@google-cloud/storage`-SDK-et (8.2.0, samme kopi som firebase-admin) mot en lokal, falsk JSON-API-server, og sjekker:
    - at opplastingen faktisk sender `ifGenerationMatch=0`;
    - at sjekksummene valideres;
    - at 412 gir «fantes» uten overskriving, og 404 gir null;
    - at typen bestemmes av bytene;
    - at andre feil (403) kastes videre.
  - Testen feiler hvis betingelsen eller 412-/404-håndteringen fjernes. Den er **ikke** ekte bøtteskriving og erstatter ikke uavhengig runtimeverifikasjon mot en ekte bøtte.
  - Avklares bare med separat testmiljø og eksplisitt autorisasjon (avsnitt 8). Ingen prøveskriving i produksjon.
- **U6. Kostnadsposter uten verifisert sats eller måling.** Se avsnitt 9.

## 4. Bøtte: anbefaling

**Anbefalt: en egen bøtte** `familieapp-a5d15-kvitteringer` i europe-west1, Standard. Den har uniform bucket-level access og public access prevention _enforced_, og den kobles ikke til Firebase Storage.

- Ingen klient har noen vei inn, verken via Firebase Storage-regler eller via CORS. Bare runtime-SA-en har tilgang, og bare på denne bøtta.
- Det trengs ingen Storage-regler, så ingen regelfil kan gli eller deployes feil.
- Uavhengig av Firebase-standardbøtta. Derfor trengs det ikke noe lesesteg for den.
- Bøttenavn er globale. Er navnet tatt, velges et annet, og `VEDLEGG_BUCKET` følger med.

## 5. Tilgang: nøyaktig

**Runtime-SA** `hverdagsflyt-vedlegg@familieapp-a5d15.iam.gserviceaccount.com` (ny)

- `roles/storage.objectCreator`, **bare på bøtta**: opprette objekter. Det gir ingen overskriving eller sletting, i tråd med `ifGenerationMatch: 0`.
- `roles/storage.objectViewer`, **bare på bøtta**: lese objekter ved autentisert nedlasting.
- `roles/firebasedatabase.viewer`, på prosjektet (samme som MCP-lesefasen): lese `families/{f}/members/{uid}`.
- `roles/firebaseauth.viewer`, på prosjektet: `firebaseauth.users.get` for tilbakekallingssjekken. [kilde] avsnitt 2.

Runtime-SA-en får ingen sletterett, ingen skriving til RTDB og ingenting annet på prosjektnivå.

**Kall fra Hosting.** Dette er en endring av tjenestens tilgangspolicy, og den gjøres **bare** i operatørsteget O1:

- Skallet `hverdagsflyt-vedlegg` opprettes av prosjekteier i `vedlegg-bootstrap.sh`, med `--no-invoker-iam-check --ingress=internal` og et plassholder-image. Det krever rettighetene i avsnitt 2 (run.services.create/setIamPolicy), som prosjekteier har.
- Deployidentiteten får **ikke** `run.admin` eller `setIamPolicy`.
- Kildefakta er at Hosting-guiden ber om kall uten autentisering, og at flagget finnes og krever disse rettighetene. Om prosjektets policy tillater det for en ny tjeneste, er ukjent (U3).
- Appens egen sjekk (Firebase ID-token pluss medlemskap) gjelder uansett. Uten Invoker-sjekk er også `*.run.app`-URL-en nåbar direkte, men den gir samme 401 og 403 som via Hosting.

**Deploy av kode** (R2, etter O1)

- Gjenbruker `hverdagsflyt-mcp-deployer@…` og WIF-oppsettet uendret (environment `mcp-production`).
- To nye, smale bindinger settes i O1:
  - `roles/run.developer` **på tjenesten `hverdagsflyt-vedlegg`**;
  - `roles/iam.serviceAccountUser` **på den nye runtime-SA-en**.
- Workflowen oppdaterer bare image, env og `--ingress=all`, slik MCP-workflowen gjør. Den sender ingen Invoker- eller IAM-flagg.
- AR-repoet `hverdagsflyt` gjenbrukes. Deployidentiteten har allerede `artifactregistry.writer` der.
- Ingen endring i WIF-attributtbetingelsen.

## 6. Lese- og operatørsteg

Bare steg som trengs, i rekkefølge.

**L: bare lesing** (Helen eller Kontrolltårnet, Cloud Shell)

```bash
# L1 billing (U2)
gcloud billing projects describe familieapp-a5d15 --format='value(billingEnabled,billingAccountName)'
# L2 Hosting-deployidentitetens roller (U4). E-posten står i FIREBASE_SERVICE_ACCOUNT-JSON-en («client_email»).
gcloud projects get-iam-policy familieapp-a5d15 --flatten='bindings[].members' \
  --filter='bindings.members:serviceAccount:<client_email>' --format='value(bindings.role)'
```

**R: repo-PR-er** (Claude, reviewes av Kontrolltårnet)

R-PR-ene har ingen driftsvirkning før de kjøres eller merges som beskrevet. De kjøres ikke, og gir ingen rettigheter, uten samlet godkjenning.

- **R1:** `infra/gcp/vedlegg-bootstrap.sh` etter mønsteret fra `mcp-bootstrap.sh`.
  - Tørrkjøring som standard, idempotent, og vokter prosjektnummeret.
  - Innhold:
    - bøtta (avsnitt 4);
    - runtime-SA med rollene i avsnitt 5;
    - skallet med `--no-invoker-iam-check --ingress=internal`;
    - de to deploybindingene.
- **R2:** `.github/workflows/deploy-vedlegg-cloudrun.yml`.
  - Startes manuelt, bare fra `main`, med environment `mcp-production` og eksplisitt bekreftelse.
  - Bygger `Dockerfile.vedlegg`, røyktester og pusher imaget.
  - Kjører deretter `gcloud run deploy hverdagsflyt-vedlegg` med:
    - `--service-account`;
    - `--env-vars-file`: `FIREBASE_DATABASE_URL`, `VEDLEGG_LAGER=gcs`, `VEDLEGG_BUCKET`, `VEDLEGG_ALLOW_PRODUCTION=true`, og **ingen** emulatorvariabler;
    - `--cpu=1 --memory=512Mi --min-instances=0 --max-instances=2 --concurrency=10 --timeout=60s --ingress=all`.
  - **Ingen Invoker- eller IAM-flagg.** Til slutt kjører den den skrivefrie kontrollen 7a.
- **R3:** Hosting-rewrite i `firebase.json`: `{ "source": "/api/vedlegg/**", "run": { "serviceId": "hverdagsflyt-vedlegg", "region": "europe-west1" } }` **foran** `**`. Den merges først når tjenesten finnes.
- **R4:** `VITE_VEDLEGG_TJENESTE: aktiv` i byggesteget i `production.yml`. Den er egen og merges sist, og først når U1 og U5 er avklart.

**O: operatør** (prosjekteier, etter Helens samlede godkjenning)

- **O1:** `bash infra/gcp/vedlegg-bootstrap.sh` (tørrkjøring). Les utskriften, og kjør så med `--apply`.
- **O2:** Budsjettvarsel på billing-kontoen, for eksempel $5 per måned.

**Release** (Kontrolltårnet eller Helen dispatcher, i rekkefølge)

1. Kjør `deploy-vedlegg-cloudrun.yml` (R2) på `main`.
2. Merg R3 og kjør `production.yml`. Rewriten er da aktiv, men filkontrollene er fortsatt AV.
3. Den skrivefrie kontrollen 7a gjennom Hosting-domenet.
4. Når U1 og U5 er avklart: merg R4 og kjør `production.yml`. Filkontrollene er nå PÅ.
5. Skrivefri etterkontroll (7b).

## 7. Kontroller uten skriving

**7a. Rute og avvisning.** Små kall uten token. Ingenting lagres, og RTDB røres ikke. Kontrollen bekrefter **ikke** body-grensen (U1).

```bash
B=https://familieapp-a5d15.web.app   # og direkte *.run.app-URL
curl -s -o /dev/null -w '%{http_code}\n' -X POST --data-binary 'x' "$B/api/vedlegg/x/y"
#   forventet 401 (tjenesten svarer, ikke index.html)
curl -s -D - -o /dev/null "$B/api/vedlegg/x/y/$(printf '0%.0s' {1..64})" | grep -iE '^HTTP|nosniff|content-type'
#   forventet 401, JSON, nosniff
curl -s -o /dev/null -w '%{http_code}\n' "$B/api/vedlegg/x"   # forventet 401 eller 400, ikke index.html (200)
```

**7b. Etterkontroll av data:** `forvaltning_cutover_kontroll` før og etter release. Tellinger og digester for `receipts`, `hendelser`, `transaksjoner` og `rules` skal være uendret. Ingen prøveskriving.

Merk: Claude-økten mangler i dag scopet `forvaltning:read` på connectoren (#59 6552201558). Kontrollen kjøres derfor fra Work, eller etter at scopet er rettet.

**Første ekte bruk** er Helens egen opplasting av en ekte kvittering, etter at U1 og U5 er avklart og 7a og 7b er kjørt. Det er bruk, ikke en test, og det skjer bare når Helen bestemmer det.

## 8. Separat testmiljø (U1, U5)

Ingen skriving til en ekte bøtte og ingen produksjonstest er autorisert. B1 er testet mot emulator og falskt lager.

U1 (body-grensen gjennom Hosting) og U5 (GCS-adapteren) kan bare verifiseres med en autentisert opplasting. Det krever:

- et avklart, separat testmiljø, det vil si eget prosjekt med egen Hosting-side, egen bøtte og egen Auth/RTDB, aldri produksjonens bøtte eller data;
- eksplisitt autorisasjon før utførelse.

Hvordan testmiljøet settes opp, er ikke en del av denne pakken. Er det uønsket, er alternativet for U1 å senke `VEDLEGG_MAKS_BYTES` og `MAKS_FILBYTES` under en kildeverifisert grense når den finnes.

## 9. Kostnad

Det finnes **ingen garantert øvre grense**. Kjente satser er fra avsnitt 2. Bruken er antatt, ikke målt: 50 nye kvitteringer i måneden på 1,5 MB i snitt, og 10 visninger per kvittering. Det gir omtrent 0,73 GiB nedlastet per måned.

| Post                                 | Sats                                                                            | Antatt per måned                     | Status                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| GCS-lagring (etter 5 år ≈ 4,4 GiB)   | $0.02 per GiB-måned                                                             | ≈ $0.09                              | [kilde]                                                                                                                     |
| GCS-operasjoner (50 A, 500 B)        | $0.005 og $0.0004 per 1 000                                                     | < $0.001                             | [kilde]                                                                                                                     |
| GCS → Cloud Run (samme region)       | gratis                                                                          | $0                                   | [kilde]                                                                                                                     |
| Cloud Run CPU, minne og forespørsler | Tier 1-satser. Gratisnivået deles med MCP på samme billing-konto.               | $0 hvis innenfor gratisnivået        | [ukjent] MCP-forbruket er ikke målt. Utenfor gratisnivået koster ~550 forespørsler på under 1 s med 1 vCPU/0,5 GiB < $0.02. |
| Cloud Run → Hosting                  | Om dette regnes som internett-trafikk ut, er ikke avklart                       | 0–0,73 GiB × $0.12                   | [ukjent] Satsen for internett ut er [kilde] med 1 GiB gratis, men kilderegionen for visningen er ikke bekreftet.            |
| Hosting → bruker                     | Firebase Hosting-pris (firebase.google.com er ikke nåbar fra økten)             | ukjent                               | [ukjent]                                                                                                                    |
| Artifact Registry (image per deploy) | 0,5 GiB gratis per billing-konto (delt med MCP), deretter ≈ $0.10 per GiB-måned | avhenger av imagestørrelse og antall | [ukjent] Ingen opprydding av gamle image er satt opp. Bygging skjer i GitHub Actions, ikke Cloud Build.                     |
| Billing                              | —                                                                               | —                                    | [ukjent] (U2)                                                                                                               |

Den kjente delen er omtrent $0.09 per måned. Resten skalerer med nedlastet volum og antall image, og har ingen verifisert sats eller måling. **Budsjettvarselet (O2) er derfor en del av pakken**, ikke en forutsetning om lav kostnad.

## 10. Tilbakerulling

| Nivå                   | Tiltak                                                                                                | Virkning                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Skru av filkontrollene | Revert R4 og kjør `production.yml`                                                                    | Filkontrollene forsvinner. Data er urørt.            |
| Koble fra API-et       | Revert R3 og kjør `production.yml`                                                                    | `/api/vedlegg/**` går til `index.html`.              |
| Stopp tjenesten        | `gcloud run services update hverdagsflyt-vedlegg --region=europe-west1 --ingress=internal` (operatør) | Tjenesten kan ikke nås fra internett.                |
| Data                   | Metadata i `receipts` og objektene i bøtta blir liggende. **Ingenting slettes automatisk.**           | Lagrede filer kan kobles på igjen ved ny aktivering. |

Ingen claims, ingen CORS, ingen Storage-regler (egen bøtte), og ingen endring i Auth0, MCP-scopes eller MCP-tjenesten.
