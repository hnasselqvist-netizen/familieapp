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
2. **Dekning:** noter antall nøkler per node (`data_nokler`, alle sider), antall lest, `forStor` lest på egen sti, uleselig og ukjent form.
   - Er noe uleselig, sier oversikten bare noe om det som er lest. Trekk ingen konklusjon om helheten, for eksempel «alle er ferdige».
3. **Ikke et øyeblikksbilde.** Sidene i `data_les` leses hver for seg (README §«Full lesing»). Endringer underveis kan gi en blanding av før og etter.
   - Trengs et konsistent grunnlag for én anledning, les den med `data_hent { sti: "anledninger/<id>" }`. Det gir `verdi` og `versjon` fra én lesing.
   - Oppgi **kildegrunnlaget**: anledningens `versjon`-felt, og `data_hent`-versjonen der den er brukt.
4. **Løpende ideer** (gaver uten `anledningId`) hører ikke til noen anledning og er ikke med i summene.

## 3. Velg anledning, år, person eller gruppe

- **Jul i et år:** anledningen er `jul-<år>`.
  - Finnes den ikke, er juleplanleggingen **ikke startet**. Meld det. Opprett den aldri.
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
- **Planlagt budsjett** er summen av mottakernes budsjett med beløp, der 0 telles som 0. Mottakere med «ikke satt» telles for seg.
- **Fjernet fra årets liste** (`fjernet`): gavene beholdes og vises for seg, men **telles ikke** i summene, i ferdig eller i mangler.
- **Gaver på anledningen for personer som ikke er mottakere** vises for seg («utenfor listen») og telles ikke i summene.

## 5. Helårsoversikten for ett år (`helaarsoversikt`)

Samme regler som «Året <år>» i appen (`web/src/domain/gaver/helaar.ts`):

- **Personer:** alle i registeret som ikke er arkivert, og i tillegg arkiverte eller ukjente personer som har gaver på årets jul eller bursdag, eller som er (ikke-fjernet) mottaker der.
- **Per anledning (jul og bursdag):**
  - **Finnes anledningen,** gjelder øyeblikksbildet. Den er bare med i budsjettet når personen er mottaker uten `fjernet`.
  - **Finnes den ikke,** gjelder personens effektive standard nå (`effektivStandard`: personens unntak → gruppen → standard, som er aktiv og ikke satt). Det gjelder bare for en person som ikke er arkivert.
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
- **Alternativer 2.** Begge er hos `pA`: «Kopp», og «Ukjent», som vises som idé.
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

## 7. Meld

- Oppgi **hva som er lest:** anledningen eller året, avgrensningen (person eller gruppe), dekningen fra §2 og kildegrunnlaget.
- **Tall** som i §4 og §5, med «uten beløp», «ikke satt» og «ukjent» oppgitt for seg. Fyll aldri inn 0 der appen sier ukjent.
- **Statusen vises for seg:** Pakket meldes som Pakket (teller som kjøpt), ikke som Gitt. En ukjent status meldes som ukjent form.
- **Ingen større konklusjoner enn dekningen tillater.** Er noe uleselig eller i ukjent form, si hva som mangler.
- **Ingen anbefalinger om å endre data** (opprette anledning, sette status, rydde). Arbeidsflyten er bare lesing.

## 8. Kodeankre

- Kontrakt: `web/src/types/gaver.ts`.
- Parsere: `web/src/data/gaver.repository.ts` (`parseGrupper`, `parsePersoner`, `parseAnledning(er)`, `parseGaver`).
- Juleplan: `web/src/domain/gaver/gaver.ts` (`effektivStandard`, `iPlanen`, `erKjopt`, `juleoversikt`, `grupperMottakere`, `STATUS_TEKST`) og `web/src/features/hverdagsflyt/familie/gaver/JulPlan.tsx`.
- Helårsoversikt: `web/src/domain/gaver/helaar.ts` (`bursdagAnledningId`, `helaarsoversikt`).
- Tester som låser semantikken: `web/src/domain/gaver/gaver.test.ts`, `helaar.test.ts` og `web/src/data/gaver.repository.test.ts`.
- Pakket-utrulling: `docs/drift/gaver-pakket-utrulling.md`.
