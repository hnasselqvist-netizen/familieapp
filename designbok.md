# Familieapp – Designbok

> **Appen skal alltid gjøre det lettere å velge enn å bekymre seg.**

> Dette er prosjektets fasit for designbeslutninger.
> Les dette før ny funksjonalitet bygges.
> Dokumentet oppdateres løpende når beslutninger tas.

---

## 1. Prosjektets sjel

### Visjon

Familieappen skal redusere den mentale belastningen ved hverdagslige beslutninger — ikke ved å automatisere alt, men ved å ta ansvar for overgangene mellom oppgaver.

Appen skal synliggjøre muligheter før problemer.

### Designprinsipper

1. **Brukeren registrerer informasjon én gang.** Data gjenbrukes av flere moduler.
2. **Motorene skal være enkle.** De beregner — ingenting annet.
3. **Generatorene gjør det tunge arbeidet.** De samler, filtrerer og strukturerer data til motoren.
4. **Flere innganger, én felles datastruktur.** Som i kokeboken: hurtigtekst, URL og bilde gir samme oppskriftsformat.
5. **Lav friksjon ved registrering.** Det skal ikke koste mer å registrere enn å la være.
6. **Data fra riktig tidspunkt.** Ikke alt trenger å registreres med en gang.
7. **Appen skal lære av faktisk bruk** — ikke av planer og intensjoner.

### Låste prinsipper

- En motor mottar kun en ferdig liste. Den har ikke ansvar for å generere innholdet i listen.
- Generatoren er alltid adskilt fra motoren.
- UI-et kan gruppere og presentere data på mange måter — datamodellen forblir flat og enkel.
- Brukeren skal alltid kunne se og slette alle poster som inngår i en beregning.
- Ingen hardkodede demo-poster i kildekoden.

### Designregler

Før en ny funksjon bygges, still disse spørsmålene:

1. Reduserer den en overgang?
2. Reduserer den mental belastning?
3. Gir den brukeren flere valgmuligheter?
4. Kan data gjenbrukes av andre moduler?
5. Er dette den minste endringen som gir størst gevinst?

Hvis svaret er nei på flere av disse, bør funksjonen vente.

6. **Hver ny funksjon skal spare mer energi enn den krever å lære.**
7. **Appen skal vise det brukeren ønsker å ta en beslutning om – ikke alt den vet.**
8. **Brukeren skal aldri måtte forstå den interne arkitekturen for å bruke appen.**
9. **Brukeren skal kunne fullføre én beslutning før appen flytter oppmerksomheten til neste.**

   Appen skal ikke flytte en oppgave til neste arbeidssteg før brukeren er ferdig med hele beslutningen.

   Eksempel: En banktransaksjon skal kunne få behandlingstype, kobles, og eventuelt læres — før den flyttes fra "Krever vurdering" til neste seksjon.

   Dette prinsippet gjelder generelt for hele appen, ikke bare Bankimport.

---

## 2. Arkitektur

### Motorer

En motor er en **ren funksjon** som tar en liste med strukturert data og returnerer et resultat. Motoren har ingen side-effekter og ingen forretningslogikk utover beregningen.

| Motor | Input | Output |
|---|---|---|
| Prognosemotor | Saldo + liste med prognoseposter + prognosedato | Spillerom |
| Matmotor (implisitt) | Ingrediensliste fra valgte oppskrifter | Handleliste |

### Generatorer

En generator er ansvarlig for å **produsere listen** som motoren mottar. Generatoren kan hente fra flere datakilder, filtrere, slå sammen og berike data.

| Generator | Datakilder | Output til |
|---|---|---|
| Handlelistegenerator | Middagsplan, kokebok, varehistorikk, basisvarer | Handleliste |
| Prognosepostgenerator (planlagt) | Budsjett, faste trekk, lønn, Mastercard, bankimport | Prognosemotor |

### Datakilder

Alle data lagres i Firebase Realtime Database under `families/familie1/`.

| Kilde | Sti | Beskrivelse |
|---|---|---|
| Middagsplan | `meals/{weekKey}/{day}` | Planlagte middager per dag per uke |
| Oppskrifter | `recipes/{id}` | Kokeboken |
| Handleliste | `shopping/{id}` | Aktiv handleliste |
| Varehistorikk | `itemHistory/{index}` | Alle varer lagt til handlelisten |
| Budsjett | `budget/{groupId}/{itemId}/{months, meta}` | Budsjett og faktisk per post per måned |
| Inntekter | `incomeGroups/{groupId}/{itemId}/{months, meta}` | Inntektsposter per måned, identisk struktur som budsjett |
| Hendelser | `events/{timestamp_uid}` | Logg: bekreftede middager, vurderinger |
| Basisvarer | `staples/{varenavn}` | Varer familien vanligvis har hjemme |
| Fryser | `freezer/{id}` | Fryserbeholdning med batches |
| Likviditet | `liquidity/` | Saldo, prognosedato, prognoseposter |

### Arbeidsflyter

**Matflyt:**
```
Oppskrift → Middagsplan → Handleliste → Fryser/Kjøleskap → Middag → Historikk
```

**Prognoseflyt:**
```
Datakilder → Generator → Prognoseposter → Prognosemotor → Spillerom → Beslutning → Historikk
```

---

## 2b. Appens tre lag

Arkitekturen er bygget rundt tre klart adskilte lag. Hvert lag har ett ansvar og kjenner bare til lagene under seg.

### Motor

Motoren vet ingenting om hvor data kommer fra. Den mottar data og returnerer et resultat. Motoren er alltid en ren funksjon.

Motoren skal:
- aldri hente data selv
- aldri skrive data
- aldri kjenne til Firebase
- aldri kjenne til UI
- aldri kjenne til generatoren

Motoren skal kunne testes med en liste inn og et svar ut.

**Eksempel:** Spillerommotoren mottar saldo, prognoseposter og dato. Den returnerer spillerommet. Ikke noe annet.

### Generator

Generatoren bygger datagrunnlaget motoren trenger. Generatoren kjenner datakildene og produserer listen motoren skal bruke. Generatoren gjør aldri beregninger selv.

Planlagte datakilder generatoren kan lese fra:
- Budsjett → prognoseposter
- Inntekter → prognoseposter
- Bankimport → faktiske poster
- OCR / kvitteringer → matposter og økonomiposter
- Manuelle prognoseposter

Alle datakilder produserer samme type prognoseposter. Motoren skal ikke vite hvilken datakilde en post kommer fra.

### Kontrollpanel

Kontrollpanelene brukes av mennesket. Her vedlikeholdes regler, metadata og prioriteringer. Kontrollpanelene påvirker generatoren, generatoren påvirker motoren, motoren påvirker beslutningene.

Eksempler på kontrollpaneler:
- Kostnader
- Inntekter
- Generator-senter

**Låst prinsipp:** Hvis ansvaret til en ny funksjon ikke er tydelig, skal den deles opp og plasseres i riktig lag før den bygges. Still alltid spørsmålene: Er dette en motor? Er dette en generator? Er dette et kontrollpanel?

---

## 2c. Generator-senter

Generator-senteret er kontrollpanelet for alle automatiske prognoseposter. Det er en administrasjonsside, ikke en beslutningsside.

Brukeren skal her kunne:
- se alle poster fra inntekter og kostnader samlet
- vedlikeholde metadata (eier, dag, konto, kilde, automatisk)
- oppdage manglende metadata raskt
- kontrollere hvilke poster generatoren bruker

Generator-senteret skal aldri utføre beregninger. Det gjør bare generatoren enklere å vedlikeholde.

**Nøkkelfeltet for Generator v2:** Forfallsdag er det feltet som gjør automatisk kjøring mulig. Generatoren kan ikke plassere en post i tid uten det. Alle automatiske poster bør ha forfallsdag satt i Generator-senteret før Generator v2 bygges.

---

## 2d. Kontantstrøm-prinsipp

Inntekter og Kostnader er søstermoduler og alltid to sider av samme sak.

De skal alltid ha samme:
- struktur og datamodell
- arbeidsflyt og redigeringsmønster
- metadata-oppsett
- visuelle språk og komponentvalg

Forskjellen er kun retningen på pengestrømmen, gruppene og standardpostene. Dette gjør vedlikehold enklere og appen lettere å lære.

**Firebase-paths:**
- Kostnader: `budget/{groupId}/{itemId}/{months, meta}`
- Inntekter: `incomeGroups/{groupId}/{itemId}/{months, meta}`

---

## 2e. Prioritet ved automatisering

Når en verdi kan komme fra flere steder brukes alltid denne prioriteten:

1. Manuelt overstyrt verdi (f.eks. `disponibelt`-feltet på inntektsposter)
2. Faktisk verdi (`spent`)
3. Budsjettverdi (`budget`)
4. Standardverdi

Brukeren skal alltid kunne overstyre automatiske forslag. Ingen automatikk skal kjøre uten at brukeren kan se og korrigere resultatet.

---

## 2f. Hverdagsflyt og Verktøy

Appen deles i to typer arbeidsflater.

### Hverdagsflyt

Hverdagsflyt består av modulene familien bruker i dagliglivet. Disse modulene skal hjelpe brukeren med beslutninger og handlinger mens livet skjer.

Eksempler:
- Mat
- Forvaltning
- Kalender
- Hjem

### Verktøy

Verktøy samler kontrollpaneler og administrasjon. Disse brukes til vedlikehold, opplæring av appen og restrukturering av data. Verktøy nås via Mer.

Eksempler:
- Generator
- Regler
- Metadata
- Kontoer

### Låst prinsipp

En bruker skal kunne fullføre en vanlig arbeidsoppgave uten å åpne Verktøy. Hvis en oppgave oppstår som en naturlig del av arbeidsflyten, skal den kunne fullføres der.

Eksempel: å behandle en banktransaksjon, lære en ny regel, eller koble en ny transaksjon skjer direkte i Bankimport (under Forvaltning) — ikke i Verktøy.

Verktøy brukes kun når brukeren ønsker å vedlikeholde eller administrere systemet.

---

## 2g. Regelmotor

Regelmotoren er en ren motor. Den mottar én transaksjon og alle regler, og returnerer beste match.

Motoren kjenner ikke:
- Firebase
- UI
- Bankimport

Bankimport bruker motoren. Regelsenter (kommer senere) vedlikeholder reglene.

Motoren gjør kun én ting: finne den beste regelen.

**Datamodell** (`families/familie1/rules/`): hver regel har `pattern` (original tekst), `normalizedPattern` (normalisert via `normaliserTransaksjonstekst()`), `type`, `targetType`/`targetId`/`targetName` (posten regelen peker mot), `mode` (auto/suggest/disabled/review), `confidence` (0–100), `timesUsed`, `lastMatched`, `multiUse` (stopper autokobling for leverandører med flere bruksområder), `active`.

**Matching**: eksakt treff på normalisert tekst gir høyest score, delvis inneholdt tekst gir middels score, felles nøkkelord gir lavest score. Scoren vektes med regelens egen `confidence`.

---

## 2h. Persistensmønster (låst)

All Firebase-synkronisert state i appen følger ett fast mønster, brukt likt av Kostnader og Inntekter:

**Lesing** — én `listen(path, setter)`-registrering per Firebase-path, satt opp i `App`s eneste `useEffect` for datastrømmer. Aldri mer enn én lytter per path. Duplikate lyttere på samme path kjører uavhengig av hverandre på samme snapshot-event og skaper et race condition: hver callback bruker sin egen `prev`-verdi, og oppdateringer fra én kan overskrives av en annen som fyrer rett etterpå. Dette var rotårsaken til at nyopprettede poster forsvant ved refresh (se v-persistens-1).

**Skriving** — `setBudgetGroups`/`setIncomeGroups` (og tilsvarende for andre datakilder): tar en updater (verdi eller funksjon), oppdaterer lokal state umiddelbart, flater deretter strukturen til `{groupId: {itemId: {months, meta}}}` og skriver med `dbSet` til riktig path.

**Redigering av enkeltposter** — `updItem`/`addItem`/`delItem` opererer alltid på hele gruppe-arrayet via `setBudgetGroups`/`setIncomeGroups`, aldri direkte på Firebase.

**Kontroll ved ny sprint**: før en ny `listen(...)`-registrering legges til for en path som allerede lyttes på, skal den gamle fjernes i samme endring — ikke bygges oppå.

---

## 2i. Regelsenter

Regelsenter er kontrollpanelet for Regelmotoren. Det ligger under Mer → Verktøy → Regler.

Regelsenter oppretter ikke regler. Regler oppstår i Hverdagsflyt når brukeren velger «Koble + lær» i Bankimport.

Regelsenter brukes kun til:
- vedlikehold
- oversikt
- administrasjon

Historiske transaksjoner skal aldri endres når en regel redigeres. Endringer i mode, confidence, aktiv-status eller flerbruk påvirker kun fremtidige hendelser — regelmotoren leser reglenes nåværende tilstand hver gang den kjører, den lagrer ingen snapshot av gamle avgjørelser.

---

## 2j. Faktisk

Faktisk er den ferdig behandlede representasjonen av en bankhendelse.

- **Banktransaksjonen** beskriver hva som skjedde.
- **Behandlingen** beskriver hva familien valgte.
- **Faktisk** beskriver hvordan hendelsen inngår i familiens økonomi.

```
Banktransaksjon
        │
        ▼
Behandling
        │
        ▼
Actual
```

Actual er et eget datalag (`families/familie1/actual/`). Det skal aldri erstatte banktransaksjonen — begge finnes side om side, og banktransaksjonen endres aldri når en Actual-post opprettes.

**Opprettes kun når** behandlingen faktisk er ferdig: transaksjonen er koblet (fast/variabel med valgt post) eller markert som engangshendelse. Opprettes **aldri** for uklar/venter på kvittering/må splittes — disse har ikke en avsluttet beslutning ennå.

**Motoren** (`createActualFromTransaction`) er en ren funksjon: mottar én ferdig behandlet transaksjon, returnerer én Actual-post. Den kjenner ikke Firebase eller UI. Bankimport kaller motoren og lagrer resultatet — ingen annen kode oppretter Actual-poster.

---

## 2k. Faktisk mot Budsjett

Budsjett beskriver planen. Faktisk beskriver hva som har skjedd. Begge skal vises samtidig.

Appen skal hjelpe brukeren å forstå avvik uten å endre budsjettet automatisk. Motoren beregner. Brukergrensesnittet viser.

**Motoren** (`calculateActualTotals(actualPosts)`) er en ren funksjon: mottar Actual-poster, returnerer summer per `targetId`. Kjenner ikke Firebase, UI eller Budsjett.

**Kostnader og Inntekter** bruker motorens resultat direkte — ingen summering skjer i komponentene selv. Under hver post, når det finnes Actual-data for den, vises én ekstra linje:

- Kostnader: Budsjett / Faktisk / Igjen
- Inntekter: Budsjettert / Mottatt / Igjen

Formelen er alltid `Igjen = Budsjett − Faktisk`. Ingen grafer, ingen prosent, ingen nye skjermer — kun én informasjonslinje i eksisterende visning.

---

## 2l. Årsbudsjett / Budsjettplanlegging

Årsbudsjett er et planleggingsverktøy, ikke en innsiktsflate. Det brukes til å justere planen fremover, ikke analysere historikken.

Ligger under Mer → Verktøy → Årsbudsjett — det er et vedlikeholdsverktøy, ikke noe familien trenger i den daglige arbeidsflyten.

**Viser kun budsjettbeløp** — ingen Faktisk, ingen Actual, ingen avvik. Rader er budsjettposter gruppert etter kategori, kolonner er januar–desember, med årssum per post og per gruppe.

**Omfatter både Kostnader og Inntekter**, valgt via en toggle øverst i visningen. Begge bruker samme tabellstruktur, tastaturnavigasjon og visuelle språk. Fordel årskostnad og prisendringsvarsel finnes foreløpig kun for Kostnader.

Bruker eksisterende `budgetGroups`- og `incomeGroups`-strukturer og skriver gjennom samme `setBudgetGroups`/`setIncomeGroups` som Kostnader- og Inntekter-fanene i Forvaltning — ingen egen datamodell, ingen egen lagringssti.

Årsbudsjett støtter planlegging fremover, inkludert årskostnader og varslede prisendringer.

---

## 2m. Kontantflyt

Budsjett beskriver kostnader. Kontantflyt beskriver når kostnadene faktisk forventes å belaste økonomien.

Et budsjett på 36 000 kr per år betyr ikke nødvendigvis 3 000 kr trekk hver måned — en kvartalsvis faktura kan gi 9 000 kr fire ganger i året og 0 kr resten av tiden. Spillerom skal på sikt ta hensyn til begge: budsjettet (planen) og kontantflyten (når planen faktisk belaster kontoen).

**Motoren** (`calculateCommittedCashflow(budgetGroups, valgtMonth)`) er en ren funksjon: mottar budsjettgrupper og valgt måned, returnerer for hver fremtidig måned planlagte kostnader, planlagte inntekter (0 i v1) og kumulativ forpliktelse. Leser `months[]` direkte — dette feltet er alltid autoritativt for forventet beløp den kalendermåneden, uavhengig av betalingsmønster. Kjenner ikke Firebase, UI eller Faktisk.

**`paymentPattern`** er nytt metadata-felt på budsjettposter (`monthly`/`quarterly`/`yearly`/`custom`, standard `monthly`). Feltet beskriver *hvorfor* beløpet varierer mellom måneder — det endrer ikke hvordan motoren leser dataene. Kun `monthly`/`quarterly`/`yearly` har UI i v1; `custom` er forberedt, ikke bygget.

**Årsbudsjett** lar brukeren velge betalingsmønster per post via en nedtrekksmeny.

**Spillerom** viser «Neste større planlagte utbetaling» — én informasjonslinje, ingen ny layout, ingen varsler eller grafer.

---

## 2n. Kvittering

Kvitteringen er dokumentasjon. OCR er bare én mulig måte å hente informasjon fra dokumentasjonen. Appen skal alltid fungere selv om OCR aldri blir brukt.

En transaksjon kan få en kvittering knyttet til seg (`families/familie1/receipts/`). Kvitteringen lagres med `transactionId`, bildet selv, og status for eventuell fremtidig tekstgjenkjenning (`ocrStatus`: `none`/`uploaded`/`processing`/`done`/`failed`).

**v1 bygger kun grunnmuren** — opplasting og kobling til transaksjonen. Ingen OCR kjøres, ingen kvitteringsvisning, ingen redigering. Kvitteringen settes til `ocrStatus:"uploaded"` og ligger klar for senere behandling.

**Motoren** (`findReceipt(transactionId, receipts)`) er en ren funksjon: mottar en transactionId og listen med kvitteringer, returnerer tilhørende kvittering eller `null`. Kjenner ikke Firebase eller UI.

Kun tilgjengelig for transaksjoner med behandlingstype «Uklar / sammensatt» — kvitteringer er dokumentasjon for det som ennå ikke er avklart, ikke en generell vedleggsfunksjon.

Selve bildet lagres i Google Drive, i en synlig, brukeradministrert mappestruktur (`Hverdagsflyt/Kvitteringer/{år}/{måned}`) — ikke som base64 i Realtime Database. Realtime Database inneholder kun metadata (`driveFileId`, `driveWebViewLink`, `ocrStatus` osv.). Se 2o og 2p for begrunnelse.

---

## 2o. Dokumentasjonsprinsippet

Dokumentasjon skal kunne eksistere uavhengig av behandlingen.

En kvittering er dokumentasjon. En banktransaksjon er dokumentasjon. OCR er informasjon hentet fra dokumentasjonen. Behandling er brukerens beslutning.

Dokumentasjon skal aldri være avhengig av hvordan informasjon senere hentes ut.

**Praktisk konsekvens for lagring:** filer (bilder, dokumenter) hører hjemme der brukeren selv kan se og administrere dem — Google Drive, i egen synlig mappe (`Hverdagsflyt/Kvitteringer/{år}/{måned}`). Metadata om filen (hvor den ligger, hva den handler om, hvilken status den har) hører hjemme i Firebase Realtime Database. Blander man disse to, blir vanlig databruk (synkronisering av lister og summer) tungt og kostbart fordi hver klient må laste ned alt bildeinnhold den ikke nødvendigvis trenger.

**Praktisk konsekvens for arbeidsflyt:** en kvittering skal kunne registreres, lagres og forberedes (kobling, splitt) helt uavhengig av om og når en tilhørende banktransaksjon dukker opp. Koblingen er noe som skjer *senere*, ikke en forutsetning for at dokumentasjonen kan eksistere.

---

## 2p. Google Drive-tilkobling

Google Drive lagrer kvitteringsfiler. Firebase lagrer metadata og behandling. Dette er en videreføring av Dokumentasjonsprinsippet (2o): filen og informasjonen om filen er to forskjellige ting, lagret to forskjellige steder.

**Drive-tilgang er en separat, eksplisitt autorisasjon** — ikke en del av appens vanlige Firebase-innlogging (e-post/passord). Brukeren kobler til Google Drive med et eget knappetrykk, via Google Identity Services (GIS), og kan når som helst koble fra. De to innloggingslagene påvirker ikke hverandre.

**Scope:** `drive.file` — appen får kun tilgang til filer og mapper den selv oppretter, ikke hele brukerens Drive. Dette er et bevisst minimumsvalg.

**Tilgangstoken lagres kun midlertidig i appøkten** — i minnet, aldri i Firebase eller i nettleserens `localStorage`. Forsvinner ved refresh eller når fanen lukkes; brukeren må koble til på nytt neste økt. Dette er en bevisst avveining: enkelhet og forutsigbar sikkerhet fremfor sømløs gjenoppkobling.

Første autorisasjon skjer alltid som en direkte respons på et brukerklikk — aldri automatisk ved sideinnlasting — siden mobile nettlesere ofte blokkerer popup/redirect som ikke er direkte utløst av en brukerhandling.

---

## 2q. Kvitteringsinnboks

Kvitteringen er sannheten. Banktransaksjonen er bare betalingen. Koblingen mellom dem er en egen hendelse.

En kvittering kan registreres lenge før den tilhørende banktransaksjonen finnes — de to lever uavhengig av hverandre. Kvitteringsinnboksen (under Forvaltning → Kvitteringer) er stedet dokumentasjonen bygges: bilde til Google Drive, metadata (dato, leverandør, totalbeløp) og splitt mot én eller flere budsjett-/inntektsposter — alt uten OCR og uten at en transaksjon trenger å eksistere.

**Status «Ikke koblet»** er standard og forblir slik helt til en fremtidig matching-sprint kobler kvitteringen mot en importert banktransaksjon (`transactionId` settes da). Denne sprinten bygger ikke den koblingen.

**Splitt** (`splits[]`) er den permanente datamodellen for å fordele én kvittering på flere budsjett-/inntektsposter. Hver split har `targetType`, `targetId`, `targetName`, `amount`, `note`. Motoren (`calculateSplitTotal(receipt)`) er en ren funksjon som summerer splittene — ingen automatikk avgjør fordelingen, brukeren gjør det selv.

**Drive-mappestruktur** følger `Hverdagsflyt/Kvitteringer/{år}/{måned}`, opprettet automatisk ved behov via samme finn-eller-opprett-mønster uansett hvor dypt i strukturen man er.

---

## 3. Moduler


---

### 3.1 Kokebok

#### Formål
Støtte beslutningen: *Hva kan vi lage?*

#### Arbeidsflyt
Bruker registrerer oppskrift → oppskrift brukes i middagsplan → ingredienser hentes til handleliste

#### Datakilder
- `recipes/{id}` i Firebase
- `_globalRecipes` (modul-level variabel for ingredienshistorikk i samme økt)

#### Datamodell
```json
{
  "id": "abc123",
  "name": "Taco",
  "cat": "Middag",
  "tags": ["favoritt", "enkel"],
  "time": 30,
  "servings": 4,
  "url": "https://...",
  "imageUrl": null,
  "source": "quick",
  "instructions": "Stek kjøttdeig...",
  "ingredients": [
    { "name": "Kjøttdeig", "amount": "500 g", "unit": "g", "cat": "Kjøtt" }
  ],
  "ingredientGroups": [],
  "lastCooked": 1720000000,
  "timesCooked": 7,
  "createdAt": 1719000000
}
```

Ingrediensgrupper (valgfritt):
```json
"ingredientGroups": [
  { "id": "g1", "name": "Bunn", "ingredients": [...] },
  { "id": "g2", "name": "Fyll", "ingredients": [...] }
]
```

Hvis `ingredientGroups` er tom, brukes `ingredients` direkte.

#### UI-prinsipper
- Tre innganger: ⚡ Hurtigtekst, 🔗 URL, 📷 Bilde
- Lavest mulig friksjon ved registrering
- Mengde er nødvendig for handleliste — men ikke påkrevd ved første registrering
- Ingrediensgrupper er valgfritt — enkle oppskrifter forblir enkle

#### Låste beslutninger
- `getIngredients(recipe)` flater alltid ut grupper — motoren og handlelistegeneratoren bruker alltid denne funksjonen
- Oppskrifter lagrer `lastCooked` og `timesCooked` — oppdateres ved bekreftelse i middagsplan
- Skalering er ren visningslogikk — lagret data endres ikke

#### Åpne spørsmål
- OCR fra bilde (krever backend/Cloud Vision)
- Normalisering av ingrediensnavn på tvers av oppskrifter

---

### 3.2 Middagsplan

#### Formål
Støtte beslutningen: *Hva spiser vi denne uken?*

#### Arbeidsflyt
Bruker planlegger middag per dag → handlelistegenerator henter ingredienser → bruker bekrefter dagens middag → historikk oppdateres

#### Datamodell

En dagverdi kan være en av tre typer:

```json
{ "type": "recipe", "name": "Taco", "recipeId": "abc123" }
{ "type": "menu", "name": "Suppe · Pannekaker", "recipes": [
    { "name": "Tomatsuppe", "recipeId": "id1" },
    { "name": "Pannekaker", "recipeId": "id2" }
]}
{ "type": "event", "name": "Middag hos svigermor", "emoji": "🏡" }
```

Gamle strenger (`"Taco"`) støttes via `getMealName()`.

#### Hjelpefunksjoner (låste)
- `getMealName(val)` — returnerer visningsnavn uansett type
- `getMealType(val)` — returnerer `"recipe"`, `"menu"` eller `"event"`
- `getMealRecipes(val)` — returnerer alltid en liste med `{name, recipeId}`
- `isEvent(val)` — returnerer `true` for hendelser

#### UI-prinsipper
- Hendelser markerer dagen som planlagt, men genererer ikke ingredienser
- Passerte dager vises nedtonet
- «✓ Bekreft»-knapp vises kun på dagens dag

#### Predefinerte hendelser
Middag hos svigermor, Middag hos foreldrene, Enkel middag, Grandiosa, Rester, Spiser ute, Hytta, Ingen middag hjemme, Annet

#### Låste beslutninger
- Meny bygges direkte i planen (ikke som eget objekt i kokeboken)
- Hendelser skal aldri generere ingredienser
- `getMealRecipes()` er eneste inngangen til handlelistegeneratoren — aldri les dagsverdien direkte

#### Åpne spørsmål
- Plan vs faktisk middag (datamodellen er klar: `{planned, actual, confirmedAt}` — UI ikke bygget)
- Middagsforslag basert på historikk («ikke laget på 8 uker»)

---

### 3.3 Handlelistegenerator

#### Formål
Støtte beslutningen: *Hva må vi handle?*

#### Arbeidsflyt
```
Velg middager → hent ingredienser → slå sammen → gjennomgang → handleliste
```

#### Generator
Handlelistegeneratoren er en generator (ikke en motor). Den:
1. Henter alle kommende planlagte middager (ikke hendelser, ikke passerte)
2. Lar brukeren velge hvilke middager som inngår
3. Henter ingredienser fra alle oppskrifter via `getIngredients()`
4. Slår sammen like varer (samme navn + samme enhet → summer mengde)
5. Slår opp kategori fra `itemHistory`
6. Markerer basisvarer som avhuket som standard

#### Basisvarer
- Lagres i `staples/{varenavn}: true` i Firebase
- Ingen hardkodet liste — familien definerer sine egne
- Merkes ved å svare «Ja» på spørsmål ved fjerning i gjennomgang
- Vises i egen gull-seksjon i gjennomgang, avhuket som standard

#### Låste beslutninger
- Eksisterende manuelle varer på handlelisten beholdes alltid
- Alle poster som inngår i beregningen må alltid være synlige i UI

---

### 3.4 Fryser

#### Formål
Støtte beslutningen: *Hva har vi i fryseren? Trenger vi å handle dette?*

#### Datamodell
```json
{
  "id": "abc",
  "name": "Karbonadedeig",
  "batches": [
    { "id": "b1", "count": 3, "unit": "pk", "gramsPerUnit": 400 },
    { "id": "b2", "count": 2, "unit": "pk", "gramsPerUnit": 500 }
  ]
}
```

Visning: `3 pk à 400 g` og `2 pk à 500 g` — Totalt: 2200 g

#### UI-prinsipper
- Samme varenavn + samme pakkestørrelse → øk antall på eksisterende batch
- Samme varenavn + annen pakkestørrelse → ny batch
- Oppskriftsvisning: `❄️ 2200 g i fryseren` (beregnet fra alle batches)

#### Åpne spørsmål
- Automatisk nedtelling når middag bekreftes (krever kobling mot oppskrift)
- Kjøleskap og tørrvarer som egne moduler (fryser er første steg i lagermodul)

---

### 3.5 Spillerom (Prognosemotor)

#### Formål
Støtte beslutningen: *Hvor stort spillerom har vi frem til neste lønn?*

#### Arbeidsflyt
```
Datakilder → Generator → Prognoseposter → Prognosemotor → Spillerom → Beslutning → Historikk
```

#### Motor (låst og ren)
```javascript
function beregnSpillerom(saldo, posts, prognosisDate) {
  // Filtrer poster med dato ≤ prognosisDate
  // Summer innbetalinger og utbetalinger
  // Returner { disponibelt, innbetalinger, utbetalinger, spillerom }
}
```

Motoren mottar kun en ferdig liste. Den genererer ingenting selv.

#### Generator (versjon 1 — manuell)
I første versjon er brukeren generatoren: alle poster legges inn manuelt.

#### Generator (planlagt)
Generatoren skal etter hvert automatisk hente fra:
- Budsjettet (faste poster)
- Lønnskalender (innbetalinger)
- Mastercard-estimat
- Kjente engangsposter
- Bankimport (CSV fra DNB/SpareBank 1)

Variable kostnader som strøm og bom skal bruke **budsjettert beløp** frem til faktisk beløp er kjent.

#### Datamodell — prognosepost (flat liste)
```json
{
  "id": "abc",
  "name": "Boliglån",
  "amount": 13534,
  "direction": "out",
  "date": "2026-07-15",
  "type": "fast"
}
```

`direction`: `"in"` eller `"out"`

`type` beskriver **behandling**, ikke innhold:
| Type | Betydning |
|---|---|
| `fast` | Hentes automatisk av generator senere |
| `variabel` | Finnes i budsjett, legges inn manuelt nå |
| `extra` | Ikke budsjettert — ekstra kostnad eller inntekt |

#### Prognosedato
- Alltid en konkret dato — aldri bundet til et konsept som «neste lønn»
- Appen foreslår neste lønningsdag (dag 20) som standard
- Brukeren kan alltid endre til en annen dato

#### Låste beslutninger
- Motoren er og forblir en ren funksjon
- Alle poster som inngår i beregningen må alltid være synlige i UI
- Poster med ukjent type vises i egen «⚠️ Ukjent type»-seksjon

#### Åpne spørsmål
- Prognosepostgenerator fra budsjett
- Støtte for gjentakende poster (genereres av generator, ikke motor)
- Historikk: sammenlign prognose mot faktisk

---

### 3.6 Budsjett

#### Formål
Gi oversikt over planlagte inntekter og kostnader per måned, og fungere som datakilde for prognosemotoren.

#### Låste beslutninger

**Én budsjettpost beskriver én konkret ting.**
Eksempel: `Boliglån` — ikke `Bolig`.

**Hver budsjettpost skal minst inneholde:**
- Navn
- Beløp
- Eier: `Felles` / `Helen` / `Eivind`
- Nivå:
  - `Beskytte` — må betales uansett
  - `Opprettholde / Nødvendig` — viktig, men kan justeres
  - `Opprettholde / Valgfritt` — ønskelig, men kan kuttes
  - `Bygge` — investering i fremtiden
  - `Velge` — bevisst prioritert forbruk
- Automatisk (ja/nei) — om generatoren skal hente den automatisk
- Oppførsel:
  - `Fast` — samme beløp hver periode
  - `Variabel` — bruker budsjettert beløp frem til faktisk er kjent
  - `Fordele` — skal splittes på kategorier eller personer

**Budsjettmodellen skal kunne utvides** med metadata (konto, forfallsdag, frekvens) uten omskriving av eksisterende poster.

**Mat budsjetteres som én post.** Underkategorier (middag, basisvarer, frokost/lunsj, kos osv.) tilhører analyse av faktisk forbruk — ikke budsjettet. Underkategorisering hentes fra kvitteringer og matmodulen.

#### Åpne spørsmål
- Årsbudsjett-visning (alle 12 måneder samtidig, kopier beløp)
- Kobling mellom budsjettpost og prognosepost (automatisk generator)
- Transaksjonsimport fra DNB og SpareBank 1
- Kobling mellom matmodulens historikk og faktisk matforbruk per underkategori (krever kvitteringsdata)

---

## 4. Roadmap

### Levert (Juli 2026)
- Motor v1: `calcSpillerom` — ren funksjon, testet og låst
- Generator v1: produserer prognoseposter fra budsjett og inntekter
- Kostnader: gruppebasert, budsjett + faktisk, metadata, InlineNum
- Inntekter: søstermodul til Kostnader, identisk struktur, `incomeGroups`-path
- Generator-senter: kontrollpanel med samlet tabell, filtre og modal-redigering
- Disponibelt nå: inline redigering av saldo direkte fra dashboardet

### Neste
- Generator v2: automatisk kjøring basert på forfallsdag (forutsetter at forfallsdag er satt i Generator-senteret for alle automatiske poster)
- Årsbudsjett-visning (alle 12 måneder samtidig)
- Middagsforslag basert på historikk
- Vercel for automatisk deploy fra GitHub

### Senere
- Transaksjonsimport fra DNB og SpareBank 1
- Statistikk og trender i økonomimodulen
- Familiemedlemmer («hvem likte den»)
- Kvitteringslagring (Google Drive)
- Lager: kjøleskap og tørrvarer (fryser er første steg)
- OCR fra bilde i kokebok

---

## 5. Backlog

- Vercel-deploy (automatisk fra GitHub)
- Familimedlem-oppsett for «hvem likte den»
- Årsbudsjett-visning (alle 12 måneder samtidig)
- Transaksjonsimport DNB (CSV-format dokumentert)
- Transaksjonsimport SpareBank 1 (CSV-format dokumentert)
- Regelmotor for kategorisering av transaksjoner
- Splitt av enkeltransaksjon på flere kategorier
- Duplikatsjekk ved import (dato ±2 dager + beløp)
- Statistikk: månedlig forbruk mot budsjett
- Statistikk: sammenligning mot samme periode fjoråret
- Automatisk nedtelling i fryser ved bekreftelse av middag
- Kjøleskap og tørrvarer som egne lagerlister
- OCR fra bilde i kokebok (krever Cloud Vision eller lignende)
- «Merk som basisvare» direkte fra handlelisten (ikke bare via generator)
- Forhåndsdefinerte menyer i kokeboken (Alternativ B)

---

*Sist oppdatert: Juli 2026*
*Versjon: 1.2*
