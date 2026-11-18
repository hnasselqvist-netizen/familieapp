# Periodelåsing: kartlegging av skriveveier, håndheving og minste skive

**Status:** kartlegging (#59, ordre 6991032797). Ingenting er bygget, låst, migrert eller endret. Det er heller ikke gjort noen endring i sikkerhetsregler.
**Kodegrunnlag:** `main` `4c7577854a04d3b28371e19bf424c471f80d8eab`.
**Behovet:** Helen 31.10, registrert i #59 6544543598. En ferdig gjennomgått eller avstemt periode skal kunne beskyttes mot utilsiktede endringer. Låsingen skal være eksplisitt og skje aldri automatisk ved kvalitetssikring eller avstemming. Gjenåpning skal være kontrollert og etterlate spor.
**Metode:** kodelesing av React (`web/src`), legacy (`index.html`), MCP-serveren (`mcp-server/src`) og `infra/firebase/database.rules.json`. Ingen produksjonsdata er lest, og ingen tester er kjørt.

## 1. Det som finnes i dag

Det finnes **ingen låsing** i koden. Søk etter «periodelås», «låst periode» og tilsvarende gir ingen treff i `web/src`, `mcp-server/src` eller `index.html`. Flere mekanismer **oppdager** likevel endringer etter kontroll, og en lås kan bygge på dem:

| Mekanisme | Hvor | Hva den gjør | Hva den ikke gjør |
|---|---|---|---|
| Kvalitetssikring | `families/{f}/transaksjonskontroller/{id}`. Grunnlaget beregnes av `kontrollgrunnlag` i `domain/forsoning/kvalitetssikring.ts:228`; skrivingen gjøres av `skrivTransaksjonskontroll` i `data/transaksjonskontroller.repository.ts:92`. | Lagrer SHA-256 av transaksjonen med koblet hendelse, kvitteringer og forventet motpost, sammen med `tid`, `av` og `avNavn`. Sporet `spor` bevares. Skrivingen er versjonsbetinget mot `forventet`. | Den hindrer ingen endring. Endres grunnlaget, vises «Endret etter kontroll». |
| Saldokontroll | `families/{f}/saldokontroller/{konto}/{ÅÅÅÅ-MM}`, skrevet av `lagreSaldokontroll` i `data/saldokontroller.repository.ts:88` | Lagrer faktisk saldo per konto og måned, med `grunnlag: {antall, nettoOre}` slik månedens transaksjoner var. | Den hindrer ingen endring. En etterimport gir `grunnlag_endret` i avstemmingen. |
| Avstemming AV-1/AV-2 | `domain/avstemming/avstemmingsko.ts`, se [`avstemming-av1.md`](avstemming-av1.md) | Avleder status per konto og måned (**OK** = avstemt uten problemer) og en prioritert problemliste. Ingenting lagres. | Den lagrer ingen «ferdig»-tilstand og hindrer ingen endring. |
| Saldokorrigering | `domain/avstemming/saldokorrigering.ts` (`etter`-avtrykk, `korrigeringslogg`) | Nekter å reversere en korrigering når transaksjonen er endret siden. Loggen fylles bare på. | Den gjelder bare reverseringen. |

En lås **forhindrer** endringer. Kvalitetssikring og avstemming **oppdager** dem. De tre holdes adskilt: kvalitetssikring eller OK i avstemmingen låser aldri en periode.

## 2. Periodedata og hvilken dato som avgjør perioden

| Data | Sti | Periodenøkkel | Merknad |
|---|---|---|---|
| Banktransaksjoner | `transaksjoner[]` (array, hele noden) | `dato` (`ÅÅÅÅ-MM-DD`) og `konto` | Saldoeffekten havner på `konto` i måneden for `dato`. `konto` kan være `null` (ukjent konto). |
| Økonomiske hendelser | `hendelser[]` (array) | `dato` | Økonomi filtrerer på `h.dato.slice(0, 7)` (`domain/budsjettfamilie/budsjettfamilie.ts:178`, `:226`). Manuelle hendelser (`kilde: "manuell"`) og mellomværende-oppgjør har **ingen konto**. |
| Kvitteringer | `receipts[]` (array) | ingen egen periodedato i modellen: `purchaseDate` er valgfri | Den økonomiske effekten går via `splits` → hendelse. Perioden følger derfor den koblede hendelsen eller transaksjonen. |
| Avledet motpost | på kildetransaksjonen (`forventetMotpost.konto`, `.dato`) | `forventetMotpost.dato` på **mottakerkontoen** | En endring på kilden i en åpen måned kan endre saldoen på en annen konto i en låst måned. |
| Faktisk på post | `budget\|incomeGroups\|sparingGroups/{g}/{p}/months[m].spent` | månedsindeks `m`, **uten år** | Brukes som faktisk når posten ikke har hendelser. Samme årshull som funn D (se [`arsskifte-beslutningsnotat.md`](arsskifte-beslutningsnotat.md)). |
| Saldokontroll | `saldokontroller/{konto}/{ÅÅÅÅ-MM}` | nøkkelen | — |
| Kvalitetssikring | `transaksjonskontroller/{id}` | transaksjonens `dato` | Metadata uten økonomisk effekt. |
| Mellomværende-avtaler | `mellomvaerender/{id}` | ingen. Kostnad og oppgjør er hendelser. | Effekten låses via hendelsene. |
| Likviditet | `liquidity` | — | Fremtidsrettet prognose og ikke periodedata. **Utenfor.** |
| Regler | `rules[]` | — | Ikke periodedata. Når reglene **anvendes**, skrives det derimot hendelser og transaksjoner (se §3). |

## 3. Skriveveier per inngang

### React: eneste skriver av de fire forsoningsnodene

`transaksjoner`, `hendelser`, `receipts` og `rules` har hatt React som eneste skriver siden R3b-cutover (`hooks/forsoningAktivering.ts`, [`r3b-cutover.md`](r3b-cutover.md)). Legacy-setterne er sperret.

**Alle** React-skrivinger til de fire nodene går gjennom **én funksjon**: `transactForsoningNode` (`data/forsoningSkriving.repository.ts:49`). Den skriver hele noden i én transaksjon i array-form, og har tre kallere:

- `useForsoningSkriver` (`hooks/useForsoningSkriver.ts:17–27`), som brukes av:
  - `useTransaksjonsoversikt`: bankimport, plassering og splitt, på vent, ignorer, intern overføring, manuell registrering og regellæring;
  - `useKorrigering`;
  - `useKvitteringsinnboks`;
  - `useAvstemming`: dublett, omklassifisering, avledet motpost og kobling til importert motpost.
- `useRegelsenter` (`:169–170`), som gjør «Kjør regler» → «Bruk resultatet».
- `useMellomvaerende` (`:106`, `:132`, `:143`), som håndterer kostnad og oppgjør som hendelser.

Dette er det naturlige håndhevingspunktet i React. Updateren får både forrige og ny array, og kan sammenligne postene på `id`.

Endringer med periodeeffekt som må fanges:

- **Ny post** i en låst periode: import av bankfil (`domain/forsoning/bankimport.ts:149`), etterimport, manuell registrering (`:245`), auto-hendelser fra regler ved import, kvittering, mellomværende.
- **Endret post**: korrigering, plassering, status, kobling, kvitteringsredigering med synk av koblet hendelse, og «Kjør regler».
- **Flytting**: endret `dato` ut av eller inn i en låst periode. Både gammel og ny dato må sjekkes.
- **Sletting**: forkast kvittering, fjern hendelse.
- **Avledede effekter på tvers av perioder og kontoer:**
  - Intern overføring parer to transaksjoner, ofte på to kontoer og noen ganger i to måneder (`internOverforing.ts:57`). Begge sider endres.
  - En avledet motpost (`saldokorrigering.ts:514` `leggTilForventetMotpost`) får saldoeffekt på mottakerkontoen på `forventetMotpost.dato`.
  - Kobling til importert motpost setter `erstattetAv` på kilden (`:736`). Dermed endres saldoeffekten i kildens måned, også når den nye importen ligger i en åpen måned.
  - Dublettmerking kan frakoble motparten (`motpart_frakoblet`, `arsakId`). Da endres en transaksjon som kan ligge i en annen periode.

Andre React-skriveveier med periodeeffekt:

- `useAvstemming.ts:108` → `lagreSaldokontroll`: saldo per konto og måned.
- `useTransaksjonsoversikt.ts:120` → `skrivTransaksjonskontroll`: kvalitetssikring.
- `useBudsjettfamilie.ts:105` → `updateItemMonth(…, "spent", …)` (`data/budsjettfamilie.repository.ts:148`): faktisk per månedsindeks i inneværende budsjettår.

### Legacy (`index.html`)

- **De fire forsoningsnodene** er sperret: `FORSONING_SKRIVESPERRE` i `setReceipts`, `setHendelser`, `setRules` og `setTransaksjoner` (~18261–18291).
- Legacy skriver ikke `saldokontroller` eller `transaksjonskontroller`; nodene er ikke nevnt i `index.html`.
- **Budsjettnodene skrives fortsatt av legacy, som hele noder:** `setBudgetGroups` (~18067, `dbSet(…/budget, flat)` ~18096), `setIncomeGroups` (~18300) og `setSparingGroups` (~18321). Faktisk (`spent`) settes fra skjermene ved ~12775, ~13227 og ~13594. En åpen legacy-fane kan dermed overskrive `months[m].spent` for en låst måned.

### MCP (`data_skriv`, aktiv i produksjon)

- `data_skriv` er generell skriving til **hvilken som helst sti** under `families/{f}`. Unntakene er de beskyttede feltene i `BESKYTTET` (`mcp-server/src/data/skriving.ts:120`): `_mcp`, `members`, `shopping/_skriver` og `shopping/_ops`.
  - Den er slått på i produksjon (`MCP_DATA_SKRIVING: "aktiv"` i `.github/workflows/deploy-mcp-cloudrun.yml:163`).
  - Den skriver med admin-SDK-et, som ikke er bundet av databasereglene.
- Hele kallet beslutter én transaksjon på **hele familieroten** (`dataSkriving.ts`), gjennom den rene `besluttSkriving`, som ser både før- og etterverdien. Det gjør MCP til den eneste inngangen der en lås kan sjekkes **atomisk** i samme transaksjon som dataene.
- `transaksjon_sok`, `data_hent`, `data_les` og `data_nokler` bare leser. De øvrige verktøyene gjelder handlelisten.

### Databaseregler

- `infra/firebase/database.rules.json` gir alle medlemmer lese- og skrivetilgang til hele `families/{f}`.
- Dermed kan enhver medlemsklient gå utenom et klientvern: en eldre åpen React-fane, legacy for budsjettnodene, eller SDK-et direkte. Det samme gjelder admin-tilgang, som datarettinger fra Work.
- Å håndheve låsing i reglene for de fire array-nodene er ikke praktisk:
  - React og legacy skriver hele arrayen. En sletting forskyver indeksene, så regler per indeks ville se uendrede poster som endret.
  - Regelbasert håndheving krever nøkkelbasert lagring på `id`, som er en datamigrering, og en endring i reglene.
  - Reglene deployes aldri automatisk (CLAUDE.md, ADR 0001). Derfor tas det ikke med i minste skive.

**Konklusjon:** en periodelås kan i praksis være et vern i appen og i MCP mot **utilsiktede** endringer. Det er nettopp Helens formål. Den er **ikke** en sikkerhetsgrense mot et medlem eller en klient som går utenom. Det som går utenom, må derfor **oppdages**. Det løses med et lagret grunnlag ved låsing (§4).

## 4. Hva en lås må håndheve, og hvor

| Krav | React (klient) | MCP (server) | Legacy | Oppdagelse |
|---|---|---|---|---|
| Ingen ny, endret, flyttet eller slettet transaksjon, hendelse eller kvittering i låst periode | sjekk i `transactForsoningNode`-updateren: diff på `id`, gammel og ny periode | sjekk i `besluttSkriving` mot låseposten i samme rot | sperret allerede (R3b) | grunnlagshash |
| Ingen avledet effekt inn i låst periode (motpart, `forventetMotpost.dato`/`konto`, `erstattetAv`, `arsakId`) | samme diff: periode for begge sider og for avledet konto og dato | samme | — | grunnlagshash |
| Etterimport | Rader i låst periode importeres ikke og vises som «i låst periode». Dubletter oppdages som før. | — | sperret allerede | `grunnlag_endret` finnes |
| Saldo for låst konto og måned | `lagreSaldokontroll` avviser | sti-sjekk | — | grunnlagshash |
| Kvalitetssikring i låst periode | `skrivTransaksjonskontroll` avviser (valg V4) | sti-sjekk | — | — |
| `spent` for låst måned i inneværende budsjettår | `updateItemMonth(spent)` avviser | sti-sjekk (månedsindeks + år) | **ikke vernet**: hele-node-`dbSet` | grunnlagshash |
| Selve låseposten | eksplisitt låse- og gjenåpningshandling | **beskyttet** (lagt til `BESKYTTET`): MCP låser og gjenåpner ikke | — | spor |

**Atomisitet:**

- I React leser transaksjonen på en forsoningsnode ikke låseposten atomisk. En skriving som startet like før en låsing, kan derfor fullføres.
- Låsingen lagrer et **grunnlag**: en hash av periodens transaksjoner, hendelser, kvitteringer, avledede motposter og saldo, etter mønsteret fra `kontrollgrunnlag`. Avstemmingen viser «endret etter låsing» når grunnlaget avviker. Det fanger også eldre faner, legacy-budsjett og datarettinger.
- I MCP er sjekken atomisk.

## 5. Minste sammenhengende skive (forslag)

**S1: lås og gjenåpne én måned, med vern i React og MCP og oppdagelse.** Én PR, eller to: domene og data først, UI etterpå.

1. **Lagringskontrakt** `families/{f}/periodelaaser/{ÅÅÅÅ-MM}`. Den følger samme mønster som `transaksjonskontroller`, og skrives versjonsbetinget med `forventet`:
   ```
   {
     gjeldende: { grunnlag: "<sha256>", versjon: 1, tid, av, avNavn } | null,
     spor: { <pushId>: { handling: "laast" | "gjenapnet", grunnlag, tid, av, avNavn, begrunnelse? } }
   }
   ```
   - `gjeldende` er lik `null` når perioden er åpen.
   - Sporet fylles bare på.
   - Med valg V1 «per konto» blir nøkkelen `{ÅÅÅÅ-MM}/{kontoNøkkel}`. `kontoNokkel` finnes i `saldokontroller.repository.ts:27`.
2. **Ren domenemodul** (`domain/forsoning/periodelaas.ts`):
   - `berorteMaaneder(node, forrige, neste)`: periodene en endring berører, inkludert avledede effekter;
   - `periodegrunnlag(maaned, data)`;
   - `kanLaases(maanedsstatus)`, etter valg V2.
3. **React-vern**, i ett felles punkt: `transactForsoningNode` avviser med `PeriodeLaast`, og ingenting skrives. I tillegg avviser `lagreSaldokontroll`, `skrivTransaksjonskontroll` og `updateItemMonth(spent)`. Skjermene viser «Låst periode» og deaktiverer handlinger, på samme måte som `ForsoningSkrivingStengt` gjør i dag.
4. **MCP-vern**:
   - `periodelaaser` legges til `BESKYTTET`;
   - `besluttSkriving` avviser kall som berører en låst periode, med et nytt utfall `periode_laast`;
   - testes med den eksisterende kontrakttesten mot emulatoren.
5. **Avstemming**:
   - ny problemtype «endret etter låsing» når grunnlaget avviker;
   - låsestatus vises i månedsstatusen;
   - handlingene «Lås måned» og «Gjenåpne» står i avstemmingen. Det er der en periode erklæres ferdig.
6. **Utenfor S1:**
   - legacy-vern for `spent` (S1b: sperre i `setBudgetGroups`, `setIncomeGroups` og `setSparingGroups` for låste måneder i inneværende år, eller ingen tiltak fordi oppdagelsen dekker det);
   - regelbasert håndheving med nøkkelbasert lagring;
   - låsing av år som allerede er arkivert. Det henger på årsskiftet D trinn 2–3, fordi `spent` ikke har år.
7. **Tester:**
   - domenetester for hver node og hver avledet effekt over månedsgrensen;
   - emulatortester for React-vernet: import og etterimport, korrigering, intern overføring over periodegrensen, avledet motpost, `erstattetAv` og dublett med `arsakId`;
   - test av `besluttSkriving` og kontrakttest mot emulatoren for MCP;
   - e2e: lås → endring avvises → gjenåpne → endre → lås igjen;
   - konfliktvern når to faner låser eller gjenåpner samtidig;
   - bare syntetiske data.

Ingen eksisterende data endres eller migreres. Låseposten opprettes bare ved Helens eksplisitte handling. Reversering er en kode-revert. Låseposter som allerede er lagret, er da uten virkning.

## 6. Produktvalg for Helen

| # | Valg | Anbefalt | Konsekvens |
|---|---|---|---|
| V1 | **Omfang:** hele måneden for hele familien, eller per konto? | **Hele måneden** | Manuelle hendelser, mellomværende og kvitteringer har ingen konto og kan bare låses per måned. Med per konto blir også avledede effekter på andre kontoer vanskeligere å forklare. Per konto gir finere kontroll når én konto mangler bankutskrift. |
| V2 | **Låsevilkår:** bare når månedsstatusen i avstemmingen er OK, eller også med åpne forhold etter en eksplisitt bekreftelse? | **Bare ved OK**. Ellers vises det som gjenstår. | Strengt vilkår betyr at en låst måned er avstemt. Det mykere vilkåret gjør det mulig å låse en måned med kjente, aksepterte forhold, og listen over dem lagres i sporet. |
| V3 | **Gjenåpning:** eksplisitt handling med obligatorisk kort begrunnelse, eller uten begrunnelse? | **Obligatorisk begrunnelse**. Sporet bevares, og ny låsing krever samme vilkår som første gang. | Gir et tydelig spor av hvorfor en ferdig periode ble endret. Gjenåpning skjer aldri automatisk. |
| V4 | **Metadata uten økonomisk effekt** i låst periode (kvalitetssikringsmerker, varelinjer, vedlegg, kommentar): låst eller tillatt? | **Låst** (låst = frosset) | Enkel regel og fullt spor. Ulempen er at en sen kvalitetssikring eller et vedlegg krever gjenåpning. |
| V5 | **Budsjettplanen** (`budget`) for låste måneder: låst eller tillatt? | **Tillatt i S1** (bare faktisk låses) | Plan er ikke en observasjon. Låses den, sperres også Årsbudsjett-flyten for passerte måneder. |

Tekniske valg tas av Kontrolltårnet og Claude og legges ikke frem for Helen. Det gjelder håndhevingspunkt, lagringsform, grunnlagshash, konfliktvern, feilutfall og om legacy-vernet tas i S1 eller S1b.

## 7. Ukjent eller antatt

- Hvor ofte legacy-budsjettskjermene fortsatt brukes til å sette `spent`, er ikke målt. Det avgjør om S1b trengs.
- Om produksjonsdata har transaksjoner uten konto i måneder som vil låses, er ikke lest. Det påvirker bare V1.
- Hvordan låser for tidligere år skal behandles etter årsskiftet, avhenger av D trinn 2–3. `spent` har i dag ikke noe år.
