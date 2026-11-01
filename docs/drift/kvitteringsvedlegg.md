# Aktiveringspakke: kvitteringsfiler (B)

**Status:**

- **Levert kode (merget, inaktiv):**
  - #98 (`7aabb81`): tjeneste og klient. Webappen er publisert med filfunksjonen **AV** (`production.yml`, run 41264129477), og Work har gjort skrivefri etterkontroll (#59 6552877345).
  - #99: denne pakken.
  - #100: offline GCS-kontrakt.
  - #101 (`57b824e`): R1/R2, det vil si bootstrap, preflight, deploy-workflow og røyktest.
- **Ikke kjørt drift:** ingen av skriptene eller workflowen er kjørt mot noe prosjekt. Denne leveransen har ikke opprettet eller endret noen tjeneste, bøtte, IAM-binding, regel eller rewrite. Hva prosjektet faktisk inneholder i dag, er ikke uavhengig verifisert. Driften er først levert når O1 og release faktisk er kjørt og etterkontrollert.
- **Ikke på main:** R3 (rewrite) og R4 (web-flagg).

**Godkjenning:**

- Pakken skal gjennomgås av Kontrolltårnet før Helen involveres.
- Lesing er allerede autorisert: den første operatørhandlingen er bare skrivefri preflight (avsnitt 0 H), uten ny prinsippgodkjenning.
- Hvert **muterende** operatørsteg (O1, O2, testmiljø, release) krever Helens samlede, konkrete godkjenning (#59 6546642665). Det bes først om den når Kontrolltårnet har konkretisert den faktiske endringslisten etter preflight.
- Ingen sikkerhets- eller driftsendring gjøres automatisk.
- Pakken gir ingen generell fullmakt til nye driftstiltak.

**Tegnforklaring for kildestatus:**

- **[kilde]** betyr at forholdet er verifisert i offisiell kilde, med lenke, av hvem og dato.
- **[repo]** betyr at forholdet er bevist i dette repoet eller i drift som allerede kjører.
- **[ukjent]** betyr at forholdet ikke er avklart, og hvordan det avklares står i teksten.

## 0. Go/no-go-grunnlag

Det korte beslutningsgrunnlaget. Detaljene står i avsnittene under. Ingenting her er utført.

**A. Det én skrivefri preflight avklarer** (`vedlegg-preflight.sh` på fast SHA, se H; bare lesing, kjøres av prosjekteier under det lesemandatet som allerede er gitt):

- U2: om billing er aktiv.
- Om Cloud Storage-API-et er aktivert.
- Om MCP-forutsetningene (AR-repo, deployidentitet, WIF) finnes og er lesbare.
- Om bøtte (med eierprosjekt), kjøretidsidentitet og tjeneste finnes fra før og er våre.
- U3: de sju relevante effektive org-policyene. UKJENT der lesing feiler. Arv utover disse er ikke kartlagt.

**B. Det preflight IKKE avklarer, og som krever et valgt steg:**

| #   | Spørsmål                                                                     | Minste steg                                                                                                                                                                                                           | Autorisasjonsgrense                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U4  | Hvilken identitet deployer Hosting, og kan den deploye en Cloud Run-rewrite? | Den som eier hemmeligheten oppgir **bare** `client_email` (ikke nøkkelen), og preflight kjøres med `HOSTING_SA_EMAIL=…`. Alternativt aksepteres at svaret først kommer ved R3-deploy, som da rulles tilbake ved feil. | Lesing. Ingen ny tilgang.                                                                                                                                                                                                             |
| U1  | Har Hosting en egen grense for request-body?                                 | **Forslag, ikke bestilt:** minste testplan i avsnitt 8, eller en offisiell kilde for grensen.                                                                                                                         | Bare i et eget, godkjent testmiljø med syntetiske identiteter og testfiler. **Ingenting i produksjonsprosjektet, ingen produksjonsdata.** Krever Helens eksplisitte autorisasjon før noe opprettes. Opprydding er en egen beslutning. |
| U5  | Virker GCS-adapteren mot en ekte bøtte (`ifGenerationMatch: 0`, 412, 404)?   | Samme testkjøring som U1 (avsnitt 8). SDK-kallene er allerede offline kontrakttestet (#100).                                                                                                                          | Som U1.                                                                                                                                                                                                                               |
| O1  | Skal bootstrap kjøres?                                                       | Tørrkjøring → les endringslisten → `--apply`.                                                                                                                                                                         | Prosjekteier, etter Helens godkjenning av den faktiske endringslisten Kontrolltårnet konkretiserer etter preflight.                                                                                                                   |
| O2  | Budsjettvarsel?                                                              | For eksempel $5 per måned på billing-kontoen.                                                                                                                                                                         | Den som har billing-tilgang.                                                                                                                                                                                                          |

Uten U1 og U5 kan O1, R2 og R3 gjennomføres, men **R4 (filkontrollene PÅ) merges ikke**.

**C. Planlagt endringsliste i produksjonsprosjektet** (bootstrap på tomt prosjekt, 9 kall; nøyaktig kommandotekst i tørrkjøringen). Dette er kodens plan, ikke en godkjenningsforespørsel: den faktiske listen fastsettes først etter preflight (H).

1. Bøtta `gs://familieapp-a5d15-kvitteringer` i europe-west1: Standard, UBLA, PAP og merket `formaal=hverdagsflyt-vedlegg`.
2. Kjøretidsidentiteten `hverdagsflyt-vedlegg@…` med beskrivelsen `hverdagsflyt-vedlegg`.
3. Bøtta: `storage.objectCreator` → kjøretidsidentiteten.
4. Bøtta: `storage.objectViewer` → kjøretidsidentiteten.
5. Prosjektet: `firebasedatabase.viewer` → kjøretidsidentiteten.
6. Prosjektet: `firebaseauth.viewer` → kjøretidsidentiteten.
7. Kjøretidsidentiteten: `iam.serviceAccountUser` → `hverdagsflyt-mcp-deployer@…`.
8. Tjenesteskallet `hverdagsflyt-vedlegg`: hello-image, `--ingress=internal`, `--no-invoker-iam-check` og merket.
9. Tjenesten: `run.developer` → `hverdagsflyt-mcp-deployer@…`.

Deretter, hver for seg:

- R2-kjøring: image og env, `--ingress=all`.
- R3: rewrite i `firebase.json` og `production.yml`.
- R4: web-flagget og `production.yml`.
- O2: budsjettvarsel.

Ingen API-aktivering, ingen sletting, ingen `set-iam-policy` og ingen endring i WIF, Auth0, MCP eller rules.

**D. Identiteter og myndighet:**

| Steg                            | Hvem                                           | Trenger                                                                                                                                                                                                          |
| ------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preflight (første handling, H)  | Prosjekteier (eller en med lesetilgang)        | Allerede gitt lesemandat; ingen ny godkjenning. Lesing av prosjekt, billing, tjenester, IAM, Run, AR og Storage. Org-policylesing kan kreve tilgang på organisasjonsnivå. Mangler den, står policyen som UKJENT. |
| O1 (`--apply`)                  | Prosjekteier                                   | Opprette bøtte og tjenestekonto, sette IAM på prosjekt, bøtte og tjenestekonto, og opprette Run-tjeneste uten Invoker-sjekk (`run.services.create`/`setIamPolicy`).                                              |
| R2-kjøring                      | Kontrolltårnet eller Helen (GitHub)            | Environment `mcp-production`. Selve deployen gjøres av `hverdagsflyt-mcp-deployer@…` via WIF, med bindingene fra punkt 7 og 9.                                                                                   |
| R3/R4-merge og `production.yml` | Kontrolltårnet, eller Claude etter grønn merge | Som i dag. U4 avgjør om Hosting-deployen klarer rewriten.                                                                                                                                                        |
| U1/U5-test (forslag, avsnitt 8) | Operatør i testprosjektet                      | Eget prosjekt og egen billing, syntetiske identiteter, ID-token logges ikke. Ingen tilgang til produksjonsprosjektet. Bare etter Helens autorisasjon.                                                            |

**E. Stopp (no-go):**

- Bootstrap stopper selv på UKJENT, på bøtte utenfor prosjektet, på ukjente ressurser og hvis Cloud Storage-API-et er av.
- **Manuell no-go hvis preflight viser at en effektiv policy hindrer oppsettet:** `run.allowedIngress` uten «all», påkrevd Invoker-IAM (`run.managed.requireInvokerIam`), `gcp.resourceLocations` uten europe-west1, eller `iam.disableServiceAccountCreation`.
- Ingen release uten budsjettvarsel (O2).
- Ingen R4 uten avklart U1 og U5.

**F. Kostnadsukjente:** se avsnitt 9. Den kjente delen er omtrent $0.09 per måned, og det finnes ingen garantert øvre grense.

**G. Tilbakeføring:** se avsnitt 10. Ressursene O1 lager (bøtte, identitet, skall og bindinger) fjernes **ikke** automatisk. Å fjerne dem er en egen, destruktiv beslutning.

**H. Første operatørhandling, og hva som kommer etterpå**

Lesemandatet er allerede gitt, så det trengs ingen ny prinsippgodkjenning. **Den eneste handlingen som bes om først** er at prosjekteier kjører den reviewede, skrivefrie preflighten på en **fast SHA** og leverer utskriften. Work og Claude har ikke prosjektlesing via gcloud, så dette kan ikke gjøres derfra.

I Cloud Shell, innlogget som prosjekteier (repoet er offentlig, så det trengs ingen GitHub-innlogging):

```bash
SHA=57b824e55f349cbcbee6f46f1e87b19c6e5ad02c   # #101, der preflight ble reviewet og merget
D=$(mktemp -d) && git clone -q https://github.com/hnasselqvist-netizen/familieapp.git "$D" && cd "$D"
git -c advice.detachedHead=false checkout -q "$SHA" && git rev-parse HEAD   # skal skrive ut nøyaktig $SHA
sha256sum infra/gcp/vedlegg-preflight.sh infra/gcp/vedlegg-felles.sh
#   63e2af9e0024ef21200b66fdf443eb1100c20a6c34ab7d030647d6b61c2f4495  infra/gcp/vedlegg-preflight.sh
#   d87a508e404ebd600e7d23cd9bbe45ef7d4b592a81d16bc7f2151a5957b1c3c2  infra/gcp/vedlegg-felles.sh
#   Avviker en sum: STOPP, ikke kjør.
bash infra/gcp/vedlegg-preflight.sh 2>&1 | tee ~/vedlegg-preflight-$(date -u +%Y%m%dT%H%M%SZ).txt
```

- **Bare lesing.** Preflight har ingen `--apply`. Ingen bootstrap, deploy eller workflow-kjøring.
- `HOSTING_SA_EMAIL` settes bare hvis den som eier hemmeligheten allerede har oppgitt `client_email`. Ingen nøkkel skal leses eller limes inn.
- **Utskriften leveres til Kontrolltårnet**, ikke som rå tekst i et offentlig issue. Den kan inneholde navn på tjenestekontoer og policyer.

**Etter at resultatet foreligger** konkretiserer Kontrolltårnet den faktiske gjenværende endringslisten, risikoen og teststrategien (U1/U4/U5) **før** det bes om noen godkjenning av mutasjoner (O1/O2), testmiljø eller release. Det bes ikke om godkjenning av en ukjent faktisk endringsliste nå. Ingen skal lete etter noen nøkkel, og ingen gammel tilgang skal settes opp på nytt.

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
  - Preflight leser de relevante **effektive** org-policyene enkeltvis (`org-policies describe … --effective`). En policy som ikke kan leses står som UKJENT. Arvede policyer utover disse er ikke kartlagt.
  - Bootstrap stopper ved første avvist kall uten å gå videre.
- **U4. Om Hosting-deployidentiteten** (`FIREBASE_SERVICE_ACCOUNT` i `production.yml`) **kan deploye en rewrite til Cloud Run.**
  - **Fortsatt ukjent.** Preflight lister `github-action-*`-kontoer med roller, men bare som **kandidater**. Én unik kandidat beviser ikke koblingen til hemmeligheten.
  - U4 avklares først når koblingen er verifisert fra en trygg konfigkilde, eller når operatøren har oppgitt bare «client_email» (`HOSTING_SA_EMAIL=… vedlegg-preflight.sh`). Nøkkelen leses eller deles aldri.
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
- **U6. gcloud-detaljer som ikke er kildeverifisert.** Gcloud-referansen og nedlastingen av CLI-et er blokkert fra Claude-økten.
  - **Kildeverifisert av Work og Kontrolltårnet** (review 5729887292 og 5730321368, 2026-11-01):
    - `storage buckets create` har `--default-storage-class`, `--uniform-bucket-level-access`, `--public-access-prevention` og `--labels`/`--labels-file` (ikke `--update-labels`) [kilde] https://docs.cloud.google.com/sdk/gcloud/reference/storage/buckets/create;
    - `run deploy` har `--labels` og `--[no-]invoker-iam-check` [kilde] https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy;
    - `org-policies describe` har `--effective` [kilde] https://docs.cloud.google.com/sdk/gcloud/reference/org-policies/describe;
    - `storage buckets list` er prosjektets egen liste og støtter `name`-projeksjon [kilde] https://docs.cloud.google.com/sdk/gcloud/reference/storage/buckets/list.
  - **Fortsatt ikke verifisert:**
    - projeksjonene `location`, `uniform_bucket_level_access`, `public_access_prevention` og `labels.formaal` (bucket describe);
    - `metadata.labels.formaal` og `spec.template.spec.serviceAccountName` (run services describe);
    - `description` (service-accounts describe) og `config.name` (services list);
    - ikke-funnet-tekstene `NOT_FOUND`, `NotFoundError`, `not found: 404` og `Cannot find service`;
    - faktisk policy i prosjektet.
  - Alle feiler **lukket**: en feil projeksjon gir avvik og STOPP, og en ukjent feiltekst gir «ukjent» og STOPP. Ingen av dem gir opprettelse. Testenes falske gcloud avviser ukjente flagg per kommando.
- **U7. Kostnadsposter uten verifisert sats eller måling.** Se avsnitt 9.

## 4. Bøtte: anbefaling

**Anbefalt: en egen bøtte** `familieapp-a5d15-kvitteringer` i europe-west1, Standard. Den har uniform bucket-level access og public access prevention _enforced_, og den kobles ikke til Firebase Storage.

- Ingen klient har noen vei inn, verken via Firebase Storage-regler eller via CORS. Bare runtime-SA-en har tilgang, og bare på denne bøtta.
- Det trengs ingen Storage-regler, så ingen regelfil kan gli eller deployes feil.
- Uavhengig av Firebase-standardbøtta. Derfor trengs det ikke noe lesesteg for den.
- Bøttenavn er globale. Navnet ligger fast i `infra/gcp/vedlegg-felles.sh` og i workflowens env, og kan ikke overstyres. Er navnet tatt av noen andre, STOPPER bootstrap. Et nytt navn krever en PR som endrer begge stedene.

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

**L: bare lesing** (prosjekteier eller den som får lesetilgang, Cloud Shell)

```bash
bash infra/gcp/vedlegg-preflight.sh
```

`infra/gcp/vedlegg-preflight.sh` bruker bare `describe`, `list` og `get-iam-policy`, og endrer ingenting. Det er testet mot falsk `gcloud` (`mcp-server/src/vedlegg/drift.test.ts`). Skriptet svarer på:

- **L1 (U2):** om billing er aktiv.
- **L2 (U4):** Hosting-deployidentiteten.
  - Hemmeligheten `FIREBASE_SERVICE_ACCOUNT` leses **ikke**. Prosjektets `github-action-*`-kontoer listes som **kandidater** med prosjektroller, men en kandidat er ikke bevis.
  - Uten `HOSTING_SA_EMAIL` skriver skriptet alltid «U4 UKJENT» og den minste opplysningen som mangler: «client_email», oppgitt av den som eier hemmeligheten, uten nøkkelen.
- **U3:** de relevante effektive org-policyene, lest enkeltvis. UKJENT der lesing feiler.
- **R1-førtilstand:** Cloud Storage-API, MCP-oppsett, og om bøtte (også eierprosjekt), kjøretidsidentitet eller tjeneste finnes fra før og er merket som våre.
- **Hvert svar** er «finnes», «finnes ikke» (bare ved positiv ikke-funnet-melding) eller **UKJENT** (avslag, deaktivert API, tidsavbrudd, formatfeil, ukjent feil). UKJENT rapporteres aldri som «finnes ikke».

**R: repo-PR-er** (Claude, reviewes av Kontrolltårnet)

R-PR-ene har ingen driftsvirkning før de kjøres eller merges som beskrevet. De kjøres ikke, og gir ingen rettigheter, uten samlet godkjenning.

**R1 og R2 er merget som inaktiv kode (#101, `57b824e`), men ikke kjørt** (6553344913, review 5729887292 og 5730321368). R3 og R4 er ikke på main.

- **R1:** `infra/gcp/vedlegg-bootstrap.sh` etter mønsteret fra `mcp-bootstrap.sh`.
  - Tørrkjøring som standard, og endringer bare med eksplisitt `--apply`. Vokter prosjektnummeret.
  - **Hele førtilstanden leses før første endring, med tre mulige utfall:** finnes, bekreftet mangler (positiv ikke-funnet-melding) eller **ukjent**. Ukjent gir STOPP: leseavslag, deaktivert API, tidsavbrudd, transport- eller formatfeil og ukjent feil. Bare «bekreftet mangler» fører til opprettelse.
  - **Cloud Storage-API-et må allerede være aktivert.** Skriptet aktiverer ingen API-er. Er det av, stopper skriptet med instruks om et eget, godkjent steg.
  - **Bøtta har fast navn og kan ikke overstyres.** Eierskap avgjøres av om bøtta står i **prosjektets egen bøtteliste**. Står den der, må den være merket og ha riktige innstillinger. Står den ikke der, må den positivt ikke finnes noe sted. Finnes den utenfor prosjektet, eller kan det ikke avgjøres: STOPP. Det blir aldri opprettet eller bundet noe mot en fremmed eller ukjent eier.
  - Finnes kjøretidsidentitet eller tjeneste fra før, må den være vår, ellers STOPP. Tjenesten må være merket `formaal=hverdagsflyt-vedlegg` og kjøre som riktig identitet, og identiteten må ha beskrivelsen `hverdagsflyt-vedlegg`. En ukjent ressurs blir aldri overtatt eller svekket.
  - **Hele endringslisten skrives ut før noe utføres.** Utførelsen stopper ved første feil.
  - IAM endres bare additivt (`add-iam-policy-binding`), aldri med `set-iam-policy`, `remove` eller `delete`. Eksisterende policy bevares. Ingen sletting eller opprydding.
  - Testet mot falsk `gcloud` som avviser ukjente flagg:
    - tørrkjøring og `--apply`;
    - prosjektavvik og idempotens;
    - fire feiltyper på hver av de sju førtilstandslesningene, pluss manglende MCP-oppsett, API av, bøtte i et annet prosjekt og ukjente eller feilinnstilte ressurser. Alle gir STOPP med **null mutasjoner**;
    - feil midt i, og forbudte kall.
  - Regresjonstestene feiler mot forrige versjon (`04f13ba`), blant annet reviewens repro med PERMISSION_DENIED på bøtta.
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
  - **Ingen Invoker- eller IAM-flagg.** Til slutt kjører den den skrivefrie kontrollen 7a (`mcp-server/scripts/verify-vedlegg-deployed.sh`).
  - Imaget røyktestes før push (`mcp-server/scripts/smoke-vedlegg-container.sh`):
    - produksjonssperre, blandet oppsett, GCS mot emulator og minnelager i produksjon nektes;
    - 401 uten token;
    - ikke-root.
  - Samme bygg og samme røyktest kjører i CI på hver PR (jobben `mcp-server (container build + smoke)`), uten push.
  - Kontrakttestet (`drift.test.ts`):
    - bare `workflow_dispatch`, `main` og `mcp-production`;
    - bekreftelsen `vedlegg-ekte-data`;
    - ingen IAM- eller Invoker-flagg, og bare `gcloud auth configure-docker`, `run deploy` og `run services describe`;
    - ingen emulatorvariabler;
    - røyktest før push og verifisering etter deploy.
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

Kontrollen kjøres fra Work, som for B1-publiseringen (#59 6552877345). Claude-økten mangler `forvaltning:read`, og det bestilles ingen endring av scopet.

**Første ekte bruk** er Helens egen opplasting av en ekte kvittering, etter at U1 og U5 er avklart og 7a og 7b er kjørt. Det er bruk, ikke en test, og det skjer bare når Helen bestemmer det.

## 8. Separat testmiljø (U1, U5)

Ingen skriving til en ekte bøtte og ingen produksjonstest er autorisert. B1 er testet mot emulator og falskt lager.

U1 (body-grensen gjennom Hosting) og U5 (GCS-adapteren) kan bare verifiseres med en autentisert opplasting. Det krever:

- et avklart, separat testmiljø, det vil si eget prosjekt med egen Hosting-side, egen bøtte og egen Auth/RTDB, aldri produksjonens bøtte eller data;
- eksplisitt autorisasjon før utførelse.

**Minste testplan for U1 og U5** (forslag, ikke bestilt; **ingen test utføres nå**):

- **Miljø:** et eget, godkjent testmiljø med egen Hosting-side og rewrite, egen Auth og RTDB, og egen bøtte. Det kjører samme image og samme `VEDLEGG_MAKS_BYTES` (10 MiB) som produksjon. **Alle identiteter og alt medlemskap er syntetiske, og alt lager ligger i testmiljøet.** ID-tokens logges ikke.
- **Grensetilfeller** (alle autentisert gjennom Hosting, gyldig signatur, ny syntetisk kvitterings-ID per fil):
  1. Under grensen (for eksempel 9,9 MiB): forventet 201.
  2. **Nøyaktig 10 × 1024 × 1024 byte** (støttet format, for eksempel PDF med gyldig signatur): forventet **201**. **Identisk gjentakelse:** forventet **200 «fantes»** (412-banen). Nedlasting skal være **byte-lik**.
  3. **10 MiB + 1 byte:** forventet tjenestens JSON-feil `for_stor` med **413**.
  4. Ukjent sha ved nedlasting: forventet 404.
- **Hva som er bevis:** **suksess under og på grensen** (punkt 1 og 2) beviser at Hosting slipper gjennom maksimalstørrelsen (U1), og at adapteren virker mot ekte GCS (U5). Punkt 3 alene beviser **ikke** full transport: tjenesten kan avvise på `Content-Length` før body leses (`lesMedGrense` i `http.ts`). Klient, HTTP-lag og kjerne aksepterer alle nøyaktig 10 MiB og avviser bare større filer.
- **Kode- og reviewstatus mot runtime:** grense-, idempotens- og typelogikken er kode- og kontrakttestet (#98, #100). Testplanen over er den eneste måten å få **runtime**-avklaring av U1 og U5 på. Testoppsettet er ikke kode-review av denne pakken. Testprosjektet er et **forslag**, ikke en stående bestilling eller et krav, og oppsettet er ikke en del av denne pakken. Er det uønsket, er alternativet for U1 å senke `VEDLEGG_MAKS_BYTES` og `MAKS_FILBYTES` under en kildeverifisert grense når den finnes. U5 forblir da bare offline kontrakttestet.

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

| Nivå                   | Tiltak                                                                                                                                                           | Virkning                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Skru av filkontrollene | Revert R4 og kjør `production.yml`                                                                                                                               | Filkontrollene forsvinner. Data er urørt.            |
| Koble fra API-et       | Revert R3 og kjør `production.yml`                                                                                                                               | `/api/vedlegg/**` går til `index.html`.              |
| Forrige versjon        | `gcloud run services update-traffic hverdagsflyt-vedlegg --region=europe-west1 --to-revisions=<forrige>=100` (operatør), eller revert på `main` og ny R2-kjøring | Forrige image tar trafikken igjen. Data er urørt.    |
| Stopp tjenesten        | `gcloud run services update hverdagsflyt-vedlegg --region=europe-west1 --ingress=internal` (operatør)                                                            | Tjenesten kan ikke nås fra internett.                |
| Data                   | Metadata i `receipts` og objektene i bøtta blir liggende. **Ingenting slettes automatisk.**                                                                      | Lagrede filer kan kobles på igjen ved ny aktivering. |

Ingen claims, ingen CORS, ingen Storage-regler (egen bøtte), og ingen endring i Auth0, MCP-scopes eller MCP-tjenesten.
