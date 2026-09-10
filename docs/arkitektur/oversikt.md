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
(`src/features/hverdagsflyt/mat/handleliste/`), **Middagsbibliotek**
(`src/features/hverdagsflyt/mat/bibliotek/`) og **Middagsplan**
(`src/features/hverdagsflyt/mat/plan/`, inkludert Handlelistegeneratoren
som en modal derfra) — hele den vertikale skiven for alle fem
skjermfanene, nåbar via en intern fane-navigasjon for Mat-området
(`MatLayout`, portert fra `MatScreen` sin fanebar). Alle fanene i
Mat-området har nå sin egen migrerte skjerm, og Middagsplan har i
tillegg fått to produktintegrasjons-skiver (Førsteutkast/variasjon/
lettvint, og måltidsavvik/feedback, se under).

**Teknisk avhengighetskartlegging — innkjøpsdelen av Mat (Issue #2,
kommentar 5588333337):** en kort kartlegging (ingen kode) av forholdet
mellom Middagsbibliotek, Kokebok, `shoppingBase`, den delte varebasen
(`items`/`Vare`) og Fryser/fremtidig Matlager, bestilt av Kontrolltårnet
etter måltidsavvik/feedback-skiven. Konkret, verifisert funn: Kokebok-
ingredienser gikk gjennom samme `ItemPicker`-flyt som Fryser/Bibliotek,
men `itemId` (og faktisk resolvert kategori) ble forkastet ved lagring —
`Ingredient` hadde ingen kobling til den delte varebasen i det hele tatt,
til tross for at UI-en så ut til å støtte det. Helen godkjente en
førsteskive for å rette akkurat dette (se under); de større spørsmålene
(eksplisitt variantmodell, `MealLibraryEntry`→`Recipe`-referanse,
Matlager) venter fortsatt på egen scoping.

**Variantmodell, ellevte skive (2 av 2, variant-bevisst generator/resolver,
fortsatt ingen UI):** `resolveMealShoppingItems`/`generators/shopping/shopping.ts`
er nå variant-bevisst for bibliotekskonsepter (`recipeId:null`), 100 %
bakoverkompatibelt — all eksisterende oppførsel (direkte `recipeId`,
legacy fritekst-navnematch, bibliotekskonsept UTEN `variants`) er UENDRET,
bevist av at samtlige 21 opprinnelige karakteriseringstester for
`resolveMealShoppingItems`/`buildShoppingItems` fortsatt passerer uendret.
Ny, delt intern `resolveLibraryConcept`-helper (brukt av BÅDE
`resolveMealShoppingItems` og den nye `resolveMealShoppingStatuses`, se
under) håndterer tre tilfeller for et bibliotekskonsept:
- ingen `variants` → UENDRET, den flate `shoppingBase` er handlegrunnlaget.
- NØYAKTIG 1 variant → auto-resolveres uten brukerbeslutning ("systemet
  gjør førsteutkastet") — `source:"recipe"` slår opp den konkrete
  Kokebok-oppskriften, `source:"shoppingBase"` bruker variantens eget
  handlegrunnlag.
- 2+ varianter, ingen valgt (`MealValue.variantId` finnes bevisst IKKE i
  denne skiven — det er skive 3/4 sitt UI-koblingsarbeid) → uløst, gir `[]`
  for handlegrunnlaget, ALDRI en vilkårlig fallback (f.eks. første variant
  eller den flate `shoppingBase`).

En manglende/slettet oppskrift-referanse (variant med `source:"recipe"`
som peker på en fjernet `Recipe`) degraderes kontrollert til 0 varer for
akkurat den referansen — samme presedens som konkret `MealRecipeRef.recipeId`
uten treff, aldri en krasj.

**Ny eksportert `resolveMealShoppingStatuses`** (§types/shopping.ts sin
`MealShoppingResolutionStatus`, diskriminert `resolved`/`unresolved`/
`not-found`) — et rent, separat statusblikk PÅ SIDEN AV det uendrede
`ResolvedShoppingIngredient[]`-outputet, én status per oppskrift-referanse
(en meny kan ha flere), slik at en senere UI kan skille "uløst
variantvalg" (2+ varianter, ingen valgt) fra "resolvert, men faktisk tomt
handlegrunnlag" uten å måtte gjette ut fra et tomt items-resultat
(§Kontrolltårn-handoff, Issue #2, kommentar 5609739877 — eksplisitt bedt
om en "diskriminert ren resolver-resultattype" som forberedelse for senere
UI, uten selv å bygge UI-en). `unresolved` bærer `libraryEntryId`/
`libraryEntryName`/`variantCount`; `not-found` bærer navnet det ble slått
opp på. Ingen skjerm leser denne statusen ennå.

**Bevisst utenfor denne skiven** (samme kommentar): `MealValue.variantId`,
variantvelger, CRUD-UI for varianter, endringer i Middagsplan. Denne
skiven gjør kun generator-/resolverlaget klart for det allerede låste
variantvalget — den modellerer eller viser ikke selve valget.

**Variantmodell, tiende skive (1 av maks 2, inert datamodell):** ny
valgfri `MealVariant`/`MealLibraryEntry.variants` (§types/shopping.ts),
nøstet på biblioteksmåltidet — samme mønster som `shoppingBase`, siden en
variant aldri gir mening løsrevet fra sitt konsept. `MealVariant` er en
DISKRIMINERT union på et eksplisitt `source: "recipe" | "shoppingBase"`-
felt (§domain/mealLibrary/mealLibrary.ts sin `NewMealVariant`/
`MealVariantPatch`): en variant sourcer enten fra en KONKRET Kokebok-
oppskrift (`recipeId: string`) eller har eget `shoppingBase`, ALDRI begge,
håndhevet av TypeScript selv fremfor en runtime-sjekk som kan glemmes.
`recipeId` er bevisst IKKE nullbar (§Nattvakt-review, PR #18, første
runde): ulikt `MealValue.recipeId:null`, som betyr "bibliotekskonsept
valgt, konkret løsning ikke bestemt ennå" på planleggingsnivå, ER en
variant selve løsningen — å tillate `recipeId:null` også her ville innført
en ny, unødvendig "uløst variant"-tilstand oppå den allerede gyldige
"konsept uten variant"-tilstanden.

`source` er ALLTID satt eksplisitt av kalleren, ALDRI utledet fra om
`shoppingBase`-nøkkelen finnes på det leste objektet (§Nattvakt-review,
PR #18, andre runde — funnet før merge): RTDB dropper tomme arrays ved
skriving (samme kjente oppførsel som flat `shoppingBase`), så en FERSK
handlegrunnlag-kildet variant (`shoppingBase: []`, ingen varer lagt til
ennå) ville ellers blitt lest tilbake som en (ugyldig) oppskrift-variant
med `recipeId: undefined` — et konkret round-trip-databrudd, ikke bare en
teoretisk bekymring, siden "opprett variant, legg til varer etterpå" er en
helt naturlig brukerrekkefølge. `parseMealVariant` avgjør derfor gren på
`raw.source`, med `shoppingBase` normalisert til `[]` når nøkkelen mangler
(dekket av en egen integrasjonstest for nettopp dette tilfellet). `recipeId`
trenger INGEN tilsvarende `null`-normalisering, ulikt `ShoppingBaseItem.itemId`,
fordi feltet aldri er nullbart.

`addVariant`/`updateVariant`/`removeVariant` speiler `shoppingBase`-
mutasjonenes eksisterende mønster (kallergenerert id, tom liste — ikke
`undefined` — når siste variant fjernes). `updateVariant` bytter HELE
kilden ved et `source`-patch (fjerner den andre helt, ikke bare objekt-
spredning ved siden av) for å bevare eksklusiviteten når en variant bytter
kilde.

**Bevisst inert i denne skiven** (§Kontrolltårn-handoff, Issue #2,
kommentar 5608057944 — presisering 2): INGEN endring i
`resolveMealShoppingItems`/generatoren, INGEN `MealValue.variantId`,
INGEN CRUD-UI, INGEN migrering av eksisterende `shoppingBase`. Et
biblioteksmåltid uten `variants` fortsetter å oppføre seg 100 % som i
dag — den flate `shoppingBase` ER handlegrunnlaget, ingen implisitt
"variant 1" å konvertere til. Presisering 1 fra samme kommentar: flat
`shoppingBase` er IKKE låst som permanent parallell modell for alltid —
kun bakoverkompatibilitet og null datatap er kravet nå; om den fases ut
senere er en åpen avgjørelse, ikke tatt her.

**Ingredient↔Vare-koblingen, niende skive:** `Ingredient` (§types/recipe.ts)
har nå et valgfritt `itemId?: string | null` — samme identitet som
`FreezerItem.itemId`/`ShoppingBaseItem.itemId` allerede bruker
(§types/vare.ts). `RecipeFormModal.tsx` og `QuickAddRecipeModal.tsx` sin
`rowsToIngredients()` persisterer nå faktisk `itemId`+resolvert kategori
fra radtilstanden (`ItemPicker`) i stedet for å forkaste `itemId` og
hardkode `cat:"Diverse"`. `RecipeFormModal.tsx` sin `ingredientToRow()`
(brukt ved REDIGERING av en eksisterende oppskrift) er rettet tilsvarende
— den hardkodet tidligere `itemId:null, cat:""` uansett hva ingrediensen
faktisk hadde, som ville nullet ut en allerede lagret varekobling stille
ved neste lagring av en urørt rad. Ingen tvungen migrering — eldre
oppskrifter uten `itemId` fortsetter å fungere uendret (fraværende felt,
ikke en tvungen `null`). `generators/shopping/shopping.ts` trengte INGEN
endring — `resolveMealShoppingItems`/`buildShoppingItems` spredte allerede
`Ingredient`-feltene rett gjennom, så `itemId` flyter automatisk med når
det finnes.

**Produktintegrasjon — Måltidsavvik/feedback, åttende skive:** erstatter
legacy sin "✓ Bekreft middag"-tankegang (bekreft+vurder-modalen som
logget `events`/oppdaterte `lastCooked`/`timesCooked`) med den låste
livssyklusen fra Kontrolltårnet (Issue #2, kommentar 5585975593): en
passert dato regnes som at planen ble faktisk middag MED MINDRE et
eksplisitt avvik registreres — normaltilfellet krever INGEN handling,
ingen bekreftelse, ingen nattjobb.

Ny, separat, sparsom samling `families/{familyId}/mealFeedback/{weekKey}/{day}`
(§types/mealFeedback.ts) — rører ALDRI den låste `MealValue`-unionen eller
selve planen (`meals/{weekKey}/{day}`). `actual?: MealValue` er KUN satt
ved avvik (gjenbruker `MealValue`, inkludert `type:"menu"` for flere
retter); `feedback?: {wantAgain?, paused?, comment?}` er uavhengig
valgfri; hele posten er slettbar/nullstillbar for å falle tilbake til
normalregelen "plan = faktisk". `MealFeedbackModal`
(`src/features/hverdagsflyt/mat/plan/`) er en kompakt, rent lokal
draft-flyt — knappen ("💬") vises på Middagsplanens dagkort kun for
passerte dager med en (ikke-hendelse) middag.

`domain/meals/mealFeedback.ts` er den nye motoren som utleder FAKTISK
historikk (`buildEffectiveHistory`: plan + eventuelt avvik) og pausede
middager (`derivePausedMealNames`: siste eksplisitte `paused`-verdi PER
middagsnavn vinner, kronologisk på `recordedAt` — en senere `paused:false`
gjenåpner en tidligere pause). Bevisst INGEN `lastFeedback`-
denormalisering på `Recipe`/`MealLibraryEntry` (eksplisitt avvist av
Kontrolltårnet — "vi har ikke behov for å optimalisere dette før vi vet
at lesekost faktisk er et problem") — `deriveLastFeedbackForMeal` avleder
i stedet siste kommentar on-the-fly fra historikk kalleren allerede har
hentet, samme mønster som `sisteGangPlanlagt`.

`lastCooked`/`timesCooked` (§types/recipe.ts) forblir avledet-fremfor-
lagret per samme avgjørelse: kartlagt at INGEN skjerm i `web/` leser
disse feltene ennå (kun `markRecipeCooked`, som ikke er koblet til noe
UI) — ingen skrive-on-read-migrering var derfor nødvendig i denne skiven.
En fremtidig skjerm som trenger å VISE "sist laget"/"antall ganger" skal
bruke en avledet funksjon over `meals`+`mealFeedback`, ikke lese de
lagrede feltene.

**Viktig integrasjon med forrige skive:** `genererForsteutkast`/
`sorterBibliotekEtterHistorikk` (§domain/meals/forsteutkast.ts) rangerer
nå mot FAKTISK historikk (ikke den rå planen) og ekskluderer pausede
middager helt fra kandidatpoolen — samme "automatisk forslag"-grense som
lettvint-filtreringen allerede hadde. `ForsteutkastPanel` sin bytteflyt
viser i tillegg siste registrerte kommentar for hver kandidat —
"familieerfaring vises neste gang middagen velges, før shopping"
(§Kontrolltårn-handoff).

**Produktintegrasjon — Førsteutkast/variasjon/lettvint, syvende skive:**
Den FØRSTE skiven som ikke er ren teknisk migrering — en eksplisitt
godkjent produktbeslutning fra Kontrolltårnet (Issue #2), etter en egen
implementeringsklarhetskartlegging og et modellforslag. `ForsteutkastPanel`
(`src/features/hverdagsflyt/mat/plan/`, åpnet fra Middagsplan sin "✨
Foreslå middager"-knapp) dekker planperiode-beregning, en NY
rangeringsalgoritme (historikk + variasjon + lettvint, IKKE en 1:1-port
av index.html sin `genererForsteutkast`/`sorterBibliotekEtterHistorikk`
— se `domain/meals/forsteutkast.ts` sin egen toppkommentar for hvorfor),
og bytteflyten.

`domain/meals/planningPeriod.ts` (`finnNesteTorsdag`/`beregnPlanperiode`/
`beregnAktivPlanperiode`) ER en 1:1-karakterisering — bekreftet uendret
av Kontrolltårnet: aktiv planperiode er fortsatt torsdag→torsdag. Ny
`src/hooks/useMealsRange.ts` abonnerer på flere ukers middagsplan samtidig
(et rent datahentings-vindu — 8 uker bakover + inneværende/neste uke —
IKKE en forslags-terskel) for historikk-basert rangering, som en enkelt
`useMeals` ikke dekker.

Ny, eksplisitt godkjent datamodellutvidelse (§types/recipe.ts,
§types/shopping.ts): `lettvint?: boolean` og `variationTags?: string[]`
på BÅDE `Recipe` og `MealLibraryEntry` — delt, valgfritt, manuelt merket
(ingen bulk-/automatisk klassifisering). `variationTags` er bevisst IKKE
det samme som fritekst-`tags` (som brukes som FALLBACK der
`variationTags` mangler) — unngår skjult avhengighet av familiens egen
taggevaner, og gir Middagsbiblioteket (som ikke har `tags`) et eget
signal. Ny UI for å merke begge feltene i `RecipeFormModal`/
`MealLibraryScreen`.

**Reell funn og fiks under implementeringen:** `mealLibrary.repository.ts`
sin transaksjons-`payload`-bygging hvitlistet opprinnelig KUN `name`/
`shoppingBase` — de to nye feltene ble derfor systematisk STRØKET fra
hver skriving, og `parseMealLibraryEntry`/`parseRecipeFields` leste dem
heller ikke inn. Oppdaget av en E2E-test sin `.check()`-handling på
lettvint-avkrysningsboksen, som aldri observerte at tilstanden faktisk
endret seg. Begge repository-filene er rettet, med regresjonstester i
sine respektive integrasjonstest-filer.

**Fase 2 (skjermmigrering) — Delt oppskriftsåpning, sjette skive:**
`RecipesScreen` leser nå et `?apne=<recipeId>`-søkeparameter ved mount
(§`useSearchParams`) og åpner sin allerede eksisterende detaljvisning
direkte — erstatter dagens `window.__openRecipe`/`setTimeout`-bridge
(index.html linje ~2275–2277, ~4809), en skjør, tidsbasert global-
bridge mellom `MatScreen` og `RecipesScreen`. Middagsplan sin
"📖"-snarvei (§PlanScreen.tsx) er lagt tilbake — vises kun når dagens
FØRSTE rett har en konkret `recipeId` (aldri for biblioteksmiddager,
som ikke har noen Kokebok-oppskrift å åpne) — og navigerer dit via
`react-router-dom` sin `<Link>`. Ingen datamodell-endring, ingen
produktbeslutning — ren teknisk erstatning av et legacy-mønster med et
idiomatisk React Router-mønster, identifisert som implementeringsklar i
en implementeringsklarhetskartlegging (Issue #2) og eksplisitt bekreftet
uten produkt-/datamodellblokkering av Kontrolltårnet.

**Fase 2 (skjermmigrering) — Handlelistegenerator-skjermen, femte skive:**
`ShoppingGeneratorModal` (`src/features/hverdagsflyt/mat/plan/`, kalt fra
Middagsplan sin "🛒 Lag handleliste"-knapp) er funksjonelt likeverdig med
dagens `ShoppingGenerator` (index.html linje ~2742–3021): velg hvilke
kommende, ikke-hendelse-middager (denne uken + neste) som skal handles
for, hent og grupper ingrediensene per kategori, fjern/rediger
mengde/enhet/kategori i gjennomgangen, "basisvare?"-spørsmål ved fjerning,
og legg til i handlelisten. Ren skjerm-UI over motorlogikken som allerede
var migrert og karakterisert i Fase 1/PR #5
(`buildShoppingItems`/`mergeShoppingItems`/`toShoppingListEntry`,
§generators/shopping/shopping.ts) — ingen ny motorlogikk i denne skiven.

Nye `useStaples`/`useItemHistory`-hooks (tynne bindinger over allerede
migrerte `staples.repository.ts`/`itemHistory.repository.ts`) og en ny
skrivefunksjon, `addBatchToShoppingList` (§data/shopping.repository.ts) —
skrivesiden av `mergeIntoShoppingList` som var bevisst utelatt helt siden
Fase 1 (§shopping.repository.ts sin daværende toppkommentar: "krever en
flerpost-batch-skriving... en reell designbeslutning om batch-strategi").
Bekreftet under kartleggingen at `import/no-restricted-paths` faktisk KUN
hindrer `src/data/**` fra å importere `src/generators/**` — ikke
`src/hooks/**` — så løsningen som allerede var pekt ut ("en
hook-lag-skive") var farbar uten arkitekturendring.

`addBatchToShoppingList` velger bevisst IKKE én hel-samling-transaksjon
(som ville speilet `mergeIntoShoppingList` sin rene fold 1:1), men
verifiserer hver dedup-kandidat mot ferskeste servertilstand i sin EGEN
transaksjon før mengden slås sammen — samme per-post-prinsipp som resten
av datalaget. Funnet under implementering, samme feilklasse som
`toggleShoppingItemDone`/`transactMealDay`/`transactMealLibraryEntry` sine
tilsvarende funn: en tidlig versjon returnerte `undefined` fra
transaksjons-updateren for "posten er borte"/"ingen tallsammenslåing er
aktuell"-tilfellene, som permanent avbrøt transaksjonen på et
speculativt (kaldt cache-)gjett i stedet for å la Firebase prøve på nytt
mot den ekte server-verdien — to av de nye integrasjonstestene feilet
umiddelbart og avdekket dette. Rettet til å alltid returnere en KONKRET
verdi (`null`, eller `current` urørt), og heller skille "slo sammen/lot
stå urørt" fra "kandidaten er faktisk borte" ved å sjekke
`result.snapshot.exists()` ETTER transaksjonen (i stedet for
`result.committed`, som ikke lenger er brukbart til dette når updateren
aldri avbryter).

Bevisst, dokumentert forenkling: to nye varer i SAMME batch-kall med
samme navn (men ulik enhet — kan overleve `mergeShoppingItems` sin
navn+enhet-dedup) slår seg IKKE sammen med hverandre slik dagens
sekvensielle `mergeIntoShoppingList`-fold ville gjort — et allerede
dokumentert, kjent avvik i den porterte motoren selv. Hver ny vare
matches kun mot det opprinnelige `existing`-øyeblikksbildet.

**Fase 2 (skjermmigrering) — Middagsplan, fjerde skive (kjerne):**
`PlanScreen` dekker uke-navigasjon og dag-CRUD (velg oppskrift eller
bibliotekmiddag, flere retter samme dag («menu»), fritekst, marker dagen
som hendelse, fjern dagen) — funksjonell paritet for dette, bygget på
motorfunksjonene i `domain/meals/meals.ts` som allerede var karakterisert
og portet i Fase 1 (PR #4). Ny `src/hooks/useMeals.ts`-utvidelse
(`addRecipeToDay`/`removeRecipeFromDay`/`setDayToEvent`/`setDayToText`/
`clearDay`) komponerer `transactMealDay` med disse motorfunksjonene,
samme mønster som `useFreezer`/`useMealLibrary`. Ny `getDayDate` i
`domain/shared/weekKey.ts` (portert fra index.html sin `getDayDate`,
linje ~785) gir dagens faktiske kalenderdato ut fra `weekKey`+dagindeks.

Bevisst UTENFOR denne skiven, per §Kontrolltårn-handoff sin
pre-implementeringskartlegging av `PlanScreen` (samme grense som
`domain/meals/meals.ts` sin egen toppkommentar allerede satte): "✨
Foreslå middager" (Førsteutkast/variasjonsmotoren —
`beregnAktivPlanperiode`/`genererForsteutkast`/bytteflyten), "✓ Bekreft
middag" (bekreft+vurder-flyten som logger `events` og oppdaterer
oppskriftens `lastCooked`/`timesCooked` — automatisk historikk/feedback,
ikke låst produktfasit), "🛒 Lag handleliste" (`ShoppingGenerator` — egen,
senere skive) og bibliotekets historikk-sorterte standardforslag når
søkefeltet er tomt (avhenger av `sorterBibliotekEtterHistorikk`, samme
blokkerte motor). Ingen av disse har en teknisk erstatning i denne
skiven — utelatt, ikke fjernet som konsept. "📖"-snarveien for å åpne en
oppskrift direkte fra en dagcelle er også utelatt (krever et delt
"åpne oppskrift"-konsept på tvers av skjermer som ikke finnes ennå) —
en bevisst mindre bekvemmelighet, ikke en regresjon.

**Kjent regresjon rettet, ikke bevart:** dagens "＋ Rett"-knapp (legg til
enda en rett på en dag som allerede har middag) vises i `index.html` KUN
på dager ANNET enn i dag (`!isToday`-vakt, linje ~3671) — en ren
UI-innsnevring uten grunnlag i domenelaget (`addRecipeToMeal` har ingen
slik vakt). Per §Kontrolltårn-handoff er `menu`/flere retter en gyldig,
allerede karakterisert modell som ikke skal begrenses videre — knappen
vises derfor i den nye skjermen på ALLE dager, inkludert i dag.

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

**Datalag migrert (full CRUD):** **Basisvarer** (`src/data/staples.repository.ts`,
`families/{familyId}/staples`) — `subscribeStaples` (lesing, PR #5) pluss
`markItemAsStaple` (skriving), ett målrettet `set(true)` på varens egen
nøkkel. Eneste skriving i hele dagens kode (`ShoppingGenerator.confirmStaple`)
var allerede uten samtidighetsrisiko — ingen les-før-skriv, ingen "fjern
basisvare"-motstykke finnes. Koblet til fra `ShoppingGeneratorModal` sin
gjennomgangssteg i Fase 2 (§Handlelistegenerator-skjermen over).

Generatorens "legg til flere varer samtidig"-flyt
(`MatScreen.onAddToList`/`mergeIntoShoppingList`) er nå koblet til
Firebase — se `addBatchToShoppingList` (§Handlelistegenerator-skjermen,
Fase 2, over) for skrivestrategien og hvorfor en hook-lag-skive var
riktig løsning på modulgrense-blokkeringen dette avsnittet opprinnelig
beskrev.

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
