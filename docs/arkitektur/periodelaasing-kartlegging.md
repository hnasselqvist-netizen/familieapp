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
- Hele kallet beslutter én transaksjon på **hele familieroten** (`dataSkriving.ts`), gjennom den rene `besluttSkriving`, som ser både før- og etterverdien. Det gjør MCP til den eneste inngangen i dag der en lås kan sjekkes **atomisk** i samme transaksjon som dataene. Et nytt beskyttet felt og et nytt domeneavslag ville endre den generelle skrivekontrakten. Det legges fram som V6.
- `transaksjon_sok`, `data_hent`, `data_les` og `data_nokler` bare leser. De øvrige verktøyene gjelder handlelisten.

### Databaseregler: bevis og hypoteser

**Bevis, lest i koden:**

- `infra/firebase/database.rules.json` har én `.write` på `families/$familyId`. Den gir hvert medlem skrivetilgang til **alt** under familien.
- I RTDB kaskaderer `.write`. En regel på et barn kan ikke trekke tilbake tilgang som en forelder har gitt.
- Uten en regelomlegging kan derfor enhver medlemsklient gå utenom et klientvern. Det gjelder en eldre åpen React-fane, legacy for budsjettnodene, og SDK-et brukt direkte. Admin-tilgang, som MCP og datarettinger fra Work, er aldri bundet av reglene.

**Konklusjon:** reell håndheving i databasen krever en **regelomlegging**. Den brede `.write` må erstattes av skriveregler per node, med betingelser for de periodebærende nodene. Det er en endring i sikkerhetsreglene. Den gjøres ikke i denne kartleggingen, og reglene deployes aldri automatisk (CLAUDE.md, ADR 0001).

**Hypoteser som må verifiseres mot en konkret regelutforming i emulatoren før valg:**

- `.validate` på barn kan legges til uten omlegging. Den kontrollerer bare ny data og **kjøres ikke ved sletting**. Den alene kan derfor ikke hindre at en post i en låst periode fjernes.
- React skriver de fire forsoningsnodene som **hele noder** (`transactForsoningNode`). Ved en skriving på `transaksjoner` vurderes `.write`-regler på stien og foreldrene, ikke på `transaksjoner/$i`.
  - En betingelse per post krever derfor enten skriving per post, som endrer skrivegranularitet etter R3b, eller en regel på hele noden, som ikke kan iterere over postene.
  - Om det krever **datamigrering**, er ikke avgjort. Det avhenger av om skriving per indeks er trygg nå som legacy er sperret, og av hvordan sletting som forskyver indekser behandles.
- RTDB-regler har ikke `substring`, så måneden kan ikke hentes ut av `dato` direkte.
  - En lås uttrykt som én **«låst til og med»-dato** kan kanskje sammenlignes leksikografisk mot ISO-datoen (`newData.child('dato').val() <= …`). Det er ikke verifisert.
  - En vilkårlig mengde låste måneder er vanskeligere å uttrykke. Det knytter V1 til gjennomførbarheten (§6).

## 4. Hva en lås må håndheve, og atomisitet

| Krav | Berørte skriveveier |
|---|---|
| Ingen ny, endret, flyttet eller slettet transaksjon, hendelse eller kvittering i låst periode | `transactForsoningNode` (alle React-flyter i §3), `data_skriv` |
| Ingen avledet effekt inn i låst periode (motpart, `forventetMotpost.dato`/`konto`, `erstattetAv`, `arsakId`) | samme |
| Etterimport: rader i låst periode importeres ikke og vises som «i låst periode» | `gjorImport` via `transactForsoningNode` |
| Saldo for låst konto og måned | `lagreSaldokontroll`, `data_skriv` |
| Kvalitetssikring i låst periode (V4) | `skrivTransaksjonskontroll`, `data_skriv` |
| `spent` for låst måned i inneværende budsjettår | `updateItemMonth(spent)`, **legacy** `setBudgetGroups`, `setIncomeGroups` og `setSparingGroups` (hele noder), `data_skriv` |
| Selve låseposten endres bare ved eksplisitt låsing eller gjenåpning | låsehandlingen; `data_skriv` (V6) |

**Låsekontrakten er atomisk.** En periode som vises som låst, skal aldri ha fått en endring etter låsetidspunktet fra en vernet skrivevei. Grunnlaget skal fanges i samme beslutning som låsen settes.

**Det første forslaget oppfyller ikke dette** (review 5966251426). Hvis skriveren leser låseposten separat og bruker en transaksjon på en enkelt node, kan rekkefølgen bli slik:

1. Skriveren leser låseposten, og perioden er åpen.
2. Låsingen committes.
3. Skriverens node-transaksjon committes, fordi noden selv er uendret.

RTDB sammenligner bare noden transaksjonen gjelder. Grunnlagshashen varsler etterpå, men hindrer ikke endringen. Det er bare et best-effort-vern, og det velges ikke på Helens vegne.

### Alternativ A: felles transaksjonsgrense på familieroten (atomisk innen dagens data og regler)

Periodedataene ligger som søsken direkte under `families/{f}`. Det gjelder `transaksjoner`, `hendelser`, `receipts`, `rules`, `saldokontroller`, `transaksjonskontroller`, `budget`, `incomeGroups`, `sparingGroups` og en ny `periodelaaser`. Familieroten er den eneste felles forelderen uten flytting av data.

- **Låsing og gjenåpning:** én `runTransaction` på `families/{f}`.
  - Updateren beregner grunnlaget fra den samme rotverdien, kontrollerer vilkåret (V2) og skriver låseposten.
  - Grunnlaget fanges dermed i samme atomiske beslutning.
- **Alle vernede skrivinger:** også én transaksjon på `families/{f}`.
  - Det gjelder `transactForsoningNode`, `lagreSaldokontroll`, `skrivTransaksjonskontroll` og `updateItemMonth(spent)`.
  - Updateren leser låseposten og den berørte noden fra samme rot, avviser med `PeriodeLaast` eller skriver bare den berørte noden.
  - En samtidig låsing eller skriving endrer roten, og RTDB kjører updateren på nytt mot den ferske roten. Låsing og skriving blir dermed serialisert.
- **MCP:** `data_skriv` beslutter allerede i én transaksjon på familieroten (`FirebaseAdminStore.transactFamily`, `mcp-server/src/store/firebaseAdminStore.ts:248`). En låsesjekk i `besluttSkriving` blir derfor atomisk med samme grense.
- **Legacy:** budsjettnodenes `dbSet` på hele noder kan ikke delta. Dette er et obligatorisk forsteg, S0 i §5.

**Kostnad, konfliktbelastning og kompatibilitet.** Ingen produksjonsstørrelse er målt.

- **Overføring:**
  - Hver vernet skriving laster ned og sender **hele familieroten** ved hvert forsøk. Det gjelder også Mat, Gaver, `_mcp` og `receipts`, som kan ha base64-bilder i `imageUrl` fra eldre Bankimport-opplastinger.
  - MCP har allerede en lesegrense på 64 MB for roten (`MAKS_FAMILIE_LESE_BYTES`, `skriving.ts:151`) og en skrivegrense på 15 MB (`:145`). Det tyder på at roten kan være stor.
  - På mobil kan dette gi merkbar ventetid og databruk.
- **Konflikter:**
  - Enhver samtidig skriving i familien gir et nytt forsøk, også handlelisteendringer, middagsplan og MCP-kvitteringer i `_mcp`.
  - SDK-et gir opp etter 25 forsøk.
  - Én familie har få samtidige skrivere, men handlelisten brukes aktivt.
- **Kompatibilitet:**
  - React må holde et abonnement på hele roten, eller vente på en første verdi slik `transactFamily` gjør, for at transaksjonen skal starte fra den ekte verdien.
  - Skriveveiene for Mat (REST med `if-match` på egne noder) og andre node-transaksjoner fungerer uendret. RTDB serialiserer dem mot rot-transaksjonen.
  - Dagens array-form og legacy-sperren (R3b) er uendret. Det er ingen datamigrering og ingen endring i reglene.
- **Uten regelomlegging** er alternativ A atomisk bare for **vernede** skriveveier: React-koden etter utrulling og MCP. En eldre åpen React-fane, en sperret legacy-flyt som likevel er åpen fra før, eller SDK-et brukt direkte går fortsatt utenom. Grunnlagshashen oppdager slike endringer.

### Alternativ B: regelomlegging (håndheving i databasen)

Som beskrevet i «Databaseregler» over. Alternativet krever en endring i sikkerhetsreglene og en konkret regelutforming som verifiseres i emulatoren. Det kan kreve endret skrivegranularitet, og eventuelt datamigrering. Det ligger utenfor dette mandatet og krever en egen beslutning. Det kan kombineres med A.

### Alternativ C: flytte periodedata under en felles forelder

Hvis alle periodebærende noder legges under én forelder, for eksempel `forvaltning/`, kan transaksjonsgrensen bli mindre enn roten. Det er en datamigrering med legacy-, MCP- og R3b-konsekvenser, og ligger utenfor dette mandatet.

## 5. Minste sammenhengende skive: **uavklart teknisk grunnlag**

Det er ikke avgjort at alternativ A er gjennomførbart for produksjonsdataene. **S1 er derfor merket uavklart** til forsteget P0 er gjort. Ingen periode skal vises som beskyttet før S0 og S1 er levert.

- **P0, syntetisk probe (docs/emulator, ingen produksjonsdata)**, etter mønsteret fra Matlager-proben i #126:
  - **Oppsett:** rot-transaksjoner i emulatoren mot syntetiske familierøtter på 1, 10 og 50 MB, med og uten base64-kvitteringer, og 2, 5 og 10 samtidige skrivere. Skriverne er handleliste-REST, Mat-transaksjoner og forsoningsskriving.
  - **Måling:** antall forsøk per skriving, tid til commit, feil etter 25 forsøk og overført mengde.
  - **Produksjonsstørrelse:** familierotens faktiske størrelse måles bare som et tall i byte, skrivefritt, av Kontrolltårnet eller Work på Helens bestilling.
  - **Utfall:** P0 avgjør om A brukes. Ellers legges B eller C fram for Helen som egen beslutning.
- **S0, cutover for legacy-budsjettskriving.** Dette er obligatorisk før noen periode vises som beskyttet.
  - `setBudgetGroups` (~18067), `setIncomeGroups` (~18300) og `setSparingGroups` (~18321) skriver hele noder med `dbSet`, også `spent`.
  - Steget gjøres som R3b: først en paritetskontroll av legacy-budsjettflytene mot React (`useBudsjettfamilie`, `useArsbudsjett`), deretter en sperre i de tre setterne i samme release, med en testet patch og en rollback.
  - Alternativet er å gjøre om setterne til rot-transaksjoner med låsesjekk. Det er mer legacy-kode, og frarådes.
- **S1, lås og gjenåpne én måned (hvis P0 godkjenner A):**
  1. **Lagringskontrakt** `families/{f}/periodelaaser/{ÅÅÅÅ-MM}`, med samme mønster som `transaksjonskontroller`:
     ```
     {
       gjeldende: { grunnlag: "<sha256>", versjon: 1, tid, av, avNavn } | null,
       spor: { <pushId>: { handling: "laast" | "gjenapnet", grunnlag, tid, av, avNavn, begrunnelse? } }
     }
     ```
     - `gjeldende` er lik `null` når perioden er åpen.
     - Sporet fylles bare på.
     - Med V1 «per konto» blir nøkkelen `{ÅÅÅÅ-MM}/{kontoNøkkel}` (`kontoNokkel`, `saldokontroller.repository.ts:27`).
     - Med en «låst til og med»-modell (V1, hypotesen i «Databaseregler» i §3) blir det én post med én dato.
  2. **Ren domenemodul** `domain/forsoning/periodelaas.ts`:
     - `berorteMaaneder(node, forrige, neste)`, inkludert avledede effekter;
     - `periodegrunnlag(maaned, rot)`;
     - `kanLaases(maanedsstatus)`.
  3. **Rot-transaksjon i ett felles React-punkt:** `transactForsoningNode` og de tre øvrige skriverne blir rot-transaksjoner med låsesjekk. Låsing og gjenåpning bruker samme grense, og grunnlaget beregnes i samme updater.
  4. **MCP:** låsesjekk i `besluttSkriving`, og `periodelaaser` lagt til `BESKYTTET`. Dette forutsetter V6.
  5. **Avstemming:**
     - låsestatus og handlingene «Lås måned» og «Gjenåpne» (med begrunnelse etter V3);
     - problemet «endret etter låsing» når grunnlaget avviker. Det kan skje ved endringer som går utenom vernet.
  6. **Tester:**
     - domene;
     - emulator: **samtidig låsing og skriving i begge rekkefølger**, import og etterimport, intern overføring og avledet motpost over periodegrensen, og `erstattetAv`;
     - MCP-kontrakttest mot emulatoren;
     - e2e: lås → endring avvises → gjenåpne → endre → lås igjen.

     Bare syntetiske data.
- **Utenfor S1:**
  - alternativ B og C;
  - låser for arkiverte år. `spent` har ikke noe år, så dette henger på årsskiftet D trinn 2–3.

Ingen eksisterende data endres eller migreres. Låseposten opprettes bare ved Helens eksplisitte handling. Reversering er en kode-revert, og S0 reverteres som R3b.

## 6. Valg for Helen før bygging

| # | Valg | Anbefalt | Konsekvens |
|---|---|---|---|
| V1 | **Omfang:** hele måneden for hele familien, eller per konto? | **Hele måneden** | Manuelle hendelser, mellomværende og kvitteringer har ingen konto og kan bare låses per måned. Per konto gir finere kontroll når én konto mangler bankutskrift. En sammenhengende «låst til og med»-dato kan være enklest å håndheve i reglene ved et senere alternativ B. Det er ikke verifisert, men taler for å låse måned for måned uten hull. |
| V2 | **Låsevilkår:** bare når månedsstatusen i avstemmingen er OK, eller også med åpne forhold etter en eksplisitt bekreftelse? | **Bare ved OK**. Ellers vises det som gjenstår. | Strengt vilkår betyr at en låst måned er avstemt. Det mykere vilkåret gjør det mulig å låse en måned med kjente, aksepterte forhold, og listen over dem lagres i sporet. |
| V3 | **Gjenåpning:** eksplisitt handling med obligatorisk kort begrunnelse, eller uten begrunnelse? | **Obligatorisk begrunnelse**. Sporet bevares, og ny låsing krever samme vilkår som første gang. | Gir et tydelig spor av hvorfor en ferdig periode ble endret. Gjenåpning skjer aldri automatisk. |
| V4 | **Metadata uten økonomisk effekt** i låst periode (kvalitetssikringsmerker, varelinjer, vedlegg, kommentar): låst eller tillatt? | **Låst** (låst = frosset) | Enkel regel og fullt spor. Ulempen er at en sen kvalitetssikring eller et vedlegg krever gjenåpning. |
| V5 | **Budsjettplanen** (`budget`) for låste måneder: låst eller tillatt? | **Tillatt i S1** (bare faktisk låses) | Plan er ikke en observasjon. Låses den, sperres også Årsbudsjett-flyten for passerte måneder. |
| V6 | **MCP-skrivekontrakten:** skal `data_skriv` få et domeneavslag `periode_laast` og et nytt beskyttet felt `periodelaaser`? | **Ja** | Full familieskriving via ChatGPT er autorisert, også for fremtidige domener (#27). Med V6 er ChatGPT avvist i låste perioder, og kan verken låse eller gjenåpne. Låsing blir en handling bare i appen. Dette blir det første domeneavslaget i den generelle kontrakten, og fremtidige domeneregler vil følge samme mønster. Uten V6 er låsen bare et vern i appen, og ChatGPT kan endre låste perioder. |

**Tekniske forutsetninger, som ikke er produktvalg, men må på plass før bygging:**

- P0 (gjennomførbarheten av alternativ A);
- S0 (legacy-cutover for budsjettnodene).

Om B eller C skal brukes hvis A ikke holder, legges fram separat, fordi det krever en endring i reglene eller en migrering. Tekniske detaljvalg tas av Kontrolltårnet og Claude: håndhevingspunkt, lagringsform, grunnlagshash, konfliktvern og feilutfall.

## 7. Ukjent eller antatt

- Familierotens faktiske størrelse og samtidighet i produksjon er ikke målt. Det avgjør P0.
- Hvor ofte legacy-budsjettskjermene brukes til `spent`, er ikke målt. Det påvirker paritetsarbeidet i S0, ikke behovet for S0.
- Om produksjonsdata har transaksjoner uten konto i måneder som vil låses, er ikke lest. Det påvirker bare V1.
- Regelhypotesene i §3 («Databaseregler») er ikke verifisert i emulatoren.
- Hvordan låser for tidligere år skal behandles etter årsskiftet, avhenger av D trinn 2–3. `spent` har i dag ikke noe år.
