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
- **Legacy-paritet er en forutsetning** for alt som endrer prognosen. Begge klientene regenererer og skriver hele noden, så en endring bare i React gir poster som skifter avhengig av hvilken klient som kjørte sist. Det krever et smalt legacy-mandat, slik som for B+C og E.

### A. Årsspesifikk prognoselesing (ren lesing, ingen lagring)

- **Innhold:** generatoren får et grunnlag per (år, måned):
  - For aktivt år (i dag kalenderåret) brukes `months[m]` som i dag.
  - For senere år brukes `annualBudgetPlans/{år}/{type}` (`budget`) for samme gruppe og post.
  - `spent` brukes **bare** for måneder i samme år som det `spent` gjelder, aldri på tvers av år.
  - Mangler neste års plan for en type eller post, brukes enten dagens tall med et synlig F-lignende varsel «plan for 2027 mangler» (valg A1), eller posten utelates med varsel (valg A2).
- **Løser:** P1. Ikke P2 eller P3.
- **Risiko:** lav. Den er reversibel med revert og trenger ingen migrering. Abonnement på `annualBudgetPlans` må inn i `useLiquidity`, og samme lesing speiles i legacy.
- **Idempotens og samtidighet:** uendret regenereringsmodell. Ingen nye skrivere.

### B. A + eksplisitt aktivering av nytt budsjettår (anbefalt)

- **Innhold:**
  - A, pluss et lagret **aktivt budsjettår** (en nøkkel under familien, f.eks. `meta/aktivtBudsjettaar`, med navn som må avklares) som erstatter `getFullYear()` som «inneværende år» i Årsbudsjett, Økonomi, Spillerom og legacy.
  - Til Helen aktiverer, gjelder den levende noden fortsatt **2026**, også i januar. Flatene viser rolig «2027 er ikke aktivert». Prognosen leser 2027-planen for 2027-måneder (fra A). Økonomi viser faktisk fra 2027-hendelser.
  - **Aktiveringen** er en eksplisitt handling (knapp med bekreftelse) som i én atomisk flerstiskriving med versjonsvakt gjør tre ting:
    1. Arkiverer de levende nodene **med `spent`** under et nytt historikkpunkt for 2026. Plassering må avgjøres, f.eks. `budgetHistory/2026` eller `annualBudgetPlans/2026` utvidet med `spent`.
    2. Skriver 2027-planens `budget` inn i de levende nodenes `months` og setter levende `spent` til 0. Dette gjelder bare typer som har plan. Andre typer beholder dagens tall og merkes i kvitteringen.
    3. Setter aktivt år til 2027.
- **Løser:** P1, P2 og P3. Fjorårets tall blir bevart med `spent`.
- **Risiko:** middels.
  - Aktiveringen er en datamigrering og må emulatortestes. Den skal være idempotent: andre kjøring blir avvist med «2027 er allerede aktivt», og et snapshot må finnes før skriving.
  - Den er reversibel ved å skrive arkivet tilbake og sette aktivt år til 2026. Reverseringen må bygges og testes.
  - Klienter som er åpne under aktiveringen, må oppdage endret aktivt år og laste data på nytt eller sperre skriving. Legacy må lese aktivt år, eller ha budsjettskriving sperret rundt aktiveringen.
- **Samtidighet:** versjonsvakt på aktivt år. Skriving i Årsbudsjett og Økonomi avvises når klientens aktive år ikke matcher serverens.

### C. Full årsdimensjon i lagring (migrering av modellen)

- **Innhold:** én kilde for plan per år for alle år, inkludert inneværende, i `annualBudgetPlans`. Faktisk kommer bare fra hendelser, `spent` fases ut, og de levende `months` slutter å være planlager.
- **Løser:** alt, permanent, og uten årlig aktivering.
- **Risiko:** høy. Det krever stor migrering av alle tre noder og alle flater i både React og legacy, og at legacy fases ut eller skrives om. Det er ikke realistisk før 1. januar og anbefales ikke nå.

## 5. Anbefaling og minste trygge trinn

**Anbefaling: B, i tre trinn.** A alene løser bare desember-prognosen. C er for stor før fristen.

| Trinn | Innhold                                                                                                                                                           | Lagring                                                 | Frist                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1     | A (årsspesifikk prognoselesing + aldri `spent` på tvers av år + varsel ved manglende plan), React og legacy-paritet                                               | Ingen                                                   | **Før ca. 15. desember** (standard krysser 20.12.)                           |
| 2     | Aktivt budsjettår som lest verdi med standard = 2026 (ingen skriving). Flatene bruker det i stedet for `getFullYear()`, og viser «2027 er ikke aktivert» i januar | Ingen                                                   | **Før 1. januar**                                                            |
| 3     | Aktiveringshandlingen (arkiv med `spent`, plan → levende, aktivt år), emulatortestet, med reversering                                                             | Ja, eksplisitt, atomisk, idempotent, med snapshot først | Etter Helens valg. Kan tas i januar, fordi trinn 2 holder 2026 aktivt til da |

Trinn 1 og 2 er ren lesing og kan reverseres med revert. Trinn 3 er den eneste lagrende delen og krever Helens eksplisitte valg.

## 6. Beslutninger Helen må ta

| #   | Beslutning                                                            | Anbefalt                                                                                     | Konsekvens                                                                                                     |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Skal prognosen for neste år bruke neste års plan når den finnes?      | **Ja**                                                                                       | Januarprognosen viser 200, ikke 80 eller 100.                                                                  |
| 2   | Hva når neste års plan mangler for en type eller post?                | **Bruk dagens tall med synlig varsel (A1)**                                                  | Prognosen blir ikke tom. Alternativet (A2) er å utelate med varsel, som gir en tryggere, men tynnere prognose. |
| 3   | Skal faktisk (`spent`) noen gang brukes som prognose for et annet år? | **Nei**                                                                                      | Fjorårets 80 slutter å bli neste års prognose.                                                                 |
| 4   | Hvilket år er «inneværende» i januar før noe er gjort?                | **Fortsatt 2026 til eksplisitt aktivering (B)**                                              | Ingen stille rebruk av fjorårets plan som ny plan. Krever trinn 2 før 1.1.                                     |
| 5   | Aktivering: hva gjøres med levende `budget`/`spent`?                  | **Arkiver begge for 2026, skriv 2027-planen inn, sett `spent` 0, bare ved eksplisitt knapp** | Fjorårets tall bevares, og det nye året starter rent. Typer uten plan beholder tallene, med merking.           |
| 6   | Hvor skal fjorårets endelige tall ligge?                              | **Egen historikkplass med `spent`**                                                          | Påvirker ikke eksisterende `annualBudgetPlans/2026` (øyeblikksbildet, hvis det finnes).                        |
| 7   | Skal Økonomi kunne vise forrige års måneder?                          | **Ja, men som eget senere steg**                                                             | Ikke nødvendig for fristen. Hendelsene finnes allerede.                                                        |
| 8   | Legacy rundt aktiveringen                                             | **Legacy leser aktivt år (trinn 2) og får budsjettskriving sperret under aktivering**        | Unngår at en åpen legacy-klient skriver «2027» til feil kilde.                                                 |

**Ikke produktvalg, men operatør- og driftssteg:**

- Legacy-endringer krever mandat og publiseres via Pages.
- React publiseres via Hosting som vanlig.
- Rules-endring trengs ikke.
- Før trinn 3 skal det tas eksport eller snapshot av de tre nodene og `annualBudgetPlans`. Dette gjør Work på Helens bestilling.
- Etter aktiveringen: skrivefri kontroll av antall og versjon.

## 7. Fristplan

| Når                   | Hva                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| Nå → ca. 1. desember  | Helen tar beslutning 1–4. Trinn 1 bestilles.                                                             |
| Før ca. 15. desember  | Trinn 1 publisert (React og legacy). Fra 20. desember krysser standardprognosen januar.                  |
| Før 31. desember      | Trinn 2 publisert. Beslutning 5–8 tatt, og Helen fyller ut planen for 2027 i Årsbudsjett (finnes i dag). |
| Januar, når Helen vil | Trinn 3 (aktivering) som egen, reviewet PR. Først snapshot, så eksplisitt aktivering, så kontroll.       |

**Hvis ingenting gjøres før 1. januar:** P1 rammer fra 20. desember, og P2 og P3 rammer fra første kalde start etter midnatt (tabellen over). Ingen data går tapt av seg selv, men fjorårets `spent` blir stående i den levende noden og vises som nytt år.

## 8. Ukjent eller antatt

- Om `annualBudgetPlans/2026` og `/2027` finnes i produksjon, og om de dekker alle tre typer. Dette er ikke lest, og må sjekkes skrivefritt av Work før trinn 3.
- Om Helen faktisk bruker `spent` manuelt, eller om faktisk bare kommer fra hendelser. Koden støtter begge deler. Bruken er ikke undersøkt.
- Om andre flater enn de nevnte leser `months` uten år: Hjem- og familieflater er parkert, og MCP-verktøyene er ikke gjennomgått for årslogikk.
- Navn og plassering for aktivt år og historikk er forslag, ikke kontrakt.
