# Arbeidsflyt: legg én batch til én eksisterende fryserpost (ChatGPT via MCP)

Dette er roadmap «Praktisk vedlikehold via ChatGPT», bestilt i #27 (6765215113).

Arbeidsflyten legger **én batch** til **én eksisterende** fryserpost etter eksplisitt bestilling fra brukeren, som appens «Legg til i matlageret». Den bruker bare `data_les`, `data_hent` og `data_skriv` (`mcp-server/README.md` §«Generell skriving»).

Den gjør ikke noe av dette:

- oppretter nye fryserposter;
- oppretter varer i varebasen;
- endrer mengde på eller fjerner batcher (se [`fryser-mengde.md`](fryser-mengde.md) og [`fryser-fjern.md`](fryser-fjern.md));
- registrerer forbruk eller historikk.

## 1. Appens handling

`FreezerScreen.submit` gjør to separate skrivinger:

1. **Varebasen:** `findOrCreateItem(navn, kategori)` (`web/src/data/items.repository.ts`).
   - Den leser `items` og finner varen med `findItemByName`, som sammenligner trimmet tekst uten hensyn til store og små bokstaver (`handlelisteRules.ts`).
   - Ved flere treff vinner det første i nøkkelorden.
   - Finnes ingen vare, **oppretter** den en ny vare i `items`. Det er en egen skriving, ikke i samme transaksjon som fryseren.
2. **Fryseren:** `useFreezer.addBatch` kjører `transactFreezerSamling` med `leggTilVedCommit` (`web/src/domain/freezer/freezer.ts`). Det er **én transaksjon på hele `freezer`**, med fersk verdi.
   - **Målvalg på fersk samling.** Treff er poster der `name` er lik `vare.name` uten hensyn til store og små bokstaver (`sammeNavn`, uten trimming).
     - Den observerte posten er slettet: avvisning.
     - Den observerte posten har fått nytt navn: avvisning.
     - Flere treff: avvisning.
     - Ingen treff: **ny post**.
     - Ett treff: den posten, også en eldre post med `id`-felt.
   - **Eksisterende post** beholder nøkkel, `id`-felt, ukjente felt og `itemId`. `itemId` settes til `vare.id` bare når det mangler.
   - **Sammenslåing** (`mergeBatchIntoBatches`): den nye batchen legges til `count` på den første batchen med **lik** `unit` og **lik** `gramsPerUnit`. Ellers legges den sist.
     - En lagret batch uten pakningsvekt mangler nøkkelen, fordi RTDB ikke lagrer `null`. Den slås derfor **ikke** sammen med en ny batch uten vekt (`null`), og det blir en ny batch.
     - Dette er dagens regel, karakterisert i `freezer.maalvalg.integration.test.ts`. Arbeidsflyten speiler den uendret.
   - **Ny batch:** `{ id: <uuid>, count: heltall ≥ 1 (standard 1), unit, gramsPerUnit: heltall eller null }`.
   - **Utfall:** `lagret`, `konflikt` (avvisning), `avvist` eller `ukjent`. Ingen automatisk nytt forsøk.

## 2. Speiling, og hvor grenen stoppes

- **Målvalget avhenger av hele samlingen.** En ny navnelik post på en annen enhet gjør at målvalget ikke lenger holder (`flere-treff`). En versjon av én post fanger ikke det. Arbeidsflyten bruker derfor **samlingens** versjon og skriver hele samlingen, slik appen gjør i `transactFreezerSamling`.
- **Varebasen leses, men skrives aldri.**
  - Finnes varen ikke, ville appen opprettet den. Arbeidsflyten **stopper** i stedet og ber brukeren legge varen til i appen.
  - Gir navnet flere treff i varebasen, **stopper** arbeidsflyten også. Appen velger da det første i nøkkelorden, men sidene fra `data_les` er ikke ett øyeblikksbilde.
- **Ingen eksisterende post** for varen: **stopp**. En ny post er utenfor denne arbeidsflyten.

| Bestilling eller tilstand                                                       | Handling                                                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Én batch til én eksisterende post, med varen entydig i varebasen                | Støttes (3–6).                                                           |
| Varen finnes ikke i varebasen, eller finnes flere ganger                        | **Stopp.** Appen ville opprettet varen eller valgt én etter nøkkelorden. |
| Ingen fryserpost treffer `vare.name`                                            | **Stopp.** Ny post er utenfor.                                           |
| Flere poster treffer                                                            | **Stopp**, som appens `flere-treff`. Duplikatene må ryddes i appen.      |
| «Brukt opp», fjerning eller ny mengde                                           | Andre arbeidsflyter.                                                     |
| Antall er ikke et heltall ≥ 1, eller pakningsvekten er ikke et positivt heltall | **Stopp** og spør.                                                       |

## 3. Les og bestem

1. **Varen:** `data_les { sti: "items" }`, med alle sider (følg `neste` til `null`).
   - Treff er varer der `name` er lik bestillingens navn etter trimming og uten hensyn til store og små bokstaver, som `findItemByName`.
   - Kan en vare ikke leses, stopp.
   - Krev **nøyaktig ett** treff. Det gir `vare.id` og `vare.name`.
2. **Fryseren:** `data_hent { sti: "freezer" }` gir hele samlingen og `versjon` fra **samme** lesing.
   - `forStor`, eller ingen `versjon`: stopp uten skriving.
   - Mangler samlingen, finnes ingen post: stopp.
3. **Målvalg på denne verdien:** finn poster der `name` er lik `vare.name` uten hensyn til store og små bokstaver (`sammeNavn`, uten trimming).
   - Krev nøyaktig ett treff, ellers stopp (2).
   - Har posten `batches` som ikke er en liste, er formen ukjent. Stopp.
4. **Den nye batchen:**
   - `id` er en ny tilfeldig UUID;
   - `count` er bestilt antall (heltall ≥ 1, standard 1);
   - `unit` er bestilt enhet;
   - `gramsPerUnit` er bestilt pakningsvekt. Uten vekt **utelates** nøkkelen, fordi `data_skriv` avviser `null` og RTDB uansett ikke lagrer den.
5. **Ny samling:** en kopi av **hele** råsamlingen der bare målposten er endret:
   - `itemId` settes til `vare.id` bare hvis den mangler;
   - `batches` slås sammen etter regelen i 1.
     - Finnes en lagret batch med lik `unit` og en `gramsPerUnit` som er lik den bestilte, økes dens `count`.
     - Uten bestilt vekt slås batchen aldri sammen med en lagret batch, fordi nøkkelen mangler der. Den nye batchen legges da sist.
   - Alle andre felt og poster er uendret.
6. **Meld hva som legges til,** for eksempel «2 pk à 400 g til Karbonadedeig». Si om batchen ble slått sammen med en eksisterende, eller ble en ny batch. En eksplisitt og entydig bestilling autoriserer skrivingen (#27 6509067353).

## 4. Skriv

1. Lag opId **én gang** etter `OPID` i `mcp-server/src/data/skriving.ts`: `ÅÅÅÅ-MM-DD_<suffiks>` med UTC-dato og et tilfeldig suffiks på 8–80 tegn. opId og operasjonen noteres uendret.
2. Send `data_skriv { opId, ops: [{ sti: "freezer", type: "set", verdi: <ny samling>, forventet: "<samlingsversjonen fra samme data_hent>" }] }`.
   - Enhver endring i fryseren etter lesingen gir `konflikt`, og ingenting skrives. Det gjelder også ＋/−, «Legg til», «Fjern» eller en ny navnelik post på en annen enhet. Dette er strengere enn appen, som beregner på nytt, men aldri svakere.
3. **Kan ikke skrives tapsfritt.** Kopien kan ha noe `data_skriv` avviser: en ugyldig nøkkel, `__proto__`, `constructor` eller `prototype`, en tom liste eller et tomt objekt. Svaret kan også bli `for_stor`. Da stopper du uten skriving og melder grunnen.

## 5. Utfall, konflikt og retry

Ingen utfall fører til en ny automatisk skriving.

| Utfall                             | Handling                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `committed`                        | Les tilbake (6).                                                                                                                                                                                                                                                                                                |
| `replay`                           | Allerede lagret med samme opId. Ingen ny skriving. Les tilbake.                                                                                                                                                                                                                                                 |
| `konflikt`                         | Fryseren er endret siden lesingen. Ingenting er skrevet. Les på nytt (3), og vis den nye tilstanden. Holder målvalget og bestillingen fortsatt, er grunnlaget likevel nytt. Avklar med brukeren før en eventuell ny skriving med ny versjon og nytt opId.                                                       |
| `ukjent_utfall`, `skriving_feilet` | Uavklart. Bare på brukerens forespørsel, og innenfor gyldighetsvinduet (30 dager, og etter `_mcp/vannmerke`), prøves det igjen med **samme opId og samme operasjon**, aldri nytt opId. Er `skriving_feilet` `vedvarende`, stopp og meld grunnen.                                                                |
| `utlopt`                           | Kvitteringen kan ikke lenger bevise utfallet. Les uten å skrive. Ble batchen lagt til som **ny**, viser dens unike `id` at operasjonen ble lagret. Ble den **slått sammen**, kan et antall ikke skilles fra andre endringer, så utfallet meldes som uavklart. Avklar med brukeren før en eventuell ny skriving. |
| Andre feil                         | `ugyldig_skriving`, `invalid_path`, `beskyttet`, `for_stor`, `forelder_er_verdi`, `not_member` og `idempotency_conflict` skriver garantert ingenting. Meld grunnen.                                                                                                                                             |

## 6. Les tilbake og meld

- **Den innebygde tilbakelesingen** i svaret fra `data_skriv` gir lagret versjon og `senereEndret`. Utfallet av operasjonen er det `data_skriv` bekreftet: `committed` eller `replay`.
- **En separat, fersk `data_hent { sti: "freezer/<nøkkel>" }`** viser målposten nå. Sammenlign med det som ble sendt for posten.
- **Avvik** meldes som de er, med det bekreftede utfallet og nåtilstanden hver for seg. Påstå ingen årsak, og «rett» ingenting.
- **Meld brukeren** posten, batchen som ble lagt til (ny eller sammenslått), og hva posten nå inneholder.

## 7. Kodeankre og tester

- **Kontrakt:**
  - `web/src/data/items.repository.ts` (`findOrCreateItem`);
  - `web/src/domain/shopping/handlelisteRules.ts` (`findItemByName`, `normalizeItemName`);
  - `web/src/data/freezer.repository.ts` (`transactFreezerSamling`);
  - `web/src/domain/freezer/freezer.ts` (`leggTilVedCommit`, `mergeBatchIntoBatches`, `observertMaal`, `batchLabel`);
  - `web/src/hooks/useFreezer.ts` (`addBatch`);
  - `web/src/features/hverdagsflyt/mat/freezer/FreezerScreen.tsx` (`submit`).
- **Eksisterende dekning:**
  - `maalvalg.test.ts` og `freezer.maalvalg.integration.test.ts` dekker:
    - målvalg på fersk samling, også eldre post og ny navnelik post;
    - flere treff, og observert post slettet eller omdøpt;
    - `itemId` som bevares;
    - sammenslåing, også at en lagret batch uten vekt ikke slås sammen med en ny batch uten vekt;
    - ukjente felt og andre poster som bevares;
    - `avvist`.
  - `freezer.test.ts` dekker sammenslåingsregelen.
  - `handlelisteRules.test.ts` dekker `findItemByName`.
  - `mcp-server/src/store/dataSkriving.integration.test.ts` dekker `set`, konflikt, replay og tilbakelesing.
- **Ingen ny test.** Dekningen var komplett for det arbeidsflyten bygger på.
