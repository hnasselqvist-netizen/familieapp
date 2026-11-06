# Matlager: kjøleskap, tørrvarer og forbruksstøtte — kartlegging

Status: kartlegging, ikke implementeringsgodkjenning (#20, ordre 6690219276).
Grunnlag: fersk `main`. Det er ikke lest produksjonsdata.

Kort svar:

- Matlager har i dag to modeller: frysebatcher med mengde og basisvarer uten mengde.
- Den minste trygge veien til kjøleskap og tørrvarer er et valgfritt **sted per batch** i den eksisterende frysermodellen. Det krever ingen migrering, ingen ny backend og ingen nye rules.
- Først bør tre konkrete svakheter i dagens skrivevei rettes. Det kan gjøres uten produktvalg (skive 1).
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

## 2. Konkrete risikoer i dagens kode (ikke produktvalg)

1. **Legacy skriver hele samlingen.**
   - `setFreezer` gjør `dbSet(FAM/freezer, alle poster fra lokal tilstand)`.
   - En legacy-side med et gammelt bilde kan derfor overskrive en +/−, en ny batch eller en sletting som er gjort i React eller på en annen enhet. En slettet post kan også komme tilbake.
   - Legacy-`add` regner i tillegg ut nye batcher fra komponentens `freezer`-prop, ikke fra `p`.
   - Dette er samme feilklasse som Spillerom før #118.
2. **Duplikatpost ved samtidig ny vare.**
   - `useFreezer.addBatch` velger målposten fra lokal tilstand og matcher på navn. Finnes ingen post, får den ny UUID.
   - To enheter som legger inn samme nye vare samtidig, får to poster med samme navn.
   - Visningen og `freezerLabel` (`find` på navn) viser da bare den ene.
3. **Feil sum ved blandede enheter.**
   - `freezerLabel` summerer `count` på tvers av ulike enheter og bruker enheten til første batch. For eksempel blir «2 pk + 3 stk» til «5 pk i Matlager».
   - `totalGrams` summerer bare batcher med `gramsPerUnit`. Grams vises dermed som om det var alt, selv om det finnes batcher uten vekt.
4. **Gram per enhet på g og kg.** Skjemaet tillater `gramsPerUnit` når enheten er `g` eller `kg`, som gir etiketter som «2 kg à 500 g».

## 3. Syntetiske eksempler

Eksemplene bruker forslaget i skive 2: valgfritt `sted` per batch, der manglende sted betyr `fryser`.

| Situasjon                       | Lagret (én node per vare)                                              | Visning                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Samme vare flere steder         | Kjøttdeig: `{2 pk à 400 g, fryser}`, `{1 pk à 400 g, kjøleskap}`       | «800 g i fryser · 400 g i kjøleskap». Totalt 1200 g.                                                                            |
| Kompatible enheter              | Mel: `{1 kg}`, `{500 g}`                                               | 1500 g. Omregning g↔kg og ml↔dl↔l er ren visning; lagret enhet beholdes.                                                        |
| Inkompatible enheter            | Bønner: `{2 boks}` (uten vekt), `{300 g}`                              | «2 boks · 300 g». Ingen falsk totalsum, i motsetning til risiko 3.                                                              |
| Flytting (tine)                 | −1 på fryserbatchen og +1 på kjøleskapsbatchen i **samme transaksjon** | Totalen er uendret. Ingen varehistorikk og ingen handleliste.                                                                   |
| Nytt innkjøp                    | Ny batch, eller sammenslåing på `sted` + enhet + gram                  | Totalen øker.                                                                                                                   |
| Basisvare mot beholdning        | Salt: bare `staples`                                                   | Salt: «har vanligvis hjemme», uten mengde. Generatoren avhuker den som i dag.                                                   |
| Beholdning uten basisvare       | Melk: `{1 l, kjøleskap}`                                               | Gjennomgangen viser «har 1 l i kjøleskap» som informasjon. Ingen automatisk avhuking.                                           |
| Samtidig +1 og −1 på samme vare | Begge går via `transactFreezerItem` på samme node                      | Begge endringene bevares (dekket av eksisterende integrasjonstest). En gammel legacy-side kan fortsatt overskrive; se risiko 1. |

**Hvorfor sted per batch, ikke egen post per sted:**

- All beholdning av én vare ligger i én node. Flytting, justering og sammenslåing blir da én atomisk transaksjon.
- Med egen post per sted måtte en flytting skrive til to noder.

## 4. Modell, migrering og drift (tekniske valg, håndteres av oss)

- **Modell:** valgfritt `sted?: "fryser" | "kjoleskap" | "torrvarer"` på `FreezerBatch`, der manglende verdi betyr `fryser`. Stien er uendret.
  - Ingen migrering eller omskriving av eksisterende data.
  - Sammenslåingsnøkkelen utvides til `sted` + enhet + `gramsPerUnit`.
- **Bakoverkompatibilitet med legacy:**
  - Legacy bevarer ukjente batchfelt når den justerer (`{...b, count}`), og nye legacy-batcher blir `fryser`.
  - Men legacy-`add` slår sammen uten å se på sted. Den kan derfor øke en kjøleskapsbatch med samme enhet og gram.
  - Før stedvalg vises, må legacy-skrivingen derfor rettes etter samme mønster som #118, eller sperres. Det er del av skive 1.
- **Familieisolasjon:** uendret. Alle stier ligger under `families/{familyId}`, og rules krever medlemskap.
- **Kildeversjon og konflikt:** RTDB-transaksjon per node. Ingen ny versjonsmekanisme trengs.
- **Retry og idempotens:**
  - Justeringer er deltaer i transaksjon og kan ikke dupliseres av SDK-et selv.
  - En ny batch kan bli lagt til to ganger hvis brukeren trykker på nytt etter ukjent utfall. Knappen bør derfor låses til transaksjonen er bekreftet.
  - Skive 2 bør bruke `batch.id` fra klienten som idempotensnøkkel inne i transaksjonen: finnes id-en allerede, gjøres ingenting.
- **Reversibilitet:** +/− og flytting reverseres med motsatt delta. «Fjern» sletter noden; et «Angre»-varsel kan skrive tilbake den siste verdien (mønster fra Spillerom).

## 5. Skiver

**Skive 1 (anbefalt først, ingen produktvalg, ingen datakontraktendring):** risikoene i dagens Matlager.

- Legacy `setFreezer` per node med transaksjon, som #118. Legacy-`add` regnes på fersk verdi.
- `useFreezer.addBatch`: lag ny post med deterministisk id per vare (`itemId`) i stedet for tilfeldig UUID, slik at to samtidige nye innlegg treffer samme node. Eksisterende poster beholder id-en sin, så det trengs ingen migrering.
- `freezerLabel`/`totalGrams`: summer per enhet, og vis gram bare når alle batcher har vekt. Skjul gram per enhet for `g`/`kg`.
- Aksept og tester:
  - domenetester for blandede og inkompatible enheter;
  - emulatortest for to samtidige nye innlegg av samme vare, som skal gi én post med 2;
  - legacy-Playwright der en frakoblet legacy-klient og en React-klient endrer samtidig, uten tap;
  - R3b-vakt.

**Skive 2 (etter P1 og P2):** kjøleskap og tørrvarer i samme Matlager.

- Valgfritt `sted` per batch, filter «Alle · Fryser · Kjøleskap · Tørrvarer» og hurtigregistrering med forhåndsvalgt sted fra filteret.
- «Flytt» mellom steder i én transaksjon. Etiketter per sted.
- Basisvarer er uendret og står som egen seksjon.
- Aksept og tester:
  - eksemplene i avsnitt 3 som domenetester;
  - emulatortest for flytting og samtidig justering på samme node;
  - e2e: registrer i kjøleskap, flytt fra fryser, og eksisterende fryserdata vises som fryser.

**Skive 3 (parkert, ikke valgt):** automatisk forbruk ved bekreftet middag. Krever egne avklaringer:

- hvilken batch og hvilket sted som trekkes;
- mengde per porsjon og enhetsomregning;
- hva som skjer når beholdningen ikke strekker til;
- hvordan angring og avvik (`actual`) skal virke.

## 6. Produktvalg som faktisk mangler

| #   | Spørsmål                                                                                 | Anbefalt svar                                                                                                                                                             | Konsekvens                                                                                  |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| P1  | Skal kjøleskap og tørrvarer registreres med mengde, eller holder «har hjemme»?           | Antall er forhåndsutfylt med 1 og enheten med «stk»/«pk». Mengde er valgfritt å justere. Ingen egen modell for «bare tilstedeværelse»; basisvarer dekker «har vanligvis». | Én skjemaflyt for alle steder og lav registreringskostnad. Tilstedeværelse vises som «har». |
| P2  | Skal én vare på flere steder vises som ett kort med steder, eller som ett kort per sted? | Ett kort per vare, med sted per batch og filter per sted.                                                                                                                 | Atomisk flytting og én sum per vare. Filteret gir en «kjøleskapsvisning» uten egen modell.  |

Allerede avgjort, og spørres ikke om:

- Beholdning er informasjon og justerer aldri handlelisten automatisk (Kjøkken v1).
- Batchregelen for pakkestørrelse (designbok §3.4).
- Automatisk forbruk er parkert.

Under eksisterende mandat kan skive 1 gjøres som en liten, reverserbar PR. Legacy-delen (`index.html`) krever, som før, at ordren eksplisitt omfatter legacy-skriveveien. Skive 2 venter på P1 og P2.
