# Teknisk arkitektur — oversikt

> Beskriver den **nye** tekniske grunnmuren (`web/`), etablert i Fase 0.
> For produktfilosofi, domenemodell og låste designbeslutninger, se
> [`../produktfasit/designbok.md`](../produktfasit/designbok.md). For hvorfor
> disse valgene ble tatt (og hvilke alternativer som ble vurdert), se
> [`../beslutninger/`](../beslutninger/). Denne filen oppdateres etter hvert
> som flere moduler migreres fra `index.html` — se
> [`../beslutninger/0001-ny-teknisk-grunnmur.md`](../beslutninger/0001-ny-teknisk-grunnmur.md)
> for migreringsfasene.

## Status

Produksjonsappen som faktisk betjener brukere i dag er fortsatt den historiske
`index.html` i repo-roten. `web/` er den nye grunnmuren, under oppbygning
modul for modul — se `docs/beslutninger/0001-ny-teknisk-grunnmur.md` for
migreringsstrategien. Ingen produksjons-URL peker på `web/` ennå.

Migrert til `web/` så langt: **Fryser** (`src/features/hverdagsflyt/mat/freezer/`),
**Kokebok** (`src/features/hverdagsflyt/mat/kokebok/`), **Handleliste**
(`src/features/hverdagsflyt/mat/handleliste/`) og **Middagsbibliotek**
(`src/features/hverdagsflyt/mat/bibliotek/`) — hele den vertikale skiven
for alle fire, inkludert skjermen, nåbar via en intern fane-navigasjon for
Mat-området (`MatLayout`, portert fra `MatScreen` sin fanebar). Kun
`Plan`-fanen viser fortsatt en midlertidig `LegacyBridge` som lenker ut
til dagens app.

**Fase 2 (skjermmigrering) — Middagsbibliotek, tredje skive:**
`MealLibraryScreen` er funksjonelt likeverdig med dagens
`MealLibraryScreen` (index.html linje ~3090–3282). Ingen ny data-/
motorlogikk — hele datalaget (`mealLibrary.repository.ts`,
`domain/mealLibrary/mealLibrary.ts`) var allerede fullt migrert i PR #7.
Ny `src/hooks/useMealLibrary.ts` komponerer `transactMealLibraryEntry`
med de fem rene motorfunksjonene for `shoppingBase`-rad-mutasjoner —
samme mønster som `useFreezer` allerede bruker for `transactFreezerItem`.

Kandidatvurdering for denne skiven veide Middagsplan (`PlanScreen`) opp
mot Middagsbibliotek: `PlanScreen` viste seg å inneholde en hel
"Førsteutkast"-auto-forslagsmotor og en eksplisitt "Bekreft middag"-flyt
— begge eksplisitt flagget andre steder (§domain/meals/meals.ts sin
toppkommentar) som uavklart produktpipeline, ikke bare skjerm-UI-lim. En
"funksjonelt likeverdig" skjermport av `PlanScreen` ville derfor enten
måtte dra inn uavklart produktlogikk eller bevisst utelate den — en
større, tvetydig avveining enn Kokebok sine to klare unntak.
Middagsbibliotek har ingen slik tvetydighet og ble derfor valgt.

**Fase 2 (skjermmigrering) — Handleliste, andre skive:** `HandlelisteScreen`
er funksjonelt likeverdig med dagens `ShoppingScreen` (index.html linje
~4902–5059). Ingen ny skrivelogikk — hele datalaget
(`shopping.repository.ts`) var allerede fullt migrert med målrettede
per-post-operasjoner (PR #6), inkludert `clearDoneShoppingItems` sin
stale-read-race-fiks; denne skiven la kun til `src/hooks/useShoppingList.ts`
som tynn React-binding over de eksisterende repository-funksjonene.
Kategorigrupperingen følger fortsatt FØRSTE-gang-rekkefølge (ikke
alfabetisk), identisk med dagens `[...new Set(...)]`. Generatorens
batch-add-flyt er fortsatt bevisst utenfor (uendret fra Fase 1-vurderingen).

**Fase 2 (skjermmigrering) — Kokebok, første skive:** `RecipesScreen` er
funksjonelt likeverdig med dagens (index.html linje ~4769–4900, pluss
`AddRecipeModal`/`RecipeForm`/`IngredientRows`/`AddToPlanCard`/
`RecipeIngredients`), med to bevisste avvik:

- URL- og bilde-import (`AddRecipeModal`/`RecipeForm` sine "URL"/"Bilde"-
  faner) er IKKE portert. URL-fanen kaller `api.anthropic.com` direkte fra
  klienten uten noen autentiseringsheader og fremstår allerede
  ikke-funksjonell i produksjon; bilde-fanen er en marginal funksjon uten
  nettverksavhengighet, utsatt til en egen skive om ønskelig.
- Redigering via full-skjemaet MERGER nå patchen inn i den eksisterende
  oppskrift-noden via `transactRecipe` (§hooks/useRecipes.ts), i stedet for
  å bygge et helt nytt objekt slik dagens `RecipeForm.save()` gjør. Dagens
  variant sletter i praksis en oppskrifts `imageUrl` og nullstiller
  `source` til `"manual"` ved ENHVER redigering (en normaliserings-
  spread-rekkefølge-feil i `RecipesScreen.saveRecipe`) — en utilsiktet
  regresjon, ikke fossilisert som ny fasit.

Ny delt motor: `src/domain/shared/weekKey.ts` (`getWeekKey`/`addWeeks`,
portert fra index.html sin globale ukenøkkel-beregning) og
`src/hooks/useMeals.ts` (ny hook for `AddToPlanCard` sin
"legg til i middagsplan"-skriving via `transactMealDay`).

**Datalag/motor migrert, skjerm ikke migrert ennå (Fase 1):** **Middagsplan**
(`src/domain/meals/`, `src/data/meals.repository.ts`) — se
[`../beslutninger/0001-ny-teknisk-grunnmur.md`](../beslutninger/0001-ny-teknisk-grunnmur.md)
for hvorfor skjermen ennå ikke er flyttet. `index.html` sin `PlanScreen` er
fortsatt fasiten for faktisk brukeropplevelse og skriver fortsatt til
samme `meals/{weekKey}/{day}`-sti, men via sitt eget (uendrede,
full-collection-overskrivende) skrivemønster — de to kodebasene deler
data, ikke skrivekode, frem til skjermen migreres. `menu`/flere retter
samme dag er full karakterisert i det nye datalaget (§Kontrolltårn-handoff,
Fase 1) selv om dagens UI i praksis kun tillater å nå den fra andre dager
enn inneværende dag.
**Generatorlogikk migrert (KUN lesing, ingen skjerm):** **Handlelistegenerator**
(`src/generators/shopping/shopping.ts`, pluss lesetilgang via
`src/data/mealLibrary.repository.ts`/`itemHistory.repository.ts`/
`staples.repository.ts`) — første faktiske bruk av `src/generators/**`-laget.
Ren generator-/motorlogikk (`resolveMealShoppingItems`, kategori-oppslag,
sammenslåing) er portert; selve `ShoppingGenerator`-skjermen, utvalget av
hvilke dager som vises som avkrysningsbare kandidater, og mealLibrary-CRUD/
nye basisvarer er fortsatt skjerm-eid i `index.html` og urørt.

**Datalag migrert (full CRUD):** **Basisvarer** (`src/data/staples.repository.ts`,
`families/{familyId}/staples`) — `subscribeStaples` (lesing, PR #5) pluss
`markItemAsStaple` (skriving), ett målrettet `set(true)` på varens egen
nøkkel. Eneste skriving i hele dagens kode (`ShoppingGenerator.confirmStaple`)
var allerede uten samtidighetsrisiko — ingen les-før-skriv, ingen "fjern
basisvare"-motstykke finnes. Ingen egen skjerm; skrivingen skjer fra
Handlelistegeneratorens gjennomgangssteg (Fase 2).

Generatorens "legg til flere varer samtidig"-flyt
(`MatScreen.onAddToList`/`mergeIntoShoppingList`) forblir bevisst
IKKE koblet til Firebase: den rene sammenslåingslogikken bor i
`src/generators/shopping/shopping.ts`, men modulgrensene
(`import/no-restricted-paths`) forbyr `src/data/**` å importere
`src/generators/**` — å fullføre denne flyten krever enten en
hook-lag-skive (utenfor Fase 1 sitt datalag/motor-omfang) eller en
arkitektonisk omplassering av sammenslåingslogikken, ikke bare
karakterisering. Overlatt til Fase 2 eller en eksplisitt senere beslutning.

## Teknologistack

| Lag         | Valg                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------- |
| Rammeverk   | React 18+ (funksjonskomponenter, hooks)                                                  |
| Byggverktøy | Vite                                                                                     |
| Språk       | TypeScript, `strict: true`                                                               |
| Routing     | React Router                                                                             |
| State       | Domenevise React-hooks — ingen global state-motor (Redux/Zustand)                        |
| Styling     | CSS Modules over en delt `src/styles/tokens.css`                                         |
| Backend     | Firebase Realtime Database (modulær SDK v9+) + Firebase Auth                             |
| Hosting     | Firebase Hosting (ikke GitHub Pages, ikke Vercel)                                        |
| Testing     | Vitest (domene/komponent), Firebase Emulator Suite (integrasjon), Playwright (E2E-smoke) |
| Kvalitet    | ESLint (+ react-hooks, + egne importgrense-regler), Prettier                             |

## Lagmodellen

Speiler designbok.md sin Motor/Generator/Kontrollpanel-modell, nå som ekte,
mekanisk håndhevede mappegrenser (`eslint.config.js`, regelen
`import/no-restricted-paths`) — ikke bare navnekonvensjon:

```
src/features/**      UI — skjermer og kontrollpaneler
       │  bruker kun
src/hooks/**          React-binding: abonnement + not_loaded/loading/loaded-status
       │  bruker kun
src/data/**            Repositories — ENESTE lag som importerer Firebase SDK
       │
   Firebase (Realtime Database + Auth)

src/generators/**    Bygger input til en motor — kan lese src/data/** og src/domain/**
       │  brukes av
src/domain/**          Motorer — rene funksjoner, ingen React- eller Firebase-import
```

Et brudd på denne retningen feiler `npm run lint` — se testene som demonstrerer
dette i praksis: `src/domain/freezer/freezer.test.ts` (rene funksjoner, ingen
mocking) vs. `src/data/freezer.repository.integration.test.ts` (mot en ekte
emulator).

## Datamodell og skrivemønster

Data ligger fortsatt i Firebase Realtime Database under
`families/{familyId}/...` — samme struktur som i dag, se
[`../produktfasit/designbok.md`](../produktfasit/designbok.md) §"Datakilder"
for den fulle stien-tabellen (uendret av Fase 0).

**Endret fra dagens `index.html`:** skriving skjer nå målrettet, mot det ene
elementet som faktisk endret seg (f.eks. `families/familie1/freezer/{id}`),
aldri ved å serialisere og overskrive en hel samling — se
`src/data/freezer.repository.ts` og `src/data/items.repository.ts` for
mønsteret alle nye repositories følger.

## familyId

Ett sted i koden vet hvilken husstand som er aktiv:
`src/hooks/useFamilyId.ts`. I dag resolver den alltid til `"familie1"` — ingen
UI, ingen husstandsvelger, ingen multi-tenant-funksjonalitet. Poenget er
utelukkende at det er ÉTT sted å endre senere, ikke et hardkodet strengverdi
spredt over dusinvis av filer slik `FAM = "families/familie1"` er i dagens
`index.html`.

## Firebase security rules

Versjonert i [`../../infra/firebase/database.rules.json`](../../infra/firebase/database.rules.json),
deployes via `firebase deploy --only database` (manuelt inntil videre — ikke
en del av noen automatisk CI-pipeline, se ADR 0001). Modellen er
medlemskapsbasert: `families/{familyId}/members/{uid}` avgjør tilgang, ikke
custom claims. **Ikke deployet til produksjon ennå** — se ADR 0001 for
overgangsplanen (medlemslisten må verifiseres først).

## Testlag

| Lag                 | Verktøy                        | Kjøres mot                  | Kommando                   |
| ------------------- | ------------------------------ | --------------------------- | -------------------------- |
| Domene/motor        | Vitest                         | Ingenting (rene funksjoner) | `npm test`                 |
| Komponent           | Vitest + React Testing Library | jsdom                       | `npm test`                 |
| Datalag/integrasjon | Vitest                         | Firebase Emulator Suite     | `npm run test:integration` |
| E2E/smoke           | Playwright                     | Emulator-bygget app         | `npm run test:e2e`         |

Automatiserte tester rører **aldri** en Hosting-forhåndsvisning eller
produksjon — kun den lokale emulatoren. Se ADR 0001 for resonnementet.

## Hosting og deploy

- **Produksjon:** Firebase Hosting, `web/dist` (se `firebase.json` i repo-roten).
  Ikke i bruk ennå — `index.html` er fortsatt live.
- **Forhåndsvisning:** forespørsel-styrt via `.github/workflows/preview.yml`
  (`workflow_dispatch`, ikke automatisk per push). Bygges med
  `VITE_DEPLOY_TARGET=preview`, som viser et synlig PREVIEW-banner i appen
  (`src/routes/AppLayout.tsx`).
- **CI:** `.github/workflows/ci.yml` — typecheck, lint, format, alle
  testlag, bygg. Påkrevd på PR mot `main`.

## Kjøre lokalt

Se [`../../web/README.md`](../../web/README.md).
