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

Verifisert mot fersk `main` (`d2def5a`). Ingen leser krasjer når `recipes/{id}` mangler, og ingen skriver rydder referansene. En oppskrift kan nås fra en planlagt dag på tre måter. Konsekvensen gjelder alltid **den ene referansen**, ikke hele dagen: andre oppskrifter i en meny gir fortsatt varer.

| Vei fra dag eller variant til oppskriften                                                                                                                                                                                                                                                                   | Konsekvens når oppskriften mangler                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Direkte:** `meals/{uke}/{dag}` er `{ type: "recipe", recipeId: <nøkkel> }`, eller en meny med et element i `recipes[]` med `recipeId: <nøkkel>`                                                                                                                                                           | Dagen viser fortsatt lagret `name`. Handlelisten gir 0 varer og `not-found` for referansen (bare id-oppslag, aldri navn). «📖» lenker til Kokebok-listen.                                                                 |
| **Direkte i biblioteket:** `mealLibrary/{id}/variants[]` med `source: "recipe"` og `recipeId: <nøkkel>`                                                                                                                                                                                                     | Varianten vises som «Oppskrift fjernet».                                                                                                                                                                                  |
| **Indirekte:** en dagreferanse med `recipeId: null` løses til en bibliotekmiddag, med `mealLibraryId` først og ellers navn uten hensyn til store og små bokstaver (`resolveLibraryConcept`, `resolveActiveVariant`). Den løste varianten peker på `<nøkkel>`: valgt `variantId`, eller den eneste varianten | Handlelisten gir 0 varer og `not-found` for referansen. «📖» lenker til listen. Har middagen 2+ varianter uten valgt `variantId`, er referansen uløst fra før og berøres ikke.                                            |
| **Navnetreff:** en eldre strengverdi for dagen, lik oppskriftens navn uten hensyn til store og små bokstaver                                                                                                                                                                                                | Generatoren slo først opp oppskriften på navn. Etter slettingen faller den tilbake til bibliotekmiddagen med samme navn, ellers 0 varer. Konsekvensen avhenger altså av biblioteket og må vurderes for hvert treff (3.4). |
| **Uten referanse:** Førsteutkast og `MealFeedbackModal` bruker navneoppslag uten lagret `recipeId`                                                                                                                                                                                                          | Oppskriften er bare borte fra forslagene.                                                                                                                                                                                 |
| **MCP:** ingen domeneverktøy bruker oppskriften som referanse. De generelle dataverktøyene (`data_les`, `data_hent`, `data_skriv`) leser og skriver stien                                                                                                                                                   | Ingen effekt utover at noden mangler.                                                                                                                                                                                     |
| **Legacy `index.html`** (GitHub Pages, fortsatt publisert fra `main`). Handlelisten slår opp konkret `recipeId`, `recipeId: null` bruker bibliotekets `shoppingBase`, og strengverdier slås opp på navn                                                                                                     | Konkret `recipeId` gir 0 varer uten krasj (~3977). «Bekreft middag» oppdaterer ingen oppskrift når navnet ikke treffer.                                                                                                   |

**Eksempel på indirekte treff (syntetisk).** Målet er `recipes/r-pizza`.

- `meals/2026-W46/Fri` er `{ "type": "recipe", "name": "Pizza", "recipeId": null, "mealLibraryId": "pizza" }`.
- `mealLibrary/pizza/variants` er `[{ "id": "v1", "name": "Hjemmelaget", "source": "recipe", "recipeId": "r-pizza" }]`.

Fredagen har ingen direkte `recipeId`, men treffer målet gjennom den eneste varianten. Etter slettingen gir fredagen 0 varer og `not-found` for Pizza. Variantens kilde vises som «Oppskrift fjernet».

**Legacy-skrivere (rettet i #20 6796358047):** legacy `index.html` skrev tidligere **hele** `recipes`-samlingen fra lokal tilstand. En foreldet legacy-økt kunne dermed gjenopplive en slettet oppskrift.

- Nå skriver legacy-Kokeboken per oppskrift (`skrivOppskrift`), med en transaksjon på `recipes/{nøkkel}`. Det gjelder oppretting, redigering, «Slett» og «Bekreft middag».
- En slettet oppskrift gjenoppstår ikke ved andre legacy-handlinger. Det er vist i `web/e2e-legacy/kokebok-skrivevei.spec.ts`.
- Redigering skriver bare feltene skjemaet faktisk endret. Urørte ingredienser, grupper og ukjent porsjonstall står uendret. Skjemaet lukkes først når lagringen er bekreftet.
- «Bekreft middag» skriver til planens `recipeId` når den finnes, uten navnefallback. Uten `recipeId` skrives det bare ved nøyaktig ett navnetreff. `lastCooked` går aldri bakover.
- Skrivegrensen (`skrivOppskrift`) godtar bare ett gyldig nøkkelsegment. Eldre numeriske id-er konverteres kontrollert. En ugyldig lagret id (som `/` eller `a/ingredients`) avvises før noen skriving, med synlig status.
- Lokal identitet er alltid nodenøkkelen, også når en eldre posts lagrede `id` avviker fra den.
- Skjemaene sperrer utkastet mens et lagresvar venter.
- Tilbakelesingen i 6 viser fortsatt bare tilstanden da den ble lest.
- **Gjelder bare oppdaterte klienter.** En fane som ble åpnet før denne rettingen ble publisert på Pages, kjører fortsatt den gamle helsamlings-skriveren til den lastes på nytt. Ved én slik handling kan den gjenopplive en slettet oppskrift og skrive en React-post under nøkkelen `undefined`. Last derfor alle åpne legacy-faner på nytt etter publisering, og før en sletting du vil stole på. Pass på faner på andre enheter også.

## 3. Les og bestem

En eksplisitt og entydig bestilling om å slette én bestemt oppskrift autoriserer slettingen (#27 6509067353). Bekreftede treff med kjent konsekvens (2) meldes uten en ny godkjenningsrunde. Bare tvetydig mål, tvetydig omfang, et endret grunnlag eller referanser som ikke kan avklares (3.4), stopper.

1. **Finn målet,** som i [`kokebok-navn.md`](kokebok-navn.md) §3.1. Det er to tilfeller:
   - **Oppslag etter navn:** `data_les { sti: "recipes" }`, med alle sider (følg `neste` til `null`). Bare nøkkel og `name` brukes.
     - Et barn som er `forStor`, leses på egen sti. Kan det fortsatt ikke leses, eller er `name` ikke tekst, stopper du og ber om eksplisitt målvalg.
     - Treff er oppskrifter der `name` er lik det oppgitte navnet etter trimming og uten hensyn til store og små bokstaver. Krev nøyaktig ett treff.
   - **Utpekt eller observert mål:** målet bindes til **nodenøkkelen**, som er autoritativ. Er nøkkelen oppgitt uten navn, kreves ikke et navn brukeren aldri oppga.
2. **Omfanget må være én hel oppskrift,** som i «slett Taco fra Kokeboken».
   - «Rydd», «fjern duplikater» eller flere navn: stopp og spør om én oppskrift om gangen.
   - Gjelder bestillingen en dag i middagsplanen eller en bibliotekvariant, er det ikke denne arbeidsflyten.
3. **Grunnlaget:** `data_hent { sti: "recipes/<nøkkel>" }`. Slettingen bygger bare på denne lesingen.
   - **Bekreftet fravær** krever et vellykket svar med `finnes: false` (`versjon: "mangler"`). Det betyr at oppskriften **ikke finnes**. Før første skriveforsøk sier det ingenting om at den er slettet tidligere. Stopp, og meld at den ikke finnes.
   - **Feil fra verktøyet, `forStor`, eller et svar uten `verdi` og `versjon`** er ikke fravær og ikke et grunnlag. Stopp uten skriving, og meld grunnen.
   - Ellers gir svaret `verdi` og `versjon` fra **samme** lesing.
   - **Navneoppslag:** `name` må fortsatt treffe det oppgitte navnet. Er posten omdøpt, er grunnlaget endret. Avklar målet.
   - **Observert grunnlag:** bygger bestillingen på noe som er vist tidligere i samtalen, valideres det mot `verdi` fra **denne** lesingen. Avviker det, er grunnlaget endret. Vis den nye tilstanden, og avklar før skriving.
   - **Lagret `id`-felt:** bare når feltet finnes, må det være likt nøkkelen sammenlignet som tekst (`String(id)`). Ellers stopper du, fordi identiteten er uklar for `index.html`. Eldre poster uten `id`-felt er gyldige, som i [`kokebok-navn.md`](kokebok-navn.md) og #134.
4. **Referanser vurderes uten å endres.** Les `data_les { sti: "mealLibrary" }` og `data_les { sti: "meals" }`, med alle sider. Klassifiser hver referanse etter 2:
   - **Direkte:** dagverdier og menyelementer med `recipeId` lik nøkkelen, og bibliotekvarianter med `source: "recipe"` og `recipeId` lik nøkkelen.
   - **Indirekte:** dagverdier og menyelementer med `recipeId: null` der bibliotekmiddagen (via `mealLibraryId`, ellers navn) har en løst variant som peker på nøkkelen. Det er valgt `variantId`, eller den eneste varianten.
   - **Navnetreff:** strengverdier for dager som er lik oppskriftens navn. Noter om det finnes en bibliotekmiddag med samme navn, og hva den gir.
   - **Ukjent dekning:** et barn som fortsatt er `forStor` eller uleselig på egen sti, en side som ikke kan leses, en dagverdi med ukjent form, eller flere bibliotekmiddager med samme navn der en referanse bare har navn.

   **Stopppunkt før `data_skriv`:** er det ukjent dekning, eller et treff der konsekvensen ikke kan avgjøres, skrives ingenting. Meld hva som ikke kunne avklares, og be brukeren avgjøre. Sidene er ikke ett øyeblikksbilde, så tellingen er en kontroll før skriving og ikke en garanti for nåtilstanden.

5. **Meld hva som slettes,** med navn og nøkkel og referansene per klasse, med konsekvensen fra 2. For eksempel: «Taco slettes. 1 dag peker direkte og 1 dag via bibliotekmiddagen Taco. De får ingen varer fra Taco i handlelisten. 1 bibliotekvariant vises som ‹Oppskrift fjernet›.» Dette er en melding, ikke et nytt spørsmål.

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
- **Nåtilstanden** kommer fra en separat, fersk `data_hent { sti: "recipes/<nøkkel>" }`.
  - **Verifisert fravær** er bare et vellykket svar med `finnes: false`.
  - **Feil, `forStor` eller et ufullstendig svar** gir nåtilstanden «ikke verifisert». Det er ikke fravær.
- **Finnes noden likevel,** meldes det med utfall og nåtilstand hver for seg. Påstå ingen årsak. Noden slettes ikke på nytt uten en ny eksplisitt bestilling.
- **Referansene** leses ikke på nytt og endres ikke. Meld brukeren tellingen fra 3.4 og hva de nå viser (2).

## 7. Kodeankre og tester

- **Kontrakt:**
  - `web/src/data/recipes.repository.ts` (`transactRecipeMedUtfall`, `raattGrunnlag`, `subscribeRecipes`);
  - `web/src/domain/recipes/recipes.ts` (`slettHvisUendret`, `sletteTekst`);
  - `web/src/hooks/useRecipes.ts` (`slettRecipe`);
  - `web/src/features/hverdagsflyt/mat/kokebok/RecipesScreen.tsx`;
  - `web/src/domain/meals/meals.ts` (`resolveActiveVariant`, `resolveActiveRecipeId`);
  - `web/src/generators/shopping/shopping.ts` (`resolveMealShoppingItems`, `resolveLibraryConcept`);
  - `MealLibraryScreen.tsx`;
  - `index.html` (~3977, og `skrivOppskrift` for legacy-Kokebokens skrivinger).
- **Eksisterende dekning:**
  - `recipes.repository.integration.test.ts` dekker «Slett» mot emulatoren: uendret, endret (navn, ingrediens, «Bekreft middag», ukjent toppfelt), fjernet og råfelt (#151);
  - `shopping.test.ts` dekker `not-found` og 0 varer for en konkret `recipeId`, og for et bibliotekskonsept med én recipe-variant uten oppskrift (det indirekte tilfellet);
  - `mcp-server/src/store/dataSkriving.integration.test.ts` dekker `slett`, konflikt, replay og tilbakelesing.
- **Ny syntetisk karakterisering:**
  - `MealLibraryScreen.test.tsx`: en variant som peker på en slettet oppskrift, vises som «Oppskrift fjernet»;
  - `RecipesScreen.test.tsx`: `?apne=<id som ikke finnes>` viser listen uten krasj;
  - `shopping.test.ts`: det indirekte eksemplet i 2 via `mealLibraryId` gir 0 varer og `not-found`, og en meny med én slettet oppskrift mister bare den referansen (review 5858632988).
