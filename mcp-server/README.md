# mcp-server — Kontrolltårnets MCP-kontrollflate (foundation)

En MCP-server som lar ChatGPT (Kontrolltårnet-pluginen) lese og endre
Hverdagsflyt-data gjennom **typed, autoriserte verktøy**, i stedet for at
ChatGPT-hostet kode får Firebase-tilgang. Første vertikale skive er
**Handleliste**. Beslutningsgrunnlaget ligger i Issue #27: arkitekturen i
5936590112/5936720705, designet i 5936936743 og godkjenningen i 5937138669.

> **Status: deploybar, ikke deployet.** Pakken har et testet container-image
> og en manuell, inert Cloud Run-workflow, men ingen opprettet IdP-tenant,
> ingen IAM-endring og ingen kobling mot ekte Firebase-data. Tre sperrer
> gjelder uansett hvor den kjører:
>
> - `main.ts` nekter å starte mot ekte RTDB uten en eksplisitt
>   `MCP_ALLOW_PRODUCTION_DATA=true`.
> - Skriveverktøyet finnes ikke med mindre `MCP_HANDLELISTE_SKRIVING=aktiv`
>   (se «Skrivesperre»).
> - Deploy-workflowen setter skriving eksplisitt til `av` og endrer ingen
>   IAM-policy.
>
> Veien til første ekte test fra ChatGPT står i «Runbook» nederst.

## Kommandoer

Fra `mcp-server/`:

```bash
npm install
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
npm run test:integration   # Admin-adapteren + koblings-CLI-en mot RTDB-emulatoren (krever Java)
npm run build:admin        # operatør-CLI for principal-koblinger → dist/link-principal.js
```

Container (fra **repo-roten**, fordi bundelen henter delte regler fra `web/src/domain`):

```bash
docker build -f mcp-server/Dockerfile -t hverdagsflyt-mcp:local .
mcp-server/scripts/smoke-container.sh hverdagsflyt-mcp:local
```

Røyktesten sjekker `/healthz`, RFC 9728-metadata, 401 med `WWW-Authenticate`,
prod-sperren, at en ugyldig skrivebryter stopper oppstart, at prosessen ikke
kjører som root, og ryddig stopp på SIGTERM. CI kjører den samme på hver PR
(jobben `mcp-container`, uten push).

## Struktur

```
src/
  handleliste/   schemas (typed kontrakt), plan (ren planlegger), views (lesing/søk),
                 shoppingNode (ren tolkning av shopping-noden + transaksjonsbeslutningen),
                 service (idempotens-orkestrering) — kjenner kun store-PORTEN
  auth/          tokens (JWT/JWKS-validering), protectedResource (RFC 9728 +
                 WWW-Authenticate), authorize (scope → kobling → medlemskap per kall)
  store/         types (porten), memoryStore (fake med RTDB-semantikk + feilinjeksjon),
                 firebaseAdminStore (Admin SDK), storeContract (felles kontrakttest)
  mcp/server.ts  verktøyregistrering, feil → isError-resultater
  http/app.ts    Node-handler: /mcp, /.well-known/oauth-protected-resource, /healthz
  admin/         principal-koblinger: ren planlegging + operatør-CLI (linkPrincipal.ts)
  app.ts         kobler lagene; main.ts er kjøretidsinngangen (SIGTERM → ryddig stopp)
scripts/smoke-container.sh   røyktest av et ferdigbygd image (CI og lokalt)
Dockerfile (+ Dockerfile.dockerignore)   bygges fra repo-roten
```

Grensene håndheves av `eslint.config.js`:

- `handleliste/` og `auth/` importerer aldri Firebase, HTTP eller MCP-SDK-et.
- Bare `store/firebaseAdminStore.ts`, `main.ts` og operatør-CLI-en
  `admin/linkPrincipal.ts` får importere `firebase-admin`.
- Delt kode hentes fra `web/` **kun** via `@domain/shopping/*`, `@domain/shared/*`
  og `@app-types/*`. Appens datalag, som bruker klient-SDK-et, er utenfor rekkevidde.

## Delte regler med appen

Dedup-, sammenslåings- og varebasereglene ligger i
`web/src/domain/shopping/handlelisteRules.ts`. **Både appen og MCP-serveren
bruker samme fil**: generatoren, `addBatchToShoppingList`/`findOrCreateItem`
gjennom hookene, og `handleliste/plan.ts`. Det finnes ingen kopi.

`plan.parity.test.ts` importerer appens egen `mergeIntoShoppingList` og
viser at MCP-planen gir samme sluttilstand for en scenariotabell som også
dekker de kjente særegenhetene (f.eks. `"2 stk" + "3" → "5"`).

## Verktøykontrakt

| Verktøy                   | Nivå | Scope            | Input                                                                                       |
| ------------------------- | ---- | ---------------- | ------------------------------------------------------------------------------------------- |
| `shopping_list_get`       | 0    | `shopping:read`  | `{ includeDone?: boolean }`                                                                 |
| `items_search`            | 0    | `shopping:read`  | `{ query: 1–60, limit?: 1–10 }`                                                             |
| `shopping_list_add_items` | 1    | `shopping:write` | `{ requestId: uuid, items: [{ name: 1–80, amount?: ≤20, cat?: SHOP_CATS }] (1–20, unike) }` |

`shopping_list_add_items` returnerer et utfall per vare:

- `added` — ny post. `newItemCreated` sier om varen også ble lagt i varebasen.
- `merged` — tallmengden er summert, `previousAmount` viser mengden før.
- `already_on_list` — varen sto der allerede uten tallmengde, så ingenting ble skrevet.

I tillegg kommer den tilbakeleste listen (`list`, eller `null` hvis tilbakelesingen
feilet; handlingen er uansett utført). Ingen verktøy tar imot `familyId`.

Hvert verktøy oppgir auth-kravet sitt som `securitySchemes: [{ type: "oauth2", scopes: [...] }]`
på toppnivå i tool descriptoren (dagens OpenAI-kontrakt), speilet i `_meta.securitySchemes`
for bakoverkompatibilitet.

### Skrivesperre

`shopping_list_add_items` registreres **kun** når
`MCP_HANDLELISTE_SKRIVING=aktiv`. Uten den finnes verktøyet verken i
`tools/list` eller som kallbart verktøy. Andre verdier enn `aktiv`, `av` og
tom stopper oppstarten. Sperren er av som standard fordi legacy-cutoveren
(se «Cutover») ikke er gjort. Lesing (`shopping_list_get`, `items_search`)
virker uansett, og første ende-til-ende-test er derfor en **lesetest**.

Nivå 1 betyr at brukerens eksplisitte kommando er autorisasjonen. Det finnes
ikke noe draft→confirm i backend. ChatGPT kan fortsatt vise sin egen
bekreftelse, og annotasjonene sier ærlig at verktøyet skriver
(`readOnlyHint: false`).

## Auth og autorisasjon

1. **Resource server, ikke authorization server.** ChatGPT kjører OAuth 2.1
   authorization code + PKCE mot en etablert IdP. Leverandøren er ikke låst;
   kravene står i Runbook, steg 1. Serveren publiserer `/.well-known/oauth-protected-resource[/mcp]`
   (RFC 9728). Den svarer 401 med `WWW-Authenticate: Bearer resource_metadata="…"`
   når token mangler eller er ugyldig.
2. **Full tokenvalidering:** signatur mot IdP-ens offentlige JWKS, `iss`,
   `aud` (= `MCP_RESOURCE_URL`), `exp`/`nbf` og en allowlist med kun `RS256`.
   Scopes leses leverandørnøytralt fra `scope`, `scp` (Entra ID/Okta) og
   `permissions` (Auth0 RBAC).
3. **Per kall** (`auth/authorize.ts`):
   1. Krevd scope.
   2. En eksplisitt kobling `mcp/principals/{idpSub}` → `{ firebaseUid, familyId }`.
   3. At koblingen ikke er `disabled`.
   4. At `families/{familyId}/members/{firebaseUid}` fortsatt finnes.

   Manglende scope gir et `isError`-resultat med
   `_meta["mcp/www_authenticate"]`, slik at ChatGPT kan be om utvidet tilgang.

4. **Ingen e-postbasert kobling.** Koblinger opprettes eksplisitt av en
   operatør med `link-principal` (se Runbook, steg 4).
   Tilgang trekkes tilbake på en av tre måter: `disabled: true`, fjernet
   medlemskap, eller blokkering i IdP-en.

v1 er én familie per kobling. Multi-family-seamen er bevart: `familyId` kommer
fra koblingen og valideres per kall. Et senere flerfamilievalg blir et
server-validert valg mellom familiene koblingen gir tilgang til, aldri et fritt felt.

## Idempotens og audit

Valgt av Kontrolltårnet i PR #40 (kommentar 5950478583, alternativ A):
eksisterende `families/{f}/shopping/{id}` forblir source of truth, og
idempotens-metadata ligger i `families/{f}/shopping/_ops/{requestId}`.

### Firebase-shape

| Node                                            | Innhold                                                                                         | Levetid        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------- |
| `families/{f}/shopping/{id}`                    | Varepost i appens form. Nye poster fra MCP har også `id` (som web)                              | —              |
| `families/{f}/shopping/_ops/{requestId}`        | `{ tool, fp, sub, uid, client, at, result }`. Skrevet i **samme transaksjon** som vareendringen | 7 d / maks 100 |
| `families/{f}/items/{id}`                       | Varebasen, appens form                                                                          | —              |
| `mcp/actions/{f}/{requestId}`                   | Replay-/konfliktregister og audit                                                               | 90 d           |
| `mcp/actionsByDay/{f}/{YYYY-MM-DD}/{requestId}` | Beskjæringsindeks (nøkkelordnet, krever ingen `.indexOn`)                                       | 90 d           |
| `mcp/principals/{idpSub}`                       | Eksplisitt kobling IdP-sub → Firebase-bruker                                                    | manuell        |

`_ops` er **aldri en vare**. Alle nøkler under `shopping` som starter med `_`
er reservert, og web-leseren og MCP-leseren filtrerer dem eksplisitt.
Legacy-leseren gjør det først etter legacy-cutover, som ikke er med i denne
PR-en (se «Cutover» under). `_ops` finnes ikke før første MCP-skriving.

`mcp/` ligger **utenfor** `families/`. Med dagens security rules kan appen
verken lese eller endre det; bare Admin SDK-et kan.

### Skriveflyten for `shopping_list_add_items`

1. **Langt register:** `mcp/actions/{f}/{requestId}` sjekkes først. Samme
   payload og principal gir replay, ellers `idempotency_conflict`.
2. **Kort register:** `shopping/_ops/{requestId}` sjekkes før varebasen
   røres, så en replay aldri oppretter varer.
3. **Varebasen:** nye varer får en deterministisk id per (familie,
   requestId, navn) og skrives kun hvis id-en er ledig. En retry eller et
   samtidig kall med samme requestId gjenbruker derfor samme vare.
4. **Én RTDB-transaksjon på `families/{f}/shopping`:** updateren
   (`decideAddItems`) beregner alt fra transaksjonens ferske verdi.
   - Finnes `_ops[requestId]`, blir resultatet replay eller konflikt, uten
     mutasjon.
   - Ellers skrives vareendringene og `_ops[requestId]` i én og samme verdi.
   - Endres listen underveis (appen krysser av, retter mengde, sletter),
     kjøres updateren på nytt mot den nye verdien. En endring beregnet fra et
     utdatert øyeblikksbilde blir aldri skrevet, og appens endring overlever.
   - Endrede poster skrives over den **rå** posten, så felt som `id` bevares.
5. **Arkivering:** `mcp/actions` skrives etter commit (best-effort). Feiler
   arkiveringen, står `_ops`-recorden til en senere skriving har reparert
   arkivet.

### Retensjon

- En `_ops`-record beskjæres når den er eldre enn 7 d eller er blant de
  eldste utover 100, men **kun** når `mcp/actions` bekreftet har den.
  Serviceflyten reparerer arkivet fra op-recorden før beskjæring.
- Pruning kan derfor aldri gjøre en gammel retry til en ny mutasjon innenfor
  90 d. Feiler arkiveringen gjentatte ganger, får `_ops` heller vokse over 100.
- `mcp/actions` beskjæres etter 90 d via dagsindeksen, maks 3 dagsbøtter per
  skriving.
- **Etter 90 dager er en requestId utløpt.** Begge registrene er beskåret, og
  samme requestId behandles som en ny forespørsel. requestId er en nøkkel for
  retries av **én** forespørsel (sekunder til minutter), ikke en evig
  idempotensnøkkel. Klienten skal lage en ny UUID per forespørsel.

### Feil og samtidighet

Dekket av `service.test.ts`, og mot ekte RTDB i
`firebaseAdminStore.integration.test.ts`:

- **Feil før commit:** ingenting er skrevet, siden transaksjonen er
  alt-eller-ingenting. Retry utfører handlingen én gang.
- **Tapt svar etter commit:** retry finner `_ops` eller `mcp/actions` og gir
  replay.
- **Samtidige kall med samme requestId:** det ene committer, og det andres
  updater ser `_ops` og gir replay.
- **Appen endrer samme vare midt i transaksjonen:** MCP beregner på nytt fra
  den nye tilstanden. På emulatoren er dette bevist med en frakoblet klient med
  utdatert cache.
- **Gammel array-seed** (`INIT_SHOPPING`, id 1–4): seed-postene bevares, og
  noden blir et objekt med `_ops`.

Kostnad: `_ops` (maks ca. 100 kompakte recorder) lastes ned sammen med
handlelisten av alle klienter.

### Audit

`_ops` og `mcp/actions` er den transaksjonelle audit-posten for skrivinger
(hvem, hva, når og utfall per vare). Annen logging (lesinger, avslag,
arkiveringsfeil) er best-effort JSON-linjer. `safeAudit` sørger for at en
loggfeil aldri kan gjøre en utført skriving om til en feil.

### Cutover (forutsetning før prod-aktivering)

Ved MCP-aktivering skal det finnes **én** aktiv Handleliste-skriver.

**Legacy-cutover er IKKE med i PR #40.** Den er et eget, eksplisitt steg
senere, og **må være gjennomført før MCP-skriving kan aktiveres**. Cutoveren
består av to deler i `index.html`:

- filtrer `_`-nøkler ved lesing av `shopping`;
- gjør Handleliste og generatorens «legg til» skrivebeskyttet.

Uten den leser legacy `_ops` som en vare og helnode-skriver `shopping`.

PWA-cachevinduet er en eksplisitt cutover-risiko også etter cutoveren. En
gammel `index.html` i service worker-cachen (fra før cutover) leser `_ops` som en vare og
helnode-skriver `shopping` ved enhver endring i Handleliste. Da flyttes
`_ops`-innholdet til nøkkelen `"undefined"`, fordi `_ops` ikke har noe `id`.
Varer går ikke tapt, men idempotens-markørene i retry-vinduet gjør det, og
`"undefined"` blir en navnløs rad til den ryddes. Dette skal løses (gammel
skriver gjort ufarlig) eller eksplisitt aksepteres før prod-aktivering.

## Runbook: første ende-til-ende-test (ChatGPT → Handleliste, kun lesing)

Alt i repoet er bygget og testet. Det som gjenstår er eksterne valg og
konsolltrinn. Rekkefølgen under er den korteste veien. Hvert steg krever en
eksplisitt beslutning, og intet av dette gjøres av CI eller av koden selv.

Verifisert lokalt: imaget, en lokal JWKS og RTDB-emulatoren, koblet med
MCP SDK-ets klient. Kjeden er token → JWKS-henting → principal-kobling →
medlemskap → `tools/list` (kun to leseverktøy) → `shopping_list_get` →
`items_search`, og ingenting skrives.

### 1. Velg IdP (authorization server). Leverandøren er IKKE låst

Serveren er en ren resource server. Den validerer et JWT-access-token lokalt
mot IdP-ens offentlige JWKS og slår opp `sub` i en eksplisitt kobling.
Enhver IdP som oppfyller sjekklisten kan brukes, og det eneste som byttes er
miljøvariabler.

| Krav                                                                                                     | Hvorfor                                                                 |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Authorization server-metadata (`/.well-known/oauth-authorization-server` eller OIDC discovery) på issuer | ChatGPT finner IdP-en via `authorization_servers` i RFC 9728-dokumentet |
| Authorization code + PKCE med `S256`                                                                     | Påkrevd av MCP-autorisasjonsspesifikasjonen                             |
| Klientregistrering for ChatGPT: dynamisk (DCR) eller Client ID Metadata Document, ev. statisk klient     | ChatGPT må kunne bli en OAuth-klient                                    |
| `resource`-parameteren (RFC 8707) **eller** fast audience → `aud` = `MCP_RESOURCE_URL`                   | Serveren avviser tokens med feil `aud`                                  |
| Access token er et **JWT signert med RS256**, med offentlig JWKS                                         | Opake tokens kan ikke valideres lokalt                                  |
| Stabil `sub` per bruker                                                                                  | Koblingsnøkkelen `mcp/principals/{sub}`                                 |
| Scopes `shopping:read` og `shopping:write` i `scope`, `scp` eller `permissions`                          | Per-kall-autorisasjon                                                   |
| Tillatt redirect-URI for ChatGPT-connectoren                                                             | Oppgis i ChatGPT-UI-et ved oppsett                                      |
| Refresh tokens (anbefalt)                                                                                | Ellers må brukeren logge inn på nytt når tokenet utløper                |

Google OAuth direkte som AS faller utenfor, fordi access tokenet er opakt og
DCR mangler. Google kan fortsatt være innloggingsmetode **i** IdP-en.
Detaljene i ChatGPTs krav (eksakt redirect-URI, DCR kontra CIMD) må
verifiseres mot OpenAIs gjeldende dokumentasjon når tenanten settes opp.

Dette gir `MCP_AUTH_ISSUER` og eventuelt `MCP_AUTH_AUDIENCE` og
`MCP_AUTH_JWKS_URL`. Standarden for JWKS-URL-en er
`{issuer}.well-known/jwks.json`. Sett `MCP_AUTH_JWKS_URL` hvis IdP-en
publiserer den et annet sted (se `jwks_uri` i discovery).

### 2. Deploy (Cloud Run): IAM-minimum

Låste verdier (Issue #27, 5955907603 / 5956386685):

|                                           |                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------- |
| Prosjekt                                  | `familieapp-a5d15` (nummer `1075494790067`)                       |
| Region                                    | `europe-west1`, samme som Realtime Database                       |
| Tjeneste                                  | `hverdagsflyt-mcp`                                                |
| `MCP_RESOURCE_URL` = Auth0 API Identifier | `https://hverdagsflyt-mcp-1075494790067.europe-west1.run.app/mcp` |
| IdP                                       | Auth0, EU-tenant, RS256                                           |
| `MCP_AUTH_ISSUER`                         | `https://hverdagsflyt.eu.auth0.com/`                              |

**Engangsoppsett: `infra/gcp/mcp-bootstrap.sh`.** Prosjekteier kjører det i
Cloud Shell, etter Kontrolltårn-godkjenning. Uten `--apply` viser skriptet
bare hva det ville gjort. Skriptet er idempotent og stopper hvis
prosjektnummeret ikke stemmer. Det etablerer:

- **Kjøretidsidentiteten** `hverdagsflyt-mcp@…` med kun
  `roles/firebasedatabase.viewer`.
  - Om Admin SDK-lesing faktisk holder med viewer, verifiseres i første
    lesetest. Trengs mer, rapporteres det før noe gis.
  - `roles/firebasedatabase.admin` gis først når skriving aktiveres, etter
    cutover.
- **Deployidentiteten** `hverdagsflyt-mcp-deployer@…`. Den har ingen nøkkel,
  og hver rolle gjelder én ressurs:
  - `roles/run.developer` kun på tjenesten;
  - `roles/artifactregistry.writer` kun på repoet `hverdagsflyt`;
  - `roles/iam.serviceAccountUser` kun på kjøretidsidentiteten.
- **Workload Identity Federation** for GitHub OIDC. Provider-betingelsen
  krever `repository`, `ref == refs/heads/main` og
  `sub == repo:hnasselqvist-netizen/familieapp:environment:mcp-production`.
- **Et ikke-nåbart tjenesteskall:** Googles `hello`-image med
  `--ingress=internal` og Invoker-IAM-sjekken av. Skallet må finnes på
  forhånd av to grunner:
  - Å slå av sjekken krever `run.services.setIamPolicy` (`run.admin`), som
    deployidentiteten ikke skal ha.
  - `run.developer` kan bare bindes til tjenesten når den finnes.

Plassholderen kan ikke nås fra internett. Den første offentlige tjenesten er
vår egen.

**Deploy: `.github/workflows/deploy-mcp-cloudrun.yml`.**

- Den kjøres manuelt, kun fra `main`, med bekreftelsen `les-ekte-data`.
- Alle ikke-hemmelige verdier står i workflowens `env`-blokk, så det finnes
  ingen GitHub-variabler å sette.
- Før noe bygges, bekrefter preflight `MCP_AUTH_ISSUER` mot tenantens
  discovery-dokument. Sjekken krever samme `issuer` og `jwks_uri`, PKCE
  `S256` og RSA-nøkler i JWKS.
- Workflowen bygger og røyktester imaget, pusher det og kjører
  `gcloud run deploy` med `--ingress=all` og `MCP_HANDLELISTE_SKRIVING=av`,
  uten IAM-endring.
- Til slutt verifiserer den tjenesten fra utsiden med
  `scripts/verify-deployed.sh`.

Den gamle testflaten (`deploy-mcp-test.yml`, `mcp-test-harness/` og
service accounten `mcp-test-harness@…`) brukes ikke. Den ryddes når denne
er bevist.

### 3. Første røykprøve mot tjenesten

Deploy-workflowen gjør dette selv. Manuelt:

```bash
scripts/verify-deployed.sh https://hverdagsflyt-mcp-1075494790067.europe-west1.run.app 'https://hverdagsflyt.eu.auth0.com/'
```

Skriptet sjekker `/healthz`, RFC 9728-metadataen (`resource`,
`authorization_servers` og scopes) og 401 med `WWW-Authenticate` uten
token. Det leser ingen data. Svarer `/healthz` med 403, er
Invoker-IAM-sjekken på eller ingress fortsatt `internal`.

### 4. Principal-kobling (etter første innlogging)

Første tilkobling fra ChatGPT gir `not_linked`, og loggen
(`tool_call`-hendelsen) viser IdP-ens `sub`. En operatør med
ADC-tilgang til RTDB kobler den til en eksisterende Firebase-bruker:

```bash
cd mcp-server && npm run build:admin
FIREBASE_DATABASE_URL=… MCP_ALLOW_PRODUCTION_DATA=true \
  node dist/link-principal.js --sub '<sub>' --uid '<firebaseUid>' --family '<familyId>'          # tørrkjøring
# … samme kommando med --apply for å skrive
```

CLI-en nekter å koble noen som ikke er medlem av familien, og overskriver
aldri en annen persons kobling uten `--replace`. `--disable` trekker
tilgangen tilbake uten å slette koblingen. Alternativet er å opprette noden
`mcp/principals/{sub}` = `{ firebaseUid, familyId }` i Firebase-konsollen.

### 5. ChatGPT-connector

Legg til MCP-serveren i ChatGPT med URL-en `MCP_RESOURCE_URL` og OAuth.
ChatGPT finner IdP-en via metadata-dokumentet, og brukeren logger inn. Test
deretter med «Hva står på handlelisten?» og «Har vi melk i varebasen?».
`tools/list` viser bare de to leseverktøyene.

### 6. Skriving (senere, eget steg)

Krever legacy-cutoveren (se «Cutover») og en reviewet endring som setter
`MCP_HANDLELISTE_SKRIVING=aktiv` i workflowen, og
`roles/firebasedatabase.admin` på kjøretidsidentiteten.
