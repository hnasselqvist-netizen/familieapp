# Årsskiftet (funn D): beslutningsnotat

**Status:** beslutningsgrunnlag (#59, ordre 6672789406). Ingenting er bygget, migrert eller aktivert. D er **ikke** løst.
**Kodegrunnlag:** `main` `604ef52` (arbeidsgren `3718c69`, likt tre).
**Metode:** kodelesing, og en midlertidig syntetisk repro av de faktiske funksjonene (`generateForecastPosts`, `effektivPrognosedato`, `flettAarsplanMedStruktur`, `byggTomAarsplanFraStruktur`, `konverterGroupsTilFlatPlan`, `budgetMonthKey`). Reproen ble kjørt i `TZ=UTC` og `TZ=Europe/Oslo` med identisk resultat, og er ikke committet.
**Ikke gjort:** ingen produksjonsdata er lest. Om `annualBudgetPlans/2026` eller `/2027` finnes i produksjon, og hva de inneholder, er **ukjent**.

## 1. Dagens modell (kort)

| Del                                      | Hvor                                                                                                        | Hva den gjør                                                                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Levende budsjett                         | `budget`, `incomeGroups`, `sparingGroups`: `{gruppe: {post: {months[0..11]: {budget, spent}, meta}}}`       | **12 måneder uten år.** Struktur (gruppe-ID, post-ID, navn, meta) er årsuavhengig.                                                                                                              |
| Årsplaner                                | `annualBudgetPlans/{år}/{costs\|income\|savings}`: `{gruppe: {post: {months: [{budget}], budgetDetails?}}}` | Bare plan (`budget`), **aldri `spent`**.                                                                                                                                                        |
| «Inneværende år»                         | React `useArsbudsjett.ts:160` (`useMemo(..., [])`), legacy `index.html:574` (`const CURRENT_BUDGET_YEAR`)   | Kalenderåret, beregnet **én gang** ved oppstart. For dette året leser og skriver Årsbudsjett de levende nodene; for andre år `annualBudgetPlans`.                                               |
| Faktisk i Økonomi                        | `useBudsjettfamilie.ts:84` → `budgetMonthKey(currentBudgetYear(new Date()), month)`                         | Hendelser filtrert på `ÅÅÅÅ-MM`, altså årsriktig. Nøkkelen beregnes når fanen eller måneden endres. Uten hendelser for posten vises `months[m].spent` som faktisk (`GroupAccordion.tsx:110`).   |
| Prognose (React og legacy, samme logikk) | `liquidity.ts:344–350` (kostnad), `392–398` (sparing), `439–470` (inntekt); legacy ~9040–9150               | Leser `months[måned]` **uten år**. Beløpet er `spent` hvis satt (kostnad > 0, sparing ≠ 0, inntekt > 0 etter `disponibelt`), ellers `budget`. `_genKey` inneholder år, så posten får riktig år. |
| Skriving av prognoser                    | `useLiquidity.ts:160` (autoeffekt) og legacy `runGenerator`                                                 | Begge klientene skriver hele `posts`-noden (React) eller hele `liquidity`-noden (legacy). Den som kjører sist, vinner.                                                                          |
| Engangskopi 2026                         | legacy `index.html:16203` (`bootstrapAarsplan2026`)                                                         | Kopierer `budget` fra de levende nodene til `annualBudgetPlans/2026` **én gang** hvis noden mangler. Den kopierer aldri `spent`, og kopien blir stående med verdiene fra kopieringstidspunktet. |
| Tilgang                                  | `infra/firebase/database.rules.json`                                                                        | Medlemmer kan lese og skrive alt under `families/{id}`. Ingen av alternativene under krever rules-endring.                                                                                      |

## 2. Tre ulike problemer

1. **P1. Prognosen krysser desember/januar før årsskiftet.**
   - Standarddatoen (funn H) blir 20. januar fra 20. desember. Med en lagret dato kan det skje tidligere.
   - Januarposter i prognosen hentes fra `months[0]` i den levende noden, altså **januar i år**. Neste års plan leses ikke.
   - Har posten `spent` for januar i år, brukes **fjorårets faktiske** som prognose for neste januar.
2. **P2. Hvilket grunnlag appen bruker etter 1. januar.**
   - En klient som starter etter midnatt («kald start») regner det nye året som inneværende år. Den levende noden (med fjorårets plan og `spent`) blir dermed **planen for det nye året**.
   - Den lagrede planen for det nye året (`annualBudgetPlans/2027`) blir ikke lenger brukt som inneværende år.
   - En klient som var åpen over midnatt, regner fortsatt det gamle året. Årsbudsjett holder på det til ny lasting, og Økonomi til fanen eller måneden byttes.
3. **P3. Bevaring og visning av historikk.**
   - Fjorårets `spent` ligger i den levende noden uten år. Det finnes ikke noe eget sted for fjorårets endelige budsjett og `spent`.
   - Økonomi kan ikke navigere til desember i fjor, fordi månedsnøkkelen alltid bruker inneværende år. Hendelsene finnes, men flaten viser dem ikke.
   - Engangskopien av 2026 (hvis den finnes) er et øyeblikksbilde fra kopieringstidspunktet og uten `spent`.

## 3. Syntetisk eksempel

Én post `g/x` av hver type, med automatisk forfall den 15. Levende node: januar `budget` 100, `spent` 80 (faktisk januar 2026). `annualBudgetPlans/2027`: januar `budget` 200.

**Observert i dagens kode** (repro, identisk i UTC og Oslo):

| Tidspunkt og flate                                           | Kostnad                     | Inntekt | Sparing | Kommentar                                                                                                                                 |
| ------------------------------------------------------------ | --------------------------- | ------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 21.12.2026, prognose (standard til 20.01.2027), januarpost   | **80**                      | **80**  | **80**  | Fjorårets faktiske brukes som neste års prognose. Planen på 200 leses ikke.                                                               |
| Samme, men `spent` 0                                         | 100                         | 100     | 100     | Januar 2026-budsjett, ikke planen for 2027.                                                                                               |
| Desember 2026, Årsbudsjett 2027 (plan finnes)                | 200                         | 200     | 200     | Korrekt plan.                                                                                                                             |
| Desember 2026, Årsbudsjett 2027 (plan mangler for typen)     | 0                           | 0       | 0       | Tom plan vises (nuller fra `byggTomAarsplanFraStruktur`); ingenting lagres før brukeren redigerer.                                        |
| Etter 1.1.2027 (kald start), Årsbudsjett 2027 = levende node | 100 (`spent` 80 i noden)    | 100     | 100     | **Planen på 200 blir ikke brukt som inneværende år.**                                                                                     |
| Etter 1.1.2027, Økonomi januar, faktisk                      | Hendelser 2027-01           | Samme   | Samme   | Årsriktig. Men uten hendelser for posten vises `spent` 80 fra januar 2026 som «faktisk» (`GroupAccordion.tsx:110`).                       |
| Etter 1.1.2027, Årsbudsjett 2026 (forrige år)                | Øyeblikksbildet, ellers 0   | Samme   | Samme   | Uten engangskopi vises 0. Med kopi vises budsjettet fra kopieringstidspunktet, uten `spent`.                                              |
| Etter 1.1.2027, prognose januar 2027                         | 80 (eller 100 uten `spent`) | Samme   | Samme   | Samme som P1, nå for inneværende måned.                                                                                                   |
| Klient åpen over midnatt (31.12 → 1.1)                       | Som desember                | Samme   | Samme   | Årsbudsjett skriver «2027» til `annualBudgetPlans/2027`, mens en kald klient skriver «2027» til den levende noden. **To kilder spriker.** |

Plan 200 og faktisk 80 blandes aldri i samme tall i dag. Men 80 (faktisk 2026) brukes som prognose for 2027, og 100 (plan 2026) vises som plan 2027.

## 4. Alternativer

Felles for alle:

- Ingen automatisk kopiering, sletting, nullstilling av `spent` eller bytte av aktivt år.
- Struktur, gruppe-ID og post-ID er stabile på tvers av år, og alternativene bygger på dem.
- Manuelle og overstyrte prognoseposter bevares som i dag (funn E).
- **Ingen av dem er «ren lesing» i den forstand at ingenting skrives.** Prognosen regenereres og skrives fortsatt (hele `posts`-noden i React, hele `liquidity` i legacy) når grunnlaget endres. Det som endres, er hva som skrives dit.
- **Legacy-paritet er en forutsetning** for alt som endrer prognosen. Begge klientene regenererer og skriver hele noden, så en endring bare i React gir poster som skifter avhengig av hvilken klient som kjørte sist. Det krever et smalt legacy-mandat, slik som for B+C og E.

### Dekning av neste års plan (felles begrep)

For hver post (type, gruppe, post) i den levende strukturen kan planen for 2027 være:

| Tilstand          | Betydning i lagret data                                                                                                              | Skilles i dag i Årsbudsjett-visningen?                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| **Plan**          | `annualBudgetPlans/2027/{type}/{gruppe}/{post}/months[m].budget` finnes og er ≠ 0. For sparing kan den være negativ (planlagt uttak) | ja                                                           |
| **Eksplisitt 0**  | Verdien finnes og er 0                                                                                                               | **nei**: vises likt som manglende (0)                        |
| **Måned mangler** | Posten finnes, men `months[m]` eller `budget` mangler eller er `null`                                                                | antatt nei (ikke verifisert i UI)                            |
| **Post mangler**  | Typen finnes, men posten mangler                                                                                                     | nei (tom plan bygges i minnet, `byggTomAarsplanFraStruktur`) |
| **Type mangler**  | `annualBudgetPlans/2027/{type}` mangler                                                                                              | nei                                                          |

«Delvis plan» betyr en blanding innen samme type, f.eks. noen poster med plan og noen uten, eller noen måneder uten verdi.

**Dekket** betyr at verdien finnes: plan (også negativ sparing) eller eksplisitt 0. Fortegnssemantikken er uendret fra i dag (`liquidity.ts:384–397`):

- Sparing tillater negativt beløp (uttak), som gir motsatt fortegn i spillerommet.
- Kostnad og inntekt gir ingen standardpost for 0 eller negative beløp.

Notatet velger ingen ny økonomiregel. «Ingen post» betyr ingen ny **standardpost** fra generatoren. Manuelt overstyrte poster for samme forekomst bevares og telles fortsatt (funn E).

### A. Årsspesifikk prognoselesing

- **Innhold:** generatoren får grunnlag per (år, måned):
  - Måneder i aktivt planår (i dag kalenderåret) bruker `months[m]` som i dag.
  - Måneder i senere år bruker 2027-planens `budget` for samme gruppe og post.
  - `spent` brukes **bare** for måneder i det året `spent` gjelder.
- **Manglende plan** (måned, post eller type mangler) gir et produktvalg:
  - **A1:** bruk aktivt års plan (`budget`, aldri `spent`) og vis et F-lignende varsel «plan for 2027 mangler».
  - **A2:** utelat posten fra prognosen og vis varsel.
  - Eksplisitt 0 er en plan: ingen standardpost. Negativ sparing er en plan: uttak med dagens fortegn.
- **Løser:** P1. Ikke P2 eller P3.
- **Risiko:** middels.
  - Ingen ny skriver, men regenererte prognoseposter endres. Det krever legacy-paritet og et ekstra abonnement på `annualBudgetPlans` i begge klientene.
  - Reversering: kode-revert. Neste regenerering skriver da dagens poster igjen; overstyrte poster bevares.

**Januar 2027-post i prognosen, alle tre typer** (levende januar 100, faktisk 80):

| Planens dekning for januar 2027              | Dagens kode           | A1                                       | A2                        |
| -------------------------------------------- | --------------------- | ---------------------------------------- | ------------------------- |
| Plan 200                                     | 80 (100 uten `spent`) | **200**                                  | **200**                   |
| Eksplisitt 0                                 | 80 / 100              | ingen post                               | ingen post                |
| Måned, post eller type mangler               | 80 / 100              | **100** + varsel                         | ingen post + varsel       |
| Delvis (post a har plan 200, post b mangler) | a: 80/100, b: 80/100  | a: 200, b: 100 + varsel                  | a: 200, b: ingen + varsel |
| **Bare sparing:** plan −50 (uttak)           | 80 / 100              | **−50** (uttak)                          | **−50** (uttak)           |
| Overstyrt post for januar finnes             | overstyrt bevares     | overstyrt bevares; ingen ny standardpost | samme                     |

Inntekt med `meta.disponibelt` bruker `disponibelt` foran både plan og faktisk, som i dag. `disponibelt` er årsuavhengig, og om det skal gjelde neste år, er et eget spørsmål (se §8).

### B. A + aktivt planår + eksplisitt aktivering (anbefalt)

**Aktivt planår skilles fra kalenderåret:**

- **Aktivt planår** (et lagret felt, foreløpig navn `meta/aktivtBudsjettaar`) sier hvilket år de levende `months` gjelder. Det styrer plan-lesing og -skriving i Årsbudsjett, Økonomi og prognosen.
- **Kalenderåret** styrer det årsriktige: faktisk via hendelser (`budgetMonthKey`), datoer og Økonomis måned.

**Konsekvens i januar 2027 før aktivering** (aktivt planår 2026, kalenderår 2027):

| Flate            | Uten tiltak                                                                                                | Krav i B                                                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Økonomi, januar  | Plan = levende januar (2026-plan 100) mot faktisk = hendelser 2027-01. To ulike år ved siden av hverandre. | Planen for 2027 vises fra `annualBudgetPlans/2027` med merket «2027 er ikke aktivert». Plan- og `spent`-redigering i Økonomi sperres eller sendes til Årsbudsjett 2027, fordi målet (levende node) gjelder 2026. |
| Årsbudsjett 2027 | Skriver til `annualBudgetPlans/2027` (riktig)                                                              | Uendret.                                                                                                                                                                                                         |
| Årsbudsjett 2026 | Skriver til levende node                                                                                   | Uendret, slik at Helen kan avslutte 2026.                                                                                                                                                                        |
| Prognose         | Januar fra levende node                                                                                    | Januar fra 2027-planen (A).                                                                                                                                                                                      |

Dette er en **modellbinding**. Eksisterende skrivere får nye mål eller sperrer, så trinnet er ikke ren lesing.

**Aktiveringen** er en eksplisitt handling (knapp med bekreftelse og forhåndsvisning). Den skal ikke bruke en ryddepolicy som skjer av seg selv. Det finnes to trygge varianter for dekning, og de kan kombineres:

- **B-i, stopp til dekningen er komplett.** Aktiveringen avvises så lenge en post i den levende strukturen mangler 2027-plan for en måned. Eksplisitt 0 og negativ sparing teller som dekket; mangler og `null` gjør det ikke. Forhåndsvisningen lister hva som mangler.
- **B-ii, eksplisitt videreføring av plan.** For en manglende post velger Helen synlig «videreført fra 2026-plan». Det skriver 2026-postens `budget` (aldri `spent`) inn i `annualBudgetPlans/2027`, **som et eget, kvittert steg før aktivering**. Deretter gjelder B-i.
- **Forkastet: delvis aktivering per type** (bare typer med plan aktiveres). Det gir flere aktive år samtidig, og typer uten plan ville beholdt 2026-tall (inkludert `spent` 80) i en node som hevder 2027.

Når aktiveringen går gjennom, skjer tre ting i én flerstiskriving:

1. De levende nodene arkiveres **med `spent`** for 2026. Plassering er teknisk design (§6).
2. 2027-planens `budget` skrives inn i levende `months`, og levende `spent` settes til 0. Dette gjelder alle poster, siden dekningen er komplett.
3. Aktivt planår settes til 2027.

**Resultat for alle tre typer** (januar):

| Dekning før aktivering         | B-i                                                         | B-ii                                                                       |
| ------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| Plan 200                       | Levende 200 / `spent` 0; arkiv 2026: 100 / 80               | Samme                                                                      |
| Eksplisitt 0                   | Levende 0 / 0; arkiv 100 / 80                               | Samme                                                                      |
| Måned, post eller type mangler | **Avvist**; levende forblir 2026 (100 / 80), aktivt år 2026 | Etter valgt videreføring: plan 2027 = 100; levende 100 / 0; arkiv 100 / 80 |
| Delvis (a: 200, b: mangler)    | **Avvist** til b er dekket                                  | a: 200 / 0; b (videreført): 100 / 0; arkiv a og b: 100 / 80                |
| **Bare sparing:** plan −50     | Levende −50 / 0 (uttak med dagens fortegn); arkiv 100 / 80  | Samme                                                                      |

`spent` 80 havner aldri i en node som gjelder 2027, og gamle faktiske tall gjenbrukes aldri som plan.

### C. Full årsdimensjon i lagring

- **Innhold:** én planlagring per år for alle år, inkludert inneværende, i `annualBudgetPlans`. Faktisk kommer bare fra hendelser, og `spent` fases ut.
- **Løser:** alt, permanent, og uten årlig aktivering.
- **Risiko:** høy. Det krever migrering av alle tre noder og alle flater i React og legacy.
- **Tidsestimat:** antakelse uten nedbrytning, så det er usikkert. Sannsynligvis ikke gjennomførbart med legacy-paritet før 1. januar.

## 5. Konfliktvern, idempotens og reversering (designkrav for B-aktiveringen)

Dette er krav til et senere design, ikke en beskrivelse av noe som finnes.

- **En separat flersti-`update()` er ikke CAS.** En versjonsvakt bare på aktivt år beskytter ikke arkivet eller kildetallene: levende `budget`/`spent` og 2027-planen kan endres mens aktivt år står stille.
  - **Krav:** alle leste kilder (de tre levende nodene, inkludert `spent`, de tre 2027-planene, aktivt år og arkivplassens tilstand) må bindes til commit. Commit må avvises hvis noe er endret siden lesing.
- **Avgrensning:** RTDB har ingen CAS for en separat flersti-`update()` **uten** en felles stammetransaksjon. En transaksjon på en felles stamme kan derimot validere relaterte søsken atomisk. Det finnes **ingen serveravvisning bare fordi et felt abonneres på.**
- **Eksisterende mekanisme:** `mcp-server/src/store/firebaseAdminStore.ts:232–269` `transactFamily` gjør én RTDB-transaksjon på `families/{f}`, med en lytter som fyller cachen først. `data_skriv` (`mcp-server/src/data/skriving.ts`) bygger på den.
  - **Den dekker:**
    - forventet versjon per skrevet posisjon (`set`, `update` per barn, `slett`), alt eller ingenting;
    - kvittering i `_mcp/ops/{opId}` med replay ved samme `opId`;
    - beskyttede felt;
    - RTDB avbryter og kjører transaksjonen på nytt når noden endres underveis, så en samtidig skriving fra en klient blir ikke overskrevet stille.
  - **Den dekker ikke, eller er ukjent:**
    - Versjonen kontrolleres bare for posisjonene som **skrives**. Rene lesekilder, f.eks. 2027-planen når bare levende noder skrives, må også inngå som forventet posisjon eller kontrolleres i updateren.
    - Egnethet og last: transaksjonen gjelder hele familienoden, inkludert store noder som kvitteringsbilder. Ytelsen er ikke målt.
    - Den kjøres gjennom MCP-serveren bak `data:write` og en egen bryter, ikke fra appen.
    - Den hindrer ikke at en **senere** skriving fra en gammel eller åpen klient (målrettet `update()` fra et utdatert snapshot) overskriver aktiveringen etterpå.
  - **Kartlegges før en ny mekanisme foreslås:** om en aktivering kan gå som én `transactFamily`-operasjon med alle leste kilder som forventede posisjoner. Ingen ny tjeneste, rules eller IAM antydes før det er avklart. Aktiveringsdesignet velges ikke her.
- **Lås og etterkontroll er ikke commitvern:**
  - En **samarbeidende lås** (markør satt med transaksjon) beskytter bare når **alle** relevante skrivere respekterer den. Den er betinget, ikke en garanti.
  - En **etterkontroll** (lese kildene på nytt etter commit) er observasjon. Når den ser et avvik, kan en feil overskriving allerede ha skjedd. Alene dekker den **ikke** kravet om å avvise ved endret førtilstand, men den kan brukes i tillegg til commitvern.
  - Serverside håndheving (rules eller egen tjeneste) **bestilles ikke** her.
- **Hele skriveflaten må dekkes før noe kan loves:**
  - React Årsbudsjett (levende noder og `annualBudgetPlans`);
  - React Økonomi og Budsjettfamilie (`budget`/`spent`, meta, legg til og fjern post);
  - legacy Budsjett, Inntekter, Sparing og Årsbudsjett, pluss `bootstrapAarsplan2026`;
  - MCP `data_skriv`, som er generisk, versjonert per sti og bak egen bryter.
    Gamle eller åpne klienter som ikke er oppdatert, respekterer ingen ny lås. Hvordan de stenges ute eller oppdages, er **ukjent**.
- **Idempotens:**
  - Aktiveringen får en operasjons-ID og lagrer en kvittering med ID, tidspunkt, digest av førtilstanden og resultat.
  - En retry med samme ID gir samme kvittering («fullført»).
  - En ny ID når 2027 allerede er aktivt, gir «allerede aktivert av operasjon X (tidspunkt)», ikke bare en avvisning.
- **Reversering skilles i tre nivåer:**
  1. **Kode-revert** fjerner funksjonen og rører ikke data.
  2. **Umiddelbar gjenoppretting** er bare lov når ettertilstanden er uendret, altså når levende noder og aktivt år er nøyaktig det operasjonen skrev. Da skrives arkivet tilbake og aktivt år settes til 2026, med samme konfliktvern.
  3. **Senere tilbakeføring** etter nye 2027-endringer krever konflikt- og deltaanalyse og egen autorisasjon. En blind tilbakeskriving av arkivet ville overskrive 2027-endringer.

## 6. Anbefaling og trinn

**Anbefaling: B, med B-i som standard og B-ii som eksplisitt måte å dekke manglende poster på.** A alene løser bare desember-prognosen. C er usikker og trolig for stor før fristen.

| Trinn | Innhold                                                                                                                                                  | Hva skrives                                                                    | Frist                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 1     | A, med Helens valg A1 eller A2, i React og legacy                                                                                                        | Ingen ny skriver; regenererte prognoseposter endres                            | **Før ca. 15. desember** (standard krysser 20.12.)                                   |
| 2     | Aktivt planår lest med standard 2026; flatene skiller planår fra kalenderår; plan-/`spent`-redigering i Økonomi sperres eller omdirigeres før aktivering | Ingen ny skriver; eksisterende skriveres mål og sperrer endres (modellbinding) | **Før 1. januar**                                                                    |
| 3     | Aktivering (B-i/B-ii) med konfliktvern, idempotens og gjenoppretting som i §5                                                                            | Ja: eksplisitt flerstiskriving, med snapshot først                             | Etter Helens valg og eget design. Kan tas i januar, fordi trinn 2 holder 2026 aktivt |

**Teknisk design som Kontrolltårnet og Claude klargjør, ikke Helen:**

- feltnavn for aktivt planår, og arkivplassering for 2026 (med `spent`);
- valg av låse- eller etterkontrollmekanisme og hvordan gamle klienter håndteres;
- koordinering med legacy (lesing av aktivt år og sperre under aktivering);
- kvitteringsformat og gjenopprettingsflyt;
- teststrategi (emulator, legacy-paritet, UTC/Oslo, årsskifte).

## 7. Produktvalg for Helen

| #   | Valg                                                                                                                                                                                                       | Anbefalt                                                                                   | Konsekvens                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Planprioritet:** skal prognosen for neste års måneder bruke neste års plan, og aldri faktisk fra et annet år?                                                                                            | **Ja**                                                                                     | Januarprognosen viser 200, ikke 80 eller 100.                                                                                                             |
| 2   | **Manglende plan i prognosen:** A1 (bruk årets plan med varsel) eller A2 (utelat med varsel)?                                                                                                              | **A1**                                                                                     | A1 gir en full prognose som kan være feil for nytt år. A2 gir en tynnere prognose som aldri gjetter. Begge varsler synlig.                                |
| 3   | **Årsaktivering:** skal nytt budsjettår starte ved eksplisitt aktivering, eller automatisk ved kalenderår (dagens oppførsel)?                                                                              | **Eksplisitt aktivering**                                                                  | Uten tiltak blir fjorårets plan og `spent` brukt som nytt år fra 1. januar. Med aktivering må Helen trykke, og Økonomis planredigering er sperret til da. |
| 4   | **Historikk og dekning ved aktivering:** skal fjorårets budsjett og faktisk arkiveres, og skal aktiveringen vente til alle poster har plan (eksplisitt videreføring av fjorårets plan som eneste snarvei)? | **Ja, arkiver begge; vent til komplett dekning (B-i), med eksplisitt videreføring (B-ii)** | Ingenting av fjoråret går tapt. Det nye året starter med `spent` 0. Det kreves litt planarbeid før aktivering.                                            |

Visning av forrige års måneder i Økonomi er et senere, eget ønske og ikke nødvendig for fristen.

**Drifts- og sikkerhetsgrenser:** ingen er påvist nå. Rules-endring trengs ikke for trinn 1 og 2. Hvis designet i §5 viser at aktiveringen krever serverside håndheving eller utestengning av gamle klienter, beskrives det samlet og konkret før trinn 3. Før trinn 3 tas uansett et snapshot av de tre nodene og `annualBudgetPlans` (Work, på Helens bestilling).

## 8. Fristplan

| Når                   | Hva                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Nå → ca. 1. desember  | Helen tar valg 1–2. Trinn 1 bestilles.                                                              |
| Før ca. 15. desember  | Trinn 1 publisert (React og legacy). Fra 20. desember krysser standardprognosen januar.             |
| Før 31. desember      | Valg 3–4 tatt. Trinn 2 publisert. Helen fyller ut planen for 2027 i Årsbudsjett (finnes i dag).     |
| Januar, når Helen vil | Trinn 3 som eget design og egen reviewet PR: først snapshot, så eksplisitt aktivering, så kontroll. |

**Hvis ingenting gjøres før 1. januar:** P1 rammer fra 20. desember, og P2 og P3 fra første kalde start etter midnatt (§3). Ingen data går tapt av seg selv, men fjorårets plan og `spent` blir stående i den levende noden og vises som nytt år.

## 9. Ukjent eller antatt

- Om `annualBudgetPlans/2026` og `/2027` finnes i produksjon, og hvordan de dekker de tre typene (inkludert eksplisitt 0 eller mangler). Dette er ikke lest, og må sjekkes skrivefritt av Work før trinn 2 og 3.
- Om Helen bruker `spent` manuelt, eller om faktisk bare kommer fra hendelser. Bruken er ikke undersøkt.
- Om inntektens `meta.disponibelt` (årsuavhengig) skal gjelde også for neste års måneder.
- Om andre flater leser `months` uten år. Hjem- og familieflater er parkert, og MCP-verktøyene er ikke gjennomgått for årslogikk.
- Hvordan gamle eller åpne klienter skal stenges ute under aktiveringen (§5).
- Om eksisterende `transactFamily` (MCP) egner seg for aktiveringen, med tanke på last på hele familienoden, lesekilder som forventede posisjoner og kjøring via MCP i stedet for appen (§5). Ikke målt eller prøvd.
- Tidsestimat for C.
