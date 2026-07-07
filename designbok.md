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
- Kvitteringslagring (Firebase Storage)
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
