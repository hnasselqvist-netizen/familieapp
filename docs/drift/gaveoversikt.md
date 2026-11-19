# Arbeidsflyt: skrivefri gaveoversikt (ChatGPT via MCP)

Roadmap «Praktisk vedlikehold via ChatGPT» (#27, ordre 7009439106). Ved en **eksplisitt bestilling** gir arbeidsflyten en oversikt over gavene for **én entydig anledning eller ett år**, eventuelt avgrenset til én person eller én gruppe. Den følger appens faktiske semantikk.

Den bruker bare leseverktøyene `data_nokler`, `data_les` og `data_hent` (`mcp-server/README.md` §«Full lesing» og §«Generell skriving» for `data_hent`). Den krever ingen nye verktøy eller domenetillatelser.

**Bare lesing.** Arbeidsflyten gjør ikke noe av dette:

- oppretter en anledning eller mottakere;
- endrer en status (også Pakket), et beløp, et budsjett eller en person;
- rydder data;
- bruker `data_skriv`.

Beløpene er **plan i øre**, ikke regnskapsført faktisk kostnad. Faktisk kostnad føres i økonomien og vises ikke her.

## 1. Datagrunnlaget

Fire noder under familien. **Identiteten er nøkkelen** (person-id, anlednings-id, gave-id), aldri navnet alene.

| Node                          | Nøkkel                                | Det appen leser (`web/src/data/gaver.repository.ts`)                                                                                                                                                            |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `relasjonsgrupper/{gruppeId}` | `naer`, `utvidet`, `venner`, `andre`  | `standard.jul` / `standard.bursdag`: `aktiv` (boolean) og `budsjett`. Andre gruppe-id-er hoppes over (`parseGrupper`).                                                                                          |
| `relasjoner/{personId}`       | person-id                             | `navn` (ikke-tom), `gruppe` (en av de fire), `unntak.jul` / `unntak.bursdag` (`aktiv`, `budsjett`), `arkivert`, `fodselsdato`, `notat`. **Uten gyldig navn eller gruppe hoppes posten over** (`parsePersoner`). |
| `anledninger/{anledningId}`   | `jul-<år>`, `bursdag-<personId>-<år>` | `type` (`jul`, `bursdag`, `annen`), `aar` (heltall), `mottakere/{personId}` med `budsjett` (øyeblikksbilde) og `fjernet`. **Uten gyldig type eller år hoppes anledningen over** (`parseAnledning`).             |
| `gaver/{gaveId}`              | gave-id                               | `personId` (påkrevd), `anledningId` (fravær betyr løpende idé), `tekst`, `status`, `valgt`, `planlagtOre`, `kjopsdato`. **Uten `personId` hoppes gaven over** (`parseGaver`).                                   |

**Former slik appen tolker dem:**

- **Budsjett** (`FastBudsjett`): `{type: "belop", belopOre}` med et heltall ≥ 0, eller `{type: "ikke_satt"}`.
  - **Eksplisitt 0 er et budsjett på 0 kr**, ikke «ikke satt».
  - En ugyldig budsjettform hos en mottaker leses som `ikke_satt`. En mottaker som ikke er et objekt, hoppes over (`parseMottakere`).
  - Hos en person eller gruppe hoppes en ugyldig form over, og verdien arves videre.
  - `{type: "arv"}` hos personen betyr arv fra gruppen.
- **Beløp på en gave** (`planlagtOre`): et heltall ≥ 0. **Mangler det, er beløpet ukjent**, ikke 0. Et ugyldig beløp (negativt, desimal, tekst) leses som manglende.
- **Status:**

  | Status                | Teller som       | I planen               | Merknad                                                                                                                                                                |
  | --------------------- | ---------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `ide`                 | idé              | bare med `valgt: true` | Ellers et alternativ som ikke telles.                                                                                                                                  |
  | `kjopt`               | kjøpt («Ferdig») | ja                     |                                                                                                                                                                        |
  | `pakket`              | kjøpt («Ferdig») | ja                     | Samme beløpssemantikk som Kjøpt, men **ikke Gitt**. Statusen kan foreløpig ikke velges i appen (forberedelse, `docs/drift/gaver-pakket-utrulling.md`), men kan finnes. |
  | `gitt`                | kjøpt («Ferdig») | ja                     |                                                                                                                                                                        |
  | annen eller manglende | **idé**          | bare med `valgt: true` | Appen viser en ukjent status som idé. Meld den som ukjent form, ikke som idé.                                                                                          |

- **Kjøpsdato** (`kjopsdato`, `YYYY-MM-DD`) er bare informasjon. **Året og anledningen avgjøres alltid av `anledningId`**, aldri av kjøpsdatoen.

## 2. Les

1. **Les alle fire nodene** med `data_les { sti: "<node>" }`. Følg `neste` til `null` for hver node.
   - Et barn som er `forStor`, leses på sin egen sti (`<node>/<nøkkel>`).
   - Kan et barn fortsatt ikke leses, tell det som **uleselig**. Det er ikke dekket.
   - Et barn med en form appen hopper over (§1), telles som **ukjent form** og meldes med nøkkel, ikke innhold.
   - **Parserfallback skjuler ikke dekning.** Appen erstatter enkelte ugyldige verdier med en standard: ukjent status blir idé, ugyldig beløp blir manglende, ugyldig mottakerbudsjett blir «ikke satt», og ugyldig budsjett hos person eller gruppe arves videre (§1). En slik verdi telles også som **ukjent form**, med nøkkel og felt. Den holdes utenfor de sikre tallene. Appens tall kan vises for seg, merket «slik appen viser det».
2. **Dekning:** noter antall nøkler per node (`data_nokler`, alle sider), antall lest, `forStor` lest på egen sti, uleselig og ukjent form.
   - Er noe uleselig, sier oversikten bare noe om det som er lest. Trekk ingen konklusjon om helheten, for eksempel «alle er ferdige».
3. **Ikke et samlet øyeblikksbilde.** Oversikten er alltid satt sammen av lesinger på **ulike tidspunkt**. Sidene i `data_les` leses hver for seg (README §«Full lesing»), og de fire nodene leses i egne kall. Endringer underveis kan gi en blanding av før og etter.
   - `data_hent { sti: "anledninger/<id>" }` gir én konsistent lesing av **bare den anledningsnoden** (`verdi` og `versjon` fra én `get()`).
   - Verken anledningens `versjon`-felt eller `data_hent`-versjonen versjonerer gaver, personer eller grupper. Gaveskrivinger endrer ikke anledningen. Ett `data_hent` gir derfor **ingen garanti** for at oversikten er et samlet øyeblikksbilde.
   - Oppgi **kildegrunnlaget** slik det faktisk finnes: hvilket verktøy som er brukt per node, rekkefølgen og tidspunktet for lesingene, og versjonene som finnes (anledningens `versjon`-felt, og `data_hent`-versjonen der den er brukt).
   - Hent aldri hele familieroten for å få ett øyeblikksbilde. Arbeidsflyten krever heller ingen ny serverfunksjon.
4. **Løpende ideer** (gaver uten `anledningId`) hører ikke til noen anledning og er ikke med i summene.

## 3. Velg anledning, år, person eller gruppe

- **Jul i et år:** anledningen er `jul-<år>`.
  - **Fravær må være bekreftet.** Anledningen finnes ikke bare når `data_les { sti: "anledninger/jul-<år>" }` svarer `type: "mangler"`, eller når nøkkelen mangler i en komplett `data_nokler`-listing av `anledninger` (alle sider).
  - Først da er juleplanleggingen **ikke startet**. Meld det. Opprett den aldri.
  - En anledningspost som er uleselig, `forStor` uten vellykket lesing på egen sti, eller i ukjent form (appens parser hopper over den), er **ukjent**. Den er ikke fravær. Juleplanen meldes da som ukjent, med grunnen.
- **Et år (helårsoversikt):** jul `jul-<år>` og bursdager `bursdag-<personId>-<år>`.
- **Én person:** pek ut personen med person-id.
  - Et navn må gi nøyaktig ett treff blant gyldige personer. Sammenlign trimmet, uten hensyn til store og små bokstaver.
  - Ingen eller flere treff: **stopp** og be om eksplisitt valg.
  - En mottaker eller gave kan peke på en person-id som ikke finnes i registeret. Appen viser den som «Ukjent person» under «Ikke i personregisteret».
- **Én gruppe:** appen grupperer etter personens **nåværende** gruppe i registeret (`grupperMottakere`), ikke etter noe lagret på anledningen.
  - Øyeblikksbildet på anledningen har bare budsjett og `fjernet`, ingen gruppe.
  - Mottakere uten person i registeret står i en egen restgruppe.
  - Meld at grupperingen er dagens tilhørighet.

## 4. Juleplanen for én anledning (`juleoversikt`)

Samme regler som «Jul <år>» i appen (`web/src/domain/gaver/gaver.ts`, `JulPlan.tsx`):

- **Mottakere** er anledningens `mottakere` uten `fjernet`. Arkiverte personer som står i øyeblikksbildet, er fortsatt mottakere. Appen markerer dem «arkivert».
- **Budsjett per mottaker** er **øyeblikksbildet på anledningen**, ikke personens eller gruppens budsjett i dag. Gruppene kan ha ulike budsjetter, og personer kan ha unntak. Anta aldri like budsjetter.
- **Ferdig** betyr at mottakeren har minst én gave med status Kjøpt, Pakket eller Gitt (`erKjopt`). **Mangler gave** gjelder resten.
- **Planlagt for gaver** er summen av `planlagtOre` for gaver i planen: valgt idé, Kjøpt, Pakket og Gitt (`iPlanen`).
  - Gaver i planen uten beløp er **ikke med i summen** og telles for seg («uten beløp»).
  - Ideer som ikke er valgt, er **alternativer** og telles ikke.
- **Gaver med ukjent status** (appen viser dem som idé) meldes som ukjent form (§2). De regnes ikke som sikre alternativer og ikke som sikkert i planen.
  - Har en mottaker ingen annen gave med Kjøpt, Pakket eller Gitt, er «ferdig» eller «mangler» for mottakeren **ukjent**.
- **Planlagt budsjett** er summen av mottakernes budsjett med beløp, der 0 telles som 0. Mottakere med «ikke satt» telles for seg.
- **Fjernet fra årets liste** (`fjernet`): gavene beholdes og vises for seg, men **telles ikke** i summene, i ferdig eller i mangler.
- **Gaver på anledningen for personer som ikke er mottakere** vises for seg («utenfor listen») og telles ikke i summene.

## 5. Helårsoversikten for ett år (`helaarsoversikt`)

Samme regler som «Året <år>» i appen (`web/src/domain/gaver/helaar.ts`):

- **Personer:** alle i registeret som ikke er arkivert, og i tillegg arkiverte eller ukjente personer som har gaver på årets jul eller bursdag, eller som er (ikke-fjernet) mottaker der.
- **Per anledning (jul og bursdag):**
  - **Finnes anledningen,** gjelder øyeblikksbildet. Den er bare med i budsjettet når personen er mottaker uten `fjernet`.
  - **Finnes den ikke,** gjelder personens effektive standard nå (`effektivStandard`: personens unntak → gruppen → standard, som er aktiv og ikke satt). Det gjelder bare for en person som ikke er arkivert.
  - Denne fallbacken brukes **bare når fravær er bekreftet** på anledningsstien (§3). Er anledningen uleselig eller i ukjent form, er budsjettet for den anledningen **ukjent**. Dagens standard brukes ikke, selv om appens parser hopper over posten og regner som om den manglet.
- **Gaveverdi** per anledning er summen av beløp for personens gaver i planen på anledningen.
  - Den telles **også når personen er fjernet fra årets jul**. Da er julen ikke med i budsjettet. Dette avviker fra juleplanen (§4).
  - Gaver uten beløp telles for seg.
- **Årets budsjett** per person har tre mulige utfall:
  - `kjent`: alle anledninger som er med, har beløp;
  - `ukjent`: minst én som er med, mangler beløp, og det **regnes aldri som 0**;
  - `ingen`: ingen anledning er med.
- **Rom** er budsjett minus gaveverdi, og bare når budsjettet er kjent. Negativt rom betyr over budsjett.

## 6. Eksempel (syntetisk, kontrollert mot domenefunksjonene)

Tallene er kjørt gjennom `parseGrupper`/`parsePersoner`/`parseAnledninger`/`parseGaver` → `juleoversikt`/`grupperMottakere`/`helaarsoversikt` på `3c45033`.

**Grupper og personer:**

- Grupper: `naer` har jul-budsjett 500 kr, og `venner` har jul av.
- `pA` og `pB` er i `naer`. `pB` har personunntak: jul-budsjett 0 kr og bursdag av.
- `pC` er i `utvidet`.
- `pD` er i `venner` og arkivert.
- `pF` er i `andre`.
- `pX` har tomt navn og hoppes over av parseren.

**Anledningen `jul-2026`, mottakere i øyeblikksbildet:**

| Mottaker                        | Budsjett i øyeblikksbildet |
| ------------------------------- | -------------------------- |
| `pA`                            | 500 kr                     |
| `pB`                            | 0 kr                       |
| `pC`                            | ikke satt                  |
| `pE` (finnes ikke i registeret) | 200 kr                     |
| `pD`                            | 300 kr, `fjernet`          |

**Gaver på `jul-2026`:**

| Person | Gave   | Status                 | Beløp      |
| ------ | ------ | ---------------------- | ---------- |
| `pA`   | Bok    | Kjøpt                  | 300 kr     |
| `pA`   | Kopp   | idé, ikke valgt        | 999 kr     |
| `pA`   | Ukjent | ukjent status «levert» | 7,77 kr    |
| `pB`   | Votter | Pakket                 | uten beløp |
| `pC`   | Te     | valgt idé              | 150 kr     |
| `pE`   | Skjerf | Gitt                   | 200 kr     |
| `pD`   | Lue    | Kjøpt                  | 100 kr     |
| `pF`   | Kort   | idé                    | 50 kr      |

**Juleplanen:**

- **Mottakere:** `pA`, `pB`, `pC` og `pE`.
- **Gruppert etter dagens gruppe:**
  - Nærmeste familie: `pA`, `pB`;
  - Utvidet familie: `pC`;
  - Ikke i personregisteret: `pE`.
- **Ferdig 3** (`pA`, `pB` med Pakket, `pE`). **Mangler 1** (`pC`, valgt idé er ikke kjøpt).
- **Planlagt budsjett 700 kr** (500 + 0 + 200). 1 mottaker uten budsjett (`pC`).
- **Planlagt for gaver 650 kr** (300 + 150 + 200). 1 gave i planen uten beløp (`pB`).
- **Alternativer:** appen viser 2 hos `pA`, som er «Kopp» og «Ukjent».
  - I brukeroversikten er bare **1 sikkert alternativ** («Kopp»).
  - «Ukjent» meldes som **1 gave i ukjent form** (status utenfor kontrakten) med nøkkel.
  - `pA` er likevel sikkert ferdig, fordi «Bok» er Kjøpt.
- **Fjernet:** `pD`, 100 kr i plan, telles ikke.
- **Utenfor listen:** `pF`. Bare en ikke-valgt idé, så 0 kr i plan.

**Helårsoversikten 2026:**

| Person | Gaveverdi                                      | Årets budsjett                               | Rom  |
| ------ | ---------------------------------------------- | -------------------------------------------- | ---- |
| `pA`   | 300 kr                                         | ukjent (bursdag mangler budsjett)            | –    |
| `pB`   | 0 kr, 1 uten beløp                             | kjent 0 kr (jul 0 kr, bursdag av)            | 0 kr |
| `pC`   | 150 kr                                         | ukjent (jul og bursdag mangler)              | –    |
| `pD`   | 100 kr (arkivert, fjernet fra jul, telles her) | ingen                                        | –    |
| `pE`   | 200 kr                                         | kjent 200 kr (bare julen, ikke i registeret) | 0 kr |
| `pF`   | 0 kr                                           | ukjent (bursdag mangler)                     | –    |

Sum gaveverdi 750 kr og 1 uten beløp. Kjent budsjett 200 kr, og 3 personer har ukjent budsjett.

**Moteksempler (dekning):**

- **Ugyldig anledningspost.** Samme data, men `anledninger/bursdag-pB-2026` finnes med `aar: "2026"` (tekst, ikke heltall).
  - Appens parser hopper over posten (`parseAnledning`). Helårsoversikten regner da som om bursdagen manglet, bruker `pB` sin standard (bursdag av) og viser «kjent 0 kr». Det er det samme som i tabellen over.
  - Arbeidsflyten melder i stedet `bursdag-pB-2026` som **ukjent form**, med nøkkel. `pB` sitt årsbudsjett er **ukjent**, ikke 0 kr, fordi fraværet ikke er bekreftet (§3).
  - Det samme gjelder en uleselig anledning, eller en `forStor` anledning som ikke kunne leses på egen sti.
- **Gave endret underveis.** Gavene leses først, og «Te» hos `pC` er da en valgt idé. Etterpå settes «Te» til Kjøpt, og så leses `jul-2026` med `data_hent`.
  - Oversikten viser `pC` som «mangler gave», selv om gaven er kjøpt.
  - Anledningens versjon endres ikke av gaveskrivingen, så versjonen kan ikke avsløre dette.
  - Kildegrunnlaget oppgir derfor rekkefølgen og tidspunktene for lesingene (§2), og oversikten påstår ikke å være ett øyeblikksbilde.

## 7. Meld

- Oppgi **hva som er lest:** anledningen eller året, avgrensningen (person eller gruppe), dekningen fra §2 og kildegrunnlaget.
- **Tall** som i §4 og §5, med «uten beløp», «ikke satt» og «ukjent» oppgitt for seg. Fyll aldri inn 0 der appen sier ukjent.
- **Statusen vises for seg:** Pakket meldes som Pakket (teller som kjøpt), ikke som Gitt. En ukjent status meldes som ukjent form, ikke som idé eller alternativ.
- **Fravær og ukjent holdes atskilt.** «Ikke startet» og fallback til dagens standard gjelder bare ved bekreftet fravær (§3 og §5).
- **Ingen større konklusjoner enn dekningen tillater.** Er noe uleselig eller i ukjent form, si hva som mangler.
- **Ingen anbefalinger om å endre data** (opprette anledning, sette status, rydde). Arbeidsflyten er bare lesing.

## 8. Kodeankre

- Kontrakt: `web/src/types/gaver.ts`.
- Parsere: `web/src/data/gaver.repository.ts` (`parseGrupper`, `parsePersoner`, `parseAnledning(er)`, `parseGaver`).
- Juleplan: `web/src/domain/gaver/gaver.ts` (`effektivStandard`, `iPlanen`, `erKjopt`, `juleoversikt`, `grupperMottakere`, `STATUS_TEKST`) og `web/src/features/hverdagsflyt/familie/gaver/JulPlan.tsx`.
- Helårsoversikt: `web/src/domain/gaver/helaar.ts` (`bursdagAnledningId`, `helaarsoversikt`).
- Tester som låser semantikken: `web/src/domain/gaver/gaver.test.ts`, `helaar.test.ts` og `web/src/data/gaver.repository.test.ts`.
- Pakket-utrulling: `docs/drift/gaver-pakket-utrulling.md`.
