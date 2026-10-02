# mcp-server — Kontrolltårnets MCP-kontrollflate (foundation)

En MCP-server som lar ChatGPT (Kontrolltårnet-pluginen) lese og endre
Hverdagsflyt-data gjennom **typed, autoriserte verktøy**, i stedet for at
ChatGPT-hostet kode får Firebase-tilgang. Første vertikale skive er
**Handleliste**. Beslutningsgrunnlaget ligger i Issue #27: arkitekturen i
5936590112/5936720705, designet i 5936936743 og godkjenningen i 5937138669.

> **Status: foundation, ikke deployet.** Denne pakken har ingen
> Cloud Run-deploy, ingen opprettet IdP/Auth0-tenant, ingen IAM-endring og
> ingen kobling mot ekte Firebase-data. `main.ts` nekter å starte mot ekte
> RTDB uten en eksplisitt `MCP_ALLOW_PRODUCTION_DATA=true`. Alt kjøres mot
> in-memory-store eller RTDB-emulatoren.

## Kommandoer

Fra `mcp-server/`:

```bash
npm install
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
npm run test:integration   # Admin-adapteren mot RTDB-emulatoren (krever Java)
```

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
  app.ts         kobler lagene; main.ts er kjøretidsinngangen (ikke deployet)
```

Grensene håndheves av `eslint.config.js`:

- `handleliste/` og `auth/` importerer aldri Firebase, HTTP eller MCP-SDK-et.
- Bare `store/firebaseAdminStore.ts` og `main.ts` får importere `firebase-admin`.
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

Nivå 1 betyr at brukerens eksplisitte kommando er autorisasjonen. Det finnes
ikke noe draft→confirm i backend. ChatGPT kan fortsatt vise sin egen
bekreftelse, og annotasjonene sier ærlig at verktøyet skriver
(`readOnlyHint: false`).

## Auth og autorisasjon

1. **Resource server, ikke authorization server.** ChatGPT kjører OAuth 2.1
   authorization code + PKCE mot en etablert IdP (Auth0 er første kandidat,
   men ikke låst). Serveren publiserer `/.well-known/oauth-protected-resource[/mcp]`
   (RFC 9728). Den svarer 401 med `WWW-Authenticate: Bearer resource_metadata="…"`
   når token mangler eller er ugyldig.
2. **Full tokenvalidering:** signatur mot IdP-ens offentlige JWKS, `iss`,
   `aud` (= `MCP_RESOURCE_URL`), `exp`/`nbf` og en allowlist med kun `RS256`.
   Scopes leses fra `scope` og fra Auth0 `permissions`.
3. **Per kall** (`auth/authorize.ts`):
   1. Krevd scope.
   2. En eksplisitt kobling `mcp/principals/{idpSub}` → `{ firebaseUid, familyId }`.
   3. At koblingen ikke er `disabled`.
   4. At `families/{familyId}/members/{firebaseUid}` fortsatt finnes.

   Manglende scope gir et `isError`-resultat med
   `_meta["mcp/www_authenticate"]`, slik at ChatGPT kan be om utvidet tilgang.

4. **Ingen e-postbasert kobling.** Koblinger opprettes manuelt (se Senere steg).
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

## Senere steg (egne beslutninger, IKKE gjort her)

1. **Auth-probe:** opprett en IdP-tenant (Auth0-kandidat) med en API/audience
   lik `MCP_RESOURCE_URL`, scopes `shopping:read`/`shopping:write` og
   Google-connection. Verifiser CIMD/DCR, refresh tokens og at ChatGPT
   faktisk fullfører linking.
2. **Cloud Run minimumsdeploy** i `familieapp-a5d15`:
   - Ferdigbygd image fra GitHub Actions.
   - Egen tjenesteidentitet med kun RTDB-tilgang.
   - Env-variablene fra `src/config.ts`. Ingen hemmeligheter trengs, siden JWKS
     er offentlig og Admin SDK-et bruker ADC.
   - Krever egen IAM-minimumsanalyse og godkjenning fra Helen (Issue #27).
3. **Principal-kobling:** skriv `mcp/principals/{idpSub}` =
   `{ firebaseUid, familyId }` manuelt (Admin/konsoll) etter at Helen har
   bekreftet IdP-sub-en.
4. **GCP-opprydding av testsporet** (provenance-tabellen i 5936936743) etter
   at produksjonsinfrastrukturen er bevist.
