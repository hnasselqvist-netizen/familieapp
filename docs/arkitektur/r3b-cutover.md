# R3b — cutover av forsoningsnodene

- **Status:** forslag til review (Kontrolltårnet). Ingenting er aktivert.
- **Issue:** #34. **Kontrakt:** [ADR 0002](../beslutninger/0002-forsoningsnoder-en-aktiv-skriver.md).
- **Grunnmur (R3b-0):**
  - felles skriveport `web/src/hooks/forsoningAktivering.ts` (AV);
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
2. **Spillerom-dashbordet:** legacy-fanen «Spillerom» i `ForvaltningScreen`
   (~5276–5430) er et eget dashbord med nivåkort, «muligheter» og neste større
   utbetaling. React har bare den detaljerte `SpilleromScreen` (legacy sin skjulte
   «detaljer»), med saldo og prognose. Dashbordet skriver ingen forsoningsnoder.
   Produktvalg: porter dashbordet før cutover, eller godta at inngangen går rett
   til detaljskjermen.
3. **`uplassert`-hendelser er usynlige i arbeidskøen** (funn fra R3-les, bevart
   likt i React). Kobling av en kvittering som ikke kan lukkes (splittavvik,
   beløpsavvik, ikke fordelt) til en transaksjon uten hendelse lager en
   `uplassert` hendelse. Transaksjonen vises
   da bare i «Alle transaksjoner», ikke i noen kø-fane, verken i legacy eller React.
   Produktvalg: rett ved cutover, eller la det stå.
4. **Ingen automatisert ende-til-ende med porten på.** Porten er bevisst en
   kodekonstant, så CI kjører aldri skrivende flyter i nettleser. Hver del
   (R3b-1–4) er kjørt manuelt mot emulatoren med porten slått på lokalt. Forslag:
   release-PR-en kjører `npm run test:e2e` mot emulatoren med porten på før merge,
   i tillegg til røyktesten.

## 5. Rollback

1. Slå av porten (`forsoningSkrivingAktiv()` → `false`) og deploy `web/`.
2. Reverter sperre-commiten i `index.html` og deploy.
3. Last alle enheter på nytt.

Det trengs ingen datamigrering. React skriver samme array-form, med indeksnøkler og
`id` i elementet, og legacy leser den tilbake uten tap eller duplikat. Dette er låst
i `forsoningSkriving.repository.integration.test.ts` og `rules.repository.integration.test.ts`.

## 6. Legacy-sperren (patchen)

Patchen er **rent additiv**: 12 linjer etter `dbSet`, og én vakt øverst i hver av de
fire setterne.

```js
if(FORSONING_SKRIVESPERRE) { varsleForsoningSperret("hendelser"); resolve(); return; }
```

Når sperren er på, gjør setteren ingenting. Den skriver verken lokalt eller til
Firebase, og promiset løses, så kallere som venter ikke henger. Brukeren får
`alert` én gang per sidelasting og `console.warn` per forsøk.

`legacySkrivesperre.legacy.test.ts` anvender patchen i minnet og låser:

- at den treffer dagens `index.html` (endres setterne, feiler testen);
- at den er additiv;
- at sperrede settere ikke skriver;
- at setterne med flagget av er identiske med dagens.

## 7. Åpne valg for Kontrolltårnet/Helen

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
4. **Varselform i legacy:** `alert` én gang per sidelasting (i patchen) eller et
   permanent banner i Forvaltning-skjermene. Begge er rene `index.html`-endringer i
   sperre-commiten.
5. **Kvitteringsbilder (Google Drive):** legacy laster opp bildet til Helens
   Google Drive via gapi/OAuth i nettleseren (ny kvittering og «Legg til bilde»
   i detaljen). React lagrer foreløpig uten bilde, og viser lenken til bilder som
   finnes. Etter cutover kan nye bilder derfor ikke legges ved før dette er
   avgjort. Det krever en ekstern avhengighet (OAuth-klient og Drive-tilgang), så
   det trengs en beslutning:
   - porter Drive-opplastingen til React (samme OAuth-klient og mappe som i dag),
   - flytt bilder til Firebase Storage (ny tjeneste, nye regler), eller
   - godta kvitteringer uten bilde inntil videre.
