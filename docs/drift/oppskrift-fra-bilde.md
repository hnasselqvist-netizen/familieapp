# Arbeidsflyt: oppskrift fra bilde til Kokebok (ChatGPT via MCP)

Dette er roadmap «Praktisk vedlikehold via ChatGPT», bestilt i #27 (6734076717).

Arbeidsflyten bruker bare de generelle verktøyene `data_nokler`, `data_les`, `data_hent` og `data_skriv` (`mcp-server/README.md` §«Generell skriving»). Den legger ikke til noen ny skriveinngang, OCR-tjeneste, scope eller rules. Posten skrives i **samme form som Kokeboken selv lagrer**, slik at appen leser, viser, skalerer og redigerer den som enhver annen oppskrift.

## 1. Når

- **Bare på en eksplisitt bestilling** med bilde, for eksempel «legg denne oppskriften i Kokeboken». Et bilde som bare deles, gir ingen skriving.
- **Bare under den autoriserte familien.** `data_skriv` krever `data:write`, og medlemskap sjekkes per kall.

## 2. Transkribér og avklar før noe skrives

Vis brukeren transkripsjonen i denne rekkefølgen:

1. navn;
2. kategori;
3. porsjoner;
4. tid i minutter;
5. ingredienser, eventuelt per gruppe, med navn, mengde og enhet;
6. fremgangsmåte.

**Usikre mengder og ord merkes og avklares. Tall gjettes aldri.** Det gjelder:

- uleselige tall og ord;
- tvetydige brøker;
- mengde uten enhet eller enhet uten mengde;
- «en klype» og liknende.

Det skrives ingenting før brukeren har bekreftet transkripsjonen.

**Kategori** er én av `Middag`, `Frokost`, `Lunsj`, `Dessert` eller `Snacks`. Det er Kokebokens filter (`RecipesScreen.tsx` `CATEGORIES`) og redigeringsskjema (`RecipeFormModal.tsx` `RECIPE_CATS`). En annen verdi lagres, men vises ikke under noe filter.

**Enhet** er én av `stk`, `g`, `kg`, `ml`, `dl`, `l`, `ss`, `ts`, `pk`, `boks`, `pose` eller `etter behov` (`IngredientRows.tsx` `UNITS`). Omregning:

- «EL» og «spsk» blir `ss`;
- «TL» og «tsk» blir `ts`;
- «klype» og «etter smak» blir `etter behov`, uten mengde.

**Mengde** skrives med desimalpunktum. «½» blir `0.5`, og «1 ½» blir `1.5`. `scaleIngredientAmount` (`domain/recipes/recipes.ts`) bruker `parseFloat`, så «0,5» ville blitt skalert som 0. Brøker som omregnes, vises til brukeren i bekreftelsen.

## 3. Les smalt

Les bare det duplikatsjekken og varekoblingen trenger:

- `data_nokler { sti: "recipes" }` gir antall og nøkler.
- `data_les { sti: "recipes" }`, sidevis med `etter`/`neste`. Bare `name` og `cat` brukes.
- `data_les { sti: "items" }`, sidevis, for varebasen. Bare nøkkel, `name` og `cat` brukes.

Andre noder leses ikke. Innholdet gjengis ikke utover det brukeren trenger for å velge.

## 4. Mulig duplikat

Er navnet likt et eksisterende etter trimming og små bokstaver, er det et mulig duplikat. Det er samme normalisering som varebasen bruker (`findItemByName` i `domain/shopping/handlelisteRules.ts`).

Vis treffet (navn, kategori og antall ingredienser) og la brukeren velge:

- **avbryt**; eller
- **lagre som ny** med et annet navn.

Å endre eller erstatte en eksisterende oppskrift er en egen bestilling og inngår ikke i denne arbeidsflyten. Et navn som bare likner, nevnes, men blokkerer ikke.

## 5. Varekobling (`itemId`)

- **Verifisert kobling** er nøyaktig ett treff i `items` på navn etter trimming og små bokstaver. Da settes `itemId` til varens nøkkel og `cat` til varens `cat`, som når `ItemPicker` har valgt varen.
- **Ellers** utelates `itemId`, og `cat` settes til `"Diverse"`. Det er appens egen fallback for fritekst (`rowsToIngredients` i `QuickAddRecipeModal.tsx`).
  - Ved flere treff, synonym, entall eller flertall («løk»/«løker») eller et nærliggende navn spør du brukeren eller lar ingrediensen stå ukoblet.
  - Ukoblede ingredienser nevnes i oppsummeringen. Brukeren kan koble dem senere i Kokeboken.
- **Det opprettes aldri en vare.** `items` skrives ikke av denne arbeidsflyten.

## 6. Posten

Formen er `RecipeFields` (`web/src/types/recipe.ts`), uten `null` og tomme lister. `data_skriv` avviser begge, og leseren `parseRecipeFields` (`data/recipes.repository.ts`) gir `[]`, `null` og `0` for felt som mangler.

Eksempelet er det samme som regresjonstesten i `web/src/data/recipes.repository.integration.test.ts` bruker:

```json
{
  "id": "<samme som nøkkelen>",
  "name": "Fiskesuppe med safran",
  "cat": "Middag",
  "time": 40,
  "servings": 4,
  "url": "",
  "source": "image",
  "instructions": "Fres løk og gulrot i smør.\n\nTilsett kraft og fløte, og la det småkoke.",
  "createdAt": 1794211200000,
  "timesCooked": 0,
  "ingredientGroups": [
    {
      "id": "<ny uuid>",
      "name": "Suppe",
      "ingredients": [
        {
          "name": "Torskefilet",
          "amount": "400 g",
          "unit": "g",
          "cat": "Fisk",
          "itemId": "<verifisert vare-id>"
        },
        {
          "name": "Fiskekraft",
          "amount": "0.5 l",
          "unit": "l",
          "cat": "Diverse"
        },
        {
          "name": "Safran",
          "amount": "",
          "unit": "etter behov",
          "cat": "Diverse"
        }
      ]
    },
    {
      "id": "<ny uuid>",
      "name": "Servering",
      "ingredients": [
        { "name": "Brød", "amount": "1 stk", "unit": "stk", "cat": "Diverse" }
      ]
    }
  ]
}
```

| Felt               | Regel                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nøkkel og `id`     | Ny UUID, som `createRecipe`. `id` settes lik nøkkelen fordi `index.html` leser oppskriftens id fra posten (`Object.values`). React ignorerer feltet.                                                                                                                                                                    |
| `time`, `servings` | Tall. `0` betyr ukjent, som i hurtigregistreringen.                                                                                                                                                                                                                                                                     |
| `url`              | `""`.                                                                                                                                                                                                                                                                                                                   |
| `source`           | `"image"`, samme verdi som bildefanen i `index.html`.                                                                                                                                                                                                                                                                   |
| `instructions`     | Tekst med `\n` mellom avsnitt.                                                                                                                                                                                                                                                                                          |
| `createdAt`        | Millisekunder.                                                                                                                                                                                                                                                                                                          |
| `timesCooked`      | `0`.                                                                                                                                                                                                                                                                                                                    |
| Ingredienser       | Enten `ingredients` (flat liste) eller `ingredientGroups` (navngitte grupper, som «Bunn» og «Fyll»), aldri begge. Hver ingrediens har `name`, `amount` (`"<tall> <enhet>"`, eller `""` uten mengde), `unit` og `cat`, og `itemId` bare ved verifisert kobling. Hver gruppe har `id` (ny UUID), `name` og `ingredients`. |
| Utelates           | `tags`, `imageUrl`, `lastCooked`, `lettvint`, `variationTags` og `updatedAt`. Bildet lagres ikke: det er over grensen per kall og krever en egen beslutning (`mcp-server/README.md` §«Størrelse»).                                                                                                                      |

## 7. Skriv

1. Hent grunnlaget: `data_hent { sti: "recipes/<id>" }` skal vise at noden mangler.
2. Skriv: `data_skriv { opId: "ÅÅÅÅ-MM-DD_<tilfeldig>", ops: [{ sti: "recipes/<id>", type: "set", verdi: <posten>, forventet: "mangler" }] }`.
   - Én operasjon på oppskriftens egen node, aldri `set` på hele `recipes`.
   - opId og nøkkel noteres før kallet, fordi de trengs ved retry.

## 8. Utfall, konflikt og retry

| Utfall                             | Handling                                                                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `committed`                        | Gå til tilbakelesing (9). Med `senereEndret: true` har appen endret noe etterpå. Det er ikke en feil, og det skal ikke «rettes».                                                                                                                                   |
| `replay`                           | Den er allerede lagret med samme opId. Ingen ny skriving. Les tilbake.                                                                                                                                                                                             |
| `konflikt`                         | Noden finnes allerede. Ingenting er skrevet. Les den på nytt og vis den. Er det samme oppskrift, er den allerede lagret. Ellers velges ny nøkkel og nytt opId etter at brukeren har bekreftet. Ingenting overskrives.                                              |
| `ukjent_utfall`, `skriving_feilet` | Prøv igjen med **samme opId, samme nøkkel og samme post**. Aldri ny nøkkel eller nytt opId, fordi det kan gi duplikat. Kvitteringen ligger i samme transaksjon, så et nytt forsøk skriver aldri dobbelt. Er `skriving_feilet` `vedvarende`, stopp og meld grunnen. |
| `utlopt`                           | opId-et er for gammelt. Les noden: finnes den, er den lagret. Mangler den, skriv med nytt opId (samme nøkkel og post, `forventet: "mangler"`).                                                                                                                     |
| Andre feil                         | `ugyldig_skriving`, `invalid_path`, `beskyttet`, `for_stor`, `not_member` og `idempotency_conflict` skriver garantert ingenting. Meld grunnen. Rett posten bare når feilen peker på den, for eksempel en `null` som er glemt.                                      |

## 9. Les tilbake og meld

- Les `data_hent { sti: "recipes/<id>" }` og sammenlign med posten som ble sendt.
- Meld brukeren:
  - navn og kategori;
  - antall ingredienser, og hvor mange som er koblet og ukoblet;
  - at oppskriften ligger i Kokeboken under kategorien.

## 10. Det arbeidsflyten ikke gjør

- **Ingen andre noder skrives.** `items`, `shopping`, middagsplan og `mealLibrary` røres ikke.
- **Ingen automatisk oppretting av varer.**
- **Ingen lagring av bildet.**
- **Ingen redigering** av eksisterende oppskrifter.
- **Ingen tester** mot produksjonsdata.

## 11. Kodeankre og tester

- **Form og leser:**
  - `web/src/types/recipe.ts`;
  - `web/src/data/recipes.repository.ts` (`parseRecipeFields`, `createRecipe`, `transactRecipe`);
  - `web/src/domain/recipes/recipes.ts` (`getIngredients`, `scaleIngredientAmount`, `markRecipeCooked`).
- **Felt og enheter:** `QuickAddRecipeModal.tsx` (`rowsToIngredients`), `IngredientRows.tsx` (`UNITS`), `RecipesScreen.tsx` (`CATEGORIES`) og `RecipeFormModal.tsx` (`RECIPE_CATS`).
- **Skriving:** `mcp-server/src/data/skriving.ts` og `dataSkriving.ts`. `store/dataSkriving.integration.test.ts` dekker `set` av objekter og lister over ekte MCP-HTTP, tilbakelesing, tapt svar med retry, idempotens og konflikt.
- **Regresjon for denne formen:** `recipes.repository.integration.test.ts`, testen «Kokebok-post i formen fra oppskrift-fra-bilde-arbeidsflyten». Posten over legges utenfor appen, og testen viser:
  - at appens leser gir en fullverdig oppskrift;
  - at grupper, koblede og ukoblede ingredienser og skalering virker;
  - at «Bekreft middag» kan oppdatere den uten å miste felt.

**Kjent forhold, ikke rettet her:** `transactRecipe` skriver tilbake `parseRecipeFields(current)`, som ikke tar med `id`. En React-redigering fjerner derfor `id`-feltet. Skrivefri lesing av produksjonen 09.11 viste at 2 av 11 oppskrifter mangler `id`, og begge har `updatedAt`. Bare tellinger ble lest. Det har betydning bare hvis `index.html`-Kokeboken skriver igjen.
