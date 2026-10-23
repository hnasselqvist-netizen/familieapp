# 0003 — Handlelisten: én aktiv skriver, vern på serveren (FORSLAG)

- **Status:** Forslag. Ikke vedtatt, ingenting er deployet. Gjeldende
  `infra/firebase/database.rules.json`, `index.html`, auth og
  produksjonsdata er uendret.
- **Dato:** 23. oktober 2026
- **Deltakere:** Kontrolltårnet (review), Claude (teknisk implementatør)
- **Kilder:** Mat #20; PR #77 med review
  [6355066911](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6355066911)
  pkt. 5 og [6355434985](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6355434985).
  Mønsteret følger [ADR 0002](0002-forsoningsnoder-en-aktiv-skriver.md).

## Kontekst

Sammenslåing og angring av handlelisteduplikater (#77) skriver hele
`families/{f}/shopping` i én transaksjon, med historikk på den beholdte
raden. Legacy (`index.html`) har **én** skriver av handlelisten,
`setShopping` (~16493). Den skriver alltid hele noden:

```js
dbSet(`${FAM}/shopping`, Object.fromEntries(next.map(i => [i.id, i])))
```

Alle legacy-produsenter går gjennom denne skriveren: ShoppingScreen
(legg til, avhuk, fjern, «Fjern fullførte», feltendring) og
PlanScreen-generatoren (`onAddToList`). RecipesScreen får `setShopping`,
men kaller den ikke. `dbGetOnce(shopping)` i bootstrap leser bare.

En ny legacy-sperre i `index.html` stopper bare nyinnlastet kode. Den
stopper ikke åpne faner eller PWA-er med gammel kode, og heller ikke
skrivinger SDK-en har lagt i kø mens klienten var frakoblet. En slik
helnodeskriving kan stille gjenopprette innslåtte rader og fjerne
historikk. Vernet må derfor ligge **på serveren**.

## Forslag

### 1. Rules: skrivermarkør på `shopping`

Fullstendig forslagsfil:
[`infra/firebase/forslag/handleliste-skrivemarkor.rules.json`](../../infra/firebase/forslag/handleliste-skrivemarkor.rules.json).
Endringen mot gjeldende rules er:

```diff
 "$familyId": {
   ".read": M,
-  ".write": M
+  "shopping": {
+    ".write": "M && newData.exists()",
+    ".validate": "newData.child('_skriver').child('versjon').val() === 'web-v2'
+                  && !newData.child('_skriver').child('id').exists()"
+  },
+  "$annet": { ".write": M }
 }
```

`M` er dagens medlemsregel, uendret. Forelderens `.write` **fjernes**.
Ellers ville arvet skrivetilgang fra `$familyId` omgått vernet på
`shopping`. `$annet` gir alle andre barn nøyaktig samme tilgang som i dag.
En test kontrollerer at forslagsfilen er lik gjeldende rules med nøyaktig
denne endringen, så avvik mellom filene fanges opp.

### 2. Endelig råformat for markøren

Markøren ligger i `families/{f}/shopping/_skriver`. Kilden er
[`infra/firebase/forslag/handleliste-skrivemarkor.markor.json`](../../infra/firebase/forslag/handleliste-skrivemarkor.markor.json):

```json
{ "versjon": "web-v2", "name": "Handlelisten redigeres i den nye appen",
  "cat": "Diverse", "amount": "", "done": true }
```

Formatet har disse egenskapene:

- **Ingen `id`.** Legacy nøkler på `i.id`. Et `id: "_skriver"` ville fått
  legacy-helnoden til å bære markøren med seg, og skrivingen ville blitt
  godtatt. Det ble funnet i legacy-harnessen. Regelen avviser derfor også
  `_skriver/id`.
- **Vareformet med streng-`name` og `done: true`.** Legacy gjør
  `Object.values(shopping)`, og flere legacy-stier kaller
  `.name.toLowerCase()` på hvert element. Markøren vises som en fullført rad
  med forklarende tekst, ikke som en tom rad.
- **`_`-nøkkel.** Web v2 (`isReservedShoppingKey`), MCP
  (`parseShoppingEntries`) og duplikatdomenet (`reservert`) ignorerer den
  allerede som vare.

### 3. Serververnet beholdes som hovedregel

Vernet er ikke et midlertidig steg. Det blir stående så lenge legacy kan
nås, også om funksjonen rulles tilbake (se §Tilbakerulling).

## Emulatorbevis (reproduserbart)

| Bevis | Fil | Kjøres med |
|---|---|---|
| Rules-forslaget med appens ekte skriveveier, i et eget emulator-navnerom (17 tester) | `web/src/data/handlelisteSkrivemarkor.forslag.integration.test.ts` | `npm run test:integration` (CI) |
| MCP-admin bevarer markør og `undefined`-metadata | `mcp-server/src/store/firebaseAdminStore.integration.test.ts` (siste test) | `npm run test:integration` i `mcp-server/` (CI) |
| Uendret `index.html` mot emulatoren (8 tester) | `web/e2e-legacy/handleliste-overgang.spec.ts` + `legacy-harness.ts` | `npm run test:legacy-overgang` (manuelt, ikke i CI) |
| Angring virker med porten av | `web/src/features/hverdagsflyt/mat/handleliste/HandlelisteScreen.test.tsx` | `npm test` (CI) |

**Verifisert i emulatoren:**

- **Tilgang.**
  - Medlem leser.
  - Ikke-medlem og uautentisert verken leser eller skriver `shopping`,
    andre moduler eller `members`.
- **Andre moduler og multipath.**
  - Medlem skriver andre moduler som før.
  - Appens ekte rot-multipath (`spreadYearlyAmount`) går gjennom.
  - Multipath med shopping-post og annen modul går gjennom.
  - Multipath som erstatter `shopping` uten markør avvises atomisk; heller
    ikke den andre stien skrives.
- **Web v2.**
  - Disse går gjennom, og markøren og `_ops` er urørt:
    `createShoppingItem`, `updateShoppingItemField` (transaksjon),
    `toggleShoppingItemDone` og `removeShoppingItem`.
  - Fjerning av siste vare er lov; noden står igjen med markøren.
  - Sammenslå og angre (`transactShoppingNode`) bevarer markøren.
- **Helnode og markør.**
  - Avvist: legacy-helnode, `set(null)`, `remove()`, `set({})` og helnode
    uten markør.
  - Markøren kan ikke fjernes, få feil versjon eller få `id`.
  - Helnode med markør (web v2-form) går gjennom.
- **Offline-kø.**
  - Med modulær SDK: legacy-helnode køet frakoblet avvises ved
    gjenoppkobling, og serveren er uendret.
  - Med legacy compat-SDK i uendret `index.html`: samme resultat, og
    UI-en ruller tilbake til serverens tilstand.
- **Uendret legacy (`index.html`).**
  - Vanlig liste og tom liste (bare markør) vises uten sidefeil, med
    markør, `_ops` og `undefined` til stede.
  - Avhuking, fjerning og «Fjern fullførte» avvises. Noden er uendret og
    UI-en ruller tilbake.
  - Generatoren uten `_ops` gir «Legg til», som avvises; noden er
    uendret.
  - Eneste sidefeil er legacys egne ubehandlede `PERMISSION_DENIED`.
- **MCP admin-SDK** (går utenom rules): `shopping_list_add_items` gjennom
  `HandlelisteService` og `FirebaseAdminStore` bevarer `_skriver` og
  `undefined` byte-likt.
- **Aktiveringsrekkefølge.**
  - Uten markør er all handleliste-skriving sperret, også web v2.
  - Feil markørformat avvises og endrer ingenting.
  - Riktig markør som barneskriving går gjennom, også når listen er
    tom eller mangler.
  - Deretter virker web v2.
  - Gjeldende rules tilbake (retur før aktivering) gir dagens oppførsel.
- **Tilbakerulling i UI.** Med porten for nye sammenslåinger av vises
  ingen forslag, men eksisterende sammenslåinger kan angres.

**Ikke verifisert:**

- Produksjonens faktiske innhold i `shopping`: om `_ops` eller
  `undefined` finnes, antall rader, eventuelle rader uten navn. Det krever
  den skrivefrie kontrollen under.
- Selve rules-deployen og Firebase-konsollens oppførsel.
- Ekte mobil-PWA med service worker. Harnessen blokkerer service workere,
  og offline er SDK-ens `goOffline`, ikke et nettverksbrudd.
- Legacy-CDN-filer i CI. Harnessen kjøres lokalt med de samme
  npm-versjonene (`LEGACY_CDN_DIR`). Uten variabelen hentes filene fra
  nettet.
- At MCP-skriving i produksjon er av. Bevaringen er testet i emulatoren
  uansett.

## Funn underveis

1. **Markør med `id` ville sluppet legacy gjennom.** Lukket med formatet
   og regelen over.
2. **Rader uten navn i legacy (eksisterende).** Når `_ops` eller
   `undefined` finnes, viser legacy dem som tomme, avhukbare rader.
   Med gjeldende rules feiler legacys oppfølgingsskriving til
   `itemHistory` (`value argument contains undefined in property
   'itemHistory.N.name'`).
3. **Legacy-generatoren krasjer (eksisterende).** «Legg til» kaster
   `TypeError … toLowerCase` når noden har et element uten `name`
   (`_ops`/`undefined`). Krasjet skjer før skrivingen, så noden er uendret.
   Testet.
4. **Web v2-generatoren krasjer (eksisterende på `main`).**
   `findMergeCandidate` kaller `toLowerCase` på en rad uten `name`. En rad
   kalt `undefined` med `_ops`-innhold gir derfor feil i «Legg til fra
   middagsplan». Duplikatpanelet tåler det. Foreslått separat, liten
   rettelse: hopp over rader uten streng-`name` i match-søket, som MCP
   allerede gjør. Ikke en del av denne draften.
5. **Legacy teller markøren.** Den vises som én fullført rad, og
   «Fjern fullførte» blir synlig (og avvises).

## Eksisterende metadata under `undefined`

**Hva det er.** `_ops` er MCPs idempotens-register. Etter en
legacy-helnodeskriving havner det under nøkkelen `"undefined"`, fordi
elementet ikke har `id`. Grunnlinjetesten viser dette med gjeldende rules.
Markøren uten `id` ville havnet samme sted før vernet er på plass.

**Hvordan det behandles i dag.**

| Leser | Behandling av `undefined` |
|---|---|
| MCP | Ignorerer den (ingen streng-`name`) og bevarer den. |
| Duplikatdomenet | Ignorerer den. |
| Legacy | Viser den som en tom rad. |
| Web v2 | Viser den som en rad uten navn, og generatorens match krasjer (funn 4). |

**Ingen automatisk opprydding.** Første steg er å telle (§Skrivefri
kontroll). Eventuell fjerning er en egen, eksplisitt beslutning: én
`remove` av `shopping/undefined` gjort av Helen i web v2 eller med et
reviewet admin-steg, og bare etter at innholdet er bekreftet å være
`_ops`-form.

## Aktiveringsrekkefølge

Hvert steg krever egen beslutning. Stegene tas i denne rekkefølgen:

1. **Skrivefri kontroll før start** (se under). Den gir grunnlinje-digest
   og telling.
2. **Rules-deploy** av forslagsfilen, manuelt av Helen. Rules deployes
   aldri automatisk.
   - Fra dette øyeblikket er all handleliste-skriving fra klienter
     sperret, også fra web v2, til markøren står. Dette er
     fail-closed: ingen data endres.
   - Legacy-brukere får stille tilbakerulling.
3. **Markøren settes** rett etter steg 2, helst med et lite reviewet
   admin-steg, etter mønster fra `mcp-server/src/admin/addMember.ts`:
   - Steget gjør en transaksjon som bare setter `shopping/_skriver` når den
     mangler, med innholdet fra fixture-filen. Ellers rører det ingenting.
   - Rekkefølgen «rules først» betyr at en legacy-skriving ikke kan fjerne
     markøren etter at den er satt. Med «markør først» kunne legacy
     skrevet den bort før regelen var på plass.
4. **Etterkontroll, skrivefri:**
   - markøren er nøyaktig lik fixture-filen,
   - digest av alt unntatt markøren er lik grunnlinjen,
   - telling uendret.
5. **`index.html`-sperre**, eget mandat: `SHOPPING_SKRIVESPERRE` med
   banner i legacy `setShopping`, som `FORSONING_SKRIVESPERRE`.
   - Dette er brukeropplevelse, ikke vernet: legacy-brukere får en
     forklaring i stedet for stille tilbakerulling.
   - Steget bør skje i samme vindu som steg 2–3.
6. **Aktivering** i egen PR: `HANDLELISTE_DUPLIKATER_I_PRODUKSJON = true`.

**Mislykket markørsteg** (feil format, avbrudd, eller markøren mangler i
etterkontrollen):

- Sperren står, og ingen data endres.
- Kjør markørsteget på nytt, eller gå tilbake før aktivering.
- Feil format kan ikke skrives av klienter (testet). En feil skrevet med
  admin-SDK eller i konsollen holder sperren lukket til den er rettet, og
  etterkontrollen fanger den.

**Tilbake før aktivering** (før steg 6, ingen sammenslåtte rader kan
finnes):

- Deploy gjeldende `database.rules.json` fra git, manuelt. Det gir dagens
  oppførsel (testet).
- Markøren kan bli liggende. Ved neste legacy-skriving havner den under
  `undefined`, som er ufarlig. Den kan også fjernes med én eksplisitt
  `remove` etter at rules er tilbake.

## Tilbakerulling etter aktivering

- **Standard:** `HANDLELISTE_DUPLIKATER_I_PRODUKSJON = false` (revert og
  deploy).
  - Nye sammenslåinger stopper.
  - «Sammenslåtte rader» med «Angre» ligger utenfor porten og vises
    fortsatt så lenge slike rader finnes (`HandlelisteScreen.test.tsx`).
  - **Serververnet beholdes.**
- **Serververnet fjernes bare når alle disse vilkårene er oppfylt:**
  1. Porten er av og verifisert deployet.
  2. Skrivefri kontroll viser `antallSammenslatt = 0`: alle sammenslåinger
     er angret, eller radene er fjernet av Helen.
  3. Helen har eksplisitt besluttet at legacy skal skrive handlelisten
     igjen.
  4. En eventuell `index.html`-sperre reverteres i samme vindu.

  Deretter deployes gjeldende rules manuelt, og etterkontroll kjøres.
- **Hvorfor dette ikke er standard:** Revert av vernet mens sammenslåtte
  rader finnes lar en gammel legacy-klient gjenopprette kilderader. Da
  nekter «Angre» fordi kilde-id-en finnes igjen. Ingen rader tapes, men
  historikken blir ubrukelig.

## Skrivefri shopping-kontroll (spesifikasjon)

`forvaltning_cutover_kontroll` dekker ikke `shopping`. Minste kontroll
som trengs:

- Den leser `families/{f}/shopping` én gang, uten lytter og uten
  skriving.
- Den gir bare tellinger, digester og ja/nei, aldri navn eller mengder.

| Felt | Innhold |
|---|---|
| `strukturOk` | Noden er et objekt, eller mangler. Ikke array eller primitiv. |
| `markor` | `ok` (lik fixture-filen, uten `id`), `mangler` eller `feil`. |
| `antallVarer`, `antallFullfort` | Ikke-`_`-nøkler med streng-`name`. |
| `antallUtenNavn` | Ikke-`_`-nøkler uten streng-`name`. |
| `harUndefined` | Ja/nei. |
| `undefinedErOpsForm` | Ja/nei: alle verdier har `tool: "shopping_list_add_items"`. |
| `antallOps` | Nøkler i `_ops`. |
| `antallSammenslatt` | Rader med `sammenslaing.opId`. |
| `antallAngremerker` | Sum av `sammenslaingAngret`-nøkler. |
| `digestUtenMarkor` | sha256 av kanonisk JSON av noden uten `_skriver`. |

Kontrollen bruker samme leserettighet som dagens skrivefrie kontroller.
**Denne PR-en utvider ikke produksjonstilgangen.** Implementasjonen blir
en egen, reviewet endring.

## Beslutningen Helen får

Etter review får Helen én samlet beslutning: «Overgang for handlelisten:
steg 1–5 i ett vindu, deretter aktivering». Beslutningen omfatter rules,
markør, legacy-sperre, etterkontroll og vilkår for tilbakerulling. De
tekniske hullene er lukket eller listet under «Ikke verifisert» før det.
