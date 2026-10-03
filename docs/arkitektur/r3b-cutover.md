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
| Kvitteringsinnboks | bakgrunnsforslag (effekt, ~5865) | receipts | beregnes i minnet (R2), skrives ikke |
| Kvitteringsinnboks | ny kvittering, forkast, rediger (+ synk av koblet hendelse) | receipts, hendelser | – |
| Kvitteringsinnboks | koble / omkoble til transaksjon | receipts, hendelser, transaksjoner | – |
| Bankimport | import av bankfil (nye rader + auto-hendelser) | transaksjoner, hendelser | parse/dupKey portert (R0) |
| Bankimport | lagre beslutning: plassering/splitt, på vent | hendelser, transaksjoner | motorer portert (R0) |
| Bankimport | ignorer / status | transaksjoner | – |
| Bankimport | intern overføring | transaksjoner | motor portert (R0) |
| Bankimport | regel-læring, flerbruk, «bruk og utvid regel» | rules, transaksjoner | motor portert (R0) |
| Bankimport | manuell registrering (hendelse uten bankrad) | hendelser | – |
| Bankimport | legg til kvittering (base64 i `imageUrl`) | receipts | – |
| Bankimport | korriger ferdig hendelse (+ læring) | hendelser, rules | – |
| Budsjett / Inntekter / Sparing (gammel) | korriger hendelse fra postdetalj (+ læring) | hendelser, rules | – |
| Budsjett / Inntekter / Sparing (gammel) | rediger koblet kvittering fra postdetalj | receipts, hendelser | – |
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
2. **R3b-1, Bankimport-beslutning:**
   - plassering/splitt, på vent, ignorer og intern overføring;
   - regel-læring og flerbruk;
   - på transaksjonsoversikten fra R3-les.
3. **R3b-2, Bankimport-import:** bankfil, dupKey, auto-hendelser fra regler, og manuell registrering.
4. **R3b-3, Kvitteringsinnboks:** ny, forkast, rediger og koble/omkoble. Bakgrunnsforslaget skrives da av React.
5. **R3b-4, korrigering:** fra transaksjonsoversikten og fra postdetalj i Budsjett/Inntekter/Sparing (React-versjonene finnes fra før).
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
   - `web/`: `forsoningSkrivingAktiv()` returnerer `true`.
4. Deploy legacy og `web/` i samme vindu.
5. **Alle enheter lastes på nytt.** `sw.js` cacher ikke, så det er åpne faner og
   PWA-er som er den gamle skriveren. Det gjelder også Eivinds enheter.
6. **Røyktest:**
   - en skrivehandling i gammel Bankimport gir varsel én gang, og Firebase er uendret;
   - den samme handlingen i React skriver;
   - legacy leser React sin endring.

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
3. **Varselform i legacy:** `alert` én gang per sidelasting (i patchen) eller et
   permanent banner i Forvaltning-skjermene. Begge er rene `index.html`-endringer i
   sperre-commiten.
