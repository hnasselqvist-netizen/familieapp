# Kartlegging: gave- og relasjonsmodulen (julegaver først)

**Status:** dette er en kartlegging til review (#59 6565087187). Ingen kode er endret, og ingen data er opprettet eller endret. Detaljert implementeringsoppdrag følger etter review.

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
- **Felles register, ingen roller.** Registeret tilhører familien (`families/{familyId}`) og har ingen eier eller familierolle. Det bygges ikke noe multi-tenant-UI (CLAUDE.md).
- **Personopplysninger.** Navn, fødselsdato og notater om ekte personer lagres som familiens øvrige data.
  - Rapportering fra Claude-økten følger dagens regel: bare tellinger og utfall, aldri innhold.
  - Ingen personer eller gaver opprettes i produksjon av andre enn Helen.

## 3. Forslag til datakontrakt (to nye noder)

Beløp lagres i øre, som `belopOre` i forsoningen. Tidspunkter er ISO-strenger. Ukjente felt bevares ved skriving.

```ts
// families/{familyId}/relasjoner/{personId}
interface Person {
  navn: string;
  gruppe: "naer" | "utvidet" | "venner" | "andre"; // fast liste i koden
  fodselsdato?: string; // "YYYY-MM-DD" eller "--MM-DD" (år ukjent)
  notat?: string;
  /** Unntak fra gruppens standardanledninger, f.eks. { jul: false }. */
  anledninger?: Partial<Record<"jul" | "bursdag", boolean>>;
  arkivert?: string; // skjules, slettes ikke (historikk bevares)
  opprettet: string;
  oppdatert: string;
}

// families/{familyId}/gaver/{gaveId}
interface Gave {
  personId: string;
  anledning: { type: "jul" | "bursdag" | "annen"; aar: number; navn?: string };
  tekst: string; // idé eller gave
  status: "ide" | "kjopt" | "gitt"; // «mangler» = ingen gave med status ≥ kjopt
  planlagtOre?: number; // bare plan
  hendelseId?: string; // senere skive: referanse til faktisk kostnad
  opprettet: string;
  oppdatert: string;
}
```

- **Grupper og standardanledninger** ligger som konstanter i koden. Jul og bursdag er standard for alle fire gruppene, og personunntak ligger i `anledninger`. Gavebudsjett per gruppe er en åpen beslutning (punkt 6.3), og lagres eventuelt i en liten `relasjoner`-innstilling, ikke i `budget`.
- **Idéliste og historikk** er ikke egne strukturer. Ideer er gaver med `status: "ide"`. Historikk er gaver fra tidligere anledninger (`aar` < i år), og oppstår av seg selv.
- **«Mangler gave»** utledes: en person med aktiv jul i år og ingen gave med `status` `kjopt` eller `gitt`.
- **Skriving** skjer per post (`update` på egen sti, ikke hele noden), med samme mønster som `budsjettfamilie.repository.ts` og `mellomvaerender.repository.ts`. Modulen får egne `domain/gaver`, `data/gaver.repository.ts` og `features/hverdagsflyt/familie/` innenfor dagens modulgrenser.

## 4. Første nyttige skive (S1): julegaver 2026

**Inn:**

1. **Personregister:** legg til, rediger og arkiver personer (navn, gruppe, valgfri fødselsdato og notat). Listen er gruppert etter gruppe.
2. **Unntak:** «Ikke med i jul» per person.
3. **Jul 2026 per person:** ideer og gaver med status idé → kjøpt → gitt, og valgfritt planlagt beløp.
4. **Juleoversikt:** mottakere, hvem som mangler gave og hvem som er ferdig, sum planlagt, og til sammenligning (bare lesing) desemberbudsjettet for Gaver og for «Gavepapir, kort og annet».
5. **Tester:**
   - enhetstester av ren domenelogikk (mangler/ferdig, unntak, summer);
   - emulatortest av repository (per-post-skriving, ukjente felt bevares);
   - én e2e-flyt mot emulatoren.

**Ikke i S1:**

- bursdagspåminnelser og anledninger utover jul;
- Gangen-punkt;
- kobling til hendelse eller transaksjon;
- egne historikkvisninger;
- MCP-verktøy;
- mottatte gaver;
- import av personer.

## 5. Plassering

`/hjem-familie` er i dag en tom legacy-plassholder i et parkert rom. Relasjoner er besluttet å være et felles register, «ikke bare en økonomimodul» (26.07). **Anbefaling:** S1 blir første React-innhold i Hjem & familie (for eksempel `/hjem-familie/gaver`), og plassholderen erstattes bare for denne delen. Alternativet er en fane i Forvaltning, men det plasserer registeret i økonomien. Uansett krever det at parkeringen av rommet oppheves for dette formålet.

## 6. Åpne beslutninger før implementeringsoppdraget

1. **Plassering:** Hjem & familie (anbefalt) eller Forvaltning.
2. **Statusene:** er idé → kjøpt → gitt nok, eller trengs «pakket»?
3. **Gavebudsjett:** per gruppe (for eksempel per person i nær familie), en samlet julesum, eller bare sammenligning mot desemberbudsjettet for Gaver (minst administrasjon, anbefalt for S1)?
4. **Gruppenavnene:** er nær familie, utvidet familie, venner og andre faste?
5. **Kobling til faktisk kjøp** (`hendelseId`): i S2 (anbefalt), eller i S1?

Ingen av disse krever IAM, rules, billing eller driftssteg.
