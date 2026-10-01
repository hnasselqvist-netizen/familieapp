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
                 service (idempotens-orkestrering) — kjenner kun store-PORTEN
  auth/          tokens (JWT/JWKS-validering), protectedResource (RFC 9728 +
                 WWW-Authenticate), authorize (scope → kobling → medlemskap per kall)
  store/         types (porten), memoryStore (fake + feilinjeksjon),
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

Nodene `mcp/actions/{familyId}/{requestId}` og `mcp/principals/…` ligger
**utenfor** `families/`. Med dagens security rules kan appen verken lese eller
endre dem; bare Admin SDK-et kan det. Appens egne noder (`shopping`, `items`)
skrives i nøyaktig samme form som appen bruker.

1. **Claim:** en transaksjon gir en lease på `requestId`.
   - En ny forespørsel får leasen.
   - Er leasen aktiv, er svaret `request_in_progress` (retryable).
   - Finnes en committet record med samme payload og principal, returneres den
     (replay).
   - Har samme requestId en annen payload, er svaret `idempotency_conflict`.
2. **Plan:** listen og varebasen leses ferskt, og planen beregnes som en ren
   funksjon.
3. **Commit:** **én atomisk multi-path-oppdatering** skriver nye varer,
   nye og oppdaterte poster (hele poster, som appens egen transaksjon) og
   den committede recorden. En krasj kan derfor ikke etterlate endringen uten
   markøren, eller markøren uten endringen.

Hva skjer ved feil (dekket av `service.test.ts`):

- **Feil før commit:** ingenting er skrevet, og retry utfører handlingen én gang.
- **Feil etter commit** (tapt svar): retry gir replay.
- **Hard krasj:** leasen utløper (60 s), og deretter utføres handlingen én gang.
- **Passert commit-frist** (20 s): serveren committer aldri, så den ikke kan
  kollidere med en ny lease-eier.

Den committede recorden **er** den transaksjonelle audit-posten (hvem, hva,
når og utfall per vare). Annen logging (lesinger, avslag) er best-effort
JSON-linjer. `safeAudit` sørger for at en loggfeil aldri kan gjøre en utført
skriving om til en feil.

**Kjent restrisiko, dokumentert og ikke løst her:** mellom den ferske lesingen
og den atomiske commiten (ett nettverkskall) kan en samtidig endring fra appen
på **samme post** bli overskrevet. Det gjelder for eksempel avkrysning eller
mengdeendring på akkurat den varen som slås sammen. Vinduet er av samme klasse
som appens egen, dokumenterte `findOrCreateItem`-race. Å lukke det helt ville
kreve at idempotens-markøren lå i samme RTDB-node som posten, altså en endring
av Firebase-shape.

## Senere steg (egne beslutninger, IKKE gjort her)

1. **Auth-probe:** opprett en IdP-tenant (Auth0-kandidat) med en API/audience
   lik `MCP_RESOURCE_URL`, scopes `shopping:read`/`shopping:write` og
   Google-connection. Verifiser CIMD/DCR, refresh tokens og at ChatGPT
   faktisk fullfører linking. Verifiser også hvor `securitySchemes` skal
   ligge (i dag i `_meta`).
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
