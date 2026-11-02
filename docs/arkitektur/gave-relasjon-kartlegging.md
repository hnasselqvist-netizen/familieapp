# Kartlegging: gave- og relasjonsmodulen (julegaver først)

**Status:** kartleggingen ble godkjent i #103 (review 5731097785). S1 er implementert etter oppdraget i #59 6566492516. Avsnitt 3 beskriver den **implementerte** kontrakten (`web/src/types/gaver.ts`). Ingen produksjonsdata er opprettet av utviklingen.

Produktgrunnlaget er Helens beslutninger 26.07, gjeninnført 31.10 ([`docs/roadmap.md`](../roadmap.md) «Omprioritering 31.10»).

## 1. Hva som finnes i dag

Søket dekket `index.html`, `web/src`, `mcp-server/src`, `infra/firebase` og `docs/`. Søkeordene var gave, relasjon, bursdag, anledning, mottaker, person og birthday. I produksjonen ble bare **nodenavn** lest, i tillegg til navnet på én budsjettpost.

| Område                         | Funn                                                                                                                                                                                                       | Kilde                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Personer, anledninger og ideer | **Finnes ikke** i kode, skjema eller produksjonsdata. Ingen av de 27 toppnodene under familien er et person- eller gaveregister.                                                                           | Kodesøk; `data_nokler("")`                                                                            |
| `members`                      | Tilgangsstyring (Firebase-uid), **ikke** et relasjonsregister. Skal ikke gjenbrukes. MCP-skrivevakten sperrer noden.                                                                                       | `infra/firebase/database.rules.json`, `mcp-server/src/data/skriving.ts`                               |
| `events`                       | Legacy-hendelseslogg (`{type, meta, ts}`, 19 nøkler), ikke anledninger.                                                                                                                                    | `index.html` (`dbSet(${FAM}/events/…)`)                                                               |
| Hjem & familie                 | Ruten `/hjem-familie` og bunnmenyen finnes, men viser legacy-plassholderen «Her kommer vedlikehold, hjem og familie» via `LegacyBridge`. Ingen funksjon. Rommet er parkert.                                | `web/src/routes/router.tsx`, `web/src/components/BottomNav.tsx`, `index.html` `HjemFamilieScreen`     |
| Budsjett: Gaver                | Kostnadsgruppen `gaver` finnes med posten `gaver` («Gaver») og en egen post `msszmus4yazn` («Gavepapir, kort og annet»). **Den felles posten for gavepapir, kort og bånd finnes altså allerede.**          | `web/src/types/budsjettfamilie.ts` `GROUP_TEMPLATES`; `data_nokler("budget/gaver")`                   |
| Faktisk gavekostnad            | Føres som `hendelser/{id}.fordelinger[]` med `plasseringId` = budsjettpost (`plasseringType: "budget"`). Den knyttes til en banktransaksjon, eller er manuell (`kilde: "manuell"`, for eksempel gavekort). | `web/src/types/forsoning.ts`, `web/src/domain/forsoning/fordeling.ts`, `ManuellRegistreringPanel.tsx` |
| Mellomværende (#95)            | Gaveutlegg som en annen har betalt, føres som faktisk kostnad på Gaver via manuell hendelse med `mellomvaerende`-kobling. Ingen avtaler er lagret ennå (noden finnes ikke).                                | `web/src/types/mellomvaerende.ts`, `web/src/domain/mellomvaerende/`                                   |
| Mottatte gaver                 | Inntektsposter `pengegaver` og `gavekort` (gruppe Annet). Er ikke en del av første skive.                                                                                                                  | `index.html` `INCOME_GROUP_TEMPLATE`                                                                  |
| Gangen                         | `MAKS_PUNKTER = 3`. Låst valg C: ingen økonomi i Gangen. Et gavepunkt kan bare være ikke-økonomisk («2 mangler gave») og er en egen beslutning.                                                            | `web/src/domain/gangen/dagensPunkter.ts`                                                              |
| Rules                          | `families/$familyId` har lese- og skrivetilgang for medlemmer. **En ny node krever ingen rules-endring og ingen rules-deploy.**                                                                            | `infra/firebase/database.rules.json`                                                                  |
| MCP                            | `data_les`, `data_nokler` og `data_skriv` er generiske på stier under familien. Nye noder blir lesbare uten MCP-endring. Skriving fra Work skjer bare på bestilling. Fra Claude-økten skrives det aldri.   | `mcp-server/src/data/`                                                                                |

Konklusjon: det finnes ingen gave- eller relasjonsfunksjon å gjenbruke som skjerm eller data. Økonomisiden, det vil si budsjettposter, hendelser og mellomværende, finnes og skal gjenbrukes uten å føres dobbelt.

## 2. Gjenbruk og prinsipper

- **Ingen dobbeltføring.**
  - Gavemodulen lagrer **aldri** brukt beløp. Faktisk kostnad er fortsatt hendelsenes fordeling på Gaver-postene.
  - Planlagt beløp per gave er bare plan.
  - Juleoversikten viser budsjettet for desember for `budget/gaver/gaver` til sammenligning, men **skriver det ikke**.
- **Gavepapir, kort og bånd** bruker den eksisterende posten `msszmus4yazn` og fordeles ikke på mottakere (26.07).
- **Kobling til faktisk kjøp** (senere skive) skjer som en referanse `hendelseId` på gaven. Det er samme mønster som kvittering ↔ transaksjon (`matchedTransactionId`), uten å endre hendelsen. Er gaven betalt av en annen, er det fortsatt mellomværende (#95) som fører kostnaden.
- **Felles register, ingen nye roller.** Registeret tilhører familien (`families/{familyId}`) og har ingen eier eller familierolle. Det bygges ikke noe multi-tenant-UI (CLAUDE.md).
- **Personopplysninger og skriving.** Navn, fødselsdato og notater om ekte personer lagres som familiens øvrige data.
  - Ingen automatisk oppretting eller import, og ingen produksjonsdata i utvikling eller test (bare emulator).
  - Konkrete brukerskrivinger skjer etter gjeldende autorisasjon: autoriserte familiemedlemmer via UI, og Work på konkret brukerbestilling.
  - Rapportering fra Claude-økten følger dagens regel: bare tellinger og utfall, aldri innhold.

## 3. Datakontrakt (implementert i S1)

Kontrakten følger det vedtatte grunnlaget (26.07, gjeninnført 31.10):

- Gruppene gir standardanledninger **og** gavebudsjett. Personen kan ha unntak.
- Anledningen registreres som utgangspunkt.
- Idéliste og gavehistorikk oppstår av seg selv.

Beløp lagres i øre. Tidspunkter er ISO-strenger. Ukjente felt bevares ved skriving. **Alle beløp er plan**: ingenting skrives til `budget`, `hendelser`, `transaksjoner`, `receipts` eller `rules`.

**RTDB-stabilitet (review 5731097785):**

- Firebase lagrer aldri `null`; feltet forsvinner. Budsjettvalget er derfor en diskriminert union med eksplisitt `type`, slik at «arv», «ikke satt» og et beløp (også 0) overlever en rundtur.
- Et manglende felt betyr alltid «arv». `false` og `0` er ekte valg.
- Datalaget avviser `null` før skriving, **rekursivt** gjennom objekter og arrays, med stien i feilen (review 5731352564). Eksplisitt `undefined` som hele verdien på en endringssti betyr sletting av akkurat det feltet.

Kildefilen er `web/src/types/gaver.ts`. Kort:

```ts
type AnledningsType = "jul" | "bursdag";
type FastBudsjett = { type: "ikke_satt" } | { type: "belop"; belopOre: number }; // ≥ 0
type Budsjettvalg = { type: "arv" } | FastBudsjett;

// families/{familyId}/relasjonsgrupper/{gruppeId}
// gruppeId ∈ "naer" | "utvidet" | "venner" | "andre" (fast i koden; visningsnavn
// nærmeste familie / utvidet familie / venner / andre)
{ standard: { jul?: { aktiv?: boolean; budsjett?: FastBudsjett }, bursdag?: … }, versjon }

// families/{familyId}/relasjoner/{personId}
{ navn, gruppe, fodselsdato?, notat?, arkivert?,
  unntak: { jul?: { aktiv?: boolean; budsjett?: Budsjettvalg }, bursdag?: … },
  versjon, opprettet, oppdatert }

// families/{familyId}/anledninger/{anledningId}
{ type: AnledningsType | "annen", aar, navn?,
  mottakere: { [personId]: { budsjett: FastBudsjett; fjernet?: string } },
  versjon, opprettet, oppdatert }

// families/{familyId}/gaver/{gaveId}
{ personId, anledningId?, tekst, status: "ide" | "kjopt" | "gitt",
  valgt?: true, planlagtOre?, versjon, opprettet, oppdatert }
```

`sisteSkriving` (en innholdsbasert skrive-ID) lagres i tillegg av datalaget, så en retry blir idempotent. `hendelseId` kommer først i en senere skive.

**Arv** (`effektivStandard` i `web/src/domain/gaver/gaver.ts`) går feltvis: personens unntak, deretter gruppens standard, deretter standarden.

- Standarden er at jul og bursdag er aktive og budsjettet ikke er satt.
- Ingen kronebeløp legges inn som standard.
- `{type: "arv"}` og et manglende felt arver begge.

**Anledningens identitet og opprettelse:**

- **Jul:** `anledningId = "jul-<år>"`. Én per år.
- **Bursdag:** `"bursdag-<personId>-<år>"`. Én per person og år.
- **Annen anledning:** en generert push-ID, så flere slike samme år har hver sin stabile identitet.
- **Opprettelse:** anledningen opprettes eksplisitt («Start juleplanlegging 2026»), før det finnes noen ideer eller gaver. Jul og bursdag skrives med create-if-absent (transaksjon på den deterministiske stien), så to enheter ikke kan lage duplikater.
- **Mottakere:** ved opprettelse fylles `mottakere` fra registeret, det vil si ikke-arkiverte personer med effektiv `aktiv`, sammen med effektivt budsjett.
  - Senere kan mottakere legges til og budsjettet endres **for denne anledningen**, uten å endre gruppen eller personen.
  - Personer som er lagt til i registeret etter oppstart, foreslås, men legges aldri til automatisk.
  - **Fjerning er myk** (`fjernet`): gavene beholdes og vises under «Fjernet fra årets liste» uten å telle i summene, og mottakeren kan legges tilbake med samme øyeblikksbilde.
- **Kontrakten låser ikke** framtidige bursdager eller ad hoc-anledninger. S1 bygger bare jul.

**Idéliste, historikk og status:**

- **Idéliste:** gaver med `status: "ide"`. Uten `anledningId` er de personens løpende idéliste, og med `anledningId` hører de til anledningen.
- **Historikk** oppstår av seg selv: gaver og mottakere på tidligere anledninger.
  - Arkivering eller redigering av en person endrer ikke tidligere anledninger. Mottakere og budsjett er et øyeblikksbilde, gaver refererer til en stabil `personId`, og personer slettes aldri.
  - Gruppebytte påvirker bare anledninger som opprettes senere.
- **«Mangler gave»** utledes: en mottaker på anledningen uten gave med `status` `kjopt` eller `gitt` og samme `anledningId`. En idé teller ikke som kjøpt.
- **Planlagt sum** er summen for valgte ideer (`valgt`), kjøpte og gitte gaver. Ideer som ikke er valgt, er alternativer og telles ikke, så flere ideer gir ikke en misvisende sum.

**Skriving** (`web/src/data/gaver.repository.ts`) skjer per post, aldri på hele noden. Hver skriving er én transaksjon på postens egen sti:

- **Versjonsvakt:** kalleren sender versjonen brukeren så. Avviker serverens versjon, avbrytes skrivingen med `EndretAvAndre`. UI-et beholder utkastet og lar brukeren lagre sin versjon likevel eller forkaste den.
- **Fersk serververdi:** updateren avbryter aldri på lokal cache, så serveren avgjør alltid mot sin egen verdi.
- **Idempotent retry:** samme endring fra samme grunnlag gir «allerede», ikke konflikt.
- **Oppretting** er create-if-absent, og en eksisterende post overskrives aldri.
  - `jul-<år>`: retry og en annen enhet får den lagrede anledningen, aldri en reset.
  - Ny person eller gave fra et skjema lagrer en innholdsbasert skrive-ID. En retry godtas bare når den lagrede posten er **nøyaktig** denne opprettingen og uendret siden.
  - Er posten endret, enten av en annen enhet eller fordi utkastet er endret, gir det konflikt, og utkastet beholdes. Fersk versjon adopteres aldri automatisk; «Lagre min versjon likevel» er en eksplisitt endring mot den lagrede versjonen (review 5731352564 P1).
- **Bare feltene skjemaet eier, patches** (`domain/gaver/endringer.ts`), for eksempel `unntak/jul/aktiv`, `…/budsjett/type`, `…/budsjett/belopOre`, og bare `fjernet` ved gjenoppretting. Ukjente felt og underfelt bevares, og «arv» sletter bare de kjente feltene.
- Ingen ferdigmelding vises før lagringen er bekreftet.

Modulen ligger i `domain/gaver`, `data/gaver.repository.ts`, `hooks/useGaver.ts` og `features/hverdagsflyt/familie/` innenfor dagens modulgrenser.

## 4. Første nyttige skive (S1): julegaver 2026

Plassering: `/hjem-familie/gaver` blir første React-innhold i Hjem & familie, og erstatter plassholderen bare for denne delen. Resten av rommet forblir parkert.

**Inn:**

1. **Personregister:** legg til, rediger og arkiver personer (navn, gruppe, valgfri fødselsdato og notat), gruppert etter gruppe.
2. **Gruppestandard for jul:** aktiv og planlagt budsjett per mottaker, per gruppe. Personunntak overstyrer det samme for én person.
3. **Start juleplanlegging 2026:** oppretter `jul-2026` med mottakere og budsjett fra arven. Mottakere kan legges til eller fjernes for i år.
4. **Per mottaker:** ideer (også personens løpende idéliste) og gaver med status idé → kjøpt → gitt, og valgfritt planlagt beløp.
5. **Juleoversikt:**
   - mottakere, hvem som mangler gave og hvem som er ferdig;
   - planlagt budsjett mot sum planlagt per gave;
   - til sammenligning, bare lesing, desemberbudsjettet for posten Gaver og for «Gavepapir, kort og annet» (som ikke fordeles på mottakere).

   Det vises ingen faktisk kostnad før hendelseskoblingen finnes.

6. **Tester:**
   - enhetstester av ren domenelogikk (arv og unntak, opprettelse av mottakere, mangler/ferdig, summer, at historikk står seg når en person arkiveres, redigeres eller bytter gruppe);
   - emulatortest av repository (create-if-absent for `jul-2026`, per-post-skriving, ukjente felt bevares);
   - én e2e-flyt mot emulatoren.

**Senere skiver, ikke i S1:**

- bursdag og andre anledninger i UI, selv om kontrakten bærer dem;
- påminnelser og Gangen-punkt;
- kobling til faktisk kostnad (`hendelseId`);
- egne historikkvisninger;
- statusen «pakket», som kan legges til uten datatap;
- MCP-verktøy;
- mottatte gaver.

## 5. Gjenværende avklaring

Det tidligere vedtatte grunnlaget er ivaretatt i kontrakten. Plassering, status og når hendelseskoblingen kommer, er tekniske og reversible valg, og ble avgjort i review 5730949528. Det er **ingen gjenværende produktspørsmål** til Helen før et implementeringsoppdrag.

Én standard er valgt fordi grunnlaget ikke sier det eksplisitt, og den kan endres i UI uten datatap: uten lagret gruppeinnstilling er jul og bursdag aktive for alle fire gruppene, og budsjettet er ikke satt.

Ingenting krever IAM, rules, billing eller driftssteg.
