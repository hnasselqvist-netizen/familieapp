# Arbeidsflyt: Kokebok-oppskrift på én dato i middagsplanen (ChatGPT via MCP)

Dette er roadmap «Praktisk vedlikehold via ChatGPT», bestilt i #27 (6738886786).

Arbeidsflyten legger én eksisterende Kokebok-oppskrift på én eksplisitt valgt dato. Den bruker bare de generelle verktøyene `data_les`, `data_hent` og `data_skriv` (`mcp-server/README.md` §«Generell skriving»), i samme datakontrakt som appen.

Den gjør ikke noe av dette:

- bekrefter middagen som spist (`mealFeedback`);
- endrer historikk, handleliste, lager eller oppskriften selv;
- legger til nye scopes eller endrer rules.

## 1. Datakontrakten

- **Sti:** én dag er én node, `meals/{weekKey}/{day}` (`web/src/data/meals.repository.ts`). Appen skriver alltid per dag med `transactMealDay`, aldri hele uken. Arbeidsflyten gjør det samme.
- **`day`** er en av `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat` og `Sun` (`DAYS` i `web/src/types/meal.ts`).
- **`weekKey`** er ISO-8601-uken etter appens `getWeekKey` (`web/src/domain/shared/weekKey.ts`):
  - mandag er første dag;
  - uken tilhører året som har ukens torsdag;
  - formen er `ÅÅÅÅ-Www`, og 2026 har uke 53.

  | Dato (norsk tid)  | `weekKey`  | `day` |
  | ----------------- | ---------- | ----- |
  | mandag 29.12.2025 | `2026-W01` | `Mon` |
  | søndag 27.12.2026 | `2026-W52` | `Sun` |
  | mandag 28.12.2026 | `2026-W53` | `Mon` |
  | fredag 1.1.2027   | `2026-W53` | `Fri` |
  | mandag 4.1.2027   | `2027-W01` | `Mon` |

  Datoen tolkes i norsk tid, som i appen. Vis alltid brukeren både datoen og ukedagen sammen med «uke NN» før skriving. Eksemplene over er låst i `weekKey.test.ts`.

- **Dagverdien** (`MealValue` i `types/meal.ts`) har én av fire former:

  | Form           | Lagret verdi                                                                       |
  | -------------- | ---------------------------------------------------------------------------------- |
  | Én oppskrift   | `{ type: "recipe", name, recipeId }`, eventuelt med `variantId` og `mealLibraryId` |
  | Meny           | `{ type: "menu", name: "<navn> · <navn>", recipes: [{ name, recipeId }, …] }`      |
  | Hendelse       | `{ type: "event", name, emoji? }`, for eksempel en bursdag eller middag ute        |
  | Eldre fritekst | en streng                                                                          |
  - `recipeId: null` (en bibliotekmiddag uten Kokebok-oppskrift) lagres ikke av RTDB. Feltet **utelates** derfor, og leseren (`parseMealValue`) gir `null`.
  - `data_skriv` avviser `null`.

## 2. Les smalt

1. **Oppskriften:** `data_les { sti: "recipes" }`, sidevis. Bare nøkkel, `name` og `cat` brukes.
   - **Treff** er navn som er like etter trimming og små bokstaver.
   - **Ett treff:** bruk det.
   - **Ingen eller flere treff**, eller bare liknende navn: vis kandidatene (navn og kategori) og la brukeren velge. Gjett aldri.
   - Har brukeren oppgitt nøkkelen, brukes den, med navnet lest fra posten.
2. **Datoen:** beregn `weekKey` og `day` som i 1, og vis dem til brukeren.
   - Ligger datoen tilbake i tid, spør om det er riktig.
   - En relativ dato som «fredag» må være entydig. Ellers spør du.
3. **Måldagen:** `data_hent { sti: "meals/<weekKey>/<day>" }` gir `verdi` og `versjon`, eller viser at dagen mangler. Versjonen er grunnlaget for skrivingen.
4. **Uken, valgfritt, bare til varsel:** `data_les { sti: "meals/<weekKey>" }`. Står samme oppskrift på en annen dag samme uke, nevnes det, som «Allerede planlagt» i `AddToPlanCard`. Det blokkerer ikke.

## 3. Bestem den nye dagverdien

| Måldagen i dag                                         | Handling                                                                                                                                                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mangler                                                | Ny verdi `{ type: "recipe", name, recipeId }`, som `setDayToRecipe` i `AddToPlanCard`.                                                                                                                                            |
| Har allerede oppskriften (samme `recipeId` eller navn) | Ingenting skrives, fordi `addRecipeToMeal` gir duplikat. Si at den allerede er planlagt.                                                                                                                                          |
| Har én oppskrift, en meny eller eldre fritekst         | **Bevar innholdet.** Vis hva dagen har, og spør om oppskriften skal **legges til** (meny), om dagen skal **erstattes**, eller om en **annen dag** skal velges. Standarden er aldri å erstatte.                                    |
| Har en hendelse (`type: "event"`)                      | **Stopp og spør.** En hendelse kan ikke kombineres med en rett. `addRecipeToMeal` ville gjort dagen til en meny uten hendelsen, så det gjøres ikke. Brukeren kan velge en annen dag eller uttrykkelig be om å erstatte hendelsen. |

- **«Legg til»** gir samme resultat som appens `addRecipeToMeal` (`web/src/domain/meals/meals.ts`):
  - `recipes` er dagens referanser fra `getMealRecipes`, i samme rekkefølge og med `variantId` og `mealLibraryId` bevart, pluss `{ name, recipeId }`;
  - `name` er navnene i rekkefølge, skilt med `" · "`;
  - eldre fritekst blir referansen `{ name: <teksten> }`, uten `recipeId`;
  - en referanse med `recipeId: null` skrives uten `recipeId`.
- **«Erstatt»** krever at brukeren uttrykkelig har bedt om det, med navn på det som erstattes. Da skrives `{ type: "recipe", name, recipeId }`.
- **`name`** er oppskriftens navn slik det står i `recipes`.
- **Felt som ikke tas med:** `variantId` og `mealLibraryId` på den nye referansen. En Kokebok-oppskrift har ingen variant.

## 4. Skriv

1. Lag opId **én gang**, før første kall, etter kontrakten i `mcp-server/src/data/skriving.ts` (`OPID`).
   - Formen er `ÅÅÅÅ-MM-DD_<suffiks>`, der datoen er dagens dato i **UTC**.
   - Suffikset er tilfeldig, 8–80 tegn av `A–Z`, `a–z`, `0–9` og `-`.
   - opId, sti og verdi noteres uendret for retry.
2. Skriv: `data_skriv { opId, ops: [{ sti: "meals/<weekKey>/<day>", type: "set", verdi: <ny dagverdi>, forventet: <versjon fra data_hent, eller "mangler"> }] }`.
   - Én operasjon på dagens egen node, aldri `set` på `meals/<weekKey>` eller `meals`. Det ville kollidert med appens per-dag-skriving.

## 5. Utfall, konflikt og retry

| Utfall                             | Handling                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `committed`                        | Gå til tilbakelesing (6). Med `senereEndret: true` har appen endret dagen etterpå. Det er ikke en feil, og det skal ikke «rettes».                                                                                                                                                                                                                                                                                         |
| `replay`                           | Allerede lagret med samme opId. Ingen ny skriving. Les tilbake.                                                                                                                                                                                                                                                                                                                                                            |
| `konflikt`                         | Dagen er endret siden den ble lest, og ingenting er skrevet. Les dagen på nytt med `data_hent`. Inneholder den allerede nøyaktig den planlagte verdien, rapporteres den som lagret. Ellers vises den nye tilstanden, og beslutningen i 3 tas på nytt **med brukeren**. Det skrives aldri over en endring som brukeren ikke har sett. En ny skriving bruker ny versjon og nytt opId.                                        |
| `ukjent_utfall`, `skriving_feilet` | Utfallet er uavklart. Innenfor gyldighetsvinduet (30 dager, og etter `_mcp/vannmerke`) prøves det igjen med **samme opId, samme sti, samme verdi og samme `forventet`**, aldri et nytt opId, fordi det kan gi dobbel skriving. Kvitteringen ligger i samme transaksjon. Er `skriving_feilet` `vedvarende`, stopp og meld grunnen.                                                                                          |
| `utlopt`                           | opId-et er utenfor gyldighetsvinduet, og kvitteringen kan ikke lenger bevise utfallet. Les dagen. At den inneholder den planlagte verdien, er ikke bevis på at dette kallet lagret den: rapporter den som lagret bare ved likt innhold, og ellers som uavklart, uten å overskrive. Mangler oppskriften på dagen, kan den ha blitt lagret og senere fjernet. Stopp og avklar med brukeren før en ny skriving med nytt opId. |
| Andre feil                         | `ugyldig_skriving`, `invalid_path`, `beskyttet`, `for_stor`, `forelder_er_verdi`, `not_member` og `idempotency_conflict` skriver garantert ingenting. Meld grunnen. Rett verdien bare når feilen peker på den, for eksempel en `null` som er glemt.                                                                                                                                                                        |

## 6. Les tilbake og meld

- Les `data_hent { sti: "meals/<weekKey>/<day>" }` og sammenlign med verdien som ble sendt.
- Meld brukeren:
  - dato, ukedag og uke;
  - om oppskriften ble lagt til eller erstattet, eller om den sto der fra før;
  - hva dagen nå inneholder.

## 7. Funn i dagens kode

Ingen av disse er rettet her.

- **Ingen sideeffekter.** Appens egen «legg i plan» (`setDayToRecipe`, `addRecipeToDay` og `useMealsWriter`) skriver bare `meals/{weekKey}/{day}`. Handleliste, `mealFeedback`, `mealEvents` og historikk skrives ikke. Arbeidsflyten gjør det samme.
- **Hendelser tåles ikke av `addRecipeToMeal`.** Brukt på en dag med `type: "event"` gir den en meny med bare den nye retten, og hendelsen forsvinner. Det er karakterisert i `meals.test.ts`. Arbeidsflyten kombinerer derfor aldri med en hendelse (3).
- **Ukjente felt i dagverdien.** `transactMealDay` skriver tilbake `updater(parseMealValue(current))`, og parseren tar bare med kjente felt. En senere redigering i appen fjerner derfor ukjente felt i dagverdien. Det er samme klasse som `transactRecipe` før #134. Arbeidsflyten skriver bare kjente felt, så den rammes ikke. Kan bestilles separat.

## 8. Kodeankre og tester

- **Kontrakt:**
  - `web/src/types/meal.ts`;
  - `web/src/data/meals.repository.ts` (`parseMealValue`, `transactMealDay`);
  - `web/src/domain/meals/meals.ts` (`getMealRecipes`, `addRecipeToMeal`);
  - `web/src/domain/shared/weekKey.ts`;
  - `web/src/hooks/useMeals.ts` og `useMealsWriter.ts`;
  - `web/src/features/hverdagsflyt/mat/kokebok/AddToPlanCard.tsx`.
- **Eksisterende dekning:**
  - `meals.repository.integration.test.ts` viser at en dag skrevet med `recipeId` utelatt (`null` lagres ikke) leses tilbake som `recipeId: null`, også inne i en meny, og at `variantId` og `mealLibraryId` bevares;
  - `meals.test.ts` dekker menybygging og duplikat;
  - `mcp-server/src/store/dataSkriving.integration.test.ts` dekker `set`, konflikt, retry og tilbakelesing.
- **Nye syntetiske regresjoner:**
  - `weekKey.test.ts`: uke 53 i 2026 og nyttår 2026/2027, som tabellen i 1;
  - `meals.test.ts`: `addRecipeToMeal` på en hendelse (funnet i 7).
