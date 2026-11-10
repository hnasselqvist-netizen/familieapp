# Arbeidsflyt: endre mengden på én fryserpost (ChatGPT via MCP)

Dette er roadmap «Praktisk vedlikehold via ChatGPT», bestilt i #27 (6757615055).

Arbeidsflyten setter antallet på **én batch** i **én entydig eksisterende fryserpost** til et nytt heltall på minst 1. Det skjer bare etter eksplisitt bestilling fra brukeren. Den bruker bare de generelle verktøyene `data_les`, `data_hent` og `data_skriv` (`mcp-server/README.md` §«Generell skriving»), i samme datakontrakt som appen.

Den gjør ikke noe av dette:

- fjerner batcher eller poster (mengde 0);
- legger til batcher eller poster;
- endrer enhet eller pakningsvekt;
- registrerer forbruk, historikk eller handleliste;
- legger til nye verktøy eller endrer rules.

## 1. Datakontrakten

- **Sti:** én fryserpost er én node, `freezer/{id}` (`web/src/data/freezer.repository.ts`). Appen endrer en eksisterende post per node med `transactFreezerItem`, aldri hele samlingen. Arbeidsflyten gjør det samme.
- **Postens form** (`FreezerItem` i `web/src/types/freezer.ts`): `{ itemId, name, batches: [...] }`. Nodenøkkelen er postens id. Eldre poster har i tillegg et lagret `id`-felt og mangler ofte `itemId`.
- **En batch** (`FreezerBatch`) er `{ id, count, unit, gramsPerUnit }`:
  - `count` er antallet i batchens egen enhet. For «5 pk à 200 g» er `count` 5. For en batch med `unit: "g"` og uten `gramsPerUnit` er `count` antall gram.
  - `gramsPerUnit: null` lagres ikke av RTDB, så nøkkelen mangler da.
  - En post kan ha flere batcher med ulik enhet eller pakningsvekt. «Legg til» slår sammen bare ved lik `unit` og `gramsPerUnit` (`mergeBatchIntoBatches`).
- **Produksjon** (lest skrivefritt 10.11, bare skjema og tellinger):
  - 14 poster;
  - 13 har et eldre `id`-felt og ingen `itemId`, og 1 har `itemId`;
  - 1 post har 3 batcher, og de andre har 1;
  - alle `count` er positive heltall;
  - ingen batch-id finnes to ganger.

## 2. Appens ordinære mengdehandling

Det finnes ingen handling i appen som setter en mengde direkte. Den ordinære handlingen er **＋/− per batch** i Matlageret (`FreezerScreen`). Den kaller `useFreezer.adjustBatchCount(postId, batchId, ±1)`, som igjen kjører `transactFreezerItem` med `applyBatchAdjustmentToItemFields` (`web/src/domain/freezer/freezer.ts`).

- Bare `count` på den valgte batchen endres. Andre batcher, alle andre felt på posten og felt appen ikke kjenner står urørt, også det eldre `id`-feltet. Transaksjonen får råverdien, og domenet kopierer den med spredning.
- Antallet går aldri under 0. En batch som når 0, fjernes. Når siste batch fjernes, fjernes hele posten.
- Det er ingen sideeffekter. Det skrives ikke historikk, forbruk eller handleliste.

Å sette `count` fra c til N, der N ≥ 1, gir derfor samme lagrede resultat som å trykke ＋ eller − |N − c| ganger. Det er semantikken arbeidsflyten speiler.

## 3. Hva som støttes, og hvor grenen stoppes

| Bestilling                                                                                                      | Handling                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nytt antall N (heltall ≥ 1) på én entydig batch i én entydig post                                               | Støttes (4–7).                                                                                                                                                |
| Mengde 0, «tom», «brukt opp» eller «fjern»                                                                      | **Stopp.** Det krever et valg om å fjerne en batch eller en post, og om det er forbruk. Det er ikke avklart. Vis brukeren appens − og «Fjern fra matlageret». |
| Ny enhet eller pakningsvekt, for eksempel «3 pk» på en batch i `stk`, eller «1,2 kg» på en batch i `pk à 400 g` | **Stopp.** Appen endrer aldri enhet eller vekt på en batch. Omregning ville vært et nytt batchvalg.                                                           |
| En totalmengde for en post med flere batcher, for eksempel «Karbonadedeig: 3»                                   | **Stopp og spør** hvilken batch som menes. Vis batchene med `batchLabel`. Fordeling over batcher gjøres aldri.                                                |
| Ny vare eller ny batch                                                                                          | Utenfor denne arbeidsflyten. Appens «Legg til» har egen målpostlogikk (`leggTilVedCommit`).                                                                   |
| N er ikke et heltall, eller er negativt                                                                         | **Stopp** og spør. Appen teller i hele steg.                                                                                                                  |

## 4. Les smalt

1. **Posten:** `data_les { sti: "freezer" }`. Bare nøkkel, `name` og batchenes `unit`, `gramsPerUnit` og `count` brukes.
   - Treff er poster der `name` er lik brukerens navn uten hensyn til store og små bokstaver, som appens `sammeNavn` (brukt av `observertMaal`). Brukerens navn trimmes først.
   - **Ett treff:** bruk det.
   - **Ingen treff, flere treff eller bare liknende navn:** vis kandidatene og la brukeren velge. Gjett aldri.
2. **Grunnlaget:** `data_hent { sti: "freezer/<id>" }` gir `verdi` og `versjon` fra **samme** lesing. Alt videre bygger på denne råverdien.
3. **Formkontroll på råverdien.** Stopp uten skriving hvis noe av dette ikke holder:
   - posten er et objekt;
   - `batches` er en liste uten hull;
   - hver batch er et objekt med tekst i `id`, et endelig tall i `count` og tekst i `unit`.

## 5. Velg batchen

- **Én batch** og ingen enhet oppgitt: bruk den. Vis den med `batchLabel`, for eksempel «7 stk», før skriving.
- **Enhet oppgitt:** batchen må ha samme `unit`. Er pakningsvekt oppgitt, må også `gramsPerUnit` være lik.
- **Flere batcher:** brukeren må peke ut én. Treffer valget flere batcher, eller ingen, stopp og spør.
- **Batch-id-en** til den valgte batchen må finnes nøyaktig én gang i `batches`. Hvis ikke, stopp uten skriving.

Vis brukeren før skriving: postens navn, batchen, nåværende antall og nytt antall.

## 6. Skriv

1. Lag opId **én gang**, før første kall, etter kontrakten i `mcp-server/src/data/skriving.ts` (`OPID`).
   - Formen er `ÅÅÅÅ-MM-DD_<suffiks>`, der datoen er dagens dato i **UTC**.
   - Suffikset er tilfeldig, 8–80 tegn av `A–Z`, `a–z`, `0–9` og `-`.
   - opId og operasjonen noteres uendret for retry.
2. **Én `set` på hele postnoden** `freezer/<id>`:
   - `verdi` er en kopi av **hele** råverdien der bare `count` på den valgte batchen er endret til N.
   - Alle andre felt følger uendret: det eldre `id`-feltet, `itemId`, `name`, ukjente felt, andre batcher og rekkefølgen.
   - `forventet` er postversjonen fra **samme** `data_hent` som råverdien.

   Delvis `update` på `freezer/<id>/batches/<indeks>` brukes ikke. Indeksen er ikke en identitet: en samtidig fjernet batch flytter de andre, og en versjon av bare `count` kan treffe en annen batch med samme antall. Det skrives aldri på `freezer`, fordi det ville kollidert med appens per-post-skriving.

   Eksempel. Råverdi:

   ```json
   {
     "id": "p1",
     "name": "Tortilla lefser",
     "batches": [{ "id": "b1", "count": 7, "unit": "stk" }]
   }
   ```

   Bestillingen «sett tortilla lefser til 5» gir:

   ```json
   {
     "sti": "freezer/p1",
     "type": "set",
     "verdi": {
       "id": "p1",
       "name": "Tortilla lefser",
       "batches": [{ "id": "b1", "count": 5, "unit": "stk" }]
     },
     "forventet": "<postversjonen fra samme data_hent>"
   }
   ```

3. **Kan ikke skrives tapsfritt.** Kopien kan ha noe dagens kontrakt avviser: en nøkkel som ikke er et gyldig stisegment, `__proto__`, `constructor` eller `prototype`, eller en tom liste eller et tomt objekt. Da stopper du uten skriving og melder grunnen.

## 7. Utfall, konflikt og retry

Ingen utfall fører til en ny automatisk skriving.

| Utfall                             | Handling                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `committed`                        | Les tilbake (8). Med `senereEndret: true` har appen endret posten etterpå. Det er ikke en feil, og det skal ikke «rettes».                                                                                                                                                                                                          |
| `replay`                           | Allerede lagret med samme opId. Ingen ny skriving. Les tilbake.                                                                                                                                                                                                                                                                     |
| `konflikt`                         | Posten er endret siden den ble lest, for eksempel med ＋/− i appen. Ingenting er skrevet. Les posten på nytt med `data_hent`. Har batchen allerede antallet N og posten ellers den planlagte verdien, rapporter den som lagret. Ellers viser du den nye tilstanden og spør brukeren før en ny skriving med ny versjon og nytt opId. |
| `ukjent_utfall`, `skriving_feilet` | Utfallet er uavklart. Bare på brukerens forespørsel, og innenfor gyldighetsvinduet (30 dager, og etter `_mcp/vannmerke`), prøves det igjen med **samme opId og samme operasjon**, aldri et nytt opId. Er `skriving_feilet` `vedvarende`, stopp og meld grunnen.                                                                     |
| `utlopt`                           | Kvitteringen kan ikke lenger bevise utfallet. Les posten. Rapporter den som lagret bare ved likt innhold, ellers som uavklart, uten å overskrive. Avklar med brukeren før en eventuell ny skriving med nytt opId.                                                                                                                   |
| Andre feil                         | `ugyldig_skriving`, `invalid_path`, `beskyttet`, `for_stor`, `forelder_er_verdi`, `not_member` og `idempotency_conflict` skriver garantert ingenting. Meld grunnen.                                                                                                                                                                 |

## 8. Les tilbake og meld

- Les `data_hent { sti: "freezer/<id>" }` og sammenlign **hele** posten med verdien som ble sendt.
- Avvik med `senereEndret: true` er appens senere endring. Meld dem som de er.
- Meld brukeren postens navn, batchen (`batchLabel`), gammelt og nytt antall, og hva posten nå inneholder.

## 9. Kodeankre og tester

- **Kontrakt:**
  - `web/src/types/freezer.ts`;
  - `web/src/data/freezer.repository.ts` (`subscribeFreezer`, `transactFreezerItem`);
  - `web/src/domain/freezer/freezer.ts` (`applyBatchAdjustmentToItemFields`, `batchLabel`, `observertMaal`);
  - `web/src/hooks/useFreezer.ts` (`adjustBatchCount`);
  - `web/src/features/hverdagsflyt/mat/freezer/FreezerScreen.tsx` (＋/− per batch).
- **Eksisterende dekning:**
  - `freezer.test.ts` dekker ＋/−, at 0 fjerner batchen og at siste batch fjerner posten;
  - `freezer.repository.integration.test.ts` dekker at samtidige ＋ på samme post ikke mister data;
  - `mcp-server/src/store/dataSkriving.integration.test.ts` dekker `set`, konflikt, retry og tilbakelesing.
- **Ny syntetisk regresjon** (`freezer.repository.integration.test.ts`, emulator):
  - ＋/− via appens skrivevei endrer bare `count` på valgt batch og bevarer felt på posten og i batchen, også det eldre `id`-feltet;
  - − til 0 fjerner batchen, og siste batch fjerner posten. Det er grenen arbeidsflyten ikke dekker (3).
