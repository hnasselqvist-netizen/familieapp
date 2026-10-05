# R3b — cutover av forsoningsnodene

- **Status:** **gjennomført 2026-10-05** (Helens godkjenning på #34). Release-PR-en har to
  commits: legacy-sperren anvendt i `index.html` (GitHub Pages ved merge), og
  forsoningsporten PÅ i `web/` (`FORSONING_CUTOVER_GJENNOMFORT`, aktiv ved `production.yml`).
  Baseline før cutover: `83cb84a`, kontrollert med `forvaltning_cutover_kontroll` (#34).
- **Issue:** #34. **Kontrakt:** [ADR 0002](../beslutninger/0002-forsoningsnoder-en-aktiv-skriver.md).
- **Grunnmur (R3b-0):**
  - felles skriveport `web/src/hooks/forsoningAktivering.ts` (PÅ etter cutover);
  - array-skriver `web/src/data/forsoningSkriving.repository.ts`;
  - første skriveflyt bak porten (Kjør regler → «Bruk resultatet»);
  - legacy-sperren som ferdig, testet patch:
    [`r3b-legacy-skrivesperre.patch`](r3b-legacy-skrivesperre.patch).

## 1. Hva som skal byttes

`transaksjoner`, `hendelser`, `receipts` og `rules` under `families/{f}` er helnode-arrays.
Legacy skriver dem **bare** gjennom fire sentrale settere i `index.html`. Det er
`setReceipts`, `setHendelser`, `setRules` og `setTransaksjoner`, alle med
`dbSet(`${FAM}/node`, next)`. Det finnes ingen andre `dbSet`/`_db.ref`-stier til
nodene. Dette er låst i `legacySkrivesperre.legacy.test.ts`.

Setterne kalles fra **44 steder i 7 legacy-skjermer**:

| Skjerm | Flyt | Noder | React i dag |
|---|---|---|---|
| Kvitteringsinnboks | bakgrunnsforslag (effekt, ~5865) | receipts | **ferdig bak port (R3b-3)**; i minnet med porten av (R2) |
| Kvitteringsinnboks | ny kvittering, forkast, rediger (+ synk av koblet hendelse) | receipts, hendelser | **ferdig bak port (R3b-3)**, uten bildeopplasting |
| Kvitteringsinnboks | koble / omkoble til transaksjon | receipts, hendelser, transaksjoner | **ferdig bak port (R3b-3)** |
| Bankimport | import av bankfil (nye rader + auto-hendelser) | transaksjoner, hendelser | **ferdig bak port (R3b-2)**, kun CSV/TXT (Excel virker heller ikke i legacy, se valg 3) |
| Bankimport | lagre beslutning: plassering/splitt, på vent | hendelser, transaksjoner | **ferdig bak port (R3b-1)** |
| Bankimport | ignorer / status | transaksjoner | **ferdig bak port (R3b-1)** |
| Bankimport | intern overføring | transaksjoner | **ferdig bak port (R3b-1)** |
| Bankimport | regel-læring, flerbruk, «bruk og utvid regel» | rules, transaksjoner | **ferdig bak port (R3b-1)** |
| Bankimport | manuell registrering (hendelse uten bankrad) | hendelser | **ferdig bak port (R3b-2)** |
| Bankimport | legg til kvittering (base64 i `imageUrl`) | receipts | – |
| Bankimport | korriger ferdig hendelse (+ læring) | hendelser, rules | **ferdig bak port (R3b-4)** |
| Budsjett / Inntekter / Sparing (gammel) | korriger hendelse fra postdetalj (+ læring) | hendelser, rules | **ferdig bak port (R3b-4)** |
| Budsjett / Inntekter / Sparing (gammel) | rediger koblet kvittering fra postdetalj | receipts, hendelser | **ferdig bak port (R3b-4)**, samme redigering som innboksen |
| RegelSenter | oppdater, slett, slå sammen | rules | **ferdig bak port (R1)** |
| RegelSenter | Kjør regler → «Bruk resultatet» | hendelser, transaksjoner | **ferdig bak port (R3b-0)** |
| Fortegns-recovery (engangsverktøy) | rett to kjente feil-signerte hendelser | hendelser | – |

## 2. Konsekvens: én samlet cutover for alle fire noder

Nesten hver flyt skriver to eller tre av nodene i samme handling. Med «én aktiv
skriver per node» må derfor **alle fire** nodene bytte skriver i samme release.
Patchen sperrer alle fire setterne samtidig.

Sperren skrur av **alle** flytene i tabellen i den gamle appen. Det som ikke
finnes i React på cutover-dagen, er utilgjengelig til det bygges. **Cutover bør
derfor vente til React har paritet for flytene Helen faktisk bruker.**

## 3. Paritetsløp før cutover (forslag til rekkefølge)

Hver PR har porten **AV**, differensielle tester mot legacy og emulatortester.
Den kan merges uten risiko for data.

1. **R3b-0 (denne PR-en):**
   - felles port og array-skriver for alle fire noder;
   - «Bruk resultatet»;
   - legacy-sperren som testet patch;
   - denne planen.
2. **R3b-1, Bankimport-beslutning (levert, porten av):**
   - plassering/splitt, på vent, ignorer og intern overføring;
   - regel-læring og flerbruk;
   - på transaksjonsoversikten fra R3-les.
3. **R3b-2, Bankimport-import (levert, porten av; kun CSV/TXT):** bankfil, dupKey, auto-hendelser fra regler, og manuell registrering.
4. **R3b-3, Kvitteringsinnboks (levert, porten av):**
   - ny kvittering, forkast, rediger (med synk av koblet hendelse) og koble/omkoble med legacy sine konflikter og valg;
   - bakgrunnsforslaget skrives av React når porten er på;
   - avvik: redigering samles i et utkast og skrives ved «Lagre endringer» (legacy skriver per felt; samme sluttilstand);
   - ikke portert: bildeopplasting til Google Drive (åpent valg 5).
5. **R3b-4, korrigering (levert, porten av):**
   - «Korriger kobling» i «Alle transaksjoner» og drilldown fra postdetalj i Budsjett/Inntekter/Sparing;
   - samme modal som legacy `KorrigerHendelseModal`: bytt post (signert beløp gjøres rått første gang), del opp, ansvar, «Lær denne koblingen», sett på vent;
   - kvitteringsrader i drilldown åpner samme redigering som innboksen (R3b-3).
6. **Cutover-release** (avsnitt 4).

Rekkefølgen følger bruksfrekvens og avhengigheter, der R3b-1 bruker de samme
motorene som R3b-0. Den kan endres uten konsekvens, siden ingen PR aktiverer noe.

## 4. Cutover-release (sjekkliste)

1. Alle paritets-PR-er er merget med porten av, og CI er grønn.
2. **Sikkerhetskopi:** eksporter de fire nodene, for eksempel med Firebase-konsollen
   «Export JSON» på `families/{f}`, før release. Rollback trenger den ikke, men den
   er billig forsikring.
3. Release-PR med **to separate commits**, med eksplisitt mandat:
   - `index.html`: anvend `docs/arkitektur/r3b-legacy-skrivesperre.patch`, med `git apply`;
   - `web/`: `forsoningSkrivingAktiv()` returnerer `true`. Det bytter også
     `/forvaltning` fra legacy-broen til React-inngangen (`ForvaltningHub`), så
     navigasjon og skriving byttes i samme steg.
4. Deploy legacy og `web/` i samme vindu.
5. **Alle enheter lastes på nytt.** `sw.js` cacher ikke, så det er åpne faner og
   PWA-er som er den gamle skriveren. Det gjelder også Eivinds enheter.
6. **Røyktest:**
   - en skrivehandling i gammel Bankimport gir varsel én gang, og Firebase er uendret;
   - den samme handlingen i React skriver;
   - legacy leser React sin endring;
   - `/forvaltning` viser React-inngangen, og alle åtte områdene åpnes.

### 4b. Konkrete gap funnet i paritetsverifikasjonen

Disse blokkerer ikke datasikkerheten, men bør avklares før cutover:

1. **Navigasjon (løst bak porten):** før R3b-cutover lenket ingenting i React til
   de migrerte skjermene, og `/forvaltning` var legacy-broen. Etter sperren ville
   Helen dermed havnet i en sperret legacy-Forvaltning. `ForvaltningHub` viser
   nå legacy-fanene (Spillerom, Inntekter, Kostnader, Sparing, Import→Transaksjoner,
   Kvitteringer) pluss RegelSenter og Årsbudsjett, som i legacy ligger under
   Verktøy. Den vises bare når porten er på.
2. **Spillerom-dashbordet (portert, pre-cutover 1):** legacy-fanen «Spillerom» i
   `ForvaltningScreen` (~5276–5430) med beslutningskort, «muligheter», neste større
   utbetaling og fordeling per nivå finnes nå på `/forvaltning/oversikt`, og er
   inngangen «Spillerom» i `ForvaltningHub`. Detaljskjermen ligger fortsatt på
   `/forvaltning/spillerom`. Dashbordet skriver bare `liquidity.saldo`, med samme
   skriving som detaljskjermen.
3. **`uplassert`-hendelser i arbeidskøen (rettet, pre-cutover 2):** kobling av en
   kvittering som ikke kan lukkes (splittavvik, beløpsavvik, ikke fordelt) til en
   transaksjon uten hendelse lager en `uplassert` hendelse. Legacy viser da
   transaksjonen i ingen kø-fane, bare i «Alle transaksjoner» (karakterisert i
   `transaksjonsoversikt.legacy.test.ts`). React viser den i «Krever vurdering» med
   merket «ikke fordelt», unntatt når den allerede står i «Forslag til match».
   Beslutningspanelet fullfører den eksisterende hendelsen (samme id, `receiptId`
   og `opprettet`, som legacy `lagreBehandling`). Dataformen er uendret.
4. **Automatisert ende-til-ende med porten på (pre-cutover 3):**
   `npm run test:e2e:skriving` bygger appen med `--mode e2e-skriving`, som er den
   eneste veien til porten (låst i `forsoningAktivering.test.ts`). Suiten kjører
   mot emulatoren i CI: Bankimport-beslutning med læring, ny kvittering og
   korrigering, og den leser nodene med firebase-admin for å verifisere at de forblir
   legacy-arrays. CI sjekker også at produksjonsbygget ikke har spor av modusen.
   Release-PR-en for cutover utvider suiten ved behov.

## 5. Rollback

1. Slå av porten (`FORSONING_CUTOVER_GJENNOMFORT = false` i `forsoningAktivering.ts`,
   eller reverter port-commiten) og deploy `web/` med `production.yml`.
2. Reverter sperre-commiten i `index.html` og deploy.
3. Last alle enheter på nytt.

Det trengs ingen datamigrering. React skriver samme array-form, med indeksnøkler og
`id` i elementet, og legacy leser den tilbake uten tap eller duplikat. Dette er låst
i `forsoningSkriving.repository.integration.test.ts` og `rules.repository.integration.test.ts`.

## 6. Legacy-sperren (patchen)

Patchen er **rent additiv**: sperreblokken og bannerkomponenten etter `dbSet`, én vakt
øverst i hver av de fire setterne, og banneret som første element i legacy-Forvaltning
og RegelSenter.

```js
if(FORSONING_SKRIVESPERRE) { varsleForsoningSperret("hendelser"); resolve(); return; }
```

Når sperren er på, gjør setteren ingenting. Den skriver verken lokalt eller til
Firebase, og promiset løses, så kallere som venter ikke henger. Brukeren får
`alert` én gang per sidelasting og `console.warn` per forsøk.

**Banner (Kontrolltårn-valg 5971209605):** øverst i legacy-Forvaltning (alle faner) og i
RegelSenter står et permanent 🔒-banner: «Bankimport, kvitteringer og regler er flyttet
til den nye appen. Du kan se dem her, men endringer lagres ikke», med lenke til
`https://familieapp-a5d15.web.app/forvaltning`. Sperren kan dermed verifiseres på hver
enhet uten å forsøke en skriving. `alert` beholdes som tilbakemelding når en skriving
faktisk avvises.

`legacySkrivesperre.legacy.test.ts` anvender patchen i minnet og låser:

- at den treffer dagens `index.html` (endres setterne, feiler testen);
- at den er additiv;
- at sperrede settere ikke skriver;
- at setterne med flagget av er identiske med dagens;
- at banneret rendres med sperren og ikke uten, og står nøyaktig to steder: først i
  `ForvaltningScreen` og først i RegelSenter sitt faste innhold.

## 7. Valg for Kontrolltårnet/Helen (alle avgjort 2026-10-05, #34)

Beslutningene D1–D4 på #34:
- **D1:** cutover gjennomføres nå.
- **D2:** nye kvitteringer kan registreres uten bilde inntil videre. Varig bildelagring
  (Drive eller Firebase Storage) er egen oppfølging.
- **D3:** fortegns-recovery (begge hendelsene er bekreftet `allerede_korrekt`) og
  Bankimports base64-«Legg til kvittering» pensjoneres. Eksisterende data beholdes.
- **D4:** bannerlenken er `https://familieapp-a5d15.web.app/forvaltning`.

Bakgrunnen for valgene står under.

1. **Venter cutover på full paritet?** Anbefaling: ja. Alternativet er en periode
   der noen gamle flyter er utilgjengelige.
2. **Fortegns-recovery og «legg til kvittering» (base64 i `receipts`) i Bankimport:**
   porteres, eller pensjoneres ved cutover?
   - Recovery er et engangsverktøy for to kjente hendelser. Forslag: bekreft at det er kjørt, og pensjoner det.
   - Base64-kvitteringene: Kvitteringsinnboksen (Drive) dekker samme behov. Forslag: pensjoner opplastingen, men behold visning av eksisterende.
3. **Excel-import (DNB/Mastercard):** legacy kaller `XLSX.read`, men
   `index.html` laster aldri SheetJS (ingen `<script>`, ingen gang i
   git-historikken). En `.xlsx`-fil gir derfor `ReferenceError` i dag, og
   Excel-import virker **ikke** i produksjon. Funnet er låst i
   `bankimport.legacy.test.ts`. Faktisk paritet er altså CSV/TXT, som React
   har. Forslag:
   - **Cutover:** behold CSV/TXT. Det er ingen regresjon.
   - **Hvis Excel ønskes (egen PR etter cutover):** SheetJS fra
     `cdn.sheetjs.com` (0.20.x) som pakke i `web/`, lastet med dynamisk
     `import()` bare i importpanelet. Arket gjøres om med
     `sheet_to_csv(ws, {FS: ";"})` og går inn i dagens `byggImportPreview`,
     akkurat som legacy var ment å gjøre. Ikke bruk `xlsx@0.18.5` fra npm:
     den er siste versjon der og har kjente sårbarheter (CVE-2023-30533,
     CVE-2024-22363).
   - DNB-hinteksten i legacy («Excel (.xlsx)») er misvisende. Det er en
     egen, liten legacy-retting hvis dere ønsker den før cutover.
4. **Varselform i legacy (avgjort, 5971209605):** permanent banner i
   Forvaltning-skjermene, i tillegg til `alert` ved avvist skriving. Ligger i patchen.
5. **Kvitteringsbilder (Google Drive):** legacy laster opp bildet til Helens
   Google Drive via gapi/OAuth i nettleseren (ny kvittering og «Legg til bilde»
   i detaljen). React lagrer foreløpig uten bilde, og viser lenken til bilder som
   finnes. Etter cutover kan nye bilder derfor ikke legges ved før dette er
   avgjort. Det krever en ekstern avhengighet (OAuth-klient og Drive-tilgang), så
   det trengs en beslutning:
   - porter Drive-opplastingen til React (samme OAuth-klient og mappe som i dag),
   - flytt bilder til Firebase Storage (ny tjeneste, nye regler), eller
   - godta kvitteringer uten bilde inntil videre.
