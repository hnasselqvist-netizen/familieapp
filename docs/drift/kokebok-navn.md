# Arbeidsflyt: endre navnet på én Kokebok-oppskrift (ChatGPT via MCP)

Dette er roadmap «Praktisk vedlikehold via ChatGPT», bestilt i #27 (6767587255).

Arbeidsflyten endrer **bare `name`** på **én entydig eksisterende** oppskrift i Kokeboken etter eksplisitt bestilling fra brukeren. Den bruker bare `data_les`, `data_hent` og `data_skriv` (`mcp-server/README.md` §«Generell skriving»).

Den gjør ikke noe av dette:

- endrer andre felt på oppskriften;
- oppdaterer referanser i middagsplanen, Middagsbiblioteket eller handlelisten;
- endrer `updatedAt` eller det lagrede `id`-feltet.

## 1. Appens redigering

«Rediger oppskrift» i `RecipesScreen` åpner `RecipeFormModal`. `save()` sender et `patch` til `useRecipes.updateRecipe(id, patch)`. Det kjører `transactRecipe` med `{ ...current, ...patch }` (`web/src/data/recipes.repository.ts`).

- **Navnet:** `name` er `name.trim()`. «Lagre» er deaktivert når navnet er tomt etter trimming.
  - Appen sjekker **ikke** om et annet navn kolliderer. To oppskrifter kan ha samme navn.
- **Hele skjemaet sendes.** `patch` har alle feltene i skjemaet:
  - `name`, `cat`, `tags` og `url`;
  - `time` (`parseInt || 0`) og `servings` (`parseInt || 4`);
  - `imageUrl` (tom blir `null`);
  - `lettvint` og `variationTags`;
  - `instructions`, `ingredients` og `ingredientGroups`.

  En navneendring i appen kan derfor også skrive disse feltene i skjemaets normaliserte form. Arbeidsflyten endrer bare `name`.

- **Råfelt bevares.** `transactRecipe` fletter med den rå posten (`medBevarteFelt`, #134). Felt appen ikke kjenner, også det lagrede `id`-feltet fra eldre poster, står uendret. `id` legges aldri til der den mangler.
- **`updatedAt`** settes aldri av React-appen. Den leses og bevares bare.
- **Referanser.** Ingen skrivevei oppdaterer andre noder når navnet endres:
  - Planlagte dager i `meals` har fortsatt det lagrede `name` sammen med `recipeId`.
  - Varianter i Middagsbiblioteket peker på `recipeId`.

  Arbeidsflyten gjør det samme.

- **Stabil identitet** er nodenøkkelen `recipes/{id}`. Det lagrede `id`-feltet, som `index.html` leser, skal være likt nøkkelen der det finnes. Eldre poster kan ha det som tall: nøkkelen `"4"` har `id: 4` i produksjon (lest uten skriving 10.11). Sammenlign derfor som tekst.

## 2. Speiling, og hvor grenen stoppes

| Bestilling eller tilstand                                                                             | Handling                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Nytt navn (ikke tomt etter trimming) på én entydig oppskrift                                          | Støttes (3–6).                                                                              |
| Det nye navnet er tomt etter trimming                                                                 | **Stopp**, som appens deaktiverte «Lagre».                                                  |
| Det nye navnet er likt det gamle                                                                      | Ingenting skrives. Meld at navnet allerede er slik.                                         |
| Det nye navnet er likt en **annen** oppskrifts navn (trimmet, uten hensyn til store og små bokstaver) | **Avklar** før skriving. Appen tillater det, men det gjør senere oppslag på navn tvetydige. |
| Ingen eller flere oppskrifter treffer det gamle navnet                                                | **Stopp**, og be om eksplisitt målvalg.                                                     |
| Lagret `id`-felt som avviker fra nøkkelen (som tekst)                                                 | **Stopp.** Identiteten er uklar for `index.html`.                                           |
| Andre felt, eller referanser i plan og bibliotek                                                      | Utenfor arbeidsflyten.                                                                      |

## 3. Les og bestem

En eksplisitt og entydig bestilling autoriserer skrivingen (#27 6509067353). Bare tvetydig mål, en navnekollisjon eller et endret grunnlag avklares.

1. **Finn oppskriften:** `data_les { sti: "recipes" }`, med alle sider (følg `neste` til `null`). Bare nøkkel og `name` brukes.
   - Et barn som er `forStor`, leses på egen sti. Kan det fortsatt ikke leses, kan det være et treff, og da stopper du.
   - Treff er oppskrifter der `name` er lik det oppgitte navnet etter trimming og uten hensyn til store og små bokstaver.
   - Krev nøyaktig ett treff, eller en nøkkel brukeren har pekt ut.
   - Oppslaget gir bare en kandidat. Avgjørelsen tas i 2.
   - Ta vare på navnene til alle de andre oppskriftene. De trengs til kollisjonssjekken i 3.
2. **Grunnlaget:** `data_hent { sti: "recipes/<nøkkel>" }` gir `verdi` og `versjon` fra **samme** lesing.
   - Mangler verdien, eller er den `forStor`, eller mangler `versjon`: stopp.
   - `name` må fortsatt treffe det oppgitte navnet. Ellers er grunnlaget endret, og målet avklares.
   - Et lagret `id`-felt må være likt nøkkelen når det sammenlignes som tekst (`String(id)`).
3. **Det nye navnet:** trim det. Det må ikke være tomt.
   - Er det likt dagens `name`, skrives ingenting.
   - Treffer det en annen oppskrift fra 1, avklar før skriving.
4. **Planlagt post:** en kopi av **hele** råverdien der bare `name` er byttet. Alle andre felt følger uendret:
   - `id`, `updatedAt`, `createdAt`, `source`, ingredienser og grupper;
   - felt appen ikke kjenner.

   Meld hva som **planlegges**, for eksempel «Taco → Fredagstaco». Bekreftet utfall meldes først i 6.

## 4. Skriv

1. Lag opId **én gang** etter `OPID` i `mcp-server/src/data/skriving.ts`: `ÅÅÅÅ-MM-DD_<suffiks>`, med UTC-dato og et tilfeldig suffiks på 8–80 tegn. opId og operasjonen noteres uendret.
2. Send `data_skriv { opId, ops: [{ sti: "recipes/<nøkkel>", type: "set", verdi: <planlagt post>, forventet: "<postversjonen fra samme data_hent>" }] }`.
   - Enhver endring i oppskriften etter lesingen gir `konflikt`, og ingenting skrives. Det gjelder også redigering, «Bekreft middag» og sletting i appen.
   - Delvis `update` på `name` brukes ikke. `forventet` må ha nøyaktig de samme nøklene som `verdi` (`skriving.ts`), og ville bare vernet om navnet, ikke om oppskriftens identitet.
3. **Kan ikke skrives tapsfritt.** Kopien kan ha noe `data_skriv` avviser: en ugyldig nøkkel, `__proto__`, `constructor` eller `prototype`, en tom liste eller et tomt objekt, eller en liste med hull. Da stopper du uten skriving og melder grunnen.

## 5. Utfall, konflikt og retry

Ingen utfall fører til en ny automatisk skriving.

| Utfall                             | Handling                                                                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `committed`                        | Les tilbake (6).                                                                                                                                                                                                                                          |
| `replay`                           | Allerede lagret med samme opId. Ingen ny skriving. Les tilbake.                                                                                                                                                                                           |
| `konflikt`                         | Oppskriften er endret eller slettet siden lesingen. Ingenting er skrevet. Les på nytt (3.2), og vis den nye tilstanden. Grunnlaget er endret, så det avklares med brukeren før en eventuell ny skriving med ny versjon og nytt opId.                      |
| `ukjent_utfall`, `skriving_feilet` | Uavklart. Bare på brukerens forespørsel, og innenfor gyldighetsvinduet (30 dager, og etter `_mcp/vannmerke`), prøves det igjen med **samme opId og samme operasjon**, aldri nytt opId. Er `skriving_feilet` `vedvarende`, stopp og meld grunnen.          |
| `utlopt`                           | Kvitteringen kan ikke lenger bevise utfallet, og det meldes som **uavklart**. Les uten å skrive. At `name` nå er det nye navnet, er et spor i nåtilstanden, ikke bevis for at dette opId-et lagret det. Avklar med brukeren før en eventuell ny skriving. |
| Andre feil                         | `ugyldig_skriving`, `invalid_path`, `beskyttet`, `for_stor`, `forelder_er_verdi`, `not_member` og `idempotency_conflict` skriver garantert ingenting. Meld grunnen.                                                                                       |

## 6. Les tilbake og meld

- **Bekreftet utfall** er det `data_skriv` svarte: `committed` eller `replay`, med lagret versjon og `senereEndret` fra den innebygde tilbakelesingen.
- **Nåtilstanden** kommer fra en separat, fersk `data_hent { sti: "recipes/<nøkkel>" }`. Sammenlign med den planlagte posten.
- **Avvik** meldes som de er, med utfall og nåtilstand hver for seg. Påstå ingen årsak, og «rett» ingenting.
- **Meld brukeren** gammelt og nytt navn.
  - Planlagte dager kan fortsatt vise det gamle navnet, som i appen.
  - Er navnet nå delt med en annen oppskrift etter avklaring, si det også.

## 7. Kodeankre og tester

- **Kontrakt:**
  - `web/src/types/recipe.ts`;
  - `web/src/data/recipes.repository.ts` (`parseRecipeFields`, `transactRecipe`, `medBevarteFelt`);
  - `web/src/hooks/useRecipes.ts` (`updateRecipe`);
  - `web/src/features/hverdagsflyt/mat/kokebok/RecipeFormModal.tsx` (`save`) og `RecipesScreen.tsx`.
- **Eksisterende dekning:**
  - `recipes.repository.test.ts`, og `recipes.repository.integration.test.ts` mot emulatoren, dekker at redigering bevarer lagret `id` og ukjente felt, og at `id` ikke legges til (#134);
  - `RecipeFormModal.test.tsx` dekker skjemaet;
  - `mcp-server/src/store/dataSkriving.integration.test.ts` dekker `set`, konflikt, replay og tilbakelesing.
- **Ingen ny test.** Dekningen var komplett for det arbeidsflyten bygger på.
