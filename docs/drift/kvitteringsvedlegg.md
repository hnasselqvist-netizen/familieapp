# Aktiveringspakke: kvitteringsfiler (B)

**Status:**

- Koden er merget (#98, `7aabb81`). Webappen er publisert med filfunksjonen **AV** (`production.yml`, run 41264129477).
- **Ingenting i denne pakken er utført.** Det finnes ingen tjeneste, bøtte, IAM-binding, regel eller rewrite.

**Godkjenning:**

- Pakken skal gjennomgås av Kontrolltårnet før Helen involveres.
- Hvert operatørsteg krever Helens eksplisitte godkjenning (#59 6546642665).
- Ingen sikkerhets- eller driftsendring gjøres automatisk.

**Tegnforklaring for kildestatus:**

- **[kilde]** betyr at forholdet er verifisert i offisiell kilde, med lenke, av hvem og dato.
- **[repo]** betyr at forholdet er bevist i dette repoet.
- **[ukjent]** betyr at forholdet må avklares, og hvordan står i teksten.

## 1. Hva som aktiveres

- **Vedleggstjenesten** (`mcp-server/src/vedlegg/`) er en egen Cloud Run-tjeneste. Den har eget image (`mcp-server/Dockerfile.vedlegg`), egen runtime-SA og ingen kode delt med MCP-tjenesten i kjøretid.
- **Tilgang** sjekkes per forespørsel. Firebase ID-tokenet verifiseres med tilbakekallingssjekk, og brukeren må stå i dagens `families/{f}/members/{uid}` for familien i stien. Tjenesten skriver aldri til RTDB.
- **Lagring:**
  - Bare originalbytes i formatene JPEG, PNG, WebP og PDF.
  - Signatur og størrelse sjekkes på serveren.
  - Hvert objekt lagres innholdsadressert i `families/{f}/kvitteringer/{receiptId}/{sha256}` med `ifGenerationMatch: 0`, altså bare opprettelse.
  - Ingen sletting, og ingen URL-er lagres.
- **Klienten** viser filkontrollene bare når bygget har `VITE_VEDLEGG_TJENESTE=aktiv`. Metadata legges i `receipts[].vedlegg`.

## 2. Forhold som er avklart

| Forhold                                   | Verdi                                                                                                                                                                                                                                          | Status                                                                                                                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting → Cloud Run: tidsavbrudd          | 60 sekunder                                                                                                                                                                                                                                    | [kilde] https://firebase.google.com/docs/hosting/cloud-run, verifisert av Kontrolltårnet (#59 6552127924). Ikke nåbar fra Claude-økten.                                                             |
| Hosting → Cloud Run i europe-west1        | Støttet                                                                                                                                                                                                                                        | [kilde] Samme side og samme verifikasjon.                                                                                                                                                           |
| Cloud Run: maks request (HTTP/1)          | 32 MiB                                                                                                                                                                                                                                         | [kilde] https://docs.cloud.google.com/run/quotas, verifisert av Kontrolltårnet (6552127924).                                                                                                        |
| Cloud Run: maks request-tidsavbrudd       | 60 min. Bak Hosting gjelder likevel 60 s.                                                                                                                                                                                                      | [kilde] Samme.                                                                                                                                                                                      |
| GCS Standard, regional europe-west1       | **$0.02 per GiB-måned** ($0.000027397 per GiB-time)                                                                                                                                                                                            | [kilde] https://cloud.google.com/storage/pricing, hentet av Claude 2026-11-01. Tallet er lest fra sidens innebygde regiontabell for «Belgium (europe-west1)», Data storage, og time-prisen stemmer. |
| GCS operasjoner og nedlasting             | Class A koster $0.005 per 1 000 og Class B $0.0004 per 1 000. Nedlasting til internett koster $0.12 per GiB. Always Free gjelder bare i US-regioner.                                                                                           | [kilde] Samme side, hentet 2026-10-31 (#59 6541616036).                                                                                                                                             |
| Cloud Run-pris i europe-west1             | Tier 1. Med request-basert fakturering (standard) koster CPU $0.000024 per vCPU-s, minne $0.0000025 per GiB-s og forespørsler $0.40 per million. Gratisnivå per billing-konto og måned: 180 000 vCPU-s, 360 000 GiB-s og 2 mill. forespørsler. | [kilde] https://cloud.google.com/run/pricing, hentet av Claude 2026-11-01. Gratisnivået deles med MCP-tjenesten (samme billing-konto).                                                              |
| Prosjekt, prosjektnummer og region        | `familieapp-a5d15`, `1075494790067`, europe-west1                                                                                                                                                                                              | [repo] `infra/gcp/mcp-bootstrap.sh`, `deploy-mcp-cloudrun.yml`                                                                                                                                      |
| RTDB                                      | `https://familieapp-a5d15-default-rtdb.europe-west1.firebasedatabase.app`                                                                                                                                                                      | [repo] `deploy-mcp-cloudrun.yml`                                                                                                                                                                    |
| Lesetilgang til RTDB fra Cloud Run-SA     | `roles/firebasedatabase.viewer` på prosjektet virker (MCP-lesefasen). En egendefinert rolle ble avvist av RTDB.                                                                                                                                | [repo] `mcp-bootstrap.sh` og kommentaren i `deploy-mcp-cloudrun.yml` (#27)                                                                                                                          |
| Artifact Registry, WIF og deployidentitet | Repoet `hverdagsflyt` ligger i europe-west1. WIF-poolen `github` med provider `familieapp` godtar bare repo, `main` og environment `mcp-production`. Deployidentiteten er `hverdagsflyt-mcp-deployer@…`.                                       | [repo] `mcp-bootstrap.sh`                                                                                                                                                                           |
| `checkRevoked` gjør et ekstra kall        | `verifyIdToken(token, true)` kaller `getUser` mot Firebase Auth                                                                                                                                                                                | [repo] `firebase-admin` 14.5.0: `lib/auth/base-auth.d.ts` («requires an extra request to the Firebase Auth backend») og `base-auth.js` (`this.getUser(decodedIdToken.sub)`).                        |

## 3. Forhold som ikke er avklart

| #   | Forhold                                                                                                           | Hvorfor det betyr noe                                                                                                                                                 | Hvordan det avklares                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Om Hosting har en egen grense for request-body mot Cloud Run                                                      | Er grensen lavere enn `VEDLEGG_MAKS_BYTES` (10 MiB), svarer Hosting før tjenesten.                                                                                    | Kilde, hvis den finnes. Ellers en skrivefri kontroll etter release (steg 7a): en stor POST **uten token** skal gi tjenestens 401 og ikke 413 fra Hosting. Ingenting lagres, fordi tjenesten avviser før den leser body. |
| U2  | Om billing er aktiv på prosjektet                                                                                 | Cloud Run kjører allerede (MCP), og det er en sterk indikasjon.                                                                                                       | Lesesteg L1                                                                                                                                                                                                             |
| U3  | Om bøtta `familieapp-a5d15.firebasestorage.app` finnes, og hvilken region den har                                 | Avgjør valget i avsnitt 4.                                                                                                                                            | Lesesteg L2                                                                                                                                                                                                             |
| U4  | Rollen som trengs for `getUser`                                                                                   | Uten den feiler alle forespørsler med 401. Det er trygt (lukket), men tjenesten virker ikke.                                                                          | Forslag: `roles/firebaseauth.viewer`. Rollenavnet er ikke kildeverifisert fra økten. Kontrolltårnet eller Helen bekrefter det i IAM-dokumentasjonen.                                                                    |
| U5  | Om Hosting krever at tjenesten tillater kall uten Google-identitet                                                | Hosting sender ikke ID-token for Google-identitet. Uten Invoker-sjekk er også `*.run.app`-URL-en nåbar direkte, men alle forespørsler autentiseres i appen (som MCP). | Bekreftes i https://firebase.google.com/docs/hosting/cloud-run. Planen under antar at det kreves, med samme oppsett som MCP: `--no-invoker-iam-check`.                                                                  |
| U6  | Om Hosting-deployidentiteten (`FIREBASE_SERVICE_ACCOUNT` i `production.yml`) kan deploye en rewrite til Cloud Run | Feiler den, feiler web-deployen, og rewriten kommer ikke på plass.                                                                                                    | Lesesteg L3 (identitetens roller). Ellers viser det seg ved første deploy med rewrite, og da rulles det tilbake ved revert.                                                                                             |
| U7  | GCS-adapteren mot en ekte bøtte (`ifGenerationMatch: 0`, 412 og 404)                                              | Kontrakten er testet mot det falske lageret. Adapteren er bare typekontrollert.                                                                                       | Bare med separat testmiljø og eksplisitt autorisasjon. Se avsnitt 8. Ingen prøveskriving i produksjon.                                                                                                                  |

## 4. Bøtte: anbefaling

**Anbefalt: en egen bøtte** `familieapp-a5d15-kvitteringer` i europe-west1, Standard. Den har uniform bucket-level access og public access prevention _enforced_, og den kobles ikke til Firebase Storage.

- Ingen klient har noen vei inn, verken via Firebase Storage-regler eller via CORS. Bare runtime-SA-en har tilgang, og bare på denne bøtta.
- Det trengs ingen Storage-regler, så ingen regelfil kan gli eller deployes feil.
- Uavhengig av U3.
- Bøttenavn er globale. Er navnet tatt, velges et annet, og `VEDLEGG_BUCKET` følger med.

Alternativet er Firebase-standardbøtta, hvis L2 viser at den finnes i europe-west1. Da trengs i tillegg Storage-regelen «alt nektes», deployet manuelt. Jeg anbefaler det ikke.

## 5. Tilgang: nøyaktig

**Runtime-SA** `hverdagsflyt-vedlegg@familieapp-a5d15.iam.gserviceaccount.com` (ny):

| Rolle                            | Omfang                       | Hvorfor                                                                                          |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `roles/storage.objectCreator`    | **Bare bøtta**               | Opprette objekter. Det gir ingen overskriving eller sletting, i tråd med `ifGenerationMatch: 0`. |
| `roles/storage.objectViewer`     | **Bare bøtta**               | Lese objekter ved autentisert nedlasting.                                                        |
| `roles/firebasedatabase.viewer`  | Prosjekt (som MCP-lesefasen) | Lese `families/{f}/members/{uid}`.                                                               |
| `roles/firebaseauth.viewer` (U4) | Prosjekt                     | `getUser` i tilbakekallingssjekken.                                                              |

Ingen sletterett, ingen skriving til RTDB og ingenting annet på prosjektnivå.

**Hosting → tjenesten** (U5):

- Tjenesten settes opp med `--ingress=all` og `--no-invoker-iam-check`, som MCP.
- Autentiseringen skjer i tjenesten: Firebase ID-token pluss medlemskap.

**Deploy:** gjenbruk av `hverdagsflyt-mcp-deployer@…` og WIF-oppsettet uendret (environment `mcp-production`). Bare to nye, smale bindinger trengs:

- `roles/run.developer` **på tjenesten `hverdagsflyt-vedlegg`**;
- `roles/iam.serviceAccountUser` **på den nye runtime-SA-en**.

AR-repoet `hverdagsflyt` gjenbrukes, og deployidentiteten har allerede `artifactregistry.writer` der. Det gir ingen endring i WIF-attributtbetingelsen.

## 6. Lese- og operatørsteg

Rekkefølgen gjelder. Hvert steg er merket med hvem som gjør det.

**L: bare lesing** (Helen eller Kontrolltårnet, Cloud Shell)

```bash
# L1 billing
gcloud billing projects describe familieapp-a5d15 --format='value(billingEnabled,billingAccountName)'
# L2 standardbøtta (finnes? region?)
gcloud storage buckets describe gs://familieapp-a5d15.firebasestorage.app --format='value(location,storageClass)'
# L3 Hosting-deployidentitetens roller (U6). E-posten står i FIREBASE_SERVICE_ACCOUNT-JSON-en («client_email»).
gcloud projects get-iam-policy familieapp-a5d15 --flatten='bindings[].members' \
  --filter='bindings.members:serviceAccount:<client_email>' --format='value(bindings.role)'
```

**R: repo-PR-er** (Claude, reviewes av Kontrolltårnet, uten driftsvirkning før de kjøres)

- **R1:** `infra/gcp/vedlegg-bootstrap.sh` etter mønsteret fra `mcp-bootstrap.sh`. Den gjør tørrkjøring som standard, er idempotent og vokter prosjektnummeret. Den inneholder nøyaktig avsnitt 4 og 5, med et skall på `--ingress=internal` som i MCP.
- **R2:** `.github/workflows/deploy-vedlegg-cloudrun.yml`. Den startes manuelt, bare fra `main`, med environment `mcp-production` og eksplisitt bekreftelse. Den bygger `Dockerfile.vedlegg`, røyktester og pusher imaget. Deretter kjører den `gcloud run deploy hverdagsflyt-vedlegg` med:
  - `--service-account`;
  - `--env-vars-file`: `FIREBASE_DATABASE_URL`, `VEDLEGG_LAGER=gcs`, `VEDLEGG_BUCKET`, `VEDLEGG_ALLOW_PRODUCTION=true`, og **ingen** emulatorvariabler;
  - `--cpu=1 --memory=512Mi --min-instances=0 --max-instances=2 --concurrency=10 --timeout=60s --ingress=all`.

  Workflowen endrer ingen IAM. Til slutt kjører den den skrivefrie verifikasjonen i 7a.

- **R3:** Hosting-rewrite i `firebase.json`: `{ "source": "/api/vedlegg/**", "run": { "serviceId": "hverdagsflyt-vedlegg", "region": "europe-west1" } }` **foran** `**`. Den merges først når tjenesten finnes.
- **R4:** `VITE_VEDLEGG_TJENESTE: aktiv` i byggesteget i `production.yml`. Den er egen og merges sist.

**O: operatør** (prosjekteier, etter Helens godkjenning)

- **O1:** `bash infra/gcp/vedlegg-bootstrap.sh` (tørrkjøring), les utskriften, og kjør så med `--apply`.
- **O2:** Budsjettvarsel på billing-kontoen, for eksempel $5 per måned.

**Release** (Kontrolltårnet eller Helen dispatcher, i rekkefølge)

1. Kjør `deploy-vedlegg-cloudrun.yml` (R2) på `main`.
2. Merg R3 og kjør `production.yml`. Rewriten er da aktiv, men filkontrollene er fortsatt AV.
3. Den skrivefrie kontrollen i 7a gjennom Hosting-domenet.
4. Merg R4 og kjør `production.yml`. Filkontrollene er nå PÅ.
5. Skrivefri etterkontroll (7b).

## 7. Kontroller uten skriving

**7a. Tjenesten og rewriten.** Ingen av kallene har token, så alle avvises før body leses. Ingenting lagres, og RTDB røres ikke.

```bash
B=https://familieapp-a5d15.web.app   # og direkte *.run.app-URL
head -c 10485760 /dev/zero > /tmp/stor.bin   # 10 MiB, ikke en gyldig fil
curl -s -o /dev/null -w '%{http_code}\n' -X POST --data-binary @/tmp/stor.bin "$B/api/vedlegg/x/y"
#   forventet 401 fra tjenesten (U1: 413 her = Hosting-grense lavere enn 10 MiB)
curl -s -D - -o /dev/null "$B/api/vedlegg/x/y/$(printf '0%.0s' {1..64})" | grep -iE '^HTTP|nosniff|content-type'
#   forventet 401, JSON, nosniff
curl -s -o /dev/null -w '%{http_code}\n' "$B/api/vedlegg/x"   # forventet 401 eller 400, ikke index.html (200)
```

**7b. Etterkontroll av data:** `forvaltning_cutover_kontroll` før og etter release. Tellinger og digester for `receipts`, `hendelser`, `transaksjoner` og `rules` skal være uendret. Ingen prøveskriving.

Merk: Claude-økten mangler i dag scopet `forvaltning:read` på connectoren (#59 6552201558). Kontrollen kjøres derfor fra Work, eller etter at scopet er rettet.

**Første ekte bruk** er Helens egen opplasting av en ekte kvittering, etter 7a og 7b. Det er bruk, ikke en test, og det skjer bare når Helen bestemmer det.

## 8. Om GCS-adapteren (U7)

Ingen skriving til en ekte bøtte og ingen produksjonstest er autorisert. B1 er testet mot emulator og falskt lager.

Trengs reell verifikasjon før første ekte bruk, kreves:

- et avklart, separat testmiljø (egen bøtte i et eget prosjekt eller en egen testbøtte, aldri produksjonsbøtta eller produksjonsdata);
- eksplisitt autorisasjon før utførelse.

Uten det er første ekte bruk også første kjøring mot GCS. Feiler den, viser klienten en feil og beholder fila. Ingenting går tapt, og det rulles tilbake som beskrevet i avsnitt 10.

## 9. Kostnad

Regneeksempelet bruker offisielle priser fra avsnitt 2. Bruken er antatt, ikke målt: 50 nye kvitteringer i måneden på 1,5 MB i snitt, og 10 visninger per kvittering.

| Post                                 | Beregning                                                                                                    | Per måned        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------- |
| Lagring etter 5 år (≈ 4,4 GiB)       | 4,4 × $0.02                                                                                                  | ≈ $0.09          |
| Opplasting (Class A)                 | 50 × $0.005 / 1 000                                                                                          | ≈ $0.0003        |
| Visning (Class B)                    | 500 × $0.0004 / 1 000                                                                                        | ≈ $0.0002        |
| Nedlasting til internett             | 500 × 1,5 MB ≈ 0,73 GiB × $0.12                                                                              | ≈ $0.09          |
| Cloud Run (forespørsler, CPU, minne) | Omtrent 550 forespørsler på under 1 s med 1 vCPU og 0,5 GiB, godt innenfor gratisnivået, også sammen med MCP | ≈ $0 (ikke målt) |
| **Sum**                              |                                                                                                              | **≈ $0.20**      |

Nedlasting fra GCS til Cloud Run i samme region regnes ikke som nedlasting til internett. Det følger av sidens prismodell, men er ikke sjekket særskilt. Nedlastingen til brukeren går fra Cloud Run via Hosting, og prisen for Cloud Runs utgående trafikk er ikke hentet. Derfor er linjen over brukt som øvre anslag.

## 10. Tilbakerulling

| Nivå                   | Tiltak                                                                                                | Virkning                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Skru av filkontrollene | Revert R4 og kjør `production.yml`                                                                    | Filkontrollene forsvinner. Data er urørt.            |
| Koble fra API-et       | Revert R3 og kjør `production.yml`                                                                    | `/api/vedlegg/**` går til `index.html`.              |
| Stopp tjenesten        | `gcloud run services update hverdagsflyt-vedlegg --region=europe-west1 --ingress=internal` (operatør) | Tjenesten kan ikke nås fra internett.                |
| Data                   | Metadata i `receipts` og objektene i bøtta blir liggende. **Ingenting slettes automatisk.**           | Lagrede filer kan kobles på igjen ved ny aktivering. |

Ingen claims, ingen CORS, ingen Storage-regler (egen bøtte), og ingen endring i Auth0, MCP-scopes eller MCP-tjenesten.
