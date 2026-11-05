# Forvaltning: øvrige praktiske hull (kartlegging)

**Status:** kartlegging etter #59, ordre 6654024344. Den gjelder roadmap-punkt 5 og er gjort mot main `86650ce`. Dokumentet er docs-only.

- **Ingen endringer:** ingen funksjonsendring, ingen produksjonsdata lest eller skrevet, og ingen generator eller «Kjør regler» kjørt i produksjon.
- **Bevis:** alle bevis under kommer fra syntetiske, lokale vitest-kjøringer i en scratch-fil som ikke er committet, eller fra eksisterende tester.

## 1. Generator, forfallsdag, overstyring, gjenkjøring og årsskifte

### Tre forskjellige tall

| Tall                                | Lagring                                                                                      | Hvem skriver                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Likviditetsprognose** (Spillerom) | `liquidity/posts/{id}` (flat liste)                                                          | generatoren og manuelle poster                                         |
| **Plan** for inneværende år         | `budget` / `incomeGroups` / `sparingGroups` → `{gruppe}/{post}/months[0–11].budget` + `meta` | Økonomi og Årsbudsjett                                                 |
| **Plan** for andre år               | `annualBudgetPlans/{år}/{type}`                                                              | Årsbudsjett, bare år ≠ inneværende (`hooks/useArsbudsjett.ts`)         |
| **Faktisk** per måned               | `months[i].spent` på samme poster                                                            | `data/budsjettfamilie.repository.ts` (`updateItemMonth`, felt `spent`) |

Prognosen leser plan og faktisk og skriver bare `liquidity/posts`. Den skriver aldri tilbake til budsjett eller faktisk.

### Faktisk vei

1. **UI:** `SpilleromScreen.tsx`.
   - Knappen **«Oppdater prognose»** (`:244`) kaller `regenerate()`. Navnet «Oppdater fra budsjett» finnes ikke i koden.
   - I tillegg kjører en **automatisk** `useEffect` (`hooks/useLiquidity.ts:139–142`) ved hver endring i budsjett-, inntekts- eller sparedata eller i prognosedatoen.
2. **Hook:** `useLiquidity.regenerate` (`:116`). Perioden er i dag → `prognosisDate`, eller standarddatoen fra `beregnStandardPrognosisDate`, som er dag 20.
3. **Domene:** `domain/liquidity/liquidity.ts generateForecastPosts` (`:140`).
   - Den tar med poster med `meta.automatisk` og en `forfallsdag`.
   - Beløpet er `spent` hvis det finnes, ellers `budget`. For inntekt overstyrer `disponibelt` begge.
   - Hver post får en `_genKey` per (post, år, måned, dag).
   - Manuelle og overstyrte poster beholdes (`:151–158`). Alle andre genererte poster lages på nytt med nye ID-er.
4. **Skriver:** `data/liquidity.repository.ts regenerateLiquidityPosts` (`:245`) gjør `set` av hele `liquidity/posts`. Legacy `runGenerator` går via `setLiquidity` (`index.html` ~16562), som skriver **hele `liquidity`**, ikke bare `posts`. Det er altså **ikke** samme atomicitetsenhet (review 5783315063).
5. **Overstyring:** `updateLiquidityPost` (`:224`) setter `manueltOverstyrt` når en generert post redigeres.

### Det brukeren kan gjøre nå

- **Metadata:** sette forfallsdag, automatisk, eier, konto og nivå per post i `PostMetaModal` (Økonomi), og disponibelt for inntekt.
- **Prognosen:** få prognosen generert automatisk og på knapp.
- **Poster:** redigere en generert post (den blir overstyrt og beholdes), legge til manuelle poster og markere manuelle poster som oppfylt.
- **Årsbudsjett:** planlegge kommende år i Årsbudsjett.

### Funn med syntetisk bevis

Alle funn er reprodusert lokalt med `TZ=UTC` og `TZ=Europe/Oslo`.

| #              | Funn                                                                                                                                                                                                                                                                                              | Bevis                                                                                                                                                                                                                                          | Brukereffekt / risiko                                                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B** (rettet) | Generert dato og standard prognosedato blir **én dag for tidlig** i norsk tid. `new Date(år, mnd, dag).toISOString().slice(0, 10)` (`liquidity.ts:89, 184, 235, 289`) gjør lokal midnatt om til UTC.                                                                                              | **5 eksisterende tester feiler med `TZ=Europe/Oslo`**, for eksempel `liquidity.test.ts:113` (forventet `2026-06-20`, fikk `2026-06-19`), `:191` (generert kostnadspost) og `PrognoseDato.test.tsx:70`. CI kjører i UTC og ser det derfor ikke. | **Synlig feil dato**, for eksempel husleie med forfall 20. vist som 19. og standard «lønningsdag» vist som 19. Når brukeren velger prognosedato selv, blir **en post som forfaller dagen etter, regnet med**, så spillerommet blir for lavt. Gjelder samme kode i legacy.                          |
| **C** (rettet) | Forfallsdag 29–31 i en kortere måned **flyter over** til neste måned.                                                                                                                                                                                                                             | Forfallsdag 31: februarposten havner 2.–3. mars (`_genKey` `…_1_31`), i tillegg til marsposten 30.–31. mars.                                                                                                                                   | **Feil måned vises.** En periode fra tidlig i mars til månedsslutt **teller to betalinger**. Vanlige perioder fra lønn til lønn (20.→20.) unngår dobbelttelling.                                                                                                                                   |
| **D**          | Ved **årsskiftet** leser prognosen `months[0]` fra **samme** 12-månedersliste som inneværende år. Det finnes ingen årsdimensjon, og `annualBudgetPlans/{neste år}` leses ikke.                                                                                                                    | En periode 1.12.2026–31.1.2027 gir januar 2027 med inneværende års januarbeløp.                                                                                                                                                                | **Tidskritisk.** Fra rundt 20. desember spenner prognoseperioden over januar. **1. januar** bytter `currentBudgetYear` (`budsjettfamilie.ts:280`), og planen for 2027 blir ikke levende data. Gapet er allerede dokumentert som bevisst utenfor scope i `domain/arsbudsjett/arsbudsjett.ts:19–25`. |
| **E** (rettet) | Når en overstyrt generert post **får endret forfallsdag**, beholdes den gamle overstyrte posten (`_genKey …_20`), og en ny genereres (`…_25`).                                                                                                                                                    | En måned med to poster, 150 (overstyrt) + 100.                                                                                                                                                                                                 | **Dobbelttelling** til brukeren sletter én. Kantilfelle; samme oppførsel som legacy.                                                                                                                                                                                                               |
| **F**          | «Automatisk til prognosen» kan slås på uten forfallsdag (`PostMetaModal.tsx:165, 221`). Generatoren **hopper da stille over** posten (`liquidity.ts:173, 224, 275`). Designboka §2c («Generator-senter: oppdage manglende metadata») finnes bare i legacy (`index.html` ~8351 `GeneratorSenter`). | Følger av koden; ikke kjørt.                                                                                                                                                                                                                   | **En betaling kan mangle i prognosen** uten varsel.                                                                                                                                                                                                                                                |
| G              | Arkiverte poster genereres fortsatt (`arkivert` sjekkes ikke).                                                                                                                                                                                                                                    | Følger av koden; samme som legacy.                                                                                                                                                                                                             | **Ukjent produktvalg**, ikke en feil.                                                                                                                                                                                                                                                              |
| A              | En generert post markert «oppfylt» mister statusen ved neste regenerering.                                                                                                                                                                                                                        | Reprodusert.                                                                                                                                                                                                                                   | **Latent:** både web (`SpilleromScreen.tsx:436`) og legacy tilbyr «oppfylt» bare for **manuelle** poster. Ingen tiltak.                                                                                                                                                                            |

**Gjenkjøring:** `_genKey` hindrer duplikater innenfor én kjøring, så gjenkjøring er idempotent i innhold. ID-ene er likevel nye ved hver kjøring, og hele noden skrives (React: `liquidity/posts`; legacy: hele `liquidity`). En endring fra en annen klient mellom lesing og skriving kan derfor overskrives. Dette er en **kjent teknisk risiko**. Sannsynligheten er **ikke målt eller verifisert**. Den holdes som egen åpen oppfølging og løses ikke i B+C.

## 2. Konto/betaler, kostnadseier og finansieringskilde

- **Transaksjon:** `konto` = `normaliserKonto` («hvor pengene gikk, ikke hvem som eier», `domain/forsoning/kontrollrader.ts:7`). Kostnadseier ligger per fordeling (`eiere`), og regler bærer eiere og kontovilkår (#108). «Hvem betalte kontra hvem eier» håndteres av Mellomværende (#96).
- **Budsjettpost:** `meta.eier` (Felles, Helen, Eivind) og `meta.konto` (`Regninger`, `Felles`, `Helen`, `Eivind`, `MC`).
  - `meta.konto` brukes **ikke** for kostnader noe sted. Den kopieres bare inn på genererte sparingsposter (`liquidity.ts:259`).
  - Verdiene er en annen ordliste enn bankkontoene (`KONTOER`: `regningskonto`, `felleskonto`, …).
- **Spillerom** regner én disponibel saldo, ikke saldo per konto.
- **Finansieringskilde for sparing:** `meta.likviditet` (avsatt/langsiktig).
- **Vurdering:** ingen konkret feil. Prognose per konto eller kobling mellom budsjettkonto og bankkonto ville vært ny økonomisemantikk. Det foreslås **ikke**.

## 3. Regelsenter og Årsbudsjett

- **Regelsenter** (`useRegelsenter`) har oppdatering, målpost (#109), sletting, sammenslåing og «Kjør regler» med godkjent plan. Tallregler og kontovilkår kom med #108. Det dekker designboka §2i (vedlikehold, oversikt, administrasjon). **Kartlagt; ingen gjenstående hull funnet.**
- **Årsbudsjett** har inneværende år mot live-noder og andre år mot `annualBudgetPlans`. Det har Helhet, «Fordel år» og «resten av året» (#92). **Kartlagt.** Eneste reelle gap er årsskiftet (D).

## 4. Behov → støtte → gap → anbefaling

| Roadmap-behov                                         | Faktisk støtte                                         | Gjenstående gap / bevis                                                                              | Anbefaling                                        |
| ----------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Generator etter forfallsdag / «Oppdater fra budsjett» | Ja: automatisk og på knapp («Oppdater prognose»)       | **B** dato −1 dag i norsk tid (5 eksisterende tester feiler i Oslo-TZ); **C** overflyt for dag 29–31 | **Neste PR** (se under)                           |
| Manuelle overstyringer                                | Ja: `manueltOverstyrt`                                 | **E** dobbel post ved endret forfallsdag                                                             | Senere; liten                                     |
| Gjenkjøring / idempotens                              | Ja: `_genKey`                                          | Overskrivingsvindu ved samtidig manuell post (som legacy)                                            | Ingen tiltak nå                                   |
| Årsskifte                                             | Delvis: Årsbudsjett planlegger kommende år             | **D** prognosen leser feil år; planen for neste år blir ikke levende 1.1                             | **Produktvalg før midten av desember** (se under) |
| Generator-senter (oppdage manglende metadata)         | Bare i legacy                                          | **F** automatisk uten forfallsdag hoppes over stille                                                 | Kandidat etter B/C                                |
| Konto/betaler vs eier/finansiering                    | Ja på transaksjonsnivå; budsjettkonto er bare metadata | Ingen konkret feil                                                                                   | Kartlagt; ingen bestilling                        |
| Regelsenter                                           | Ja (#108/#109 + Kjør regler)                           | Ingen                                                                                                | Kartlagt                                          |
| Årsbudsjett (12 måneder, flere år)                    | Ja (#92)                                               | Bare årsskiftet (D)                                                                                  | Kartlagt                                          |

### B + C: rettet (#59, ordre 6655518240)

**Rettet:** prognosedato i lokal kalender og klemt forfallsdag, i både React og legacy.

- **React** (`web/src/domain/liquidity/liquidity.ts`):
  - `lokalKalenderdato` gir `YYYY-MM-DD` fra lokale komponenter. Den erstatter `toISOString()` i `beregnStandardPrognosisDate` og i generatorens tre grener (kostnad, sparing, inntekt).
  - `forfallIMaaned` klemmer forfallsdagen til siste dag i måneden.
- **Legacy** (`index.html`, eget mandat i ordren): de samme to hjelpefunksjonene og de samme seks linjene i `beregnStandardPrognosisDate` og `generateForecastPosts`. Ingen ny skriver, sperre eller annen endring.
  - Andre `toISOString()`-bruk i legacy er **ikke** endret, for eksempel `progDate` ~5301, nye-post-standarddatoer ~6037/6536 og bankimport ~6716. De er utenfor oppdraget.
- **Uendret:**
  - `_genKey` med konfigurert dag, for eksempel `husleie_2026_1_31` også når datoen blir 28.02, så overstyrte poster fortsatt matches.
  - Manuelle og overstyrte poster med sine lagrede datoer, beløpsgrunnlag, metadata og datakontrakt.
  - Ingen migrering eller opprydding av lagrede datoer.
- **Lesesiden:** lagret `YYYY-MM-DD` tolkes som UTC-midnatt. I UTC og UTC+1/+2 (norsk tid) er det samme kalenderdag. Fra- og til-grensene i `erPrognosepostIPeriode`/`calcSpillerom` tar derfor med riktig dag. Det er vist i `prognosedato.test.ts`, og lesesiden er ikke endret.
- **Forfallsdag under 1 eller ugyldig:** oppfører seg som før (ugyldig hoppes over). Dag over 31 klemmes nå også til siste dag.

**Hvilke datoer endres i praksis:**

- Ved neste vanlige regenerering (automatisk i Spillerom når budsjett eller prognosedato endres, eller «Oppdater prognose») får **genererte, ikke-overstyrte** poster i perioden riktig dag. Typisk blir det én dag senere enn før, og dag 29–31 havner i riktig måned.
- **Standard prognosedato** (bare når ingen dato er lagret) blir den 20. i stedet for den 19. En lagret prognosedato endres ikke.
- **Overstyrte og manuelle poster** beholder lagret dato, også en dato som ble lagret med den gamle forskyvningen.
- Vi kjører ingen egen regenerering i produksjon.

**Åpne klienter:**

- Allerede åpne React-faner og legacy-sider kjører gammel kode til de lastes på nytt. En gammel klient som regenererer, skriver fortsatt forskjøvede datoer. Neste regenerering fra en ny klient retter dem igjen.
- Vi lover ikke at åpne gamle klienter er oppgradert.
- React publiseres med Firebase Hosting (`production.yml`). Legacy `index.html` bygges av den eksisterende GitHub Pages-jobben («pages build and deployment»). Deploytilgangen er ikke endret.

**Tester:**

- De eksisterende 33 testene i liquidity og PrognoseDato passerer nå i både `TZ=UTC` og `TZ=Europe/Oslo`.
- Nye regresjoner (`prognosedato.test.ts`) dekker:
  - klem og skuddår, desember–januar og sommertid;
  - fra- og til-grenser, og lesesiden;
  - uendret `_genKey` og manuelle/overstyrte poster.
- Legacy-paritet (`liquidity.legacy.test.ts`) kjører samme syntetiske eksempler gjennom legacy-funksjonene, trukket ordrett ut av `index.html`. Testen feiler mot gammel legacy-kode.
- **CI:** steget `npm run test:tz-oslo` kjører de relevante testene med `TZ=Europe/Oslo`. En vakt-test (`runIf` på `Intl`-tidssonen) bekrefter at kjøringen faktisk er norsk tid.
- **E2E mot emulatoren** (`e2e-skriving/prognosedato.spec.ts`, nettleser i `Europe/Oslo` med fast klokke) dekker automatisk regenerering, 28.02 for dag 31, overstyrt og manuell post uendret, og standarddato rett etter midnatt.

**Fortsatt åpne, ikke rettet her:** D (årsskiftet), F (automatisk uten forfallsdag), G (arkivert), helnodeoverskriving ved samtidige klienter (se «Gjenkjøring») og H (under).

**H (nytt, ikke rettet):** uten lagret prognosedato bruker generatoren standarddatoen (den 20.). Skjermen viser likevel «Velg dato» og en tom periode, så de genererte postene ikke vises før brukeren velger en dato. Dette er eksisterende oppførsel, observert i E2E.

### E: rettet (#59, ordre 6658205196)

**Rettet:** en manuelt overstyrt generert månedsforekomst har forrang for samme kilde, type, år og måned, også når forfallsdagen senere endres. Generatoren lager ingen ekstra standardpost for den forekomsten.

- **React** (`web/src/domain/liquidity/liquidity.ts`): `generertForekomst(post)` gir identiteten (type, kilde-ID, år, måned).
  - **Type og kilde-ID** kommer fra postens egne kildefelt: `sourceType` pluss `sourceBudgetItemId`, `sourceSparingItemId` eller `sourceItemId`.
  - **År og måned** kommer fra `_genKey`, ikke fra lagret dato. Identiteten følger derfor den opprinnelige forekomsten, også når brukeren har flyttet datoen til en annen måned.
  - **Krysskontroll:** `_genKey`-prefikset må være nøyaktig det generatoren lager for den kilden (`{id}`, `spar_{id}` eller `inc_{id}`). Lik ID i ulike domener, og prefikser som `spar_x` i kostnad mot `x` i sparing, kolliderer derfor ikke. Varenavn, tekst og dato brukes aldri som identitet.
  - **Fallback uten bevisbar identitet:** mangler, motstrider eller ikke kan tolkes metadata, gis ingen identitet. Da gjelder bare dagens eksakte `_genKey`-sammenligning, altså oppførselen før E. Posten bevares uansett. Ingenting slettes, flyttes, omskrives eller kobles.
  - **Flere overstyringer av samme forekomst** bevares alle, som før. Det er ingen sammenslåing, sletting eller valg av vinner.
  - **Alle andre poster** følger fortsatt gjeldende metadata og dato. Det gjelder andre måneder, andre kilder og typer, og ikke-overstyrte poster.
- **Legacy** (`index.html`, eget mandat i ordren): samme smale speiling i `generateForecastPosts` (`generertForekomst`/`forekomstNokkel` og ett felles `erOverstyrt` for de tre grenene). Ingen ny skriver eller sperre. B+C og forsoningssperren står. Sperrepatchens hunk-hoder er flyttet +30 linjer med uendret innhold.
- **Uendret:** datakontrakt, skrivevei og den overstyrte postens ID, `_genKey`, dato, beløp og metadata.
- **Drift:**
  - React publiseres med Hosting (`production.yml`), og legacy med den eksisterende Pages-jobben.
  - Åpne gamle klienter oppgraderes ikke. En gammel klient som regenererer, kan fortsatt lage den ekstra posten, og neste regenerering fra en ny klient fjerner den igjen (den er ikke overstyrt).
  - Vi kjører ingen egen regenerering eller opprydding. Eksisterende ekstra poster forsvinner først ved neste vanlige regenerering.
- **Tester:**
  - `overstyring.test.ts`:
    - 20 → 25 med overstyrt 150 for alle tre typer;
    - prefiks- og domenekollisjoner, og kilde-ID med understrek;
    - flyttet dato, desember–januar og korte måneder;
    - ufullstendige og flertydige metadata, og flere overstyringer;
    - ikke-overstyrt og gjentatt kjøring.
  - Legacy-paritet for de samme E-scenarioene (`liquidity.legacy.test.ts`).
  - Alt kjøres i både UTC og `TZ=Europe/Oslo` (CI: `test:tz-oslo`).
  - E2E mot emulatoren (`e2e-skriving/overstyring.spec.ts`): brukeren endrer forfallsdag i Økonomi, Spillerom regenererer, og den overstyrte novemberposten står uendret uten ekstra post.

### Nødvendig produktvalg (tidskritisk, ikke kode nå): årsskiftet

Før midten av desember må det bestemmes hva som skal skje 1. januar:

- om planen for neste år i `annualBudgetPlans` skal bli levende budsjett;
- hva som skjer med årets faktiske tall (`spent`);
- om prognosen skal lese neste års plan for januar.

Dette er dataflyt med migreringsrisiko og skal ikke bygges uten et eksplisitt valg. Det er et dokumentert, senere spor: ingen migrering eller produktvalg er tatt. Anbefalingen er et kort beslutningsnotat med to–tre alternativer som eget oppdrag.
