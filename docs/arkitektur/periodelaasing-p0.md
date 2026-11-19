# Periodelåsing P0: rot-transaksjon mot eksisterende skrivere (syntetisk emulatorforsøk)

**Status:** gjennomført som syntetisk forsøk (#59, ordre 6995863821). Resultatet er **beslutningsgrunnlag, ikke bevis for ytelse i produksjon**. Ingen låsing er implementert, og A/B/C og V1–V7 er ikke besluttet (se [`periodelaasing-kartlegging.md`](periodelaasing-kartlegging.md) §4–§6).
**Kode:** [`web/src/data/rotTransaksjon.p0.integration.test.ts`](../../web/src/data/rotTransaksjon.p0.integration.test.ts).
**Kodegrunnlag:** `main` `f5e36a0`.
**Grenser:** Bare Firebase-emulatoren og syntetiske data. Produksjonsroten er ikke lest, og det er ikke kjørt noe forsøk i produksjon. Ingen ny skrivevei i appen, ingen endring i rules, IAM eller data.

## 1. Oppsett og hva som er produksjonskode

| Del | Produksjonskode eller simulert |
|---|---|
| Handlelistens REST-vei med ETag og `if-match` (`skrivHandlelisteVersjonert`) | **Produksjonskode**, gjennom appens `firebase.ts`-singleton |
| Node-transaksjon på forsoningsnodene (`transactForsoningNode` på `transaksjoner`) | **Produksjonskode** |
| Rot-transaksjonen `runTransaction` på `families/{f}` | **Simulert**. Det finnes ingen i `web/`. Den er modellert på MCP-ens `transactFamily`: vent på første rotverdi, kjør transaksjonen og avslutt lytteren. Den bruker **ikke** et permanent rotabonnement. Updateren legger en markør under `p0/rot` og en post i `transaksjoner`, og bevarer resten urørt. |
| Vanlig `set` og `update`, og «urelaterte» skrivere | **Simulert**: separate klientapper, hver med egen websocket og cache |

Rekkefølgen styres deterministisk med `goOffline`/`goOnline`. En klient som har lest en verdi og går offline, regner på den gamle verdien. Når den kommer tilbake, sender den skrivingen med en utdatert hash, og serveren avviser den. Det er det ekte forløpet med avbrudd og nytt forsøk i SDK-et.

Hver skriving legger en unik markør. Testene kontrollerer at hver markør står **nøyaktig én gang** etterpå. Det avdekker både tapte og doble skrivinger.

**Kommandoer, fra `web/`, med emulatoren:**

- Korrekthet, kjører også i CI: `npm run test:integration` (filen er med).
- Måling:
  ```
  P0_MAALING=1 P0_RAPPORT=<fil> npx firebase emulators:exec --config ../firebase.json \
    --project demo-familieapp --only database,auth \
    "npx vitest run --config vitest.integration.config.ts src/data/rotTransaksjon.p0.integration.test.ts"
  ```

Uten `P0_MAALING` hoppes måletestene over.

## 2. Resultat: korrekthet ved samtidighet (alltid i CI)

| Forløp | Resultat (lokal kjøring 19.11) |
|---|---|
| Roten har lest; node-transaksjonen (produksjon) committer imellom | Roten avvises og prøver på nytt (2 kall til updateren) og committer. Begge postene står nøyaktig én gang. |
| Node-transaksjonen har lest; roten committer imellom | Node-transaksjonen prøver på nytt (2 kall) og committer. Begge står én gang. |
| REST (produksjon) committer mens roten har en gammel verdi | Roten prøver på nytt (2 kall). REST-posten og kvitteringen under `_reactForsok` er bevart. |
| REST har lest med ETag; roten committer imellom **uten** å endre handlelisten | PUT godtas uten ny runde (`GET, PUT`). En rot-skriving som lar handlelisten stå uendret, gir ikke ny ETag for `shopping` i emulatoren. |
| REST har lest med ETag; roten committer imellom **og endrer** handlelisten | PUT får `412`, REST-veien tar en ny runde (`GET, PUT, GET, PUT`, status `412, 200`), og begge endringene står. |
| Vanlig `set`/`update` committer mens roten har en gammel verdi | Roten prøver på nytt (2 kall) og bevarer dem. |
| Vanlig `set` fra en klient som var offline mens roten committet | `set` overskriver rotens verdi **på samme sti** uten konflikt. Det er dagens semantikk for blind skriving, ikke en ny feil. Resten av rotens skriving står. |
| Urelaterte samtidige skrivinger under rot-transaksjonen | Ingen tapt eller doblet skriving. |

**Tolkning:**

- I alle forløpene serialiserer RTDB rot-transaksjonen mot de eksisterende skriverne.
- Tapte eller doble skrivinger ble ikke observert.
- De eksisterende node-skriverne fikk bare nye forsøk når roten faktisk endret deres egen node. Da gikk de sin vanlige vei: ny `412`-runde for REST, ny updater for SDK-transaksjonen.

## 3. Resultat: belastning (`P0_MAALING=1`, lokal emulator, 19.11)

Hvert scenario kjører fem rot-transaksjoner etter hverandre, mens N simulerte skrivere skriver én liten post hver per intervall. Verdiene er **eksempler**. Det finnes ingen bestått-grense.

| Rot | Samtidige skrivere | Committet | Kall til updateren per rot-transaksjon | Tid per rot-transaksjon | Estimert opplastet | Urelaterte tapt |
|---|---|---|---|---|---|---|
| 1 MB, uten base64 | 2 hvert 50. ms | 5/5 | 3, 2, 2, 2, 2 | 90–205 ms | ≈ 11 MB | 0 av 22 |
| 1 MB, uten base64 | 5 hvert 50. ms | 5/5 | 2, 3, 5, 2, 2 | 88–179 ms | ≈ 14 MB | 0 av 47 |
| 10 MB, base64-kvitteringer | 0 (grunnlinje) | 5/5 | 1 hver | 760–834 ms | ≈ 50 MB | — |
| 10 MB, base64-kvitteringer | 2 hvert sekund | 5/5 | 1, 2, 2, 2, 2 | 800–993 ms | ≈ 90 MB | 0 av 10 |
| 10 MB, base64-kvitteringer | 2 hvert 50. ms | **0/5**: `maxretry` | 25 hver (SDK-ets grense) | 4,5–5,2 s | ≈ 1250 MB | 0 av 271 |
| 10 MB, base64-kvitteringer | 5 hvert 50. ms | **0/5**: `maxretry` | 25 hver | 4,4–4,9 s | ≈ 1250 MB | 0 av 658 |

En tidligere kjøring med 1 MB og 5 skrivere hvert 50. ms ga én rot-transaksjon med 19 kall. Variasjonen mellom kjøringer er stor.

**Tolkning:**

- En rot-transaksjon kostet om lag 0,8 s per forsøk ved 10 MB **lokalt, uten nettverksforsinkelse**.
- Hver samtidig skriving i familien under det vinduet gir et nytt forsøk med full rot.
- Ved et høyt skrivetempo **sulter** rot-transaksjonen. Etter 25 forsøk avbryter SDK-et med `maxretry`. Ingenting er da skrevet, og de andre skriverne er upåvirket. Det gir et trygt avslag, men låsing og vernet skriving ville da ikke gått gjennom.
- I et ekte nett blir hvert forsøk lenger, fordi hele roten skal opp og ned. Konfliktvinduet blir dermed større enn i emulatoren, og sultegrensen inntreffer ved et lavere skrivetempo enn målt her.

## 4. Målemetode og begrensninger

- **Kall til updateren** telles i updateren. Ett kall er lik ett forsøk.
- **Tid** er veggklokke fra `runTransaction` starter til den er avgjort. Ventingen på første rotverdi er ikke med.
- **Opplastet mengde** er **estimert** som `kall × JSON-størrelsen på verdien updateren returnerte`. SDK-et sender over websocket, og den faktiske overførte mengden er ikke målt. Nedlastingen, med første rotverdi og ferske verdier etter avvisning, er ikke målt i det hele tatt. Begge krever måling på nettverksnivå.
- Emulatoren kjører lokalt. Den har ingen nettverksforsinkelse og ingen båndbreddegrense, og ytelsen er en annen enn produksjonsdatabasens.
- Skrivetempoene (hvert 50. ms og hvert sekund) er valgt for å vise et intervall. De er ikke målt bruksmønster. Én familie har normalt langt færre samtidige skrivinger enn hvert 50. ms. Synkronisering i bakgrunnen, MCP-kvitteringer i `_mcp` og flere åpne faner kan likevel samle seg.
- 10 MB-roten består mest av base64-«kvitteringer». Hvor stor produksjonsroten er, og hvor mye av den som er bilder, er ukjent (se kartleggingen §7).

## 5. Hva som fortsatt må avklares før A, B eller C kan velges

1. **Produksjonsrotens størrelse i byte.** Den skal måles skrivefritt og nær serveren som et tall, innenfor lesemandatet. Den avgjør om roten er nærmere 1 MB, der A virket i forsøket, eller 10 MB, der A sultet ved høyt skrivetempo.
2. **Faktisk skrivetempo i familien.** Det gjelder særlig handlelisten, MCP og åpne faner. Det avgjør om sultingen ved høyt tempo er realistisk.
3. **Nettverkskostnaden ved en rot-transaksjon** på mobil, med full rot per forsøk. Den er ikke målt. Et forsøk med ekte nettverksforsinkelse, for eksempel en strupet lokal proxy, ville gi bedre grunnlag uten å røre produksjon.
4. **Om rot-transaksjonen kan gjøres mindre.**
   - Alternativ C (felles forelder for periodedata) fjerner de urelaterte nodene fra konfliktgrensen. Det krever migrering.
   - Å flytte store base64-kvitteringer ut av databasen (vedleggstjenesten i kvitteringer B) ville redusere roten. Det henger på operatørsteget for B.
5. **Regelhypotesene for B** («Databaseregler» i kartleggingen §3) er ikke testet i dette forsøket.

**Foreløpig vurdering, ikke et valg:** Alternativ A er korrekt under samtidighet i emulatoren. Kostnaden og sulterisikoen avhenger sterkt av rotens størrelse og av skrivetempoet. Ved en stor rot med base64-bilder er A sårbar. A, B og C bør derfor vurderes samlet, når punkt 1 og 2 er kjent.
