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
| Legacy                   | `index.html` ~5086–5133, `setFreezer` ~16727                         | Legacy-Matlager skriver **hele** `freezer` med `dbSet` fra lokal tilstand.                                                                                                                                   |
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

1. **Legacy skriver hele samlingen.**
   - `setFreezer` gjør `dbSet(FAM/freezer, alle poster fra lokal tilstand)`.
   - En legacy-side med et gammelt bilde kan overskrive en +/−, en ny batch eller en sletting gjort i React eller på en annen enhet. En slettet post kan også komme tilbake.
   - Legacy-`add` regner nye batcher fra komponentens `freezer`-prop, ikke fra `p`.
   - Samme feilklasse som Spillerom før #118.
2. **Vareidentitet: flere poster for samme vare.** `useFreezer.addBatch` velger målpost ved å matche navn i **lokal** tilstand, og lager ellers en ny tilfeldig UUID. `findOrCreateItem` matcher også på navn mot et øyeblikksbilde. Konkrete veier til duplikat:
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

| Situasjon                       | Lagret                                                                 | Ønsket visning                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Samme vare flere steder         | Kjøttdeig: `{2 pk à 400 g, fryser}`, `{1 pk à 400 g, kjøleskap}`       | «800 g i fryser · 400 g i kjøleskap»                                                                                  |
| Direkte masse, kompatibel       | Mel: `{1 kg}`, `{500 g}`                                               | «1,5 kg». Omregning g↔kg og ml↔dl↔l er bare visning; lagret enhet beholdes.                                           |
| Pakningsvekt + direkte masse    | Kjøttdeig: `{2 pk à 400 g}`, `{500 g}`                                 | «1300 g». Begge typer er masse.                                                                                       |
| Inkompatible                    | Bønner: `{2 boks}` (uten vekt), `{300 g}`                              | «2 boks · 300 g». Ingen totalsum.                                                                                     |
| Gammel tvetydig verdi           | `{2, "kg", gramsPerUnit: 500}`                                         | «2 kg à 500 g» som i dag. Ikke med i noen sum, og ikke skrevet om.                                                    |
| Flytting (tine)                 | −1 på fryserbatchen og +1 på kjøleskapsbatchen i **samme transaksjon** | Totalen er uendret. Ingen varehistorikk og ingen handleliste.                                                         |
| Nytt innkjøp                    | Ny batch, eller sammenslåing på `sted` + enhet + gram                  | Totalen øker.                                                                                                         |
| Basisvare mot beholdning        | Salt: bare `staples`                                                   | «Har vanligvis hjemme», uten mengde. Generatoren avhuker den som i dag.                                               |
| Beholdning uten basisvare       | Melk: `{1 l, kjøleskap}`                                               | Gjennomgangen viser «har 1 l i kjøleskap» som informasjon. Ingen automatisk avhuking.                                 |
| Samtidig +1 og −1 på samme vare | Begge som deltaer i `transactFreezerItem` på samme node                | Begge bevares (dekket av eksisterende integrasjonstest). En gammel legacy-side kan fortsatt overskrive; se svakhet 1. |

## 4. Identitet, samtidighet og reversibilitet (tekniske valg, håndteres av oss)

### Identitet: velg én målpost ved commit

- **Anbefaling:** å legge til en ny batch velger målposten **i transaksjonen**, ikke fra lokal tilstand.
  - Fryseren er liten, så transaksjonen kan gå på hele `freezer` med normalisert navn som nøkkel.
  - **Ett treff:** batchen legges i den posten. Dette dekker tilfelle a. Tilfelle b dekkes også, fordi navnet, ikke `itemId`, velger posten.
  - **Ingen treff:** det opprettes én ny node i samme transaksjon. To samtidige forsøk gir én post, fordi transaksjonen kjøres på nytt med fersk verdi.
  - **Flere treff (tilfelle c):** skrivingen **avvises synlig** med «Det finnes flere poster for Kjøttdeig — velg hvilken». Ingen automatisk sammenslåing.
- **Konsekvens:**
  - Skriveveien endres: transaksjon på samlingen i stedet for på noden. Uavhengige varer kan da få flere omforsøk.
  - Datakontrakten (form og sti) er uendret, og ingenting migreres.
  - Identitetsregelen «samme vare = samme normaliserte navn» er dagens regel, nå håndhevet ved commit. Eksisterende duplikater blir stående og vises.
- **Atomisk flytting og ett kort per vare** gjelder bare for varer som faktisk har én post. For tilfelle c må brukeren velge post, eller duplikatene må ryddes separat. Det bestilles ikke her.
- **Legacy:** så lenge legacy skriver hele samlingen (svakhet 1), kan den fortsatt lage og overskrive poster. Identitetsvernet er bare helt når legacy-skrivingen også er rettet.

### Fersk verdi, brukerens grunnlag og idempotens

- **Delta (+1/−1):** brukerens hensikt er relativ. RTDB kjører transaksjonen på nytt med fersk verdi, og det er riktig. Det trengs ikke noe forventet-versjon-vern.
- **Absolutt endring og sletting:** for eksempel «sett antall til 3», «fjern varen» eller «flytt 2 pk». Brukeren handler ut fra det hen så.
  - En fersk transaksjon alene vil gjennomføre handlingen selv om verdien er endret i mellomtiden.
  - Slike operasjoner trenger grunnlagssjekk, som `LikviditetKonflikt` i #118: forventet batch, antall og om noden finnes. Avvik avvises synlig, og ingenting skrives.
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
  - Stedvalg forutsetter derfor at legacy-skrivingen er rettet eller sperret først.
- **Familieisolasjon:** uendret, med alt under `families/{familyId}`.

## 5. Skiver og rekkefølge

Hver retting er en egen liten PR. De samles ikke.

1. **Første og minste retting: mengdevisning (svakhet 3 og 4).**
   - Ren, skrivefri domene- og visningsendring i `freezerLabel`/`totalGrams`, etter de tre mengdetypene i avsnitt 3.
   - Gamle tvetydige verdier vises som de er.
   - Skjul gram per enhet for `g`/`kg` i skjemaet for nye registreringer.
   - Aksept og tester: domenetester for hvert eksempel i avsnitt 3, og eksisterende `freezerLabel`-tester oppdateres. Ingen data endres.
2. **Legacy-skrivevei (svakhet 1).**
   - Transaksjon per node etter mønsteret fra #118. Legacy-`add` regnes på fersk verdi.
   - Krever at ordren eksplisitt omfatter legacy-skriveveien.
   - Aksept og tester: legacy-Playwright med en frakoblet legacy-klient og en React-klient som endrer samtidig uten tap, og R3b-vakten.
3. **Vareidentitet og grunnlag (svakhet 2, avsnitt 4).**
   - Velg målpost ved commit, og avvis synlig ved flere treff.
   - Grunnlagssjekk for absolutte endringer og sletting.
   - Aksept og tester (emulator):
     - to samtidige nye innlegg av samme navn gir én post;
     - en foreldet klient finner eksisterende legacy-post;
     - to `itemId` for samme navn gir én post;
     - eksisterende duplikat gir synlig avvisning;
     - sletting på foreldet grunnlag avvises.
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
