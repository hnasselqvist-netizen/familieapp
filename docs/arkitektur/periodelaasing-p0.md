# Periodelåsing P0: rot-transaksjon mot eksisterende skrivere (syntetisk emulatorforsøk)

**Status:** gjennomført som syntetisk forsøk (#59, ordre 6995863821). Resultatet er **beslutningsgrunnlag, ikke bevis for ytelse i produksjon**. Ingen låsing er implementert, og A/B/C og V1–V7 er ikke besluttet (se [`periodelaasing-kartlegging.md`](periodelaasing-kartlegging.md) §4–§6).
**Kode:** [`web/src/data/rotTransaksjon.p0.integration.test.ts`](../../web/src/data/rotTransaksjon.p0.integration.test.ts).
**Kodegrunnlag:** `main` `f5e36a0`.
**SDK:** `firebase` 12.18.0 i `web/`.
**Grenser:** bare Firebase-emulatoren og syntetiske data. Produksjonsroten er ikke lest, og det er ikke kjørt noe forsøk i produksjon. Ingen ny skrivevei i appen, ingen endring i rules, IAM eller data.

## 1. Oppsett og hva som er produksjonskode

| Del | Produksjonskode eller simulert |
|---|---|
| Handlelistens REST-vei med ETag og `if-match` (`skrivHandlelisteVersjonert`) | **Produksjonskode**, gjennom appens `firebase.ts`-singleton |
| Node-transaksjon på forsoningsnodene (`transactForsoningNode` på `transaksjoner`) | **Produksjonskode** |
| Rot-transaksjonen `runTransaction` på `families/{f}` | **Simulert**. Det finnes ingen i `web/`. Den er modellert på MCP-ens `transactFamily`: vent på første rotverdi, kjør transaksjonen og avslutt lytteren. Den bruker **ikke** et permanent rotabonnement. Updateren legger en markør under `p0/rot` og en post i `transaksjoner`, og bevarer resten urørt. |
| Vanlig `set` og `update`, og «urelaterte» skrivere | **Simulert** |

**To slags oppsett:**

- **Separate klienter:** hver klientapp har egen websocket og cache. Det tilsvarer flere enheter eller faner.
- **Samme `Database`-instans:** appens singleton bærer både rot-transaksjonen og den andre skrivingen. Det tilsvarer én React-klient.

**Rekkefølgen styres deterministisk med `goOffline`/`goOnline`.**

- En klient som har lest og går offline, regner på den gamle verdien.
- På samme instans startes begge operasjonene mens klienten er offline. Ingenting sendes før `goOnline`.
- En annen klient kan endre roten imellom («konkurrent»).

**Kontroll av hvert forløp:**

- Hver skriving legger en unik markør. Testene kontrollerer at markøren står **nøyaktig én gang** på serveren, eller ikke i det hele tatt når klienten fikk avslag.
- Både det terminale utfallet (committet, eller avvist med grunn) og den faktiske servertilstanden kontrolleres.
- Lyttere og offline-forbindelser ryddes i `afterEach`, også når en test feiler.

**Kommandoer, fra `web/`, med emulatoren:**

- Korrekthet, kjører også i CI: `npm run test:integration` (filen er med).
- Måling:
  ```
  P0_MAALING=1 P0_RAPPORT=<fil> npx firebase emulators:exec --config ../firebase.json \
    --project demo-familieapp --only database,auth \
    "npx vitest run --config vitest.integration.config.ts src/data/rotTransaksjon.p0.integration.test.ts"
  ```

Uten `P0_MAALING` hoppes de 6 måletestene over.

## 2. Resultat: korrekthet ved samtidighet (21 tester, alltid i CI)

Tallene er fra lokale kjøringer 19.11. De 21 korrekthetstestene besto i tre kjøringer på rad.

### 2a. Separate klienter

| Forløp | Terminalt utfall og servertilstand |
|---|---|
| Roten har lest; node-transaksjonen (produksjon) committer imellom | Roten tar et nytt updater-kall (2 kall) og committer. Begge postene står nøyaktig én gang. |
| Node-transaksjonen har lest; roten committer imellom | Node-transaksjonen tar et nytt kall (2) og committer. Begge står én gang. |
| REST (produksjon) committer mens roten har en gammel verdi | Roten tar et nytt kall (2) og committer. REST-posten og kvitteringen under `_reactForsok` er bevart. |
| REST har lest med ETag; roten committer imellom **uten** å endre handlelisten | PUT godtas uten ny runde (`GET, PUT`). |
| REST har lest med ETag; roten committer imellom **og endrer** handlelisten | PUT får `412`. REST-veien tar en ny runde (`GET, PUT, GET, PUT`, status `412, 200`), og begge endringene står. |
| `set`/`update` committer mens roten har en gammel verdi | Roten tar et nytt kall (2) og bevarer dem. |
| Tre urelaterte `set`, alle awaitet, committer mens roten har en gammel verdi | Roten tar et nytt kall (2) og committer. Alle tre står. |
| `set` fra en klient som var offline mens roten committet | `set` overskriver rotens verdi **på samme sti** uten konflikt. Resten av roten står. |
| `update` fra en klient som var offline mens roten committet | `update` endrer bare sine egne barnestier, og overskriver også der roten skrev. Resten av roten står. |

Skrivinger uten versjonsbetingelse, altså `set` og `update`, vinner på sine egne stier. Det er dagens semantikk, ikke en ny feil.

### 2b. Samme `Database`-instans (én klient)

| Rekkefølge | Den andre skrivingen | Uten konkurrent | Med en annen klient som endrer roten imellom |
|---|---|---|---|
| Roten først, deretter | `set` på barnesti | Begge committer (roten: 1 kall) | **Roten avbrytes av SDK-et med `set`**. Ingenting fra roten er skrevet. `set` står. |
| Roten først, deretter | `update` på barnesti | Begge committer (1 kall) | **Roten avbrytes med `set`**. Ingenting fra roten er skrevet. `update` står. |
| Roten først, deretter | node-transaksjon (produksjon) | Begge committer (1 kall) | Begge committer. Roten tar 2 kall. |
| Den andre først, deretter roten | `set`, `update` eller node-transaksjon | Begge committer (1 kall) | Begge committer. Roten tar 2 kall. |

**Funn.** En `set` eller `update` på en sti under roten, i **samme klient** mens rot-transaksjonen er sendt, merker rot-transaksjonen for avbrudd.

- Godtar serveren rotens sending, committer roten som vanlig.
- Avviser serveren den som utdatert, fordi en annen klient har endret roten, kjører SDK-et **ikke** updateren på nytt. Det avbryter rot-transaksjonen med grunnen `set`.
- Firebase beskriver dette i dokumentasjonen for `runTransaction`, `set` og `update`. Det samsvarer med SDK-koden (`repoAbortTransactions`, statusen `SENT_NEEDS_ABORT`).
- En implementering av alternativ A i én React-klient må derfor behandle dette avbruddet som et eget utfall: synlig avslag eller et nytt, kontrollert forsøk. Hvordan, er ikke avgjort her.
- Testen hverken skjuler eller retter dette i appen.

**Avgrensning.** Testet er REST med `if-match`, `transactForsoningNode`, `set` og `update` i rekkefølgene over. Andre skrivere er **ikke** testet:

- legacy `dbSet`;
- MCP-ens `transactFamily` mot en React-rot;
- `onDisconnect`;
- flere samtidige rot-transaksjoner i samme klient;
- `set` eller `update` på **selve** rotstien.

I de testede forløpene ble det ikke observert noen tapt eller dobbel skriving. Serverens tilstand samsvarte alltid med det klienten fikk vite.

## 3. Resultat: belastning (`P0_MAALING=1`, lokal emulator, 19.11)

Hvert scenario kjører fem rot-transaksjoner etter hverandre, mens N simulerte skrivere (separate klienter) skriver én liten post hver per intervall. Verdiene er **eksempler**. Det finnes ingen bestått-grense.

| Rot | Samtidige skrivere | Committet | Kall til updateren per rot-transaksjon (målt) | Tid per rot-transaksjon | Proxy: kall × rotstørrelse | Urelaterte tapt |
|---|---|---|---|---|---|---|
| 1 MB, uten base64 | 2 hvert 50. ms | 5/5 | 3, 2, 2, 2, 2 | 95–209 ms | ≈ 11 MB | 0 av 22 |
| 1 MB, uten base64 | 5 hvert 50. ms | 5/5 | 2, 2, 3, 1, 2 | 69–104 ms | ≈ 10 MB | 0 av 38 |
| 10 MB, base64-kvitteringer | 0 (grunnlinje) | 5/5 | 1 hver | 718–784 ms | ≈ 50 MB | — |
| 10 MB, base64-kvitteringer | 2 hvert sekund | 5/5 | 1, 2, 2, 2, 2 | 747–992 ms | ≈ 90 MB | 0 av 10 |
| 10 MB, base64-kvitteringer | 2 hvert 50. ms | **0/5**: `maxretry` | 25 hver | 4,7–5,3 s | ≈ 1250 MB | 0 av 277 |
| 10 MB, base64-kvitteringer | 5 hvert 50. ms | **0/5**: `maxretry` | 25 hver | 4,8–5,1 s | ≈ 1250 MB | 0 av 667 |

Tidligere kjøringer ga samme mønster, men med variasjon. Én kjøring med 1 MB og 5 skrivere hvert 50. ms hadde én rot-transaksjon med 19 kall.

**Tolkning, avgrenset til det som er målt:**

- Ved 10 MB og høyt skrivetempo nådde hver rot-transaksjon SDK-ets grense på 25 updater-kall og ble **avbrutt av klienten** med `maxretry`.
  - Ingenting fra roten ble skrevet, og ingen urelatert skriving gikk tapt.
  - Det er et trygt avslag, men låsingen eller den vernede skrivingen ville ikke gått gjennom.
- Ved 1 MB, og ved 10 MB med et roligere tempo, committet alle rot-transaksjonene.
- Om, og ved hvilket tempo, dette skjer i produksjon, kan **ikke** utledes av forsøket (se §4).

## 4. Målemetode og begrensninger

- **Målt sikkert:**
  - antall **kall til updateren**, talt i updateren;
  - terminalt utfall og avbruddsgrunn (`maxretry`, `set`);
  - veggklokketid fra `runTransaction` starter til den er avgjort, uten ventingen på første rotverdi;
  - servertilstand etterpå, lest med admin-SDK-et.
- **Et kall til updateren er ikke det samme som et forsøk over nettverket.** SDK-et kan kjøre updateren på nytt lokalt, for eksempel ved en ny lokal verdi eller ny hendelse, uten en tilsvarende full opplasting. Antall sendinger og antall avvisninger fra serveren er **ikke** målt.
- **Kolonnen «proxy: kall × rotstørrelse» er en grov beregningsproxy:** kall til updateren ganget med JSON-størrelsen på verdien updateren sist returnerte. Den er **ikke** bevis for hvor mye som faktisk er overført, eller forsøkt lastet opp. Nedlastingen (første rotverdi og ferske verdier) er ikke målt. Dette krever måling på nettverksnivå. Nettverkskostnad eller en sikker sultegrense i produksjon kan ikke utledes av tallene.
- **Klientens avbrudd og serverkonflikt er to forskjellige ting:**
  - **Serverkonflikt:** serveren avviser en sendt skriving fordi verdien er endret siden klienten leste (`datastale`). Normalt kjører SDK-et da updateren på nytt.
  - **Klientens avbrudd:** SDK-et avslutter transaksjonen selv. Det skjer med `maxretry` når grensen på 25 updater-kall er nådd, og med `set` når en lokal `set`/`update` under roten har merket en sendt transaksjon og serveren så avviser den.
  - Begge avbruddene er terminale avslag til kalleren uten noen skriving fra roten.
- **Emulatoren** kjører lokalt. Den har ingen nettverksforsinkelse og ingen båndbreddegrense, og ytelsen er en annen enn produksjonsdatabasens.
- **Skrivetempoene** (hvert 50. ms og hvert sekund) er valgt for å vise et intervall. De er ikke målt bruksmønster.
- **10 MB-roten** består mest av base64-«kvitteringer». Hvor stor produksjonsroten er, og hvor mye av den som er bilder, er ukjent.

## 5. Hva som fortsatt må avklares før A, B eller C kan velges

1. **Produksjonsrotens størrelse i byte.** Den skal måles skrivefritt og nær serveren som et tall, innenfor lesemandatet.
2. **Faktisk skrivetempo i familien.** Det gjelder særlig handlelisten, MCP og åpne faner.
3. **Faktisk antall sendinger og overført mengde per rot-transaksjon.** Det må måles på nettverksnivå, for eksempel med en lokal proxy med forsinkelse. Forsøket gir bare updater-kall og en grov proxy.
4. **Håndtering av SDK-avbrudd i én klient.** Det gjelder `set` fra en lokal `set`/`update` under roten, og `maxretry`. Det må designes for A dersom A velges, sammen med hvilke skrivere som kan dele klient med rot-transaksjonen.
5. **Om rot-transaksjonen kan gjøres mindre.** Alternativ C (felles forelder) krever migrering. Å flytte store base64-kvitteringer ut (kvitteringer B) henger på operatørsteget.
6. **Utestede skrivere** (§2b, «Avgrensning») og **regelhypotesene for B** (kartleggingen §3).

**Foreløpig vurdering, ikke et valg:** I de testede forløpene ga alternativ A ingen tapte eller doble skrivinger. Det har likevel to typer klientavbrudd som må håndteres: `set` i én klient og `maxretry` ved høyt tempo og stor rot. Kostnaden er ikke målt. A, B og C bør vurderes samlet, når punkt 1–3 er kjent.
