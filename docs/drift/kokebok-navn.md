# Arbeidsflyt: endre navnet på én Kokebok-oppskrift (ChatGPT via MCP)

Dette er roadmap «Praktisk vedlikehold via ChatGPT», bestilt i #27 (6767587255).

Arbeidsflyten endrer **bare `name`** på **én entydig eksisterende** oppskrift i Kokeboken etter eksplisitt bestilling fra brukeren. Den bruker bare `data_les`, `data_hent` og `data_skriv` (`mcp-server/README.md` §«Generell skriving»).

Den gjør ikke noe av dette:

- endrer andre felt på oppskriften;
- oppdaterer referanser i middagsplanen, Middagsbiblioteket eller handlelisten;
- endrer `updatedAt` eller det lagrede `id`-feltet.

## 1. Appens redigering

«Rediger oppskrift» i `RecipesScreen` åpner `RecipeFormModal`. `save()` sender et `patch` til `useRecipes.redigerRecipe(observert, patch)`, der `observert` er oppskriften slik skjemaet ble åpnet. Det kjører `transactRecipeMedUtfall` med `redigerHvisUendret` (`web/src/data/recipes.repository.ts`, `web/src/domain/recipes/recipes.ts`). Siden #20 6781074174 avvises lagringen med `endret` hvis et felt skjemaet skriver, er endret siden skjemaet ble åpnet, og med `mangler` hvis oppskriften er slettet. Da skrives ingenting, og en slettet oppskrift gjenopprettes ikke. Utfallet er verifisert mot serveren (review 5851280024). `permission_denied` gir `avvist`, og annen feil eller manglende commit gir `ukjent`. Ellers skrives `{ ...current, ...patch }`.

- **Navnet:** `name` er `name.trim()`. «Lagre» er deaktivert når navnet er tomt etter trimming.
  - Appen sjekker **ikke** om et annet navn kolliderer. To oppskrifter kan ha samme navn.
- **Hele skjemaet sendes.** `patch` har alle feltene i skjemaet:
  - `name`, `cat`, `tags` og `url`;
  - `time` (`parseInt || 0`) og `servings` (`parseInt || 4`);
  - `imageUrl` (tom blir `null`);
  - `lettvint` og `variationTags`;
  - `instructions`, `ingredients` og `ingredientGroups`.

  En navneendring i appen kan derfor også skrive disse feltene i skjemaets normaliserte form. Unntaket er urørte felt ved redigering: porsjoner (#20 6784919488) og ingredienser og grupper (#20 6787017122) sendes bare når de er endret. Ellers står de rått uendret, men er fortsatt grunnlag for lagringen. Arbeidsflyten endrer bare `name`.

- **Råfelt bevares.** `transactRecipe` fletter med den rå posten (`medBevarteFelt`, #134). Felt appen ikke kjenner, også det lagrede `id`-feltet fra eldre poster, står uendret. `id` legges aldri til der den mangler.
- **`updatedAt`** settes ikke av redigeringsveien over (`RecipeFormModal.save` → `redigerRecipe` → `transactRecipeMedUtfall`). Den leses og bevares bare.
- **Referanser.** Ingen skrivevei oppdaterer andre noder når navnet endres:
  - Planlagte dager i `meals` har fortsatt det lagrede `name` sammen med `recipeId`.
  - Varianter i Middagsbiblioteket peker på `recipeId`.

  Arbeidsflyten gjør det samme.

- **Stabil identitet** er nodenøkkelen `recipes/{id}`. Det lagrede `id`-feltet, som `index.html` leser, skal være likt nøkkelen der det finnes. Eldre poster kan ha det som tall, for eksempel nøkkelen `"7"` med `id: 7` (syntetisk eksempel). Sammenlign derfor som tekst.

## 2. Speiling, og hvor grenen stoppes

| Bestilling eller tilstand                                                                                         | Handling                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Nytt navn (ikke tomt etter trimming) på én entydig oppskrift                                                      | Støttes (3–6).                                                                                                           |
| Det nye navnet er tomt etter trimming                                                                             | **Stopp**, som appens deaktiverte «Lagre».                                                                               |
| Det nye navnet er likt det gamle                                                                                  | Ingenting skrives. Meld at navnet allerede er slik.                                                                      |
| Det nye navnet er likt en **annen** oppskrifts navn i oppslaget (trimmet, uten hensyn til store og små bokstaver) | **Avklar** før skriving. Appen tillater det, men det gjør senere oppslag på navn tvetydige. Sjekken er rådgivende (3.3). |
| Ingen eller flere oppskrifter treffer det gamle navnet                                                            | **Stopp**, og be om eksplisitt målvalg.                                                                                  |
| Lagret `id`-felt som avviker fra nøkkelen (som tekst)                                                             | **Stopp.** Identiteten er uklar for `index.html`.                                                                        |
| Andre felt, eller referanser i plan og bibliotek                                                                  | Utenfor arbeidsflyten.                                                                                                   |

## 3. Les og bestem

En eksplisitt og entydig bestilling autoriserer skrivingen (#27 6509067353). Bare tvetydig mål, en navnekollisjon eller et endret grunnlag avklares.

1. **Finn målet.** Det er to tilfeller.
   - **Oppslag etter gammelt navn:** `data_les { sti: "recipes" }`, med alle sider (følg `neste` til `null`). Bare nøkkel og `name` brukes.
     - Et barn som er `forStor`, leses på egen sti.
     - Kan det fortsatt ikke leses, eller er `name` ikke tekst, kan det ikke brukes til å fastslå at et treff er entydig. Da stopper du og ber om eksplisitt målvalg.
     - Treff er oppskrifter der `name` er lik det oppgitte navnet etter trimming og uten hensyn til store og små bokstaver. Krev nøyaktig ett treff.
   - **Utpekt eller observert mål:** brukeren har pekt ut en bestemt oppskrift, eller den er observert tidligere i samtalen. Målet bindes da til **nodenøkkelen**.
     - Er nøkkelen oppgitt uten gammelt navn, kreves ikke et navn brukeren aldri oppga. Det som valideres, er nøkkelen og det observerte grunnlaget, for eksempel navnet som ble vist.

   Oppslaget gir bare en kandidat. Avgjørelsen tas i 2. Navnene til de andre oppskriftene i oppslaget brukes i den rådgivende kollisjonssjekken i 3.

2. **Grunnlaget:** `data_hent { sti: "recipes/<nøkkel>" }` gir `verdi` og `versjon` fra **samme** lesing.
   - Mangler verdien, eller er den `forStor`, eller mangler `versjon`: stopp.
   - `name` må være tekst og fortsatt treffe det oppgitte gamle navnet, eller det observerte grunnlaget for et utpekt mål.
   - Er posten borte eller omdøpt, er grunnlaget endret. Avklar målet. Det gjelder også om en **annen** oppskrift nå har det gamle navnet. Den brukes aldri i stedet.
   - Et lagret `id`-felt må være likt nøkkelen når det sammenlignes som tekst (`String(id)`).
3. **Det nye navnet:** trim det. Det må ikke være tomt.
   - Er det likt dagens `name`, skrives ingenting.
   - **Rådgivende kollisjonssjekk:** treffer det navnet til en annen oppskrift i oppslaget fra 1, avklar før skriving.
     - Sidene fra `data_les` er ikke ett øyeblikksbilde.
     - Versjonsvernet på `recipes/<nøkkel>` fanger ikke at en annen oppskrift får det samme navnet samtidig.
     - Meld derfor aldri at det nye navnet er unikt når skrivingen lagres.
     - Appen tillater duplikater, så det innføres ikke noe krav om å skrive hele samlingen.
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
  - Godtok brukeren en observert navnekollisjon, si det også. Påstå aldri at navnet er unikt.

## 7. Kodeankre og tester

- **Kontrakt:**
  - `web/src/types/recipe.ts`;
  - `web/src/data/recipes.repository.ts` (`parseRecipeFields`, `transactRecipe`, `medBevarteFelt`);
  - `web/src/hooks/useRecipes.ts` (`redigerRecipe`);
  - `web/src/features/hverdagsflyt/mat/kokebok/RecipeFormModal.tsx` (`save`) og `RecipesScreen.tsx`.
- **Eksisterende dekning:**
  - `recipes.repository.test.ts`, og `recipes.repository.integration.test.ts` mot emulatoren, dekker at redigering bevarer lagret `id` og ukjente felt, og at `id` ikke legges til (#134);
  - `RecipeFormModal.test.tsx` dekker skjemaet;
  - `mcp-server/src/store/dataSkriving.integration.test.ts` dekker `set`, konflikt, replay og tilbakelesing.
- **Ingen ny test.** Dekningen var komplett for det arbeidsflyten bygger på.
