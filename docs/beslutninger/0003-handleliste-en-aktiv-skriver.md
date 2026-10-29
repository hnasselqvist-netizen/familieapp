# 0003 — Handlelisten: én aktiv skriver, vern på serveren

- **Status:** Steg 0–4 er gjennomført i produksjon 29. oktober 2026
  (§Gjennomført overgang). Steg 6, aktivering av sammenslåing, er besluttet
  av Helen (#20
  [6507010011](https://github.com/hnasselqvist-netizen/familieapp/issues/20#issuecomment-6507010011))
  og leveres i en egen PR. Steg 5 (`index.html`-sperre) og `id`-tilbakefylling
  er ikke bestilt.
- **Dato:** 23. oktober 2026, oppdatert 26. oktober 2026 til `main`
  `d6618f4` med samlet overgangspakke (§Overgangspakke), og 29. oktober 2026
  med gjennomført overgang og aktivering.
- **Deltakere:** Kontrolltårnet (review), Claude (teknisk implementatør)
- **Kilder:** Mat #20; PR #77 med review
  [6355066911](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6355066911)
  (pkt. 5),
  [6355434985](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6355434985)
  og
  [6356624432](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6356624432)
  og
  [6356969393](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6356969393)
  og oppdraget
  [6418105783](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6418105783)
  med review
  [5654569092](https://github.com/hnasselqvist-netizen/familieapp/pull/77#pullrequestreview-5654569092).
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
| `antallUtenId` | Slike poster uten ikke-tom streng-`id` (format 2). Se §Poster uten `id`. |
| `undefinedForm` | `mangler`, `ops`, `markor`, `vare` eller `annet`. |
| `antallOps`, `antallAngremerker` | Tellinger. |
| `antallSammenslatt` | Poster med gyldig `sammenslaing.opId`. Telles på **alle** poster, også navnløse og `undefined`, før noen klassifisering. |
| `antallHistorikkUavklart` | Poster med `sammenslaing`/`sammenslaingAngret` i en form verktøyet ikke kan tolke. Er aldri «trygt fravær». |
| `stopp` | Ugyldig form, avvikende markør eller uavklart historikk. |
| `digestUtenMarkor` | sha256 av kanonisk JSON uten markøren. Array og objekt sammenlignes i samme nøkkelform. |
| `legacyIdentitet` (ved siden av `kontroll`) | Preflight for legacy-identitet, se §Poster uten `id`. Ikke stopp for `kontroll`. |

**`markor --family <f> [--fjern] [--forventet-digest <hex>] [--apply]`**:

- Én admin-transaksjon på hele noden, med tørrkjøring som standard.
- Alle andre rådata bevares byte-likt.
- En eksisterende markør som avviker fra det avtalte formatet, **overskrives og
  fjernes aldri**. Ugyldig form nektes.
- `--fjern` nekter når sammenslåingshistorikk finnes eller er uavklart, og
  når legacy-identiteten ikke er `ok`.
  Dette vurderes **i samme transaksjon**, så et gammelt kontrollresultat
  aldri åpner for fjerning etter en samtidig endring.
- Med `--forventet-digest` nektes skriving hvis listen er endret siden
  kontrollen. Det betyr «undersøk», **aldri automatisk gjenoppretting fra
  snapshot**: en legitim samtidig skriving kan forklare avviket.
- Etter skriving leses noden på nytt, og avvik rapporteres.

**Emulatortestet** (`handlelisteOvergang.test.ts`, 37 tester;
`handlelisteOvergang.integration.test.ts`, 12 tester, ekte admin-SDK med
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

## Grunnlinje i produksjon

### Veier til en skrivefri grunnlinje

Alle tre bruker den samme rene `kontrollerHandleliste`
(`mcp-server/src/handleliste/overgangKontroll.ts`). Ingen av dem skriver.

| Vei | Rettighet | Hvem kan kjøre den i dag | Status |
|---|---|---|---|
| MCP `shopping_cutover_kontroll` | `shopping:read` på egen familie | Klienter med `shopping:read` (ChatGPT-connectoren). Claude-connectoren har bare `data:read` og får `insufficient_scope`. | Deployet: #79 (`7ea0ea2`), nå `d6618f4` (run [40334973609](https://github.com/hnasselqvist-netizen/familieapp/actions/runs/40334973609)). Format 2 (`antallUtenId`) følger med neste MCP-deploy etter merge. |
| `data_les` på `shopping` + kontrollen lokalt | `data:read` på egen familie | Claude (connector koblet til økten 26. oktober). Rådata bare i privat arbeidsområde, slettes etterpå; bare tellinger og digest rapporteres. | Brukt 26. oktober (under). Digesten er regnet lokalt; likhet med serverdigesten er ikke bekreftet. |
| CLI `handleliste-overgang kontroll` | Operatørens ADC + `MCP_ALLOW_PRODUCTION_DATA=true` | Helen | Emulatortestet. Ikke kjørt mot produksjon. Koden er på #77-grenen. |

### Grunnlinje 26. oktober 2026 (foreløpig)

Lest ca. 14:10–14:12Z med `data_les` (`antall` 500, `maksBytes` 500 000):
hele noden i én side (12 barn, `neste: null`, ingen `forStor`), altså én
RTDB-spørring per lesing. `data_nokler` ga `totalt: 12`. To lesinger med ca.
to minutters mellomrom ga identisk innhold.

| Felt | Verdi |
|---|---|
| `form` / `strukturOk` | `objekt` / `true` |
| `markor` | `mangler` (forventet før overgangen) |
| `antallVarer` / `antallFullfort` / `antallUtenNavn` | 12 / 3 / 0 |
| `antallUtenId` | 5 (§Poster uten `id`) |
| `undefinedForm` / `antallOps` | `mangler` / 0 |
| `antallSammenslatt` / `antallAngremerker` / `antallHistorikkUavklart` | 0 / 0 / 0 |
| `stopp` / `stoppKoder` | tom / tom |
| `digestUtenMarkor` | `eb0b0cfa8a28d8a8fa09d43c064dd7b513c6c6fd44dfb7d590aacf780586405c` |

Dette er **ikke** et klarsignal. Handlelisten endres i daglig bruk, så
steg 1 i overgangspakken kjøres på nytt rett før markørsteget, i samme
vindu.

## Emulatorbevis (reproduserbart, alt i CI)

| Bevis | Fil |
|---|---|
| Rules-forslaget med appens ekte skriveveier, i eget emulator-navnerom (30 tester) | `web/src/data/handlelisteSkrivemarkor.forslag.integration.test.ts` |
| Overgangsverktøyet (37 + 12 tester) og `shopping_cutover_kontroll` (6 HTTP- + 4 emulator-MCP-tester) | `mcp-server/src/admin/handlelisteOvergang*.test.ts` |
| Preflight for legacy-identitet (9 tester, mot en etterligning av legacy-skrivingen): 12 poster med 5 uten `id`, én manglende `id` med `_ops`, to like ikke-tomme `id`-er, `id` ulik nøkkel; `--fjern` nekter i samme transaksjon (også mot emulatoren og via CLI) | `mcp-server/src/handleliste/legacyIdentitet.test.ts`, `handlelisteOvergang*.test.ts` |
| MCP `shopping_list_add_items` bevarer markør og `undefined` | `mcp-server/src/store/firebaseAdminStore.integration.test.ts` |
| Uendret `index.html` og foreslått sperre (12 tester), også 12 syntetiske poster med 5 uten `id`: tap med gjeldende rules, avvist og bevart med forslaget | `web/e2e-legacy/handleliste-overgang.spec.ts`; egen CI-jobb, CDN-skript fra låste npm-kopier i `web/e2e-legacy/cdn/` |
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

- Antall familier i produksjon (§Omfang). Claudes lesing er avgrenset til
  egen familie og kan ikke liste familier.
- At den lokalt regnede digesten 26. oktober er lik den serverside
  `shopping_cutover_kontroll` gir.
- Kjøretidsidentitetens IAM i produksjon er ikke kontrollert på nytt i
  denne runden.
- Selve rules-deployen og Firebase-konsollens oppførsel.
- Ekte mobil-PWA med service worker. Harnessen blokkerer service workere,
  og offline er SDK-ens `goOffline`.
- Runtime-IAM for MCP-tjenesten er ikke kontrollert på nytt, og ingen
  autorisert skriveprøve er gjort. Det som er observert: deploy
  [40334973609](https://github.com/hnasselqvist-netizen/familieapp/actions/runs/40334973609)
  på `d6618f4` er `success`, også deploy- og verifiseringssteget, og
  workflowen setter `MCP_HANDLELISTE_SKRIVING=av`. Det viser konfigurasjonen,
  ikke kjøretidsidentitetens rettigheter.
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
4. **Web v2-generatoren krasjet på en rad uten `name`.** Rettet på `main`
   i #78 (`c688b91`, navnløse kandidater hoppes over) og deployet.
5. **Legacy teller markøren** som én fullført rad.
6. **5 av 12 poster i produksjon mangler eget `id`-felt** (26. oktober).
   Eksisterende risiko, ikke fra #77. Se §Poster uten `id`.

## Poster uten `id` (funn 26. oktober)

- I produksjon har 5 av 12 poster en UUID-nøkkel, men ikke noe `id`-felt
  inne i posten. De andre 7 har `id` lik nøkkelen. Alle har `itemId`.
- Legacy leser `Object.values(shopping)` (`index.html` ~15929) og skriver
  `Object.fromEntries(next.map(i => [i.id, i]))` (~16497). **Én legacy-
  handling på handlelisten slår derfor de 5 sammen til én post under
  `"undefined"`, og fire går tapt.** Risikoen gjelder i dag, uavhengig av
  #77.
- Dagens skrivere legger inn `id`: web `createShoppingItem` siden #40, MCP
  i `shoppingNode.ts`. Postene er trolig eldre enn #40.
- Kontrollen rapporterer `antallUtenId` (format 2), så tilstanden kan
  måles uten rådata. `antallUtenId` alene beviser ikke at legacy kan skrive
  trygt: to like ikke-tomme `id`-er eller `id` ulik nøkkelen gir også
  omnøkling eller kollisjon. Det dekker preflighten under.

**Preflight for legacy-identitet** (`kontrollerLegacyIdentitet`,
`mcp-server/src/handleliste/legacyIdentitet.ts`):

- Skrivefri og ren. Etterligner legacy-nøklingen `String(i.id)` på noden
  **uten** markøren, fordi tilbakeføringen fjerner markøren først.
- `ok` er sann bare når **hver** oppføring, også `_ops`, annen metadata og
  en eventuell `"undefined"`-post, har ikke-tom streng-`id` lik sin
  rånøkkel. Da skriver legacy hver post tilbake under samme nøkkel, og
  historikk og metadata står urørt.
- Rapporterer bare tellinger og koder: `antallUtenGyldigId`,
  `antallIdUlikNokkel`, `antallDeltId`, `antallFlyttes`, `antallTapes`,
  `antallMetadataBerort`, `ok` og `avvik` (`uten_id`, `id_ulik_nokkel`,
  `delt_id`).
- Med i `shopping_cutover_kontroll` (`legacyIdentitet`) og i CLI-ens
  `kontroll`. Ikke et stoppvilkår for kontrollen før overgangen.
- **Håndheves av `markor --fjern`** i samme transaksjon som fjerningen:
  ved avvik nektes fjerning, og markøren og serververnet står. Ingen
  reparasjon.
- Følge: så lenge MCP-metadata (`_ops`) finnes, er legacy-identiteten ikke
  ok, og vernet kan ikke fjernes. I produksjon er `antallOps` 0 per 26.
  oktober, og MCP-skriving er av.
- Med 26. oktober-grunnlinjen ville preflighten gitt `ok: false`
  (5 `uten_id`). Tilbakeføring til legacy-skriving er derfor ikke mulig
  uten en egen, reviewet tilbakefylling.

**Hvordan overgangspakken håndterer det:**

- Fra steg 2 (rules) avviser serveren all legacy-helnodeskriving. Da kan
  kollisjonen ikke skje, og postene trenger ikke `id` for web v2, MCP eller
  duplikatdomenet, som alle bruker nøkkelen.
- Før steg 2 er risikoen åpen. Inntil da bør legacy-handlelisten ikke
  brukes. Det er en driftsanbefaling, ikke et teknisk vern.
- **Før legacy noen gang får skrive igjen** (§Tilbake før aktivering,
  §Tilbakerulling etter aktivering) må preflighten gi `ok: true`. Planlagt
  datatap er ikke et alternativ. Ved avvik beholdes serververnet.
- En eventuell tilbakefylling (`id` = nøkkel) er en produksjonsskriving.
  Den er **ikke bestilt** og krever eget verktøy, egen review og eget
  mandat. Den er ikke nødvendig for overgangen så lenge serververnet står.

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
| Web v2 | Viser den som en rad uten navn. Generatoren hopper over navnløse kandidater (funn 4, rettet i #78). |

**Bevaring og kontroll:**

- Ingen steg i denne planen skriver, flytter eller sletter `undefined`.
- Markørsteget bevarer den byte-likt (testet).
- Kontrollen rapporterer bare `undefinedForm`. Plan for bevaring og
  kontroll er beskrevet her; eventuell sletting av metadata er ikke en del
  av planen.

## Overgangspakke

### Avhengigheter

1. **#77 på `main` som ren kode.** Porten (`HANDLELISTE_DUPLIKATER_I_PRODUKSJON`)
   er `false`, og rules-forslaget er ikke deployet. Det gir `main` CLI-en
   (`handleliste-overgang`), forslagsfilene i `infra/firebase/forslag/` og
   format 2 av kontrollen med preflighten. Merge av trygg, reversibel kode
   etter tilfredsstillende review ligger i Kontrolltårnets mandat; det
   krever ingen egen Helen-beskjed (§Beslutningsmodell).
2. **Web-deploy** av `main` etter merge (`production.yml`; Claude kan
   starte den etter Helens stående mandat #59). Ingen synlig endring: porten
   er av.
3. **MCP-deploy** av `main` etter merge (`deploy-mcp-cloudrun.yml`, Helen
   starter den), så `shopping_cutover_kontroll` gir format 2.
4. **Eget `index.html`-mandat** for steg 5. Uten det stopper pakken etter
   steg 4, med serververnet på plass.
5. **Helen tilgjengelig** i vinduet for steg 0, 2 og 3. Steg 2 og 3 kan
   ingen andre utføre.

### Berørte familier

Regelen ligger under `$familyId` og gjelder **alle** familier (§4). Én
markør dekker bare sin egen familie. Pakken er skrevet for `familie1`.
Finnes flere familier, må hver av dem enten få sitt eget markørsteg (1, 3,
4) eller bevisst forbli sperret for handlelisteskriving.

### Steg

Stegene 0–5 dekkes av én overgangsbeslutning, og aktiveringen (6) av en
egen (§Beslutningsmodell). Hvert steg har egne stoppvilkår. CLI-kommandoene kjøres fra `mcp-server/`
på `main` etter `npm run build:admin`, med Helens ADC,
`FIREBASE_DATABASE_URL` for prosjektet og `MCP_ALLOW_PRODUCTION_DATA=true`.
Steg 0–4 er utført 29. oktober (§Gjennomført overgang); steg 6 er besluttet.

| # | Steg | Utførelsesvei (tillatt i dag) | Stoppvilkår (exit 1, eller avvik → stopp og undersøk) |
|---|---|---|---|
| 0 | Preflight | Helen bekrefter i Firebase-konsollen at `families` bare har `familie1` (§Omfang). Claude kan ikke liste familier. | Flere familier uten avklaring. |
| 1 | Grunnlinje | Helen: `node dist/handleliste-overgang.js kontroll --family familie1`. Supplement: `shopping_cutover_kontroll` (klient med `shopping:read`) eller Claude via `data_les` + kontrollen lokalt. Noter `digestUtenMarkor` fra CLI-en: den er grunnlaget for steg 3. | Exit 1 (`stopp` ikke tom). Uforklart `undefinedForm`, `antallUtenNavn` eller `antallUtenId` (forventet nå: `mangler`, 0, 5). |
| 2 | Rules | Helen deployer `infra/firebase/forslag/handleliste-skrivemarkor.rules.json` manuelt. Aldri automatisk. Fra nå er all klientskriving til `shopping` sperret (fail-closed). | Deploy feiler: §Tilbake før aktivering. |
| 3 | Markør | Helen: `markor --family familie1 --forventet-digest <fra 1>` (tørr), deretter samme med `--apply`. MCP-skriving er av, og Claude har ingen skrivevei. | `nekt` eller avvik. Ved digest-avvik: ny kontroll; er endringen legitim, gjentas steget med ny digest. Ingen gjenoppretting. |
| 4 | Etterkontroll | Helen: `kontroll --family familie1`. Uavhengig kontroll: Claude via `data_les` + kontrollen, eller `shopping_cutover_kontroll`. | Exit 1, `markor` ikke `ok`, eller `digestUtenMarkor` ulik grunnlaget i steg 3. |
| 5 | Legacy-sperre | Krever `index.html`-mandat. Claude åpner PR med vedleggsdiffen fra tillatt gren; Kontrolltårnet/Helen reviewer og merger. Legacy publiseres fra `main` (GitHub Pages; ikke verifisert via API i denne økten). Samme vindu som 2–4. | Legacy-harnessen (`test:legacy-overgang`) rød, eller banneret mangler etter publisering. |
| 6 | Aktivering | Egen PR: `HANDLELISTE_DUPLIKATER_I_PRODUKSJON = true`. Merge etter review, deretter `production.yml` (Claude kan starte den) og verifisering av grønn kjøring med riktig `head_sha`. | CI eller deploy rød. |

**Før- og etterkontroll i korte trekk:** steg 1 er førkontrollen, steg 4
etterkontrollen. Etter steg 6 kjøres kontrollen igjen etter første ekte
sammenslåing: forvent `antallSammenslatt ≥ 1`, `antallHistorikkUavklart = 0`
og `markor: "ok"`.

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

**Tilbake før aktivering** (før steg 6). Utføres av Helen; Claude kan
kjøre kontrollen i steg 3 uavhengig. Sammenslåtte rader antas ikke å
mangle: porten er av i produksjon, men emulator- og testskriving eller en
feil kan ha laget historikk. Derfor sjekkes fersk historikk.

0. Kjør `kontroll`. Fortsett bare når `antallSammenslatt = 0`,
   `antallHistorikkUavklart = 0` og `legacyIdentitet.ok` er sann. Ellers:
   stopp, og behold markøren og serververnet (§Poster uten `id`).
1. Kjør `markor --family familie1 --fjern --apply`. Det fjerner bare en
   markør som er nøyaktig lik fixture-filen, og vurderer historikk og
   legacy-identitet på nytt **i samme transaksjon**. Ved avvik nektes det,
   og ingenting skrives. Til gjeldende rules er tilbake, er klientskriving
   fortsatt sperret (fail-closed).
2. Helen deployer gjeldende `database.rules.json` fra git, manuelt.
3. Kjør `kontroll`. Forvent `markor: "mangler"` og samme
   `digestUtenMarkor` som før.

Rekkefølgen (fjern markør først) hindrer at en legacy-skriving flytter
markøren inn under `undefined`, der den kunne kollidert med
MCP-metadata.

**Rules deployet, men markøren ikke satt** (steg 3 ikke fullført): da er
all klientskriving til `shopping` sperret. Gi legacy-identiteten ikke
`ok`, er veien videre å fullføre steg 3, ikke å tilbakestille rules.

## Tilbakerulling etter aktivering

- **Standard:** `HANDLELISTE_DUPLIKATER_I_PRODUKSJON = false` (revert og
  deploy).
  - Nye sammenslåinger stopper.
  - «Angre» ligger utenfor porten og vises fortsatt
    (`HandlelisteScreen.test.tsx`).
  - **Serververnet beholdes.**
- **Serververnet fjernes bare når alle disse vilkårene er oppfylt:**
  1. Porten er av og verifisert deployet.
  2. `kontroll` gir exit 0 med `antallSammenslatt = 0`,
     `antallHistorikkUavklart = 0` og `legacyIdentitet.ok`. `markor --fjern`
     sjekker det samme på nytt i sin egen transaksjon og nekter ellers.
  3. Helen har eksplisitt besluttet at legacy skal skrive handlelisten
     igjen.
  4. Sperren i `index.html` reverteres i samme vindu.

  Deretter følges «tilbake før aktivering» steg 0–3.
- **Hvorfor dette ikke er standard:** Revert av vernet mens sammenslåtte
  rader finnes lar en gammel legacy-klient gjenopprette kilderader. Da
  nekter «Angre». Ingen rader tapes, men historikken blir ubrukelig.

## Beslutningsmodell

| Handling | Hvem | Status |
|---|---|---|
| Merge av #77 som ren kode (port `false`, rules ikke deployet) | Kontrolltårnet, etter tilfredsstillende review (stående mandat for trygg, reversibel kode) | Merget (`e8d17d9`) |
| Web-deploy etter merge | Claude eller Kontrolltårnet (`production.yml`, Helens stående mandat #59) | Utført ([40359355458](https://github.com/hnasselqvist-netizen/familieapp/actions/runs/40359355458)) |
| MCP-deploy etter merge | Helen eller Kontrolltårnet (`deploy-mcp-cloudrun.yml`) | Ikke kjørt. Ikke nødvendig for vinduet: operatøren brukte CLI-en |
| Overgangsvinduet, steg 0–4 | Helen, **én** samlet beslutning for vinduet. Stegene kjøres i rekkefølge; et stoppvilkår avbryter vinduet, og gjenopptak krever ny beslutning. | Godkjent (#77 [6492517610](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6492517610)) og utført 29. oktober |
| Steg 5, `index.html`-sperre | Helen, eget `index.html`-mandat, i samme vindu | Ikke bestilt. Serververnet etter steg 4 er et sikkert stoppunkt |
| Steg 6, aktivering | Helen, egen beslutning etter vellykket vindu | Besluttet (#20 [6507010011](https://github.com/hnasselqvist-netizen/familieapp/issues/20#issuecomment-6507010011)); egen PR |
| `id`-tilbakefylling | Eget verktøy, review og mandat | Ikke bestilt |

## Gjennomført overgang 29. oktober (historiske bevis)

Dette er bevis fra vinduet, ikke dagens tilstand. Tellinger og digest fra
vinduet skal ikke brukes som grunnlag senere; ta alltid en fersk kontroll.

| Steg | Bevis |
|---|---|
| 0 Preflight | Helen viste Firebase-konsollen: bare `familie1` under `families` (#77 [6492517840](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6492517840), korrigert). |
| 1 Grunnlinje | Operatørens CLI-kontroll (#77 [6493411922](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6493411922)). Uavhengig skrivefri førkontroll fra Claude kl. 10:16Z (#77 [6493978958](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6493978958)). |
| 2 Rules | Forslagsfilen er deployet manuelt av Helen; rapportert i operatørdialogen (#77 [6499232517](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6499232517)). Ingen lesevei til rules er tilgjengelig for Claude eller Work. |
| 3 Markør | `markor --apply` med operatørens egen digest (#77 [6499373209](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6499373209)). |
| 4 Etterkontroll | Operatør: «ETTERKONTROLL GODKJENT — MARKØR PÅ PLASS», digest uendret (#77 [6499373209](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6499373209)). Uavhengig skrivefri etterkontroll fra Claude kl. 14:29Z: markøren kanonisk lik konstanten og forslagsfilen, digest uten markør uendret (#77 [6499440077](https://github.com/hnasselqvist-netizen/familieapp/pull/77#issuecomment-6499440077)). |

## Fersk kontroll før aktivering (29. oktober, 20:16Z)

Claude, `data_les` på `shopping` og kontrollkoden fra `c401c0e`, kjørt
lokalt. Bare tellinger og digest:

| | |
|---|---|
| `markor` | `ok` (kanonisk lik `HANDLELISTE_MARKOR` og forslagsfilen) |
| `strukturOk` / `stopp` / `stoppKoder` | `true` / `[]` / `[]` |
| `antallVarer` / `antallFullfort` | 25 / 20 (brukeren har endret listen siden vinduet) |
| `antallUtenNavn` / `antallUtenId` | 0 / 5 (de fem kjente postene) |
| ops / sammenslått / angremerker / historikk uavklart | 0 / 0 / 0 / 0 |
| `digestUtenMarkor` | `9cc324484fd42feec06c85fc25ff8de89d8e316e81a2ce52ba3c608f87633dce` |
| `legacyIdentitet` | `ok: false`, `[uten_id]` — kjent tilstand, ingen ny skade |

## Status: verifisert og gjenstående (29. oktober)

| | Innhold |
|---|---|
| **Verifisert** | Steg 0–4 i produksjon (over). Rules-forslaget, markøren, overgangsverktøyet og legacy-sperren i emulatoren (§Emulatorbevis, alt i CI). Web v2 sine skriveveier, også sammenslå og angre, mot forslagsfilen i emulatoren (`handlelisteSkrivemarkor.forslag.integration.test.ts`), nå også med rader uten eget `id`-felt slik produksjonen har. |
| **Leveres nå** | Steg 6: `HANDLELISTE_DUPLIKATER_I_PRODUKSJON = true`. Aktiv først etter merge, grønn main-CI og verifisert `production.yml` på merge-SHA. |
| **Etter aktivering** | Skrivefri kontroll etter første ekte, brukerstyrte sammenslåing: forvent `markor: "ok"`, `antallSammenslatt ≥ 1`, `antallHistorikkUavklart = 0`. Ingen prøveskriving i produksjon. |
| **Kjent avvik** | `infra/firebase/database.rules.json` i git er fortsatt de *gamle* rules, mens produksjonen kjører forslagsfilen. Det er bevisst: filen er referansen for «Tilbake før aktivering», og rules endres aldri uten egen beslutning. Følgen er at e2e-testene i CI kjører mot de gamle rules; web v2 sine skriveveier mot produksjonens rules dekkes av integrasjonstesten over. Å gjøre forslaget til gjeldende fil i git er et eget, reviewet steg. |
| **Ikke bestilt** | Steg 5 (`index.html`-sperre), `id`-tilbakefylling, MCP-deploy av format 2. |

## Beslutningene Helen har tatt

1. **Overgangsvinduet, steg 0–4:** godkjent og gjennomført 29. oktober.
   Steg 5 er ikke bestilt.
2. **Aktivering:** besluttet 29. oktober («Aktiver duplikatfunksjonen»).

Legacy-handlelisten (`index.html`) kan ikke lenger lagre handlelisten; bruk
den nye (`/mat/handle`).
