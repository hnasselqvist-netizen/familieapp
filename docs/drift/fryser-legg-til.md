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
- **Identiteten til målet holdes fast.** Har brukeren pekt ut en bestemt post, eller er den observert tidligere i samtalen, bindes skrivingen til den **nodenøkkelen**, slik `observertId` gjør i `leggTilVedCommit`. Er den posten slettet eller omdøpt, stopper arbeidsflyten, også om en annen post med samme navn står igjen.
- **Bare allerede koblede poster.** Appen setter `itemId` fra et oppslag i varebasen som ikke er med i fryserens transaksjon. Varen kan være slettet, omdøpt eller erstattet før skrivingen. Arbeidsflyten kan ikke skrive en ny kobling med et atomisk grunnlag. Den støtter derfor bare poster som **allerede har** en `itemId`, der varen er validert. Koblingen bevares uendret, slik `post.itemId || vare.id` gjør.
- **Varebasen leses, men skrives aldri.** Appen kan opprette en vare. Arbeidsflyten gjør aldri det.

| Bestilling eller tilstand                                                                                  | Handling                                                                                          |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Én batch til én eksisterende post med validert `itemId`                                                    | Støttes (3–6).                                                                                    |
| Posten mangler `itemId` (eldre poster)                                                                     | **Stopp.** Appen ville satt koblingen fra et oppslag uten atomisk grunnlag. Legg til i appen.     |
| `itemId` peker på en vare som mangler, har et annet navn, eller ikke er den varen varebasen gir for navnet | **Stopp.** Koblingen er avvikende eller ugyldig.                                                  |
| Varen finnes ikke i varebasen, eller finnes flere ganger                                                   | **Stopp.** Appen ville opprettet varen eller valgt én etter nøkkelorden.                          |
| Ingen fryserpost treffer                                                                                   | **Stopp.** Ny post er utenfor.                                                                    |
| Flere poster treffer                                                                                       | **Stopp**, som appens `flere-treff`. Duplikatene må ryddes i appen.                               |
| Den observerte eller utpekte posten er slettet eller omdøpt                                                | **Stopp**, som `observert-slettet` og `observert-omdopt`. Avklar målet før en eventuell skriving. |
| «Brukt opp», fjerning eller ny mengde                                                                      | Andre arbeidsflyter.                                                                              |
| Ugyldig antall, enhet eller pakningsvekt (3.5)                                                             | **Stopp** og spør.                                                                                |

## 3. Les og bestem

En eksplisitt og entydig bestilling autoriserer skrivingen (#27 6509067353). Bare tvetydig mål, en tvetydig kobling eller et endret grunnlag avklares.

1. **Varebasen:** `data_les { sti: "items" }`, med alle sider (følg `neste` til `null`). Kan en vare ikke leses, stopp.
   - Treff er varer der `name` er lik bestillingens navn etter trimming og uten hensyn til store og små bokstaver, som `findItemByName`.
   - Krev **nøyaktig ett** treff. Det gir `vare.id` og `vare.name`.
   - Dette er bare validering. Varebasen skrives aldri, og ingen `itemId` hentes herfra til skrivingen.
2. **Fryseren:** `data_hent { sti: "freezer" }` gir hele samlingen og `versjon` fra **samme** lesing.
   - `forStor`, eller ingen `versjon`: stopp uten skriving.
   - Mangler samlingen, finnes ingen post: stopp.
3. **Målet, avgjort på denne verdien:** poster der `name` er lik `vare.name` uten hensyn til store og små bokstaver (`sammeNavn`, uten trimming).
   - **Flere treff:** stopp.
   - **Utpekt eller observert mål** (en kjent nodenøkkel): noden må finnes og `name` må fortsatt treffe. Ellers stopp og avklar. Den brukes aldri for å gå videre til en annen navnelik post.
   - **Ellers:** krev nøyaktig ett treff, ellers stopp.
   - **Ukjent form:** har posten `batches` som ikke er en liste, stopp.
4. **Koblingen:** målposten må ha `itemId`, og den må være lik `vare.id` fra 1.
   - Valider at `data_hent { sti: "items/<itemId>" }` finnes, og at `name` der fortsatt treffer bestillingen.
   - Mangler `itemId`, eller er den avvikende eller ugyldig: stopp (2).
   - Koblingen skrives ikke, den bevares bare.
5. **Den nye batchen,** med samme felt som appens skjema (`FreezerScreen.submit`):
   - `unit` er en av appens enheter: `stk`, `g`, `kg`, `ml`, `dl`, `l`, `pk`, `boks` og `pose`.
   - `count` er et heltall ≥ 1, standard 1.
     - Appen tolker antall med `parseInt(…) || 1`, så `0` og ugyldige tall blir 1, og desimaler kuttes.
     - Arbeidsflyten gjetter ikke på samme måte. Den spør i stedet.
   - `gramsPerUnit` er et positivt heltall. Appen tilbyr vekt bare for `pk`, `boks`, `pose`, `g` og `kg`. Uten vekt **utelates** nøkkelen, fordi `data_skriv` avviser `null` og RTDB uansett ikke lagrer den.
   - `id` er en ny tilfeldig UUID.
6. **Planlagt samling:** en kopi av **hele** råsamlingen der bare målpostens `batches` er endret etter regelen i 1. Alle andre felt, inkludert `itemId`, og alle andre poster er uendret.
   - **Planlagt sammenslåing:** finnes en lagret batch med lik `unit` og en `gramsPerUnit` som er lik den bestilte, økes dens `count`.
   - **Planlagt ny batch:** uten bestilt vekt slås batchen aldri sammen med en lagret batch, fordi nøkkelen mangler der. Den nye batchen legges da sist.
   - Meld hva som **planlegges**, for eksempel «2 pk à 400 g til Karbonadedeig, ny batch». Bekreftet utfall meldes først i 6.

## 4. Skriv

1. Lag opId **én gang** etter `OPID` i `mcp-server/src/data/skriving.ts`: `ÅÅÅÅ-MM-DD_<suffiks>` med UTC-dato og et tilfeldig suffiks på 8–80 tegn. opId og operasjonen noteres uendret.
2. Send `data_skriv { opId, ops: [{ sti: "freezer", type: "set", verdi: <ny samling>, forventet: "<samlingsversjonen fra samme data_hent>" }] }`.
   - Enhver endring i fryseren etter lesingen gir `konflikt`, og ingenting skrives. Det gjelder også ＋/−, «Legg til», «Fjern» eller en ny navnelik post på en annen enhet. Dette er strengere enn appen, som beregner på nytt, men aldri svakere.
3. **Kan ikke skrives tapsfritt.** Kopien kan ha noe `data_skriv` avviser: en ugyldig nøkkel, `__proto__`, `constructor` eller `prototype`, en tom liste eller et tomt objekt. Svaret kan også bli `for_stor`. Da stopper du uten skriving og melder grunnen.

## 5. Utfall, konflikt og retry

Ingen utfall fører til en ny automatisk skriving.

| Utfall                             | Handling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `committed`                        | Les tilbake (6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `replay`                           | Allerede lagret med samme opId. Ingen ny skriving. Les tilbake.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `konflikt`                         | Fryseren er endret siden lesingen. Ingenting er skrevet. Les på nytt (3), og vis den nye tilstanden. Holder målvalget og bestillingen fortsatt, er grunnlaget likevel nytt. Avklar med brukeren før en eventuell ny skriving med ny versjon og nytt opId.                                                                                                                                                                                                                                                                     |
| `ukjent_utfall`, `skriving_feilet` | Uavklart. Bare på brukerens forespørsel, og innenfor gyldighetsvinduet (30 dager, og etter `_mcp/vannmerke`), prøves det igjen med **samme opId og samme operasjon**, aldri nytt opId. Er `skriving_feilet` `vedvarende`, stopp og meld grunnen.                                                                                                                                                                                                                                                                              |
| `utlopt`                           | Kvitteringen kan ikke lenger bevise utfallet, og utfallet meldes som **uavklart**. Les uten å skrive. Finnes den planlagte batch-id-en nå, er det et **spor** i nåtilstanden, ikke en kvittering som beviser at dette opId-et lagret den. Finnes den ikke, kan batchen være slått sammen, aldri lagret, eller lagret og senere fjernet. Det er uavklart det også. En sammenslått batch kan heller ikke skilles ut fra antallet. Ingen automatisk ny skriving. Avklar med brukeren før en eventuell ny skriving med nytt opId. |
| Andre feil                         | `ugyldig_skriving`, `invalid_path`, `beskyttet`, `for_stor`, `forelder_er_verdi`, `not_member` og `idempotency_conflict` skriver garantert ingenting. Meld grunnen.                                                                                                                                                                                                                                                                                                                                                           |

## 6. Les tilbake og meld

- **Bekreftet utfall** er det `data_skriv` svarte: `committed` eller `replay`, med lagret versjon og `senereEndret` fra den innebygde tilbakelesingen.
- **Nåtilstanden** kommer fra en separat, fersk `data_hent { sti: "freezer/<nøkkel>" }`. Sammenlign med den planlagte posten fra 3.6.
  - Ved bekreftet utfall meldes faktisk resultat: ny batch med den planlagte id-en, eller sammenslått batch og nytt antall.
- **Avvik** meldes som de er, med bekreftet utfall og nåtilstand hver for seg. Påstå ingen årsak, og «rett» ingenting.
- **Meld brukeren** posten, det bekreftede utfallet og hva posten nå inneholder.

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
