# Arbeidsflyt: slett én Kokebok-oppskrift (ChatGPT via MCP)

Dette er roadmap «Praktisk vedlikehold via ChatGPT», bestilt i #27 (6794055423).

Arbeidsflyten sletter **én entydig eksisterende** oppskrift i Kokeboken etter eksplisitt bestilling fra brukeren, med samme grunnlagsvern som appens «Slett» (#151). Den bruker bare `data_les`, `data_hent` og `data_skriv` (`mcp-server/README.md` §«Generell skriving»).

Den gjør ikke noe av dette:

- sletter flere oppskrifter, eller tolker «rydd opp» eller «fjern duplikater»;
- endrer eller fjerner referanser i middagsplanen, Middagsbiblioteket eller handlelisten;
- gjenoppretter en slettet oppskrift.

## 1. Appens handling

«Slett» i detaljvisningen (`RecipesScreen`) kaller `useRecipes.slettRecipe(selected)`. Den kjører `transactRecipeMedUtfall` med `slettHvisUendret` (`web/src/data/recipes.repository.ts`, `web/src/domain/recipes/recipes.ts`).

- **Grunnlag:** hele råposten slik detaljen viste den, fra samme abonnementssnapshot (`raattGrunnlag`). Den inneholder også felt appen ikke kjenner. Råposten sammenlignes med den ferske råverdien inne i transaksjonen. Er noe endret, også bare et ukjent felt eller «sist laget» fra «Bekreft middag», blir utfallet `endret`, og ingenting slettes.
- **Serververifisert:** `applyLocally: false`, og `committed` sjekkes. Et stopp returnerer gjeldende verdi uendret og verifiseres mot serveren.
- **Utfall:**
  - `slettet`;
  - `endret` eller `mangler`: ingenting er slettet eller gjenopprettet;
  - `avvist` (`permission_denied`);
  - `ukjent`.
- **Sideeffekter:** ingen. Bare `recipes/{id}` slettes. Referanser til oppskriften står uendret.

## 2. Hva skjer med referansene

Verifisert mot fersk `main` (`d2def5a`). Ingen leser stopper eller krasjer når `recipes/{id}` mangler. Ingen skriver rydder referansene.

| Leser                                                                                  | Referanse                                                                 | Når oppskriften mangler                                                                                                                    |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Middagsplanen** (`meals/{uke}/{dag}`, `PlanScreen`, `ActiveMealCard`)                | `{ type: "recipe", name, recipeId }`, eller `recipes[]` i en meny         | Dagen viser fortsatt det lagrede `name`. «📖 åpne oppskrift» lenker til `/mat/kokebok?apne=<id>`. Kokeboken viser da listen, ikke en feil. |
| **Handlelistegeneratoren** (`generators/shopping/shopping.ts`)                         | Konkret `recipeId` slås bare opp på id                                    | Gir 0 varer fra den dagen, med status `not-found`. Det er aldri en navnefallback.                                                          |
| **Middagsbiblioteket**, varianter med `source: "recipe"` (`mealLibrary/{id}/variants`) | `recipeId`                                                                | Varianten vises som «Oppskrift fjernet». Handlelisten gir 0 varer og `not-found` for den varianten. 📖 lenker til listen som over.         |
| **Førsteutkast**, `MealFeedbackModal`                                                  | Navneoppslag, ingen lagret `recipeId`                                     | Oppskriften er bare borte fra forslagene.                                                                                                  |
| **MCP-serveren**                                                                       | Ingen verktøy leser `recipes`                                             | Ingen effekt.                                                                                                                              |
| **Legacy `index.html`** (GitHub Pages, fortsatt publisert fra `main`)                  | Handlelisten slår opp konkret `recipeId`, og «Bekreft middag» bruker navn | Handlelisten gir 0 varer uten krasj (`index.html` ~3977). «Bekreft middag» oppdaterer ingen oppskrift når navnet ikke treffer.             |

**Kjent risiko, ikke en referanse:** legacy `index.html` skriver **hele** `recipes`-samlingen fra lokal tilstand ved enhver oppskriftsendring (`setRecipes` → `dbSet(${FAM}/recipes, …)`, ~16769). Rules har ikke noe eget vern for `recipes`.

- En legacy-økt som ble åpnet før slettingen, kan derfor skrive oppskriften tilbake ved neste endring der.
- Det gjelder appens egen «Slett» like mye. Det er ikke noe denne arbeidsflyten kan verne mot.
- Tilbakelesingen i 6 viser bare tilstanden da den ble lest.

## 3. Les og bestem

En eksplisitt og entydig bestilling om å slette én bestemt oppskrift autoriserer slettingen (#27 6509067353). Det kreves ingen ekstra bekreftelse. Bare tvetydig mål, tvetydig omfang eller et endret grunnlag avklares.

1. **Finn målet,** som i [`kokebok-navn.md`](kokebok-navn.md) §3.1. Det er to tilfeller:
   - **Oppslag etter navn:** `data_les { sti: "recipes" }`, med alle sider (følg `neste` til `null`). Bare nøkkel og `name` brukes.
     - Et barn som er `forStor`, leses på egen sti. Kan det fortsatt ikke leses, eller er `name` ikke tekst, stopper du og ber om eksplisitt målvalg.
     - Treff er oppskrifter der `name` er lik det oppgitte navnet etter trimming og uten hensyn til store og små bokstaver. Krev nøyaktig ett treff.
   - **Utpekt eller observert mål:** målet bindes til **nodenøkkelen**. Er nøkkelen oppgitt uten navn, kreves ikke et navn brukeren aldri oppga.
2. **Omfanget må være én hel oppskrift,** som i «slett Taco fra Kokeboken».
   - «Rydd», «fjern duplikater» eller flere navn: stopp og spør om én oppskrift om gangen.
   - Gjelder bestillingen en dag i middagsplanen eller en bibliotekvariant, er det ikke denne arbeidsflyten.
3. **Grunnlaget:** `data_hent { sti: "recipes/<nøkkel>" }` gir `verdi` og `versjon` fra **samme** lesing. Slettingen bygger bare på dette.
   - **Mangler verdien:** stopp, og meld at oppskriften allerede er slettet.
   - **`forStor`, eller ingen `versjon`:** stopp uten skriving.
   - **Navneoppslag:** `name` må fortsatt treffe det oppgitte navnet. Er posten omdøpt, er grunnlaget endret. Avklar målet.
   - **Observert grunnlag:** bygger bestillingen på noe som er vist tidligere i samtalen, valideres det mot `verdi` fra **denne** lesingen. Avviker det, er grunnlaget endret. Vis den nye tilstanden, og avklar før skriving.
   - **Lagret `id`-felt** må være likt nøkkelen sammenlignet som tekst (`String(id)`). Ellers stopper du. Identiteten er uklar for `index.html`.
4. **Referanser vurderes uten å endres.** De er rådgivende og stopper ikke slettingen, som i appen.
   - Les `data_les { sti: "mealLibrary" }` (alle sider). Tell variantene med `source: "recipe"` og `recipeId` lik nøkkelen.
   - Les `data_les { sti: "meals" }` (alle sider). Tell dagene der `recipeId`, eller et element i `recipes[]`, er lik nøkkelen.
   - Kan noe ikke leses, meld antallet som ukjent. Sidene er ikke ett øyeblikksbilde, så tellingen er et anslag og ikke en garanti.
5. **Meld hva som slettes,** med navn og nøkkel, og antall referanser med konsekvensen fra 2. For eksempel: «Taco slettes. 2 planlagte dager og 1 bibliotekvariant peker på den. De viser navnet eller ‹Oppskrift fjernet› og gir ingen varer i handlelisten.» Dette er en melding, ikke et nytt spørsmål.

## 4. Skriv

1. Lag opId **én gang** etter `OPID` i `mcp-server/src/data/skriving.ts`: `ÅÅÅÅ-MM-DD_<suffiks>`, med UTC-dato og et tilfeldig suffiks på 8–80 tegn. opId og operasjonen noteres uendret.
2. Send `data_skriv { opId, ops: [{ sti: "recipes/<nøkkel>", type: "slett", forventet: "<versjonen fra samme data_hent>" }] }`.
   - Versjonen dekker hele råposten, også ukjente felt. Det er samme grunnlag som appen bruker (1). Enhver endring etter lesingen gir `konflikt`, og ingenting slettes. Det gjelder også redigering, «Bekreft middag» og «Slett» i appen.
   - Stien er alltid nodenøkkelen, aldri et lagret `id`-felt.
   - Det skrives aldri på `recipes`, `meals` eller `mealLibrary`.

## 5. Utfall, konflikt og retry

Ingen utfall fører til en ny automatisk skriving.

| Utfall                             | Handling                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `committed`                        | Les tilbake (6).                                                                                                                                                                                                                                                                     |
| `replay`                           | Allerede slettet med samme opId. Ingen ny skriving. Les tilbake.                                                                                                                                                                                                                     |
| `konflikt`                         | Oppskriften er endret eller slettet siden lesingen. Ingenting er slettet. Les på nytt med `data_hent`, og vis den nye tilstanden. Mangler den nå, meld at den allerede er slettet. Ellers avklares det med brukeren før en eventuell ny sletting med ny versjon og nytt opId.        |
| `ukjent_utfall`, `skriving_feilet` | Uavklart. Bare på brukerens forespørsel, og innenfor gyldighetsvinduet (30 dager, og etter `_mcp/vannmerke`), prøves det igjen med **samme opId og samme operasjon**, aldri nytt opId. Kvitteringen gjør retry idempotent. Er `skriving_feilet` `vedvarende`, stopp og meld grunnen. |
| `utlopt`                           | Kvitteringen kan ikke lenger bevise utfallet, og det meldes som **uavklart**. Les uten å skrive. At oppskriften mangler, er et spor, ikke bevis for at dette opId-et slettet den. Finnes den, avklar med brukeren før en eventuell ny sletting med nytt opId.                        |
| Andre feil                         | `ugyldig_skriving`, `invalid_path`, `beskyttet`, `not_member` og `idempotency_conflict` skriver garantert ingenting. Meld grunnen.                                                                                                                                                   |

## 6. Les tilbake og meld

- **Bekreftet utfall** er det `data_skriv` svarte: `committed` eller `replay`, med `senereEndret` fra den innebygde tilbakelesingen.
- **Nåtilstanden** kommer fra en separat, fersk `data_hent { sti: "recipes/<nøkkel>" }`. Forventet resultat er at noden mangler.
- **Finnes noden likevel,** meldes det med utfall og nåtilstand hver for seg. Påstå ingen årsak. Én mulighet er en legacy-økt (2). Noden slettes ikke på nytt uten en ny eksplisitt bestilling.
- **Referansene** leses ikke på nytt og endres ikke. Meld brukeren antallet fra 3.4 og hva de nå viser (2).

## 7. Kodeankre og tester

- **Kontrakt:**
  - `web/src/data/recipes.repository.ts` (`transactRecipeMedUtfall`, `raattGrunnlag`, `subscribeRecipes`);
  - `web/src/domain/recipes/recipes.ts` (`slettHvisUendret`, `sletteTekst`);
  - `web/src/hooks/useRecipes.ts` (`slettRecipe`);
  - `web/src/features/hverdagsflyt/mat/kokebok/RecipesScreen.tsx`;
  - `web/src/generators/shopping/shopping.ts`;
  - `web/src/domain/meals/meals.ts` (`resolveActiveRecipeId`);
  - `MealLibraryScreen.tsx`;
  - `index.html` (~3977 og ~16769).
- **Eksisterende dekning:**
  - `recipes.repository.integration.test.ts` dekker «Slett» mot emulatoren: uendret, endret (navn, ingrediens, «Bekreft middag», ukjent toppfelt), fjernet og råfelt (#151);
  - `shopping.test.ts` dekker `not-found` og 0 varer for en konkret `recipeId` og en recipe-variant uten oppskrift;
  - `mcp-server/src/store/dataSkriving.integration.test.ts` dekker `slett`, konflikt, replay og tilbakelesing.
- **Ny syntetisk karakterisering:**
  - `MealLibraryScreen.test.tsx`: en variant som peker på en slettet oppskrift, vises som «Oppskrift fjernet»;
  - `RecipesScreen.test.tsx`: `?apne=<id som ikke finnes>` viser listen uten krasj.
