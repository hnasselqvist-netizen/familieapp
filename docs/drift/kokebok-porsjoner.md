# Arbeidsflyt: korriger grunnporsjonene på én Kokebok-oppskrift (ChatGPT via MCP)

Dette er roadmap «Praktisk vedlikehold via ChatGPT», bestilt i #27 (6770296542).

Arbeidsflyten setter **bare `servings`** (grunnporsjonene) på **én entydig eksisterende** oppskrift i Kokeboken til et nytt heltall på minst 1. Det skjer bare etter eksplisitt bestilling fra brukeren, og **ingrediensmengdene står uendret**. Den bruker bare `data_les`, `data_hent` og `data_skriv` (`mcp-server/README.md` §«Generell skriving»).

Den gjør ikke noe av dette:

- skalerer ingrediensene, eller endrer andre felt på oppskriften;
- setter grunnporsjonene til ukjent (0);
- oppdaterer middagsplanen, Middagsbiblioteket eller handlelisten;
- endrer `updatedAt` eller det lagrede `id`-feltet.

## 1. Korrigering er ikke skalering

- **`servings` er grunnen for de lagrede mengdene.** Ingrediensene lagres som tekst, for eksempel `"400 g"`, og gjelder for `servings` porsjoner.
- **Skalering er ren visning** (låst, designbok §3.1: «Skalering er ren visningslogikk — lagret data endres ikke»). `RecipeIngredients` starter visningen på grunnporsjonene og regner om bare det ledende tallet i hver mengde med `scaleIngredientAmount(mengde, servings, valgt)`. Ingenting lagres.
- **En korrigering** sier at de lagrede mengdene gjelder for et annet antall porsjoner enn det som står. Bare `servings` endres. «400 g kjøttdeig» står fortsatt, men betyr nå 400 g for N porsjoner.
- **En skalering** («gjør den til 6 porsjoner», «dobbel oppskrift») ville endret mengdene. Det er ikke denne arbeidsflyten, og det finnes ingen skrivevei for det i appen. Brukeren kan skalere i visningen med ＋/−.

## 2. Appens lagring og forbrukere

Verifisert mot fersk `main` (`228f740`).

- **Lagring.** `servings` er et tall på `recipes/{id}`. Det skrives på tre måter:
  - **«Rediger oppskrift»** (`RecipeFormModal.save` → `useRecipes.updateRecipe` → `transactRecipe` med `{ ...current, ...patch }`) skriver `Number.parseInt(servings, 10) || 4`.
    - Et lagret 0 vises som et tomt felt med plassholder «4», og blir 4 ved neste lagring, også når feltet ikke røres.
    - Tomt felt og 0 blir 4. Desimaltall avkortes («2.5» → 2). Et negativt tall lagres som det er.
  - **Hurtigregistrering** (`QuickAddRecipeModal`) skriver `servings: 0`, som betyr ukjent.
  - **Oppskrift fra bilde** ([`oppskrift-fra-bilde.md`](oppskrift-fra-bilde.md)) skriver 0 når antallet er ukjent.
- **Lesing.** `parseRecipeFields` kopierer `servings` uten kontroll. Et manglende felt blir `undefined`.
- **Forbrukere.** Bare Kokeboken leser feltet:
  - **Listen og detaljen** i `RecipesScreen` viser `{servings} pers`. Et lagret 0 vises som «0 pers».
  - **Ingrediensvisningen** `RecipeIngredients` bruker `servings || 0` som grunn:
    - Er grunnen over 0, vises ＋/− og «N pers». Visningen starter på grunnen, og de lagrede mengdene vises uendret.
    - Er grunnen 0, mangler eller er negativ, finnes ingen skalering. Mengdene vises som lagret.
    - Porsjonstallet i en **åpen** visning er tilstand. Endres grunnporsjonene mens oppskriften er åpen, beholdes det valgte tallet, men det regnes fra den nye grunnen. Ved neste åpning starter visningen på den nye grunnen.
- **Ingen andre forbrukere.** Disse leser ikke `servings`:
  - middagsplanen (`meals`, `AddToPlanCard`, «Bekreft middag» via `markRecipeCooked`);
  - Middagsbiblioteket;
  - handlelistegeneratoren, som tar mengdene uskalert fra `getIngredients`;
  - MCP-serverens verktøy.

  En korrigering endrer derfor verken planlagte dager, biblioteket eller handlelisten.

- **`index.html`** leser og skriver feltet på samme måte (skjema `parseInt || 4`, skalering fra `servings || 0`).
- **Råfelt og identitet.** `transactRecipe` fletter med den rå posten (`medBevarteFelt`, #134). Det lagrede `id`-feltet og felt appen ikke kjenner, står uendret. Stabil identitet er nodenøkkelen `recipes/{id}`, som i [`kokebok-navn.md`](kokebok-navn.md) §1. `updatedAt` settes ikke av redigeringsveien.
- **Hele skjemaet sendes.** En porsjonsendring i appen skriver også de andre skjemafeltene i normalisert form. Arbeidsflyten endrer bare `servings`.

## 3. Speiling, og hvor grenen stoppes

Arbeidsflyten speiler appens redigering av feltet for et gyldig heltall, og ellers ingenting av normaliseringen.

| Bestilling eller tilstand                                                        | Handling                                                                                                          |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Nye grunnporsjoner N (heltall ≥ 1) på én entydig oppskrift, med mengdene uendret | Støttes (4–7). Det gjelder også når dagens verdi er 0 eller mangler.                                              |
| «Skaler», «gjør den til N porsjoner», «dobbel oppskrift», eller endrede mengder  | **Stopp.** Det er skalering, ikke korrigering (1). Vis ＋/− i oppskriften.                                        |
| Bestillingen sier ikke om mengdene gjelder for N, eller skal regnes om til N     | **Avklar** før skriving.                                                                                          |
| N er 0, tomt eller «ukjent»                                                      | **Stopp.** Appens redigering lagrer aldri 0, men gjør det om til 4. Å sette ukjent er ingen ordinær handling.     |
| N er ikke et heltall, eller er negativt                                          | **Stopp** og spør. Appen ville avkortet eller lagret et negativt tall uten skalering. Arbeidsflyten gjetter ikke. |
| N er likt dagens `servings`                                                      | Ingenting skrives. Meld at grunnporsjonene allerede er N.                                                         |
| Dagens `servings` finnes, men er ikke et tall                                    | **Stopp** og meld lagringsformen. Den er ikke laget av appen.                                                     |
| Ingen eller flere oppskrifter treffer navnet                                     | **Stopp**, og be om eksplisitt målvalg.                                                                           |
| Lagret `id`-felt som avviker fra nøkkelen (som tekst)                            | **Stopp.** Identiteten er uklar for `index.html`.                                                                 |

## 4. Les og bestem

En eksplisitt og entydig bestilling autoriserer skrivingen (#27 6509067353). Bare tvetydig mål, uklart om det er korrigering eller skalering, eller et endret grunnlag avklares.

1. **Finn målet,** som i [`kokebok-navn.md`](kokebok-navn.md) §3.1:
   - **Oppslag etter navn:** `data_les { sti: "recipes" }`, med alle sider (følg `neste` til `null`). Bare nøkkel og `name` brukes.
     - Et barn som er `forStor`, leses på egen sti. Kan det fortsatt ikke leses, eller er `name` ikke tekst, stopper du og ber om eksplisitt målvalg.
     - Treff er oppskrifter der `name` er lik det oppgitte navnet etter trimming og uten hensyn til store og små bokstaver. Krev nøyaktig ett treff.
   - **Utpekt eller observert mål:** målet bindes til **nodenøkkelen**. Det som valideres, er nøkkelen og det observerte grunnlaget.

   Oppslaget gir bare en kandidat. Avgjørelsen tas i 2.

2. **Grunnlaget:** `data_hent { sti: "recipes/<nøkkel>" }` gir `verdi` og `versjon` fra **samme** lesing.
   - Mangler verdien, eller er den `forStor`, eller mangler `versjon`: stopp.
   - `name` må fortsatt treffe det oppgitte navnet, eller det observerte grunnlaget. Er posten borte eller omdøpt, er grunnlaget endret. Avklar målet.
   - Et lagret `id`-felt må være likt nøkkelen når det sammenlignes som tekst (`String(id)`).
   - `servings` må være et endelig tall, 0 eller mangle (3).
3. **Planlagt post:** en kopi av **hele** råverdien der bare `servings` er satt til N. Alle andre felt følger uendret:
   - ingredienser og grupper, med mengdene;
   - `id`, `updatedAt`, `createdAt`, `source`, `lastCooked` og `timesCooked`;
   - felt appen ikke kjenner.

   Meld hva som **planlegges**, for eksempel «Gryte: 4 → 2 porsjoner, mengdene uendret». Dagens 0 eller manglende verdi meldes som «ukjent». Bekreftet utfall meldes først i 7.

## 5. Skriv

1. Lag opId **én gang** etter `OPID` i `mcp-server/src/data/skriving.ts`: `ÅÅÅÅ-MM-DD_<suffiks>`, med UTC-dato og et tilfeldig suffiks på 8–80 tegn. opId og operasjonen noteres uendret.
2. Send `data_skriv { opId, ops: [{ sti: "recipes/<nøkkel>", type: "set", verdi: <planlagt post>, forventet: "<postversjonen fra samme data_hent>" }] }`.
   - Enhver endring i oppskriften etter lesingen gir `konflikt`, og ingenting skrives. Det gjelder også redigering, «Bekreft middag» og sletting i appen.
   - Delvis `update` på `servings` brukes ikke. `forventet` må ha nøyaktig de samme nøklene som `verdi` (`skriving.ts`), og ville bare vernet om porsjonstallet, ikke om mengdene det gjelder for.
3. **Kan ikke skrives tapsfritt.** Kopien kan ha noe `data_skriv` avviser: en ugyldig nøkkel, `__proto__`, `constructor` eller `prototype`, en tom liste eller et tomt objekt, eller en liste med hull. Da stopper du uten skriving og melder grunnen.

Eksempel (syntetisk). Råverdi på nøkkelen `"7"`:

```json
{
  "id": 7,
  "name": "Gryte",
  "servings": 4,
  "ingredients": [{ "name": "Kjøttdeig", "amount": "400 g", "cat": "Kjøtt" }]
}
```

Bestillingen «Gryte er egentlig for 2, mengdene stemmer» gir:

```json
{
  "sti": "recipes/7",
  "type": "set",
  "verdi": {
    "id": 7,
    "name": "Gryte",
    "servings": 2,
    "ingredients": [{ "name": "Kjøttdeig", "amount": "400 g", "cat": "Kjøtt" }]
  },
  "forventet": "<postversjonen fra samme data_hent>"
}
```

## 6. Utfall, konflikt og retry

Ingen utfall fører til en ny automatisk skriving.

| Utfall                             | Handling                                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `committed`                        | Les tilbake (7).                                                                                                                                                                                                                                 |
| `replay`                           | Allerede lagret med samme opId. Ingen ny skriving. Les tilbake.                                                                                                                                                                                  |
| `konflikt`                         | Oppskriften er endret eller slettet siden lesingen. Ingenting er skrevet. Les på nytt (4.2), og vis den nye tilstanden. Grunnlaget er endret, så det avklares med brukeren før en eventuell ny skriving med ny versjon og nytt opId.             |
| `ukjent_utfall`, `skriving_feilet` | Uavklart. Bare på brukerens forespørsel, og innenfor gyldighetsvinduet (30 dager, og etter `_mcp/vannmerke`), prøves det igjen med **samme opId og samme operasjon**, aldri nytt opId. Er `skriving_feilet` `vedvarende`, stopp og meld grunnen. |
| `utlopt`                           | Kvitteringen kan ikke lenger bevise utfallet, og det meldes som **uavklart**. Les uten å skrive. At `servings` nå er N, er et spor i nåtilstanden, ikke bevis for at dette opId-et lagret det. Avklar med brukeren før en eventuell ny skriving. |
| Andre feil                         | `ugyldig_skriving`, `invalid_path`, `beskyttet`, `for_stor`, `forelder_er_verdi`, `not_member` og `idempotency_conflict` skriver garantert ingenting. Meld grunnen.                                                                              |

## 7. Les tilbake og meld

- **Bekreftet utfall** er det `data_skriv` svarte: `committed` eller `replay`, med lagret versjon og `senereEndret` fra den innebygde tilbakelesingen.
- **Nåtilstanden** kommer fra en separat, fersk `data_hent { sti: "recipes/<nøkkel>" }`. Sammenlign hele posten med den planlagte.
- **Avvik** meldes som de er, med utfall og nåtilstand hver for seg. Påstå ingen årsak, og «rett» ingenting.
- **Meld brukeren:**
  - gamle og nye grunnporsjoner, og at mengdene er uendret;
  - at skaleringen i oppskriften nå regnes fra N;
  - at en oppskrift som allerede er åpen i appen, beholder porsjonstallet som var valgt, til den åpnes på nytt (2);
  - at middagsplan, bibliotek og handleliste ikke påvirkes.

## 8. Kodeankre og tester

- **Kontrakt:**
  - `web/src/types/recipe.ts`;
  - `web/src/data/recipes.repository.ts` (`parseRecipeFields`, `transactRecipe`, `medBevarteFelt`);
  - `web/src/domain/recipes/recipes.ts` (`scaleIngredientAmount`);
  - `web/src/features/hverdagsflyt/mat/kokebok/RecipeFormModal.tsx` (`save`), `QuickAddRecipeModal.tsx`, `RecipeIngredients.tsx` og `RecipesScreen.tsx`.
- **Eksisterende dekning:**
  - `recipes.test.ts` dekker `scaleIngredientAmount`, også grunn 0;
  - `recipes.repository.test.ts` og `recipes.repository.integration.test.ts` dekker at redigering bevarer lagret `id` og ukjente felt (#134);
  - `mcp-server/src/store/dataSkriving.integration.test.ts` dekker `set`, konflikt, replay og tilbakelesing.
- **Ny syntetisk karakterisering** (dekningshull: verken porsjonsfeltet i skjemaet eller ingrediensvisningen var testet):
  - `RecipeFormModal.test.tsx`: ny verdi lagres som heltall uten at mengdene endres; 0 vises tomt og blir 4; tomt og «0» blir 4, «2.5» blir 2 og «-2» lagres;
  - `RecipeIngredients.test.tsx`: visningen starter på grunnporsjonene med lagrede mengder; ny grunn med samme mengder gir samme visning, og skaleringen regnes fra den; 0 og manglende felt gir ingen skalering; en åpen visning beholder valgt porsjonstall.
