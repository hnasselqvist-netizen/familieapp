# 0003 — Handlelisten: én aktiv skriver, vern på serveren (FORSLAG)

- **Status:** Forslag. Ikke vedtatt, og ingenting er deployet. Gjeldende
  `infra/firebase/database.rules.json`, `index.html`, auth og
  produksjonsdata er uendret.
- **Dato:** 23. oktober 2026
- **Deltakere:** Kontrolltårnet (review), Claude (teknisk implementatør)
- **Kilder:** Mat #20; PR #77 med review
  [6355066911](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6355066911)
  (pkt. 5),
  [6355434985](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6355434985)
  og
  [6356624432](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6356624432)
  og
  [6356969393](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6356969393).
  Mønsteret følger [ADR 0002](0002-forsoningsnoder-en-aktiv-skriver.md).

## Kontekst

Sammenslåing og angring av handlelisteduplikater (#77) skriver hele
`families/{f}/shopping` i én transaksjon, med historikk på den beholdte
raden. Legacy (`index.html`) har **én** skriver av handlelisten,
`setShopping` (~16493), og den skriver alltid hele noden:

```js
dbSet(`${FAM}/shopping`, Object.fromEntries(next.map(i => [i.id, i])))
```

Alle legacy-produsenter går gjennom denne skriveren: ShoppingScreen
(legg til, avhuk, fjern, «Fjern fullførte», feltendring) og
PlanScreen-generatoren (`onAddToList`). RecipesScreen får `setShopping`,
men kaller den ikke. `dbGetOnce(shopping)` i bootstrap leser bare.

En sperre i `index.html` stopper bare nyinnlastet kode. Den stopper ikke
åpne faner eller PWA-er med gammel kode, og heller ikke skrivinger SDK-en
har lagt i kø mens klienten var frakoblet. En slik helnodeskriving kan
stille gjenopprette innslåtte rader og fjerne historikk. Vernet må derfor
ligge **på serveren**.

## Forslag

### 1. Rules: skrivermarkør på `shopping`

Fullstendig forslagsfil:
[`infra/firebase/forslag/handleliste-skrivemarkor.rules.json`](../../infra/firebase/forslag/handleliste-skrivemarkor.rules.json).
Endringen mot gjeldende rules (`M` er dagens medlemsregel, uendret):

```diff
 "$familyId": {
   ".read": M,
-  ".write": M
+  "shopping": {
+    ".write": "M && newData.exists()",
+    ".validate": "_skriver har versjon/name/cat/amount/done
+                  && versjon === 'web-v2' && name er ikke-tom streng
+                  && cat og amount er strenger && done === true
+                  && _skriver/id finnes ikke",
+    "_skriver": { "versjon"|"name"|"cat"|"amount"|"done": { ".validate": true },
+                  "$annet": { ".validate": false } }
+  },
+  "$annet": { ".write": M }
 }
```

- Forelderens `.write` er **fjernet**. Ellers ville arvet skrivetilgang
  fra `$familyId` omgått vernet på `shopping`.
- `$annet` gir alle andre barn nøyaktig samme tilgang som i dag.
- En test sjekker at forslagsfilen er lik gjeldende rules med nøyaktig
  denne endringen, så avvik mellom filene fanges opp.

**Hva regelen fanger, og hva bare etterkontrollen fanger:**

| Feil i markøren | Skrevet av klient | Skrevet utenom rules (admin/konsoll) |
|---|---|---|
| Mangler, feil `versjon`, manglende eller feiltypet påkrevd felt, `done ≠ true`, `id` | Avvises (testet) | All klientskriving til `shopping` forblir avvist (fail-closed, testet). Etterkontrollen viser `markor: "feil"`. |
| Ekstra felt (annet enn `id`) | Avvises av `_skriver/$annet` (testet) | **Fanges ikke av regelen** (testet). Klientskriving går gjennom; bare etterkontrollen (`markor: "feil"`) fanger det. |

`.validate` på `shopping` evalueres ved hver klientskriving i noden, men
kan ikke telle felt. `_skriver/$annet` evalueres bare når markøren selv
skrives av en klient. Admin-SDK og konsollen går utenom rules.

### 2. Endelig råformat for markøren

Kilden er
[`infra/firebase/forslag/handleliste-skrivemarkor.markor.json`](../../infra/firebase/forslag/handleliste-skrivemarkor.markor.json).
Rules-testene, legacy-harnessen og MCP-verktøyet bruker den samme filen;
MCP-konstanten er testet lik den.

```json
{ "versjon": "web-v2", "name": "Handlelisten redigeres i den nye appen",
  "cat": "Diverse", "amount": "", "done": true }
```

- **Ingen `id`.** Legacy nøkler på `i.id`. Med `id: "_skriver"` ville
  legacy-helnoden tatt markøren med seg og blitt godtatt. Det ble funnet i
  legacy-harnessen.
- **Vareformet, med streng-`name` og `done: true`.** Legacy gjør
  `Object.values(shopping)`, og flere legacy-stier kaller
  `.name.toLowerCase()` på hvert element. Markøren vises som en fullført rad
  med forklarende tekst.
- **`_`-nøkkel.** Web v2, MCP og duplikatdomenet ignorerer den som vare.

### 3. Serververnet beholdes som hovedregel

Vernet blir stående så lenge legacy kan nås, også om funksjonen rulles
tilbake (§Tilbakerulling etter aktivering).

### 4. Omfang: rules gjelder ALLE familier

Regelen ligger under `$familyId`. Når den deployes, sperres
handleliste-skriving i **hver** familie som mangler markør, ikke bare
`familie1`. Andre moduler påvirkes ikke, og én markør dekker bare sin egen
familie (emulatortest med to familier).

**Preflight-vilkår:** Før rules-deploy må Helen bekrefte at `families`
bare inneholder `familie1`, for eksempel ved å se på nøklene i
Firebase-konsollen. Finnes flere familier, må markørsteget kjøres for hver
av dem, eller de må bevisst forbli sperret. Dette verktøyet leser bare én
navngitt familie. Det lister ikke familier og utvider ikke lesingen av
produksjonsdata.

### 5. Foreslått `index.html`-sperre (vedlegg, ikke anvendt)

[`0003-vedlegg-index-html-sperre.diff`](0003-vedlegg-index-html-sperre.diff)
legger til tre ting:

- `SHOPPING_SKRIVESPERRE` med varsel øverst i `setShopping`, etter mønster
  fra `FORSONING_SKRIVESPERRE`,
- et banner i ShoppingScreen,
- en lenke til `/mat/handle` i den nye appen.

Den er ikke vernet; det er regelen. Sperren gir forklaring i stedet for
stille tilbakerulling. Fordi den slår til før oppdatereren kjører, fjerner
den også legacy-generatorens krasj med `_ops`/`undefined`. Harnessen
anvender diffen på en **midlertidig kopi** og tester banner, varsel, at
ingen skriving forsøkes, og at generatoren ikke krasjer. `index.html` i
repoet endres ikke uten mandat.

## Overgangsverktøy (emulatortestet, ingen produksjonskjøring)

[`mcp-server/src/admin/handlelisteOvergang.ts`](../../mcp-server/src/admin/handlelisteOvergang.ts)
har ren logikk; CLI-en er `handlelisteOvergangCli.ts` →
`dist/handleliste-overgang.js`. Produksjonsvernet er som for
`add-member`: uten emulator kreves `MCP_ALLOW_PRODUCTION_DATA=true`, også
for kontroll og tørrkjøring. CLI-en tar `FIREBASE_DATABASE_URL`. Exit-koder:

| Kode | Betydning |
|---|---|
| 0 | OK |
| 1 | Avslag, avvik, eller `kontroll.stopp` ikke tom: **stopp og undersøk** |
| 2 | Bruk- eller miljøfeil |
| 3 | Kjøring feilet |

**`kontroll --family <f>`** leser bare og gir aldri navn eller mengder. Den
gir exit 1 når `stopp` ikke er tom. Manglende markør før overgangen er
forventet og er ikke stopp.

| Felt | Innhold |
|---|---|
| `form` / `strukturOk` | `mangler`, `objekt`, `array` eller `ugyldig` (primitiv). |
| `markor` | `ok` (nøyaktig lik fixture), `mangler` eller `feil`. |
| `antallVarer`, `antallFullfort`, `antallUtenNavn` | Ikke-`_`-nøkler; `undefined` telles for seg. |
| `undefinedForm` | `mangler`, `ops`, `markor`, `vare` eller `annet`. |
| `antallOps`, `antallAngremerker` | Tellinger. |
| `antallSammenslatt` | Poster med gyldig `sammenslaing.opId`. Telles på **alle** poster, også navnløse og `undefined`, før noen klassifisering. |
| `antallHistorikkUavklart` | Poster med `sammenslaing`/`sammenslaingAngret` i en form verktøyet ikke kan tolke. Er aldri «trygt fravær». |
| `stopp` | Ugyldig form, avvikende markør eller uavklart historikk. |
| `digestUtenMarkor` | sha256 av kanonisk JSON uten markøren. Array og objekt sammenlignes i samme nøkkelform. |

**`markor --family <f> [--fjern] [--forventet-digest <hex>] [--apply]`**:

- Én admin-transaksjon på hele noden, med tørrkjøring som standard.
- Alle andre rådata bevares byte-likt.
- En eksisterende markør som avviker fra fixture-formatet, **overskrives og
  fjernes aldri**. Ugyldig form nektes.
- `--fjern` nekter når sammenslåingshistorikk finnes eller er uavklart.
  Dette vurderes **i samme transaksjon**, så et gammelt kontrollresultat
  aldri åpner for fjerning etter en samtidig endring.
- Med `--forventet-digest` nektes skriving hvis listen er endret siden
  kontrollen. Det betyr «undersøk», **aldri automatisk gjenoppretting fra
  snapshot**: en legitim samtidig skriving kan forklare avviket.
- Etter skriving leses noden på nytt, og avvik rapporteres.

**Emulatortestet** (`handlelisteOvergang.test.ts`, 31 tester;
`handlelisteOvergang.integration.test.ts`, 11 tester, ekte admin-SDK med
kald cache og bygget CLI):

- manglende node, array-node og ugyldig node,
- avvikende markør for både sett og fjern,
- retry,
- byte-lik bevaring,
- fjern,
- samtidig skriving med forventet digest,
- historikk i vanlige, navnløse og `undefined`-poster, feilformet
  historikk og ukjente felt, uten sletting eller reparasjon,
- at fjern nekter ved historikk, også når den dukker opp etter lesingen,
- at kontroll gir exit 1 og stopp ved ugyldig node, avvikende markør og
  uavklart historikk, og aldri skriver,
- produksjonsvernet.

## Emulatorbevis (reproduserbart, alt i CI)

| Bevis | Fil |
|---|---|
| Rules-forslaget med appens ekte skriveveier, i eget emulator-navnerom (30 tester) | `web/src/data/handlelisteSkrivemarkor.forslag.integration.test.ts` |
| Overgangsverktøyet (31 + 11 tester) | `mcp-server/src/admin/handlelisteOvergang*.test.ts` |
| MCP `shopping_list_add_items` bevarer markør og `undefined` | `mcp-server/src/store/firebaseAdminStore.integration.test.ts` |
| Uendret `index.html` og foreslått sperre (10 tester) | `web/e2e-legacy/handleliste-overgang.spec.ts`; egen CI-jobb, CDN-skript fra låste npm-kopier i `web/e2e-legacy/cdn/` |
| Angring virker med porten av | `web/src/features/hverdagsflyt/mat/handleliste/HandlelisteScreen.test.tsx` |

**Verifisert i emulatoren:**

- **Tilgang.**
  - Medlem leser.
  - Ikke-medlem og uautentisert verken leser eller skriver `shopping`,
    andre moduler eller `members`.
- **Andre moduler og multipath.**
  - Andre moduler skrives som før.
  - Appens ekte rot-multipath (`spreadYearlyAmount`) og multipath på
    tvers går gjennom.
  - Multipath som erstatter `shopping` uten markør avvises atomisk.
- **Web v2.**
  - `createShoppingItem`, `updateShoppingItemField`,
    `toggleShoppingItemDone` og `removeShoppingItem` går gjennom; markør og
    `_ops` er urørt.
  - Fjerning av siste vare er lov.
  - Sammenslå og angre bevarer markøren.
- **Helnode og markør.**
  - Avvist: legacy-helnode, `set(null)`, `remove()`, `{}` og helnode uten
    markør.
  - Ti delvise eller feil markører avvises, både som barn og i helnode.
  - Delvis markør skrevet utenom rules gir fail-closed.
  - Ekstra felt skrevet utenom rules slipper gjennom regelen (presis
    grense, testet).
- **Offline-kø.** Avvist ved gjenoppkobling, både med modulær SDK og med
  legacy compat-SDK i uendret `index.html`.
- **To familier.** Familien uten markør er sperret; den andre familien og
  andre moduler påvirkes ikke.
- **Aktiveringsrekkefølge.** Uten markør er all skriving sperret; feil
  markør endrer ingenting; riktig markør (også i tom liste) åpner;
  gjeldende rules tilbake gir dagens oppførsel.
- **Uendret legacy.**
  - Vanlig og tom liste vises uten sidefeil.
  - Avhuking, fjerning, «Fjern fullførte», generatoren og offline-kø
    avvises. Noden er uendret og UI-en ruller tilbake.
  - Generatoren med `_ops`/`undefined` krasjer før skriving
    (eksisterende funn).
- **Foreslått sperre** (midlertidig kopi): banner og ett varsel vises,
  ingen skriving forsøkes, og generatoren krasjer ikke.

**Ikke verifisert:**

- Produksjonens faktiske innhold i `shopping` og antall familier.
- Selve rules-deployen og Firebase-konsollens oppførsel.
- Ekte mobil-PWA med service worker. Harnessen blokkerer service workere,
  og offline er SDK-ens `goOffline`.
- Om MCP-skriving faktisk er av i produksjon.
- At de låste CDN-kopiene er byte-like med filene CDN-en leverer i dag
  (samme versjonsnumre).

## Funn underveis

1. **Markør med `id` ville sluppet legacy gjennom.** Lukket med formatet og
   regelen.
2. **Delvis markør ble godtatt av første regelversjon.** Lukket med full
   feltvalidering; grensen for admin-skrevne ekstra felt er dokumentert
   over.
3. **Rader uten navn i legacy (eksisterende).**
   - `_ops` og `undefined` vises som tomme rader.
   - Med gjeldende rules feiler legacys oppfølgingsskriving til
     `itemHistory`.
   - Legacy-generatoren kaster `TypeError … toLowerCase` før skriving.
4. **Web v2-generatoren krasjer (eksisterende på `main`).**
   `findMergeCandidate` kaller `toLowerCase` på en rad uten `name`. Egen
   rettelse fra `main`, utenfor denne PR-en.
5. **Legacy teller markøren** som én fullført rad.

## Metadata under `undefined`

`_ops` er MCPs idempotens-register. Etter en legacy-helnodeskriving havner
det under nøkkelen `"undefined"` fordi elementet ikke har `id`.
Grunnlinjetesten viser dette med gjeldende rules. Det samme skjer med
**alle** elementer uten `id`. Flere slike elementer **kolliderer**, og bare
ett overlever. En markør som havner der, kan derfor overskrive eller bli
overskrevet av MCP-metadata, og omvendt.

**Hvordan det behandles i dag.**

| Leser | Behandling av `undefined` |
|---|---|
| MCP | Ignorerer den og bevarer den (testet). |
| Duplikatdomenet | Ignorerer den. |
| Legacy | Viser den som en tom rad, og generatoren krasjer. |
| Web v2 | Viser den som en rad uten navn, og generatoren krasjer (funn 4). |

**Bevaring og kontroll:**

- Ingen steg i denne planen skriver, flytter eller sletter `undefined`.
- Markørsteget bevarer den byte-likt (testet).
- Kontrollen rapporterer bare `undefinedForm`. Plan for bevaring og
  kontroll er beskrevet her; eventuell sletting av metadata er ikke en del
  av planen.

## Aktiveringsrekkefølge

Hvert steg krever egen beslutning. Kommandoene kjøres fra `mcp-server/`
etter `npm run build:admin`, med operatørens ADC,
`FIREBASE_DATABASE_URL` for prosjektet og `MCP_ALLOW_PRODUCTION_DATA=true`.
Ingenting av dette er kjørt.

| # | Steg | Kommando/handling | Stoppvilkår (exit 1, eller avvik → stopp og undersøk) |
|---|---|---|---|
| 0 | Preflight | Helen bekrefter at `families` bare har `familie1` (§Omfang). | Flere familier uten avklaring. |
| 1 | Grunnlinje | `node dist/handleliste-overgang.js kontroll --family familie1`. Noter `digestUtenMarkor`. | Exit 1 (`stopp` ikke tom). Se også merknaden under tabellen. |
| 2 | Rules | Helen deployer forslagsfilen manuelt. Fra nå er all klientskriving til `shopping` sperret (fail-closed). | Deploy feiler: gå til «tilbake før aktivering». |
| 3 | Markør | `markor --family familie1 --forventet-digest <fra 1>` (tørr), deretter samme med `--apply`. | `nekt` eller avvik. Ved digest-avvik kjøres ny kontroll; om endringen er legitim, gjentas steget med ny digest. Ingen gjenoppretting. |
| 4 | Etterkontroll | `kontroll --family familie1` | Exit 1, `markor` er ikke `ok`, eller `digestUtenMarkor` er ikke lik steg 3 sitt grunnlag. |
| 5 | Legacy-sperre | Vedleggsdiffen, eget `index.html`-mandat, samme vindu. | — |
| 6 | Aktivering | `HANDLELISTE_DUPLIKATER_I_PRODUKSJON = true` i egen PR. | — |

Merknad til steg 1: stopp også ved uventet `undefinedForm`/`antallUtenNavn`
som ikke er forklart.

**Mislykket markørsteg:**

- **Avslag før skriving** (`nekt`, exit 1 uten `etter`): verktøyet har ikke
  skrevet noe.
- **Prosess- eller SDK-avbrudd, eller avvik i etterkontrollen:** dette kan
  skje **etter** commit. Tilstanden er da ukjent til en ny skrivefri
  `kontroll` er kjørt. Serververnet beholdes. Det finnes ingen automatisk
  kompensasjon eller snapshot-gjenoppretting.
- Kjør `kontroll`, og deretter markørsteget på nytt. Det er idempotent og
  gir `allerede` når markøren står. Alternativet er å gå tilbake før
  aktivering.

**Tilbake før aktivering** (før steg 6, ingen sammenslåtte rader kan
finnes):

1. Kjør `markor --family familie1 --fjern --apply`. Det fjerner bare en
   markør som er nøyaktig lik fixture-filen. Til gjeldende rules er tilbake,
   er klientskriving fortsatt sperret (fail-closed).
2. Helen deployer gjeldende `database.rules.json` fra git, manuelt.
3. Kjør `kontroll`. Forvent `markor: "mangler"` og samme
   `digestUtenMarkor` som før.

Rekkefølgen (fjern markør først) hindrer at en legacy-skriving flytter
markøren inn under `undefined`, der den kunne kollidert med
MCP-metadata.

## Tilbakerulling etter aktivering

- **Standard:** `HANDLELISTE_DUPLIKATER_I_PRODUKSJON = false` (revert og
  deploy).
  - Nye sammenslåinger stopper.
  - «Angre» ligger utenfor porten og vises fortsatt
    (`HandlelisteScreen.test.tsx`).
  - **Serververnet beholdes.**
- **Serververnet fjernes bare når alle disse vilkårene er oppfylt:**
  1. Porten er av og verifisert deployet.
  2. `kontroll` gir exit 0 med `antallSammenslatt = 0` og
     `antallHistorikkUavklart = 0`. `markor --fjern` sjekker det samme på
     nytt i sin egen transaksjon og nekter ellers.
  3. Helen har eksplisitt besluttet at legacy skal skrive handlelisten
     igjen.
  4. Sperren i `index.html` reverteres i samme vindu.

  Deretter følges «tilbake før aktivering» steg 1–3.
- **Hvorfor dette ikke er standard:** Revert av vernet mens sammenslåtte
  rader finnes lar en gammel legacy-klient gjenopprette kilderader. Da
  nekter «Angre». Ingen rader tapes, men historikken blir ubrukelig.

## Beslutningen Helen får

Etter review får Helen én samlet beslutning: «Overgang for handlelisten,
steg 0–5 i ett vindu, deretter aktivering». Den omfatter preflight,
rules, markør, etterkontroll, legacy-sperre og vilkår for tilbakerulling.
