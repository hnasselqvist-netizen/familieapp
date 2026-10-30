# mcp-server — Kontrolltårnets MCP-kontrollflate (foundation)

En MCP-server som lar ChatGPT (Kontrolltårnet-pluginen) lese og endre
Hverdagsflyt-data gjennom **typed, autoriserte verktøy**, i stedet for at
ChatGPT-hostet kode får Firebase-tilgang. Første vertikale skive er
**Handleliste**. Beslutningsgrunnlaget ligger i Issue #27: arkitekturen i
5936590112/5936720705, designet i 5936936743 og godkjenningen i 5937138669.

> **Status 30.10.2026: deployet med lesing og generell skriving.** Tjenesten kjører
> på Cloud Run mot ekte data. Lesing (`data:read`) og generell skriving (`data_skriv`,
> `data:write`, kun Helen) er i bruk. Første ekte skrivinger (handleliste og en
> transaksjon i Forvaltning) er bekreftet etter Runbook steg 8.
> Disse sperrene gjelder uansett hvor den kjører:
>
> - `main.ts` nekter å starte mot ekte RTDB uten en eksplisitt
>   `MCP_ALLOW_PRODUCTION_DATA=true`.
> - Skriveverktøyene finnes ikke med mindre `MCP_HANDLELISTE_SKRIVING=aktiv`
>   (se «Skrivesperre») eller `MCP_DATA_SKRIVING=aktiv` (se «Generell skriving»).
> - Deploy-workflowen setter `MCP_DATA_SKRIVING=aktiv` og
>   `MCP_HANDLELISTE_SKRIVING=av` eksplisitt, og endrer ingen IAM-policy.
>   Kjøretidsidentitetens skriverett er gitt av prosjekteier (Runbook steg 8).
>
> Runbooken nederst beskriver oppsettet steg for steg.

## Kommandoer

Fra `mcp-server/`:

```bash
npm install
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
npm run test:integration   # Admin-adapteren + koblings-CLI-en mot RTDB-emulatoren (krever Java)
npm run build:admin        # operatør-CLI-ene → dist/add-member.js, dist/link-principal.js og dist/handleliste-overgang.js
```

Container (fra **repo-roten**, fordi bundelen henter delte regler fra `web/src/domain`):

```bash
docker build -f mcp-server/Dockerfile -t hverdagsflyt-mcp:local .
mcp-server/scripts/smoke-container.sh hverdagsflyt-mcp:local
```

Røyktesten sjekker `/health`, RFC 9728-metadata, 401 med `WWW-Authenticate`,
prod-sperren, at en ugyldig skrivebryter stopper oppstart, at prosessen ikke
kjører som root, og ryddig stopp på SIGTERM. CI kjører den samme på hver PR
(jobben `mcp-container`, uten push).

## Struktur

```
src/
  handleliste/   schemas (typed kontrakt), plan (ren planlegger), views (lesing/søk),
                 shoppingNode (ren tolkning av shopping-noden + transaksjonsbeslutningen),
                 service (idempotens-orkestrering) — kjenner kun store-PORTEN
  forvaltning/   cutoverKontroll (ren, skrivefri strukturkontroll av forsoningsnodene),
                 fortegn (klassifisering av de to kjente fortegnshendelsene),
                 transaksjonSok (filtrert, skrivefritt transaksjonssøk), schemas
  data/          full lesing: sti (validering + RTDB-nøkkelorden), side (sidedeling uten
                 tap), schemas
  auth/          tokens (JWT/JWKS-validering), protectedResource (RFC 9728 +
                 WWW-Authenticate), authorize (scope → kobling → medlemskap per kall)
  store/         types (porten), memoryStore (fake med RTDB-semantikk + feilinjeksjon),
                 firebaseAdminStore (Admin SDK), storeContract (felles kontrakttest),
                 skrivebeskyttet (skrivevakt for full lesing)
  mcp/server.ts  verktøyregistrering, feil → isError-resultater
  http/app.ts    Node-handler: /mcp, /.well-known/oauth-protected-resource, /health
  admin/         principal-koblinger: ren planlegging + operatør-CLI (linkPrincipal.ts)
  app.ts         kobler lagene; main.ts er kjøretidsinngangen (SIGTERM → ryddig stopp)
scripts/smoke-container.sh   røyktest av et ferdigbygd image (CI og lokalt)
Dockerfile (+ Dockerfile.dockerignore)   bygges fra repo-roten
```

Grensene håndheves av `eslint.config.js`:

- `handleliste/`, `auth/`, `forvaltning/` og `data/` importerer aldri Firebase, HTTP eller MCP-SDK-et.
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

`forvaltning_cutover_kontroll` (nivå 0, `forvaltning:read`, `{ forrige?, endretEtter? }`),
`shopping_cutover_kontroll` (nivå 0, `shopping:read`, ingen input), full lesing med
`data_nokler` / `data_les` (nivå 0, `data:read`) og generell skriving med `data_hent`
(nivå 0, `data:read`) / `data_skriv` (nivå 1, `data:write`) og transaksjonssøket
`transaksjon_sok` (nivå 0, `data:read`) er beskrevet i egne seksjoner under.

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

## Cutover-kontroll for handlelisten (`shopping_cutover_kontroll`)

Skrivefri grunnlinje for `families/{f}/shopping` før en eventuell overgang til én aktiv skriver
av handlelisten (Mat #20). Den erstatter manuell lesing av noden.
Operatør-CLI-en `handleliste-overgang kontroll`
([ADR 0003, forslag](../docs/beslutninger/0003-handleliste-en-aktiv-skriver.md)) bruker den samme
klassifiseringen.

- **Ingen skrivevei og ingen input.** Verktøyet kjører `authorizeToolCall` (principal →
  medlemskap → familie, `shopping:read`), én `store.readShoppingNode` for egen familie, og
  den rene `kontrollerHandleliste` (`src/handleliste/overgangKontroll.ts`). Argumenter som
  forsøker å velge familie eller sti, ignoreres.
- **Ingen rådata.** Svaret inneholder aldri navn, mengder eller historikkinnhold, og feil har
  bare generelle koder.
- **Rettigheter.** Verktøyet leser den samme noden som `shopping_list_get`, med samme scope og
  samme kjøretidsidentitet. Det trengs ingen ny scope, IAM- eller OAuth-endring.

| Felt                                              | Innhold                                                                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `format`, `lest`                                  | Formatversjon (2) og tidspunkt for lesingen.                                                                          |
| `form`, `strukturOk`                              | `mangler`, `objekt`, `array` eller `ugyldig` (primitiv verdi).                                                        |
| `markor`                                          | `ok` (nøyaktig `HANDLELISTE_MARKOR`), `mangler` eller `feil`.                                                         |
| `antallVarer`, `antallFullfort`, `antallUtenNavn` | Ikke-`_`-nøkler med og uten streng-`name`. Nøkkelen `undefined` telles for seg.                                       |
| `antallUtenId`                                    | Slike poster uten ikke-tom streng-`id`. Legacy nøkler hele noden på `i.id`, så de kolliderer under `undefined`.       |
| `undefinedForm`                                   | `mangler`, `ops`, `markor`, `vare` eller `annet`. `undefined` er det `_ops` blir til etter en legacy-helnodeskriving. |
| `antallOps`, `antallAngremerker`                  | Tellinger.                                                                                                            |
| `antallSammenslatt`                               | Poster med gyldig `sammenslaing.opId`. Telles på alle poster, også navnløse og `undefined`.                           |
| `antallHistorikkUavklart`                         | Poster med `sammenslaing`/`sammenslaingAngret` som ikke kan tolkes. Er aldri «trygt fravær».                          |
| `digestUtenMarkor`                                | sha256 av kanonisk JSON uten markøren. Array og objekt sammenlignes i samme nøkkelform.                               |
| `stopp`, `stoppKoder`                             | `ugyldig_form`, `markor_avvik` og `historikk_uavklart`. Tom liste betyr OK; manglende markør er ikke stopp.           |
| `legacyIdentitet`                                 | Preflight (ikke stopp): ville en legacy-skriving beholde hver oppføring under sin nøkkel? Se ADR 0003.                |

Skrivermarkøren (`shopping/_skriver`) har et fast, vareformet format uten `id`. Den er
beskrevet i `HANDLELISTE_MARKOR`. Kontrollen bare rapporterer markøren; den skriver aldri en.

Ordinær kodedeploy (`deploy-mcp-cloudrun.yml`, manuell) gjør verktøyet synlig i `tools/list`.
Ved behov oppdateres ChatGPT-connectoren. Skrivesperren og IAM er uendret.

## Full lesing (`data_nokler`, `data_les`)

Helen har bedt om at Claude skal kunne lese alle hennes Hverdagsflyt-data, også økonomi,
historikk og Mat. Kontrolltårnet har formidlet bestillingen i #27 (6362495145).
Verktøyene gir full, sidedelt **lesing** av alt under `families/{familyId}`. De gir ingen
skriving.

- **Egen scope `data:read`.** Andre scopes gir ikke tilgang, og `data:read` gir ingen
  skriving. Autorisasjonen er den samme som ellers (`authorizeToolCall`): scope, så
  principal-kobling, så at koblingen ikke er deaktivert, så medlemskap. Det sjekkes
  ved hvert kall.
- **Bare egen familie.** `sti` er relativ til `families/{familyId}` for familien koblingen
  gir. Hvert segment må være en gyldig RTDB-nøkkel. `..`, `/` først eller sist, tomme
  segmenter, `. # $ [ ]` og kontrolltegn gir `invalid_path`. `mcp/` og andre familier kan
  ikke nås. Et `familyId`-argument blir ignorert.
- **`data_nokler { sti, etter?, antall? }`** gir nøklene under en sti, uten verdiene
  (RTDB-REST `shallow=true`). Med tom sti får man alle toppnodene, også nye som appen
  ennå ikke kjenner. Nøklene sorteres i RTDB-ens nøkkelorden og deles i sider med
  `etter`/`neste`.
- **`data_les { sti, etter?, antall?, maksBytes?, fraTegn? }`** gir barna med **fulle
  verdier**, med alle felt, nestede og ukjente felt og all historikk. Barna kommer i
  RTDB-ens nøkkelorden (`orderByKey`) og deles i sider med `etter`/`neste`. Ingenting kuttes:
  - Et barn som alene er større enn `maksBytes`, kommer som
    `forStor: { bytes, type, antallBarn | lengde }`. Det leses på sin egen sti (`sti/nøkkel`).
  - En lang tekst, for eksempel et base64-kvitteringsbilde, leses i deler med
    `fraTegn`/`nesteFraTegn`.
  - En primitiv verdi gir `type: "verdi"`, og en sti som ikke finnes gir `type: "mangler"`.
- **Begrensninger, presist** (Kontrolltårn-review av #80, 5627463106):
  - `maksBytes` er en **omtrentlig grense for svaret**, ikke for det som hentes. Admin SDK-et
    henter hele verdien til hvert barn på siden (`antall + 1` barn) før serveren avgjør om
    det skal komme med eller rapporteres som `forStor`. Et stort barn lastes altså inn i
    serveren selv om svaret bare viser størrelsen.
  - Tekstdeler måles i **UTF-16-tegn** (JavaScripts `string.length`), ikke serialiserte
    byte. For base64 og ASCII er det det samme, men flerbytetegn gir et større svar enn
    `maksBytes`.
  - Sidedelingen er **ikke et konsistent øyeblikksbilde**. Hver side leses for seg, så
    endringer mellom to kall kan gi en blanding av før og etter. Markøren er nøkkelbasert,
    så ingen nøkkel hoppes over eller gjentas av sidedelingen selv. Et barn som legges til
    eller slettes underveis, kan likevel mangle eller komme med.
- **Ingen skrivevei.** Det finnes tre lag:
  1. Verktøyene er `readOnlyHint`, og porten har bare lesemetoder for dette.
  2. All lesing går gjennom `store/skrivebeskyttet.ts`. Vakten avviser `set`, `update`,
     `remove`, `push`, `transaction`, `setWithPriority`, `setPriority` og `onDisconnect`
     før noe sendes. Det gjelder også via `child`, `root`, `parent` og spørringer. Den
     grunne nøkkellistingen er bare `GET`.
  3. Leseverktøyene (`data_nokler`, `data_les`, `data_hent`) går alltid gjennom
     skrivevakten. Kjøretidsidentiteten har siden Runbook steg 8 også skriverett
     (`roles/firebasedatabase.admin`), men den brukes bare av `data_skriv`, som
     har egen scope, egen sperre og egen transaksjonsvei.
- **Testet** med syntetiske data mot RTDB-emulatoren
  (`store/dataLesing.integration.test.ts`, kontrakten i `store/storeContract.ts`):
  - Hele familienoden leses tilbake identisk: nestede og ukjente felt, arrays, glisne
    arrays, lange tekster og mange barn.
  - Nøkkelordenen er lik serverens.
  - Skrivevakten avviser alle skrivemetoder på en ekte `Database`.
  - En annen familie kan ikke nås, og scope og medlemskap kreves.
  - Databasen er kanonisk uendret etterpå.
- **Logg.** `tool_call`-hendelsen logger verktøy, `sub`, `familyId` og utfall, aldri
  stier eller innhold. Svarene går bare til den autoriserte klienten. Ingen data havner i
  repoet, Actions eller artefakter.

Tilkobling, engangssteg og tilbaketrekking står i Runbook, steg 7.

## Generell skriving (`data_hent`, `data_skriv`)

Helen har gitt full skrivetilgang til egen families data (#27, 6509067353, og direkte
instruks 30.10.2026). Kontrakten ble reviewet i #27 (6514058564, 6514708855). Verktøyene
kan opprette, endre og slette hvor som helst under `families/{familyId}`, også i nye
domener som appen ennå ikke kjenner. Det finnes ingen domeneliste og ingen verktøy per
domene. Koden ligger i `data/skriving.ts` (ren kontrakt og beslutning),
`data/dataSkriving.ts` (I/O-rekkefølge) og `data/versjon.ts`.

- **Egen scope `data:write`** for `data_skriv`. `data_hent` er lesing og krever
  `data:read`. `data:write` gir ingen lesing, og `data:read` gir ingen skriving.
  Autorisasjonen er den samme som ellers: scope, kobling, at koblingen ikke er
  deaktivert, og medlemskap per kall. Medlemskapet sjekkes i tillegg på nytt inne i
  transaksjonen. Er det trukket tilbake mellom autorisasjonen og transaksjonen, gir
  kallet `not_member`, og ingenting skrives.
- **Egen sperre:** `data_skriv` finnes bare når `MCP_DATA_SKRIVING=aktiv`. Bryteren er av
  som standard. Deploy-workflowen setter den eksplisitt til `aktiv` etter Runbook steg 8
  (tilbaketrekking: sett den til `av` og deploy). Den er uavhengig av
  `MCP_HANDLELISTE_SKRIVING`, som fortsatt er av.
- **`data_hent { sti }`** gir `{ verdi, versjon, bytes }` fra **én** `get()`, altså
  samme snapshot. Versjonen er grunnlaget for skriving. Den sidedelte `data_les` gir
  ingen versjon og er aldri et skrivegrunnlag. Over 500 000 byte svarer verktøyet
  `forStor` uten verdi og uten versjon, og klienten må hente en smalere sti. Roten gis
  uten `_mcp`.
- **`data_skriv { opId, ops }`:** alle operasjonene lagres i **én** RTDB-transaksjon på
  `families/{f}`, alt eller ingenting. Kvitteringen ligger i samme transaksjon.
  - `set`: erstatter noden på `sti` med `verdi`. `forventet` er nodens versjon.
  - `update`: erstatter bare de navngitte direkte barna. `verdi` er
    `{ nøkkel: ny verdi }`, og `forventet` er `{ nøkkel: versjon }`. Urørte søsken
    bevares, også om appen endrer dem samtidig.
  - `slett`: fjerner noden. `forventet` er nodens versjon.
  - **Validering:**
    - Det skrives aldri blindt. Hver posisjon må ha forventet versjon fra `data_hent`,
      eller `"mangler"`. Avviker én, skrives ingenting, og svaret er `konflikt` med alle
      nåværende versjoner.
    - Ingen `null`, tomme objekter eller lister, ikke-endelige tall eller `-0` i
      `verdi`, fordi RTDB ville endret dem stille.
    - Nøkler valideres som stisegmenter, og `__proto__`, `constructor` og `prototype`
      avvises.
    - Overlappende posisjoner i samme kall avvises.
    - Er en forelder i dag en enkeltverdi, avvises kallet (`forelder_er_verdi`) i stedet
      for at verdien erstattes stille.
- **Versjon** (`data/versjon.ts`): sha256 av RTDB-ens lagringsform. Arrays er
  indeksobjekter, `null` og tomme noder finnes ikke, nøklene sorteres, og typene skilles.
  Prioriteter er ikke med, og appen bruker ingen. Den samme rene funksjonen brukes i
  `data_hent`, inne i transaksjonen, i kvitteringen og i tilbakelesingen. Rotversjonen
  tar aldri med `_mcp`, så kvitteringen kan ikke inngå i sin egen versjon.
- **Beskyttede felt, eksakt liste:**

  | Felt                | Hva det er                           |
  | ------------------- | ------------------------------------ |
  | `_mcp`              | kvitteringer                         |
  | `members`           | tilgangsstyring, ikke familiedata    |
  | `shopping/_skriver` | handlelistens skrivermarkør          |
  | `shopping/_ops`     | handlelistens markør for operasjoner |
  - En posisjon på eller under et beskyttet felt gir `beskyttet`.
  - **Avvik fra ren RTDB:** `set` eller `slett` på en forelder bevarer de beskyttede
    barna. `verdi` kan da ikke inneholde dem og må være et objekt, ikke en enkeltverdi
    eller liste.
  - Svaret lister `bevart`, og `etter` er versjonen av den faktisk lagrede formen.
  - `slett` på familieroten etterlater altså `members`, `_mcp` og handlelistens markør
    og ops.
  - Sammenslåings- og angrehistorikk i handlelisten er vanlige felt. En endring av en
    sammenslått rad gjør at appen nekter å angre sammenslåingen senere, i stedet for å
    overskrive endringen. Det er dagens oppførsel og videreføres.

- **Idempotens og utløp:**
  - `opId` skrives `ÅÅÅÅ-MM-DD_<tilfeldig>` med UTC-datoen. Datoen er en del av id-en,
    så et beskåret opId kan aldri bli nytt.
  - Et kjent opId gir `replay` hvis payload og principal er de samme, ellers
    `idempotency_conflict`. Ingen av dem skriver noe.
  - Et ukjent opId med dato eldre enn 30 dager, eller lik eller eldre enn
    `_mcp/vannmerke` (siste beskårne dato), gir `utlopt`.
  - En dato mer enn én dag fram gir `ugyldig_skriving`.
  - Kvitteringer eldre enn 31 dager beskjæres bare i en ny, committet skriving, aldri
    ved replay eller avvisning.
- **Utfall:**

  | Utfall                                                                                                                                             | Betydning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
  | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `committed`                                                                                                                                        | `skrivinger` gir før- og etterversjon og `bevart`. `tilbakelesing` er en skrivefri lesing etterpå.                                                                                                                                                                                                                                                                                                                                                                                               |
  | `committed` med `senereEndret: true`                                                                                                               | Appen har endret noe etter commit. Det er ikke en feil, og klienten skal ikke «rette» det.                                                                                                                                                                                                                                                                                                                                                                                                       |
  | `committed` med `tilbakelesing: { ok: false }`                                                                                                     | Tilbakelesingen feilet, men dataene er lagret.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
  | `replay`                                                                                                                                           | Den lagrede kvitteringen. Ingen ny skriving.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
  | Feil: `konflikt`, `beskyttet`, `invalid_path`, `ugyldig_skriving`, `forelder_er_verdi`, `utlopt`, `for_stor`, `idempotency_conflict`, `not_member` | Garantert ingen skriving.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
  | `ukjent_utfall` (retryable)                                                                                                                        | Transaksjonen kastet, ingen matchende kvittering ble funnet, og det er ikke bevist at forsøket ikke ble lagret (f.eks. `disconnect`, eller kvitteringen kunne ikke leses). Prøv igjen med samme opId. Kvitteringen ligger i samme transaksjon, så et nytt forsøk gir aldri dobbel skriving. `detaljer.grunn` er med når grunnen er kjent.                                                                                                                                                        |
  | `skriving_feilet` (retryable, samme opId)                                                                                                          | Firebase avviste eller avbrøt DETTE forsøket med en grunn som beviser at det ikke ble lagret, og kvitteringen ble lest og mangler. Et annet forsøk med samme opId kan likevel committe, så klienten beholder opId-et. `detaljer.grunn` er et fast token (`permission_denied`, `maxretry`, `ugyldig_data`, `too_big`, `set`, `intern` …), og `vedvarende` sier om et nytt forsøk feiler på samme måte til årsaken er rettet. Kan kvitteringen ikke leses eller tolkes, er svaret `ukjent_utfall`. |

- **Kald cache:** Admin SDK-et kjører ellers transaksjonens updater først mot en tom
  lokal cache. Adapteren holder derfor en `value`-lytter på familienoden mens
  transaksjonen kjører. Motprøve mot emulatoren: uten lytteren gir en fersk Admin-app
  falsk `not_member` (11 av 17 integrasjonstester feiler). En fersk `get()` alene hjelper
  ikke. En avvisning verifiseres i tillegg mot en fersk lesing, slik at en cache som
  henger etter ikke gir falsk konflikt.
- **Størrelse** (#85-review 5709352689): Admin SDK-transaksjonen sender **hele**
  familienoden som én write. Firebase tillater 16 MB per SDK-write
  (https://firebase.google.com/docs/database/usage/limits), og SDK-et avviser en enkelt
  tekst over 10 485 760 byte (verifisert mot emulatoren). Derfor:
  - **Skrivebudsjett 15 MB** (`MAKS_FAMILIE_SKRIVE_BYTES`). Den komplette kandidaten,
    med data, kvittering og beskjæring, kontrolleres før commit. Over grensen svarer
    verktøyet `for_stor` (`grunn: "skriving"`), og ingenting skrives.
  - **Lesebudsjett 64 MB** (`MAKS_FAMILIE_LESE_BYTES`) for det som lastes. Det er høyere
    enn skrivebudsjettet, så en endring som gjør en for stor familie mindre, fortsatt går.
  - **Tekst over 10 485 760 byte** i `verdi` avvises før transaksjonen.
  - **Per kall:** HTTP-laget tar imot maks 256 KiB per forespørsel og svarer 413 før noe
    leses eller skrives. Skrivekjernen er samordnet med det: maks 200 000 byte samlet
    `verdi` per kall (`MAKS_SKRIV_BYTES`). Større enkeltverdier, som bilder, krever at
    begge grensene økes sammen etter en egen beslutning.
  - **Målt** skrivefritt 30.10.2026 til ca. 8,1 MB JSON. Mest er `_fase4_backup`
    (3,8 MB), `receipts` (2,9 MB), `transaksjoner` (0,76 MB) og `hendelser` (0,43 MB).
    Bare byte per toppnode ble målt, ingen verdier. Det gir omtrent 7 MB å vokse på.
  - 15 MB er en kodegrense under Firebases dokumenterte grense, ikke målt driftskapasitet.
    Er en skriving treg i praksis, eller nærmer noden seg grensen, er en mindre
    familienode tiltaket, for eksempel å flytte `_fase4_backup` ut etter Helens
    beslutning. Det gjøres ikke av denne koden.
- **Logg** (#85-review 5709352689):
  - `data_skriv_committed` logger opId og antall per type. Den logger aldri stier, fordi
    nøkler kan være brukertekst som varenavn. Den logger heller aldri verdier, eller
    versjoner, siden digesten av en kort verdi kan gjettes. Hele kvitteringen ligger i
    `_mcp/ops/{opId}`.
  - Feil logges bare som en fast `feilklasse` og en `feilkode` fra en liten allowlist
    (`audit/log.ts` §`tryggFeil`). Klassen avgjøres med `instanceof`, aldri med
    `err.name`. Ukjente koder og navn droppes, og melding, stack og payload logges
    aldri. Funksjonen kaster ikke, heller ikke for kastende gettere. Det gjelder også
    `tool_call` og `http_error` for alle verktøy.
  - Audit er best-effort: en loggfeil endrer aldri utfallet, og `committed` står.
- **Testet:**
  - Enhetstester i `data/skriving.test.ts`, `data/dataSkriving.test.ts` og
    `http/app.test.ts`.
  - Mot RTDB-emulatoren i `store/dataSkriving.integration.test.ts`:
    - en fersk Admin-app med kald cache
    - versjonslikhet mellom `get` og transaksjon
    - tapt svar etter commit og retry
    - opId-kollisjon med annet mål eller annen principal
    - beskjæring og utløp
    - `set` og `slett` på roten og `shopping` med metadata
    - samtidige appendringer i berørte og urørte felt, også midt i transaksjonen
    - `senereEndret`
    - alle skriveformer over ekte MCP-HTTP
    - familieisolasjon, scope og medlemskap
    - en ekte sammenslåing laget og angret med appens egen domenelogikk
      (`lagPlan`, `anvendSammenslaing`, `angreSammenslaing`):
      - en `update` på beholdt rad gir konflikt ved angring, og endringen, historikken og
        de rå feltene står;
      - en ubeslektet endring lar sammenslåingen angres eksakt, uten duplikater;
    - audit som kaster, canary i feilmelding, -navn og -kode, og skrivegrensen

  Det finnes ingen automatiserte tester mot produksjon.

## Transaksjonssøk (`transaksjon_sok`)

Helen bestilte søket 30.10.2026 (#27/#59). Det finner presise transaksjoner i Forvaltning
uten at hele transaksjonslisten eller rå bankrader hentes inn i samtalen. Et eksempel er
«fem transaksjoner fra Eivinds konto merket felles». Søket er bare lesing: to `get()` av
`transaksjoner` og `hendelser` gjennom skrivevakten, med scope `data:read` fordi treffene
har tekst og beløp. Koden ligger i `forvaltning/transaksjonSok.ts`.

- **Samme semantikk som appen, uten kopi.** Søket bruker appens rene funksjoner fra
  `web/src/domain/forsoning` (`normaliserKonto`, `finnHendelseForTransaksjon`,
  `beskrivTilstand`). Modulgrensen i `eslint.config.js` er utvidet med nøyaktig disse tre
  modulene.
- **Filtrene kan kombineres (alle må stemme):**
  - `konto`: kontonøkkelen fra kontofilteret i Transaksjoner, altså `MC`, `regningskonto`,
    `felleskonto`, `helen`, `eivind` eller `krav`. Den hentes fra `konto`, og ellers fra
    `importkilde`.
  - `ansvar`: felles eller privat. Ansvaret ligger på **hendelsen**, ikke på
    transaksjonen. Søket treffer når personen (for eksempel «Felles») har en andel over 0
    i minst én fordeling. En transaksjon uten hendelse har ikke noe plassert ansvar.
  - `tekst`: del av banktekst eller motpart. Store og små bokstaver regnes likt, som i
    kontrolloversikten.
  - `fraDato` / `tilDato`: `ÅÅÅÅ-MM-DD`, begge inklusive.
  - `status`: én eller flere av kategoriene i kontrolloversikten (`ferdig`, `pa_vent`,
    `intern`, `ignorert`, `forslag`, `krever_vurdering`, `matchet_uten_hendelse`,
    `uferdig`).
- **Sider:**
  - Treffene kommer nyest først. Ved lik dato sorteres de på nøkkel.
  - En side har 1–100 treff (25 som standard). `antallTreff` er det samlede antallet.
  - Markøren `neste` er (dato, nøkkel), så sidene er stabile også når nye transaksjoner
    kommer til underveis.
- **Treffet** har bare det som trengs for å følge opp:
  - `sti` og `versjon`, de samme som `data_hent` gir;
  - id, dato, tekst, beløp, retning, konto og status;
  - `hendelse` (sti og versjon) og fordelingene med post, beløp og eiere.

  Endringer gjøres alltid med `data_hent` på stien og deretter `data_skriv`.

- **Testet:**
  - `forvaltning/transaksjonSok.test.ts`: hvert filter og kombinasjoner, tomme treff,
    paginering, at søket ikke muterer data, og at versjonen er lik den `data_hent` gir.
  - `http/app.test.ts`: over MCP, med scope og familieisolasjon.
  - `store/transaksjonSok.integration.test.ts`: mot emulatoren, med legacy-arrayer som
    har hull, og med kontroll av at databasen er uendret etterpå.

## Cutover-kontroll for Forvaltning (`forvaltning_cutover_kontroll`)

Skrivefri kontroll av forsoningsnodene `families/{f}/transaksjoner|hendelser|receipts|rules`
før og etter R3b-cutover (Issue #34, Kontrolltårn-beslutning 5971770332).
Den erstatter manuell JSON-eksport og Helens fortegns-forhåndsvisning.

- **Ingen skrivevei.** Verktøyet kaller bare `store.readForsoningsnoder` (fire `get()`)
  og den rene `forvaltning/cutoverKontroll.ts`. Store-porten har ingen skrivemetode
  for disse nodene. Verktøyet finnes uavhengig av skrivesperren.
- **Egen scope `forvaltning:read`.** Shopping-scopes gir ikke tilgang, og
  `forvaltning:read` gir ikke tilgang til handlelisten. Autorisasjonen er den samme
  som for de andre verktøyene: kobling og medlemskap per kall, og `familyId` kommer
  aldri fra forespørselen.
- **Ingen innholdsdata ut:** bare antall, opake id-er (som eksempler på avvik, maks 20)
  og hasher. Beløp, tekster, datoer og bilder forlater aldri serveren. Unntaket er
  beløpene til de to kjente fortegnshendelsene.
- **Retter aldri noe.** «trenger_retting» er bare en klassifisering.

### Hva rapporten inneholder

| Felt                     | Innhold                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `vurdering`              | `strukturOk` (alle noder er legacy-arrays med `id`, uten hull og duplikater) og `merknader` på norsk                                     |
| `noder.{node}`           | `form` (`tom`/`array`/`array_med_hull`/`objekt`/`ugyldig`), `antall`, `hull`, `utenId`, `dupliserteIder`, `fordeling` (status), `digest` |
| `kvitteringsbilder`      | Antall med Drive-lenke, base64-`imageUrl`, annen `imageUrl` og forkastede                                                                |
| `referansebrudd`         | Per id-felt (f.eks. `hendelser.receiptId→receipts`): antall som peker på noe som ikke finnes, og eksempel-id-er                          |
| `fortegn`                | `msoknxe09eop` og `msoknxe0960s`: `allerede_korrekt`, `trenger_retting`, `hoppet_over` (med legacy sin begrunnelse) eller `finnes_ikke`  |
| `sammenligningsgrunnlag` | Digest per node og per bøtte (16 bøtter etter sha256(id)). **Send det tilbake som `forrige`** i neste kall                               |
| `sammenligning`          | Bare med `forrige`: per node `antallFor`/`antallEtter`, `endret`, `endredeBotter`, og endring i antall referansebrudd                    |
| `endretEtter`            | Bare med `endretEtter`: elementer med tidsstempel ≥ tidspunktet (`ider`), og elementer koblet til dem via referanse (`viaReferanse`)     |

Med både `forrige` og `endretEtter` får hver node `uforklarteBotter`: bøtter som er endret
uten at noe element i dem er endret etter tidspunktet, verken direkte eller via referanse.
Slike bøtter meldes også i `merknader`.

**Fortegnsklassifiseringen** er en port av legacy `kjorFortegnsRecoveryDrivstoffRabatt`.
Den er differensielt testet mot koden, trukket ordrett ut av `index.html`
(`fortegn.legacy.test.ts`), og har en mutasjonsrunde der 9 av 9 mutanter ble drept.

### Prosedyre ved cutover

1. **Før:** kall uten argumenter. Ta vare på `sammenligningsgrunnlag`, `lest`,
   `referansebrudd` og `fortegn`. Eksisterende referansebrudd er historikk og blokkerer
   ingenting, men de skal ikke øke.
2. **Etter:** kall med `forrige` = grunnlaget fra steg 1 og `endretEtter` = `lest` fra steg 1.
   Forventet resultat:
   - `strukturOk: true`;
   - ingen nye referansebrudd;
   - endringene i `endretEtter` (inkludert `viaReferanse`) er røyktesten og React sine
     bakgrunnsforslag i `receipts`;
   - `uforklarteBotter` er tom.

### Eksempel (generert fra koden)

Før-kallet (utdrag): én hendelse trenger fortegnsretting, den andre er allerede korrekt.
De to referansebruddene er historiske.

```json
{
  "format": 1,
  "lest": "2026-10-04T18:00:00.000Z",
  "vurdering": { "strukturOk": true, "merknader": [] },
  "noder": {
    "hendelser": {
      "form": "array",
      "antall": 3,
      "hull": [],
      "ikkeArrayNokler": [],
      "ugyldigeElementer": 0,
      "utenId": { "antall": 0, "nokler": [] },
      "dupliserteIder": [],
      "fordeling": { "ferdig": 3 },
      "digest": "9f648c0d1e8dfa0c"
    }
  },
  "kvitteringsbilder": { "drive": 1, "base64": 1, "annenImageUrl": 0, "forkastet": 0 },
  "referansebrudd": [
    {
      "type": "hendelser.transaksjonId→transaksjoner",
      "antall": 2,
      "eksempler": ["msoknxe09eop", "msoknxe0960s"]
    }
  ],
  "fortegn": [
    { "id": "msoknxe09eop", "resultat": "trenger_retting", "belop": 9.27, "rettetBelop": -9.27 },
    { "id": "msoknxe0960s", "resultat": "allerede_korrekt", "belop": -1 }
  ],
  "sammenligningsgrunnlag": {
    "lest": "2026-10-04T18:00:00.000Z",
    "noder": {
      "hendelser": { "antall": 3, "digest": "9f648c0d1e8dfa0c", "botter": ["…16 digester…"] }
    },
    "referansebrudd": { "hendelser.transaksjonId→transaksjoner": 2 }
  }
}
```

Etter-kallet, etter én Bankimport-beslutning: transaksjonen `t2` er koblet til den nye
hendelsen `h9`. Transaksjonen har ikke tidsstempel, men er forklart via referansen.

```json
{
  "vurdering": { "strukturOk": true, "merknader": [] },
  "sammenligning": {
    "forrigeLest": "2026-10-04T18:00:00.000Z",
    "noder": {
      "transaksjoner": {
        "antallFor": 3,
        "antallEtter": 3,
        "endret": true,
        "endredeBotter": ["c"],
        "uforklarteBotter": []
      },
      "hendelser": {
        "antallFor": 3,
        "antallEtter": 4,
        "endret": true,
        "endredeBotter": ["a"],
        "uforklarteBotter": []
      },
      "receipts": {
        "antallFor": 2,
        "antallEtter": 2,
        "endret": false,
        "endredeBotter": [],
        "uforklarteBotter": []
      },
      "rules": {
        "antallFor": 1,
        "antallEtter": 1,
        "endret": false,
        "endredeBotter": [],
        "uforklarteBotter": []
      }
    },
    "referansebrudd": []
  },
  "endretEtter": {
    "tidspunkt": "2026-10-04T18:00:00.000Z",
    "noder": {
      "transaksjoner": { "antall": 0, "ider": [], "viaReferanse": { "antall": 1, "ider": ["t2"] } },
      "hendelser": { "antall": 1, "ider": ["h9"], "viaReferanse": { "antall": 0, "ider": [] } },
      "receipts": { "antall": 0, "ider": [], "viaReferanse": { "antall": 0, "ider": [] } },
      "rules": { "antall": 0, "ider": [], "viaReferanse": { "antall": 0, "ider": [] } }
    }
  }
}
```

### Før første kall mot ekte data

1. **IdP:** `forvaltning:read` må finnes på Auth0-API-et (Permissions), og med RBAC
   også gis til brukeren. ChatGPT ber om scopen ved første kall, via `insufficient_scope`
   og `WWW-Authenticate`.
2. **Redeploy** med den eksisterende manuelle `deploy-mcp-cloudrun.yml`. Ingen ny IAM:
   kjøretidsidentiteten har allerede `roles/firebasedatabase.viewer`. Om Admin SDK-lesing
   holder med viewer, bekreftes av første kall. Trengs mer, rapporteres det før noe gis.

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
   operatør med `link-principal`, etter at `add-member` har sikret medlemskapet (se Runbook, steg 4).
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

| Krav                                                                                                             | Hvorfor                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Authorization server-metadata (`/.well-known/oauth-authorization-server` eller OIDC discovery) på issuer         | ChatGPT finner IdP-en via `authorization_servers` i RFC 9728-dokumentet |
| Authorization code + PKCE med `S256`                                                                             | Påkrevd av MCP-autorisasjonsspesifikasjonen                             |
| Klientregistrering for ChatGPT: dynamisk (DCR) eller Client ID Metadata Document, ev. statisk klient             | ChatGPT må kunne bli en OAuth-klient                                    |
| `resource`-parameteren (RFC 8707) **eller** fast audience → `aud` = `MCP_RESOURCE_URL`                           | Serveren avviser tokens med feil `aud`                                  |
| Access token er et **JWT signert med RS256**, med offentlig JWKS                                                 | Opake tokens kan ikke valideres lokalt                                  |
| Stabil `sub` per bruker                                                                                          | Koblingsnøkkelen `mcp/principals/{sub}`                                 |
| Scopes `shopping:read`, `shopping:write`, `forvaltning:read` og `data:read` i `scope`, `scp` eller `permissions` | Per-kall-autorisasjon                                                   |
| Tillatt redirect-URI for ChatGPT-connectoren                                                                     | Oppgis i ChatGPT-UI-et ved oppsett                                      |
| Refresh tokens (anbefalt)                                                                                        | Ellers må brukeren logge inn på nytt når tokenet utløper                |

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
  `gcloud run deploy` med `--ingress=all`, `MCP_HANDLELISTE_SKRIVING=av` og
  `MCP_DATA_SKRIVING=aktiv` (Runbook steg 8), uten IAM-endring.
- Til slutt verifiserer den tjenesten fra utsiden med
  `scripts/verify-deployed.sh`.

Den gamle testflaten (`deploy-mcp-test.yml`, `mcp-test-harness/` og
`functions`-blokken i `firebase.json`) er fjernet fra repoet etter at denne
deployen ble bevist. Service accounten `mcp-test-harness@…` og en eventuell
deployet `mcpTestHarness`-funksjon i GCP slettes av prosjekteier for hånd.
Det er en IAM-endring, og den gjøres ikke fra en workflow.

### 3. Første røykprøve mot tjenesten

Deploy-workflowen gjør dette selv. Manuelt:

```bash
scripts/verify-deployed.sh https://hverdagsflyt-mcp-1075494790067.europe-west1.run.app 'https://hverdagsflyt.eu.auth0.com/'
```

Skriptet sjekker `/health`, RFC 9728-metadataen (`resource`,
`authorization_servers` og scopes) og 401 med `WWW-Authenticate` uten
token. Det leser ingen data. Svarer `/health` med 403, er
Invoker-IAM-sjekken på eller ingress fortsatt `internal`.

### 4. Operatørsekvens: medlemskap og principal-kobling

Serveren krever to ting per bruker, og de opprettes av to **separate**
operatør-CLI-er (ingen skjult dobbeltskriving). Begge kjører som
**tørrkjøring** som standard, og skriver bare med `--apply`.

| Steg                                                                | Kommando         | Skriver (kun med `--apply`)                          |
| ------------------------------------------------------------------- | ---------------- | ---------------------------------------------------- |
| 1. Identifiser og bekreft brukeren, og opprett medlemskap ved behov | `add-member`     | `families/{familyId}/members/{uid}` = `true`         |
| 2. Koble IdP-brukeren til Firebase-brukeren                         | `link-principal` | `mcp/principals/{sub}` = `{ firebaseUid, familyId }` |

`members` har ingen effekt for appen før de medlemsbaserte reglene deployes
(ADR 0001), så noden kan mangle i produksjon.

**Operatør:** en identitet med lesetilgang til Firebase Auth og
lese-/skrivetilgang til Realtime Database via ADC, for eksempel prosjekteier i
Cloud Shell. Tjenestens egen kjøretidsidentitet (`firebasedatabase.viewer`) skal
ikke brukes og kan ikke skrive. CLI-ene er ikke med i imaget og kjøres ikke av
noen workflow.

```bash
git clone https://github.com/hnasselqvist-netizen/familieapp.git
cd familieapp && git checkout <reviewet commit>
cd mcp-server
npm ci --ignore-scripts --no-audit --no-fund
npm run build:admin

export FIREBASE_DATABASE_URL='https://familieapp-a5d15-default-rtdb.europe-west1.firebasedatabase.app'
export MCP_ALLOW_PRODUCTION_DATA=true

# 1) Medlemskap. Svaret viser e-post, navn, innloggingsleverandører, opprettet og
#    sist innlogget. Kontroller at det er riktig person.
node dist/add-member.js --email '<e-post>' --family familie1                 # tørrkjøring
node dist/add-member.js --email '<e-post>' --family familie1 --apply         # skriver medlemskapet

# 2) Principal-kobling. Bruk UID-en fra svaret over (eller --expect-uid for å feste den).
node dist/link-principal.js --sub 'auth0|<id>' --uid '<uid fra steg 1>' --family familie1                 # tørrkjøring
node dist/link-principal.js --sub 'auth0|<id>' --uid '<uid fra steg 1>' --family familie1 --apply
```

Hopp over `add-member --apply` hvis tørrkjøringen sier `unchanged` (medlemskapet finnes).
Tilbakeføring av koblingen: `link-principal … --disable --apply`.

`dist/handleliste-overgang.js` (`kontroll` / `markor`) hører til
overgangsplanen for handlelisten
([ADR 0003, forslag](../docs/beslutninger/0003-handleliste-en-aktiv-skriver.md)).
Den er bare emulatortestet og har ingen besluttet produksjonskjøring.

#### `add-member`

- **Operatøren oppgir e-post**, ikke UID. CLI-en slår opp brukeren i Firebase
  Auth (`getUserByEmail`) og avslår hvis oppslaget ikke gir nøyaktig den
  e-posten. `--uid` finnes som alternativ, og nøyaktig én av dem må oppgis.
  `--expect-uid` fester resultatet til en UID operatøren allerede har sett.
- **Avslår** (exit 1, ingenting skrevet): ukjent bruker, deaktivert bruker,
  familie som ikke finnes (oppretter aldri en ny), og et medlemskap som er
  satt til `false` (tilgang er trukket tilbake; skrives aldri over).
  Et eksisterende medlemskap er `unchanged`.
- **Produksjonsvern**, samme nivå som `link-principal` pluss Auth:
  - uten emulator kreves `MCP_ALLOW_PRODUCTION_DATA=true`, også for tørrkjøring;
  - database og Auth må peke samme vei (begge emulatorer eller ingen), så
    ekte Auth aldri brukes mot en emulert database;
  - mot ekte prosjekt må `GOOGLE_CLOUD_PROJECT` stemme med databasens URL.
- **Svaret** er JSON med `target` (`emulator`/`PRODUKSJON`), `project`, `dryRun`,
  `action` (`create`/`unchanged`/`refuse`), `user` (identiteten) og `applied`.
  Exit-koder: 0 ok, 1 avslag, 2 feil bruk eller vern, 3 feil mot tjenesten
  (for eksempel manglende tilgang til Auth).
- **Testet** mot in-memory (`memberAdd.test.ts`) og mot RTDB- og Auth-emulatorene
  (`addMember.integration.test.ts`, inkludert hele sekvensen over).

`link-principal` nekter å koble noen som ikke er medlem av familien, og
overskriver aldri en annen persons kobling uten `--replace`. Første tilkobling
fra ChatGPT uten kobling gir `not_linked`, og loggen (`tool_call`-hendelsen)
viser IdP-ens `sub`.

### 5. ChatGPT-connector

Legg til MCP-serveren i ChatGPT med URL-en `MCP_RESOURCE_URL` og OAuth.
ChatGPT finner IdP-en via metadata-dokumentet, og brukeren logger inn. Test
deretter med «Hva står på handlelisten?» og «Har vi melk i varebasen?».
`tools/list` viser de to handleliste-leseverktøyene, `forvaltning_cutover_kontroll` og
`shopping_cutover_kontroll`.

### 6. Handlelisteverktøyets skriving (`shopping_list_add_items`, forblir av)

Krever legacy-cutoveren (se «Cutover»), en løsning for sammenslåingshistorikken (#27, 6512500898) og en reviewet endring som setter `MCP_HANDLELISTE_SKRIVING=aktiv` i
workflowen. Generell skriving, inkludert handlelisten, aktiveres i steg 8.

### 7. Claude-connector med full lesing (`data:read`)

Formålet er at Claude (Claude Code-økter og claude.ai) skal kunne lese alle Helens data
gjennom den samme MCP-serveren. Innloggingen skjer mot den samme Auth0-tenanten med Helens
egen bruker. Koblingen `mcp/principals/{sub}` går på brukeren, ikke klienten. Den
eksisterende koblingen og medlemskapskontrollen gjelder derfor uendret. Det trengs ingen
adminnøkkel, ingen delt hemmelighet og ingen ny IAM.

**Engangssteg (prosjekteier, etter merge og MCP-deploy fra `main`):**

1. **Auth0 → APIs → (API-et med identifier `MCP_RESOURCE_URL`) → Permissions:** legg til
   `data:read`. Gi den til Helens bruker under **User Management → Users → Helen →
   Permissions**. Ingen andre brukere skal ha den.
2. **Klientregistrering for Claude.**
   - Er dynamisk klientregistrering (DCR) slått på i tenanten, trengs ingenting.
   - Ellers opprettes en egen applikasjon «Claude» (Regular Web Application) med
     _Allowed Callback URL_ `https://claude.ai/api/mcp/auth_callback` og grant types
     Authorization Code og Refresh Token. Client ID og secret legges da inn under
     _Advanced settings_ når connectoren legges til (punkt 3). De legges aldri i repoet.
   - Token-oppsettet må gi `aud` = `MCP_RESOURCE_URL`, som for ChatGPT (se steg 1,
     `resource`-parameter eller fast audience).
3. **claude.ai → Settings → Connectors (https://claude.ai/customize/connectors) → Add custom
   connector:** URL = `MCP_RESOURCE_URL`. Logg inn med Helens Auth0-bruker.
4. **Start en ny Claude Code-økt.** Connectorer leses når en økt starter.
   `tools/list` skal vise `data_nokler` og `data_les`.

**Verifisering (uten å publisere innhold):**

- **Lesing:** I den nye økten kaller Claude `data_nokler { sti: "" }` og
  `data_les { sti: "<én toppnode>", antall: 1 }`. Bare at kallet lyktes og antallet
  rapporteres i issuet, aldri innholdet.
- **Skrivevern** verifiseres uten å skrive. Prosjekteier kjører denne kommandoen i
  Cloud Shell:

  ```bash
  gcloud projects get-iam-policy familieapp-a5d15 \
    --flatten='bindings[].members' \
    --filter='bindings.members:serviceAccount:hverdagsflyt-mcp@familieapp-a5d15.iam.gserviceaccount.com' \
    --format='value(bindings.role)'
  ```

  Den skal gi nøyaktig `roles/firebasedatabase.viewer`. MCP-serveren har ingen skrivevei
  for full lesing (se §«Full lesing»), og `MCP_HANDLELISTE_SKRIVING=av` står fast i
  workflowen.

**Tilbaketrekking (hver for seg er nok):**

- Fjern `data:read` fra Helens bruker i Auth0. Nye tokens mangler da scopen, og kallene
  gir `insufficient_scope`. Et token som allerede er utstedt, virker til det utløper.
- Koble fra connectoren i claude.ai (Settings → Connectors).
- Sett `disabled: true` på `mcp/principals/{sub}`. Det stopper **all** MCP-tilgang for
  brukeren.
- Fjern verktøyene: revert på `main` og ny MCP-deploy.

En ny økt må logge inn på nytt gjennom connectoren hvis tokenet er utløpt eller tilgangen
er trukket tilbake.

### 8. Aktivering av generell skriving (`data:write`) — driftssteg

**Gjeldende driftstilstand (30.10.2026). Dette er det som gjelder nå:**

- **Skrivingen er PÅ.** `MCP_DATA_SKRIVING=aktiv` i workflowen (#86). `MCP_HANDLELISTE_SKRIVING=av`.
- **Første ekte skriving** er bekreftet i #27 (6534385832). Helen har i tillegg testet skriving til handlelisten og til en transaksjon i Forvaltning.
- **Kjøretidsidentitetens RTDB-roller:** `roles/firebasedatabase.viewer` + `roles/firebasedatabase.admin`. Den egne rollen `hverdagsflytRtdbSkriver` fra steg 3b er **fjernet og skal ikke gjenopprettes**, se «Erfaring fra aktiveringen» under steg 3b.
- **Etter en IAM-endring for kjøretidsidentiteten:** Den valgte prosedyren her er å kjøre en ny MCP-deploy, så tjenesten får en fersk databaseforbindelse. Det er ikke et dokumentert generelt krav fra Firebase. Det er slik det ble gjort her, der rollen og forbindelsen ble byttet samtidig.
- Verifisering og tilbaketrekking står nederst i steget.

**Historisk etablering (utført 30.10.2026; ikke gjenta).** Stegene under beskriver hvordan
skrivingen ble slått på. De ble kjørt i denne rekkefølgen, slik at ingenting kunne skrive
før alle lagene var på plass. Ingen av dem gjøres av en workflow eller av Claude, og det
skal ikke gjøres noen prøveskriving i produksjon.

- Steg 1: MCP-deploy 41051804397.
- Steg 2: rapportert av Helen.
- Steg 3: erstattet, se «Erfaring fra aktiveringen».
- Steg 4: #86, med aktiveringsdeploy 41072539758.
- Steg 5: ny tilkobling.

1. **MCP-deploy fra `main` med skriving av (Helen).** Kjør Actions → «MCP-server — deploy
   til Cloud Run (manuell)» → `les-ekte-data`.
   - `data_hent` blir tilgjengelig, og metadataen lister `data:write`.
   - `data_skriv` finnes ikke ennå, fordi workflowen setter `MCP_DATA_SKRIVING=av`.
   - `scripts/verify-deployed.sh` sjekker scopene.
2. **Auth0 (Helen).**
   - Gå til APIs → API-et med identifier `MCP_RESOURCE_URL` → Permissions, og legg til
     `data:write`.
   - Gi den **bare** til Helens bruker: User Management → Users → Helen → Permissions.
3. **IAM for kjøretidsidentiteten (prosjekteier, Cloud Shell): ett samlet driftsvalg.**

   **Verifiserte kilder.** Kontrolltårnet har lest disse sidene (review 5710037222). Fra
   økten der koden ble skrevet er de stengt av nettverket.
   - [Firebase IAM permissions](https://firebase.google.com/docs/projects/iam/permissions),
     §Firebase Realtime Database:
     - `firebasedatabase.instances.get` gir lesing av data.
     - `firebasedatabase.instances.update` gir skriving av data, og i tillegg aktivering
       og deaktivering av instansen og lesing og endring av security rules.
   - [Firebase Realtime Database roles and permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasedatabase)
     lister de samme instansrettighetene. Det finnes ingen egen data-only-rettighet for
     skriving.

   **Faktisk ekstra myndighet.** Skriving krever `firebasedatabase.instances.update`, og
   den rettigheten er **ikke data-only**. Med den kan kjøretidsidentiteten også:
   - lese og endre RTDB-ens security rules;
   - aktivere og deaktivere databaseinstansen.

   Koden bruker ingen av delene. REST-klienten gjør bare `GET`, og Admin SDK-et brukes
   bare til data under `families/{familyId}`. Rettigheten gir likevel denne myndigheten,
   og den kan ikke avgrenses til en sti eller en familie.

   **Driftsvalg (anbefalt):** en egen rolle med nøyaktig `firebasedatabase.instances.get`
   og `firebasedatabase.instances.update`. Den er smalere enn `roles/firebasedatabase.admin`
   på noen punkter, men fortsatt ikke data-only. `roles/firebasedatabase.viewer` beholdes
   som i dag.

   **Steg 3a, skrivefri kontroll før tildeling (ingen endring):**

   ```bash
   # a) Dagens faktiske roller for kjøretidsidentiteten
   gcloud projects get-iam-policy familieapp-a5d15 \
     --flatten='bindings[].members' \
     --filter='bindings.members:serviceAccount:hverdagsflyt-mcp@familieapp-a5d15.iam.gserviceaccount.com' \
     --format='value(bindings.role)'
   # b) At instances.update kan brukes i en egen rolle (customRolesSupportLevel)
   gcloud iam list-testable-permissions //cloudresourcemanager.googleapis.com/projects/familieapp-a5d15 \
     --filter='name:firebasedatabase.instances' --format='table(name,customRolesSupportLevel,stage)'
   # c) Hva admin-rollen ellers ville gitt (til sammenligning)
   gcloud iam roles describe roles/firebasedatabase.admin --format='value(includedPermissions)'
   ```

   Forventet resultat:
   - a) gir bare `roles/firebasedatabase.viewer`;
   - b) viser `firebasedatabase.instances.update` som `SUPPORTED`.

   Avviker noe, stoppes det, og avviket legges i #27. Utdataene inneholder bare
   rettighetsnavn.

   **Steg 3b, tildeling (historisk; ga `permission_denied` og er erstattet: rollen er
   fjernet og skal IKKE opprettes på nytt, se «Erfaring fra aktiveringen» rett under):**

   ```bash
   gcloud iam roles create hverdagsflytRtdbSkriver --project=familieapp-a5d15 \
     --title="Hverdagsflyt MCP: RTDB-skriving" \
     --description="data_skriv (#27). Gir også rules-lesing/-endring og instansaktivering (instances.update)." \
     --permissions=firebasedatabase.instances.get,firebasedatabase.instances.update --stage=GA
   gcloud projects add-iam-policy-binding familieapp-a5d15 \
     --member=serviceAccount:hverdagsflyt-mcp@familieapp-a5d15.iam.gserviceaccount.com \
     --role=projects/familieapp-a5d15/roles/hverdagsflytRtdbSkriver --condition=None
   ```

   **Erfaring fra aktiveringen (#27, 30.10.2026):**
   - **Med den egne rollen fra 3b ble skrivingen avvist.** RTDB avviste transaksjonens put med `permission_denied`, mens lesing fra samme identitet og token gikk. Det skjedde både før og etter en ny revisjon. Den skrivefrie kontrollen (#27 6534271574) viste:
     - `serviceAccountName` i tjenestetemplaten var `hverdagsflyt-mcp@…`;
     - `hverdagsflytRtdbSkriver` hadde `stage: GA` og `firebasedatabase.instances.get` + `firebasedatabase.instances.update`, og var ikke slettet;
     - prosjektpolicyen bandt den egne rollen og `roles/firebasedatabase.viewer` til identiteten, uten betingelse;
     - prosjektet hadde ingen deny-policyer.

     Dette er det som ble observert. Det fastslår ikke alene identiteten til den aktive revisjonen eller all effektiv og arvet policy.

   - **Rotårsaken er ukjent.** Firebase-dokumentasjonen sier at produktrettighetene kan brukes i egne roller (Kontrolltårnet, 6533663408).
   - **Det som virket:** Helen tildelte den forhåndsdefinerte `roles/firebasedatabase.admin` og kjørte så en ny MCP-deploy (41134701007). Rollen og forbindelsen ble altså endret samtidig. Første skriving etterpå committet. Den egne rollen er deretter fjernet.
   - **Merk:** `roles/firebasedatabase.admin` gir mer enn `instances.update`, også forvaltning av instanser.

   **Risiko, presist:**
   - **Grensen ligger i koden.** Rettigheten gjelder hele databasen, også andre familier og
     `mcp/`. Grensen er derfor koden:
     - stien settes alltid sammen under `families/{familyId}` fra koblingen;
     - de beskyttede feltene kan ikke skrives;
     - REST-klienten gjør bare `GET`;
     - lesing går gjennom skrivevakten.
   - **Regler og instans:** identiteten kan i prinsippet endre security rules og
     deaktivere instansen. En kompromittert kjøretid ville kunne gjøre det. Koden gjør det
     aldri, og ingen deploy endrer reglene.
   - Deployidentiteten og workflowen endres ikke.
   - **Tilbaketrekking:** `gcloud projects remove-iam-policy-binding` med samme medlem og
     rolle.

   **Valgfri ekstra forsvarslinje (ikke del av denne PR-en):** Admin SDK-ets
   `databaseAuthVariableOverride: { uid }` vil kjøre skrivingene under security rules som
   Helens Firebase-bruker. Det forutsetter at reglene i produksjon tillater
   familieskrivingen og at avviket mellom git-reglene og produksjonsreglene er løst
   (ADR 0003). Det må derfor vurderes for seg.

4. **Slå på i workflowen (egen, reviewet én-linjes PR).** Endre
   `"MCP_DATA_SKRIVING": "av"` til `"aktiv"` i `.github/workflows/deploy-mcp-cloudrun.yml`.
   Kjør deretter en ny MCP-deploy fra `main`, som i steg 1.
5. **Koble til på nytt (Helen).** Koble fra og til igjen i claude.ai (og eventuelt
   ChatGPT), så det nye tokenet bærer `data:write`. Start en ny økt. `tools/list` skal
   vise `data_hent` og `data_skriv`.

**Verifisering uten prøveskriving:**

- Kontroller at IAM-policyen viser `roles/firebasedatabase.admin`. Bruk kommando a) i steg 3a.
- Bekreft at `data_skriv` finnes i `tools/list`, og at `data_hent` virker.
- Den første ekte skrivingen er Helens egen, konkrete bestilling. Etterpå rapporteres
  bare utfallet, stier og versjoner, aldri innhold.

**Tilbaketrekking (hvert punkt er nok alene):**

- Sett `MCP_DATA_SKRIVING` tilbake til `av` (revert på `main`) og deploy på nytt.
  Verktøyet forsvinner.
- Fjern IAM-bindingen (`gcloud projects remove-iam-policy-binding` med
  `roles/firebasedatabase.admin`) og deploy på nytt. All skriving feiler da i databasen,
  uansett kode.
- Fjern `data:write` fra Helens bruker i Auth0. Nye tokens gir da `insufficient_scope`.
- Sett `disabled: true` på `mcp/principals/{sub}`. Det stopper all MCP-tilgang.
