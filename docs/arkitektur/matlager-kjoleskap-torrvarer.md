# Matlager: kjøleskap, tørrvarer og forbruksstøtte — kartlegging

Status: kartlegging, ikke implementeringsgodkjenning (#20, ordre 6690219276; presisert etter review 5804812801).
Grunnlag: fersk `main`. Det er ikke lest produksjonsdata.

Kort svar:

- Matlager har i dag to modeller: frysebatcher med mengde og basisvarer uten mengde.
- Et valgfritt **sted per batch** i den eksisterende frysermodellen er den minste veien til kjøleskap og tørrvarer.
  - Det krever ingen migrering, ingen ny backend og ingen nye rules.
  - Atomisk flytting gjelder bare når varen faktisk ligger i én node; se avsnitt 4.
- Fire konkrete svakheter i dagens kode bør rettes først, én om gangen, i rekkefølgen i avsnitt 5. Ingen av dem krever produktvalg.
- Automatisk forbruk ved bekreftet middag forblir parkert.

## 1. Det som finnes i dag

| Del                      | Referanse                                                            | Hva den gjør                                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Datamodell               | `web/src/types/freezer.ts`                                           | `FreezerItem { itemId, name, batches[] }`, `FreezerBatch { id, count, unit, gramsPerUnit }`. Sti: `families/{familyId}/freezer/{id}`. Uendret fra legacy.                                                    |
| Repository               | `web/src/data/freezer.repository.ts`                                 | Leser hele samlingen. Skriver én post-node om gangen med `transactFreezerItem` (`runTransaction`). Sletter med `deleteFreezerItem`.                                                                          |
| Domene                   | `web/src/domain/freezer/freezer.ts`                                  | Samme enhet + samme `gramsPerUnit` slås sammen (`mergeBatchIntoBatches`). En batch på 0 fjernes, og posten fjernes når siste batch er borte. `freezerLabel` er **ren informasjon** («❄️ 2200 g i Matlager»). |
| Hook                     | `web/src/hooks/useFreezer.ts`                                        | `addBatch` finner målposten på **navn** i lokal tilstand og lager ellers en ny UUID. Selve verdien regnes i transaksjonen.                                                                                   |
| Flate                    | `web/src/features/hverdagsflyt/mat/freezer/FreezerScreen.tsx`        | Brukerrettet «Matlager»: hurtigregistrering, enheter `stk g kg ml dl l pk boks pose`, søk, +/−, «Fjern» og egen basisvareseksjon.                                                                            |
| Basisvarer               | `web/src/types/shopping.ts:82`, `web/src/data/staples.repository.ts` | `staples/{varenavn i små bokstaver}: true`. Betyr «har vanligvis hjemme», uten mengde. Merkes fra generatoren og handlelisten (#111) og fjernes i Matlager.                                                  |
| Varebase                 | `web/src/data/items.repository.ts:50`                                | `findOrCreateItem` matcher på navn. Kjent kappløp: to klienter kan opprette samme navn samtidig (dokumentert der).                                                                                           |
| Handlelistegenerator     | `web/src/generators/shopping/shopping.ts:302`                        | Basisvarer markeres som avhuket. Beholdning leses **ikke** i beregningen.                                                                                                                                    |
| Gjennomgang og oppskrift | `ShoppingGeneratorModal.tsx:303`, `RecipeIngredients.tsx:31`         | Viser `freezerLabel` som informasjon. Ingen mengdejustering.                                                                                                                                                 |
| Legacy                   | `index.html` `FreezerScreen` ~5086–5357                              | Skriver per post med transaksjon på fersk verdi (skive 2). `setFreezer` ~16828 skriver ikke lenger. Før skive 2 skrev legacy **hele** `freezer` med `dbSet` fra lokal tilstand.                              |
| MCP                      | `mcp-server/src`                                                     | Har ikke noe eget Matlager-verktøy. Generisk `data_les`/`data_skriv` (versjonert) dekker stien, men brukes ikke herfra.                                                                                      |
| Rules                    | `infra/firebase/database.rules.json`                                 | Bare familiemedlemskap. Ingen node-spesifikk validering av `freezer`, `staples` eller `items`.                                                                                                               |

Produktfasit som allerede gjelder og ikke spørres om igjen:

- `docs/produktfasit/designbok.md` §3.4: én vare med flere batcher; samme pakkestørrelse øker antallet, ulik pakkestørrelse gir ny batch.
- Kjøkken v1 (#20, sitert i `freezer.ts:151–160`): beholdning er **informasjon**, «ikke avansert lagerstyring, automatisk forbruk».
- Automatisk nedtelling ved bekreftet middag er et åpent spørsmål (designbok §3.4) og parkert (roadmap).

Testsikring som finnes:

- `web/src/domain/freezer/freezer.test.ts`: sammenslåing, justering, etiketter og `freezerLabel`.
- `web/src/data/freezer.repository.integration.test.ts`: to samtidige +1 på samme node gir 2, og en ikke-medlem nektes.
- `web/e2e/freezer.spec.ts`: legg til i Matlager.
- `web/e2e-skriving/basisvare.spec.ts`: merk basisvare og fjern i Matlager.

## 2. Konkrete svakheter i dagens kode (ikke produktvalg)

1. **Legacy skriver hele samlingen.** _Rettet i skive 2 — se avsnitt 5._
   - `setFreezer` gjør `dbSet(FAM/freezer, alle poster fra lokal tilstand)`.
   - En legacy-side med et gammelt bilde kan overskrive en +/−, en ny batch eller en sletting gjort i React eller på en annen enhet. En slettet post kan også komme tilbake.
   - Legacy-`add` regner nye batcher fra komponentens `freezer`-prop, ikke fra `p`.
   - Samme feilklasse som Spillerom før #118.
2. **Vareidentitet: flere poster for samme vare.** _a og b rettet i skive 3 (målpost ved commit); c avvises nå synlig — se avsnitt 5._ Før skive 3: `useFreezer.addBatch` velger målpost ved å matche navn i **lokal** tilstand, og lager ellers en ny tilfeldig UUID. `findOrCreateItem` matcher også på navn mot et øyeblikksbilde. Konkrete veier til duplikat:
   - **a. Eksisterende legacy-post og foreldet klient.** Posten «Kjøttdeig» har legacy-id `x1`. Klient B har ennå ikke fått den i abonnementet og lager en ny node `u7`. Resultatet er to poster.
   - **b. To nye varebase-id-er for samme navn.** A og B oppretter «Kjøttdeig» i varebasen samtidig og får `itemId` `i1` og `i2`. Selv en node-id avledet av `itemId` gir da to noder.
   - **c. Allerede flere poster med samme navn.** Eksisterende data kan ha to poster «Kjøttdeig». Dagens `find` velger den første. Visningen viser begge kortene, men `freezerLabel` teller bare én.
3. **Mengdeberegning blander direkte mengde, pakningsvekt og antall.**
   - `totalGrams` summerer **bare** `count × gramsPerUnit`. En direkte masse (`{500, "g"}` eller `{1, "kg"}` uten `gramsPerUnit`) teller ikke.
   - Når ingen batch har `gramsPerUnit`, summerer `freezerLabel` `count` på tvers av enheter og bruker enheten til første batch.
   - Eksempler på feil:
     - `{500 g}` + `{1 kg}` vises som «501 g i Matlager».
     - `{2 pk}` + `{3 stk}` vises som «5 pk».
     - `{2 pk à 400 g}` + `{500 g}` vises som «800 g», fordi den direkte massen faller bort.
4. **Gram per enhet på g og kg.** Skjemaet tillater `gramsPerUnit` når enheten er `g` eller `kg`, som gir lagrede verdier som `{2, "kg", 500}` («2 kg à 500 g»). Slike gamle, tvetydige verdier skal vises slik de er, ikke skrives om.

## 3. Syntetiske eksempler

Eksemplene bruker forslaget i skive 2: valgfritt `sted` per batch, der manglende sted betyr `fryser`. Antakelsen er at varen ligger i **én** node; se avsnitt 4 for når den ikke gjør det.

**Tre mengdetyper som skal holdes atskilt:**

- **Direkte masse eller volum:** `g kg` og `ml dl l`, der `count` _er_ mengden.
- **Dokumentert pakningsvekt:** `pk boks pose` med `gramsPerUnit`.
- **Antall uten vekt:** `stk`, eller `pk` uten `gramsPerUnit`.

| Situasjon                       | Lagret                                                                 | Ønsket visning                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Samme vare flere steder         | Kjøttdeig: `{2 pk à 400 g, fryser}`, `{1 pk à 400 g, kjøleskap}`       | «800 g i fryser · 400 g i kjøleskap»                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Direkte masse, kompatibel       | Mel: `{1 kg}`, `{500 g}`                                               | «1,5 kg». Omregning g↔kg og ml↔dl↔l er bare visning; lagret enhet beholdes.                                                                                                                                                                                                                                                                                                                                                                                          |
| Pakningsvekt + direkte masse    | Kjøttdeig: `{2 pk à 400 g}`, `{500 g}`                                 | «1300 g». Begge typer er masse.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Inkompatible                    | Bønner: `{2 boks}` (uten vekt), `{300 g}`                              | «2 boks · 300 g». Ingen totalsum.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Gammel tvetydig verdi           | `{2, "kg", gramsPerUnit: 500}`                                         | «2 kg à 500 g» som i dag. Ikke med i noen sum, og ikke skrevet om.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Flytting (tine)                 | −1 på fryserbatchen og +1 på kjøleskapsbatchen i **samme transaksjon** | Totalen er uendret. Ingen varehistorikk og ingen handleliste.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Nytt innkjøp                    | Ny batch, eller sammenslåing på `sted` + enhet + gram                  | Totalen øker.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Basisvare mot beholdning        | Salt: bare `staples`                                                   | «Har vanligvis hjemme», uten mengde. Generatoren avhuker den som i dag.                                                                                                                                                                                                                                                                                                                                                                                              |
| Beholdning uten basisvare       | Melk: `{1 l, kjøleskap}`                                               | Gjennomgangen viser «har 1 l i kjøleskap» som informasjon. Ingen automatisk avhuking.                                                                                                                                                                                                                                                                                                                                                                                |
| Samtidig +1 og −1 på samme vare | Begge som deltaer i `transactFreezerItem` på samme node                | Atomisk, sekvensiell behandling **så lenge målbatchen finnes**. Starter batchen på 1 og −1 kommer først, fjernes batchen (`applyBatchAdjustmentToItemFields`); en etterfølgende +1 på samme batch-id finner ikke målet. Utfallet for manglende eller slettet mål må avklares og testes i skrivevei-rettingen. Eksisterende integrasjonstest dekker bare to +1 med en inline updater, ikke domenets +/−. En gammel legacy-side kan fortsatt overskrive; se svakhet 1. |

## 4. Identitet, samtidighet og reversibilitet (tekniske valg, håndteres av oss)

### Identitet: velg én målpost ved commit

- **Anbefaling:** å legge til en ny batch velger målposten **i transaksjonen**, ikke fra lokal tilstand.
  - **Teknisk kandidat:** transaksjon på hele `freezer` med normalisert navn som nøkkel.
    - Størrelse og konfliktlast er **ukjent**. Kartleggingen har ikke lest produksjonsstørrelse eller målt last, og skal ikke gjøre det.
    - Før implementering kreves en syntetisk belastnings- og samtidighetskontroll i emulatoren.
  - **Ett treff:** batchen legges i den posten. Dette dekker tilfelle a. Tilfelle b dekkes også, fordi navnet, ikke `itemId`, velger posten.
  - **Ingen treff:** det opprettes én ny node i samme transaksjon. To samtidige forsøk gir én post, fordi transaksjonen kjøres på nytt med fersk verdi.
  - **Flere treff (tilfelle c):** skrivingen **avvises synlig** med «Det finnes flere poster for Kjøttdeig — velg hvilken». Ingen automatisk sammenslåing.
- **Konsekvens:**
  - Skriveveien endres: transaksjon på samlingen i stedet for på noden. Uavhengige varer kan da få flere omforsøk.
  - Datakontrakten (form og sti) er uendret, og ingenting migreres.
  - Identitetsregelen «samme vare = samme normaliserte navn» er dagens regel, nå håndhevet ved commit. Eksisterende duplikater blir stående og vises.
- **Atomisk flytting og ett kort per vare** gjelder bare for varer som faktisk har én post. For tilfelle c må brukeren velge post, eller duplikatene må ryddes separat. Det bestilles ikke her.
- **Legacy:** skriver per post (skive 2) og velger nå også målpost ved commit med samme regel som React (skive 3).

### Fersk verdi, brukerens grunnlag og idempotens

- **Delta (+1/−1):** brukerens hensikt er relativ. RTDB kjører transaksjonen på nytt med fersk verdi, og det er riktig **når målbatchen finnes**. Da trengs ikke et forventet-versjon-vern for selve tallet.
  - Grensen er mål-eksistens. Er batchen eller noden fjernet i mellomtiden, for eksempel fordi en −1 tok den til 0 eller en annen bruker fjernet varen, finnes det ikke noe å justere.
  - Det utfallet (synlig avvisning eller gjenskaping) er ikke valgt. Det må avklares og testes i skrivevei-rettingen.
- **Absolutt endring og sletting:** for eksempel «sett antall til 3», «fjern varen» eller «flytt 2 pk». Brukeren handler ut fra det hen så.
  - En fersk transaksjon alene vil gjennomføre handlingen selv om verdien er endret i mellomtiden.
  - Slike operasjoner trenger grunnlagssjekk, som `LikviditetKonflikt` i #118: forventet batch, antall og om noden finnes. Avvik avvises synlig, og ingenting skrives.
  - **Status «Fjern varen»:** legacy siden #125, React siden skive 3b (avsnitt 5).
- **Ukjent utfall:** etter frakobling, ny tilkobling eller omlasting vet ikke klienten om et tillegg ble lagret.
  - En knappelås hjelper bare mens siden lever.
  - `batch.id` er ikke en idempotensnøkkel: `mergeBatchIntoBatches` slår tillegget inn i en eksisterende batch og forkaster den nye id-en, så en ny avspilling legger til på nytt.
  - **Ekte idempotens krever varig operasjonsidentitet** (en kvittering per operasjon lagret med varen). Det er en datakontraktendring og er **ukjent/ikke valgt** her.
  - Inntil videre er dette en kjent grense: brukeren ser resultatet i abonnementet og kan justere.
- **Sikkerhetsflate:** ingen ny. Uendret familiemedlemskap i rules.

### Reversibilitet

- Det skal **ikke** finnes noen ubetinget gjeninnsetting av et øyeblikksbilde.
- **Trygg angring** gjelder bare når noden er uendret siden operasjonen. Angre-transaksjonen sammenligner med verdien rett etter operasjonen. Ved avvik avvises den synlig: «Varen er endret etter dette; ingenting er gjenopprettet».
- **Motsatt delta er ikke alltid eksakt:**
  - En batch som nådde 0, er slettet. Id-en finnes ikke lenger, så +1 må gjenskape batchen.
  - Et uttak som ble klemt ved 0 (−2 på 1 gir 0), blir 2 ved angring, ikke 1.
  - Angring må derfor bruke den lagrede før-verdien med grunnlagssjekk, ikke en ny delta.
- **Konkurranseeksempel:**
  1. A fjerner «Kjøttdeig» (siste batch, noden slettes).
  2. B legger rett etter inn 2 pk à 400 g, og noden finnes igjen.
  3. A trykker «Angre».
  - Et øyeblikksbilde ville overskrevet B sine 2 pk.
  - Ønsket oppførsel: Angre ser at noden ikke er `null` som forventet, avviser, viser «Kjøttdeig er endret etter at du fjernet den» og skriver ingenting.
- **Tilbakeføring etter senere endringer** er en egen, eksplisitt operasjon. Den er ikke del av Angre og bestilles ikke her.

### Sted per batch: modell og legacy

- **Modell:** valgfritt `sted?: "fryser" | "kjoleskap" | "torrvarer"` på `FreezerBatch`, der manglende verdi betyr `fryser`. Stien er uendret, og ingenting migreres. Sammenslåingsnøkkelen blir `sted` + enhet + `gramsPerUnit`.
- **Legacy:**
  - Legacy bevarer ukjente batchfelt når den justerer, og nye legacy-batcher blir `fryser`.
  - Men legacy-`add` slår sammen uten å se på sted, og kan dermed øke en kjøleskapsbatch.
  - Stedvalg forutsetter derfor at legacy-`add` også ser på sted, eller at legacy sperres. Skrivingen per post (skive 2) er ikke nok alene.
- **Familieisolasjon:** uendret, med alt under `families/{familyId}`.

## 5. Skiver og rekkefølge

Hver retting er en egen liten PR. De samles ikke.

1. **Første og minste retting: mengdevisning (svakhet 3 og 4).**
   - Ren, skrivefri domene- og visningsendring i `freezerLabel`/`totalGrams`, etter de tre mengdetypene i avsnitt 3.
   - Gamle tvetydige verdier vises som de er.
   - Skjul gram per enhet for `g`/`kg` i skjemaet for nye registreringer.
   - Aksept og tester: domenetester for hvert eksempel i avsnitt 3, og eksisterende `freezerLabel`-tester oppdateres. Ingen data endres.
2. **Legacy-skrivevei (svakhet 1).** _Levert (ordre i #20)._
   - Transaksjon per postnode på fersk verdi. Ukjente felt, andre batcher og andre poster bevares.
   - +/− krever at posten og batchen finnes ved commit; ellers synlig konflikt og ingen gjenoppretting.
   - Legg til i eksisterende post krever at posten finnes ved commit; samme enhet- og `gramsPerUnit`-sammenslåing som før. Ny post får ny id og avvises hvis noden finnes.
   - «Fjern» er absolutt: sammenlignes med tilstanden brukeren så, og avvises synlig hvis posten er endret eller borte. Ingen Angre.
   - Konflikt og avvisning fra databasen (terminale, ingenting lagret) skilles fra ukjent utfall (ikke bekreftet). Skjemaet beholdes ved feil; ingen automatisk nytt forsøk. Knappelåsen hindrer dobbeltklikk, men er ingen garanti mot gjentak fra andre faner.
   - Grensen for målvalg fra lokal navneliste (svakhet 2a/2b) er løst i skive 3.
   - Ingen endring i React, MCP eller rules. Ingen `sted`-felt; legacy-`add` slår fortsatt sammen uten å se på sted.
   - Tester: `web/e2e-legacy/matlager-skrivevei.spec.ts` (ekte legacy, emulator, frakoblet legacy-klient mot en annen klient) og R3b-vakten.
3. **Målpost ved commit for «Legg til» (svakhet 2, avsnitt 4).** _Levert (ordre 6698904630 i #20), React og legacy._
   - Én RTDB-transaksjon på hele `freezer`, med fersk verdi. Regelen ligger i `leggTilVedCommit` (`web/src/domain/freezer/freezer.ts`); legacy har samme regel i `index.html`.
   - Navneregelen er dagens: case-insensitiv lik `name`. Ingen fuzzy, alias, trimming eller ny identitetsregel.
   - **Observert mål:** eneste lokale navnetreff er posten brukeren så. Den brukes og ingen annen navnelik post. Er den slettet → konflikt (som #125), er den omdøpt → konflikt. Aldri gjenoppliving eller tillegg under feil vare.
   - **Uten observert mål:** ett ferskt treff → den faktiske node-id-en (også en legacy-post med `id`-felt, eller en React-post uten); ingen treff → én ny node; flere treff → synlig avvisning.
   - Flere ferske treff avvises alltid, uten skriving, sammenslåing eller migrering.
   - Eksisterende post beholder id, ukjente felt og `itemId`. `itemId` settes bare når den mangler, så en konkurrerende varebase-id for samme navn bytter ikke koblingen.
   - Batchsammenslåingen er dagens regel, beregnet på fersk verdi. Andre poster returneres urørt.
   - Avvisning returnerer gjeldende verdi uendret, så den verifiseres mot serveren. `applyLocally: false`: ingen optimistisk visning.
   - React viser utfallet i skjemaet (`role="alert"`) og beholder skjemaet; legacy bruker #125-meldingen. Konflikt, avvisning fra databasen og ukjent utfall holdes fra hverandre. Ingen automatisk nytt forsøk, og knappelåsen er ingen idempotens. Ingen replaygaranti etter omlasting.
   - +/− og «Fjern» er uendret (per post, #125).
   - **Syntetisk emulator-probe før implementering** (ingen produksjonsstørrelse målt). Poster på 1–3 batcher, 15 / 200 / 1000 poster (3,5 kB / 48 kB / 242 kB), 2 / 5 / 10 samtidige klienter, samme og uavhengige varer — 18 runder:
     - Alle runder ga riktig resultat: samme navn → én post, uavhengige → én post hver, alle antall talt med, andre poster uendret, ingen feil.
     - Flest updater-kall per klient med 10 samtidige: 5–11 (SDK-grensen er 25 omforsøk). Med 2 klienter: 3–4.
     - Tid til alle hadde commitet (lokal emulator, uten nettverksforsinkelse): 15 poster under 0,2 s; 200 poster 0,1–1 s; 1000 poster 0,3–4,6 s.
     - Grenser: hvert forsøk sender hele samlingen, så kostnaden vokser med samlingen × omforsøk. Ekte nettverksforsinkelse gir lengre konfliktvindu og flere omforsøk enn i emulatoren. Mange samtidige skrivere er ikke et realistisk bruksmønster for én familie.
   - **Funn, ikke endret (dagens regel):** «samme enhet + samme `gramsPerUnit`» slår ikke sammen batcher uten vekt. Lagret batch mangler `gramsPerUnit` (RTDB lagrer ikke `null`), mens ny batch har `null`, så «2 stk» + «3 stk» blir to batcher. Det gjelder React og legacy, før og etter denne skiven. Ordren tillater ingen skjema- eller enhetsretting, så det er bare dokumentert her.
   - Tester (emulator):
     - integrasjon `web/src/data/freezer.maalvalg.integration.test.ts` (React-datavei);
     - `web/e2e-skriving/matlager-maalvalg.spec.ts` (React-UI);
     - `web/e2e-legacy/matlager-maalvalg.spec.ts` (ekte legacy, inkludert to samtidige legacy-sider);
     - domenetester i `web/src/domain/freezer/maalvalg.test.ts`.
   - **3b. React-«Fjern varen» med grunnlagsvern.** _Levert (ordre 6700834307 i #20)._
     - Før: React sendte bare post-id og gjorde ubetinget `remove()`. En batch eller et antall som en annen klient la til etter at brukeren så posten, ble slettet med.
     - Nå: slettetrykket sender posten slik brukeren så den (fra abonnementet). En transaksjon på akkurat den noden sammenligner fersk verdi med grunnlaget (`fjernHvisUendret`). Er de like, slettes posten. Er posten endret eller borte, gis synlig konflikt uten verdiendring og uten gjenoppretting. Grunnlaget hentes aldri på nytt i bakgrunnen.
     - Sammenligningen er stabil JSON av postens lagrede felt: alle batcher (rekkefølge, antall, enhet, vekt), navn, `itemId` og ukjente felt. Et `id`-felt som bare gjentar nodenøkkelen (legacy) ses bort fra. Et `id`-felt som avviker fra nøkkelen beholdes og gir avvisning. RTDB lagrer ikke `null`, og begge sider kommer fra serveren, så fravær sammenlignes likt.
     - Abonnementet gir nå alltid nodenøkkelen som `id`, også når en legacy-post har et eget `id`-felt. Slik treffer alle skrivinger noden som vises.
     - Utfallene lagret, konflikt, avvist og ukjent vises i Matlager. Ved ukjent utfall sier teksten at vi ikke vet om posten ble fjernet. Knappen er låst mens forsøket pågår. Ingen automatisk nytt forsøk og ingen optimistisk fjerning (`applyLocally: false`).
     - Uendret: +/−, «Legg til» (skive 3), legacy og datakontrakten. Ingen Angre og ingen bekreftelsesdialog.
     - **Egen `__proto__`-nøkkel (review 5809537574):** sammenligningen bygger sorterte objekter med `Object.fromEntries`, så en egen `__proto__`-nøkkel bevares som felt. Domenetester bruker `JSON.parse` på posten og i et nestet ukjent objekt.
     - **Separat begrensning (ikke rettet, egen beslutning):** syntetisk emulatorsjekk viser at RTDB lagrer og returnerer `__proto__` som vanlig nøkkel over REST. Firebase JS SDK (`firebase` 12.18.0 i `web/`, legacy-CDN-versjonen ikke sjekket) gjør derimot nøkkelen om til prototype i `val()`, både på posten og nestet. Klienter som går via SDK-en, ser derfor ikke slike felt, og grunnlagsvernet kan ikke oppdage endringer i dem ende-til-ende. Verre: en transaksjon som skriver verdien tilbake, fjerner slike felt fra databasen. Det gjelder også en uendret tilbakeskriving. Det rammer:
       - konfliktstien i nodetransaksjonene fra #125 og #127;
       - +/−;
       - samlingstransaksjonen fra #126, som skriver tilbake alle poster ved «Legg til».

       Legacy fra #125 har i tillegg samme `reduce`-mønster i sin `stabilJson`. Om slike nøkler finnes i produksjon, er ikke lest. Ingen migrering eller validering er bygget.

     - Tester (emulator):
       - domene `web/src/domain/freezer/fjern.test.ts`;
       - integrasjon `web/src/data/freezer.fjern.integration.test.ts`;
       - React-UI `web/e2e-skriving/matlager-fjern.spec.ts`, der foreldet bilde lages med tilbakeholdt websocket.
4. **Kjøleskap og tørrvarer (skive 2, etter P1 og P2 og etter punkt 2 og 3).**
   - Valgfritt `sted` per batch, filter «Alle · Fryser · Kjøleskap · Tørrvarer» og hurtigregistrering med forhåndsvalgt sted.
   - «Flytt» i én transaksjon med grunnlagssjekk. Basisvarer er uendret.
   - Aksept og tester:
     - domenetester for eksemplene;
     - emulatortest for flytting samtidig med justering;
     - e2e der eksisterende fryserdata vises som fryser.
5. **Automatisk forbruk (parkert, ikke valgt).** Krever avklaring av:
   - batch og sted;
   - mengde per porsjon og enhetsomregning;
   - utilstrekkelig beholdning;
   - angring og avvik (`actual`).

## 6. Produktvalg og tekniske valg

Tekniske valg tas av oss og legges ikke frem for Helen. Det gjelder identitetsregel, transaksjonsgranularitet, grunnlagssjekk, angringsregler og om en varig operasjonsidentitet skal innføres.

Foreløpige produktvalg om brukerens registreringsbehov:

| #   | Spørsmål                                                                                 | Anbefalt svar                                                                                                                                                                                   | Konsekvens                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Skal kjøleskap og tørrvarer registreres med mengde, eller holder «har hjemme»?           | Mengde, med antall forhåndsutfylt (1 stk/pk) og lett å endre. Merk: «1 stk/pk» **er** en mengde. Det finnes ingen mengdeløs tilstedeværelsesmodell for beholdning, og en slik foreslås ikke nå. | Én skjemaflyt for alle steder. Vil Helen heller ha ren tilstedeværelse, trengs en egen modell eller et eget felt. Det er en ny kontrakt og eget valg. |
| P2  | Skal én vare på flere steder vises som ett kort med steder, eller som ett kort per sted? | Ett kort per vare, med sted per batch og filter per sted.                                                                                                                                       | Én sum per vare og atomisk flytting når varen har én post (avsnitt 4). Filteret gir en «kjøleskapsvisning».                                           |

Allerede avgjort, og spørres ikke om:

- Beholdning er informasjon og justerer aldri handlelisten automatisk (Kjøkken v1).
- Batchregelen for pakkestørrelse (designbok §3.4).
- Automatisk forbruk er parkert.
