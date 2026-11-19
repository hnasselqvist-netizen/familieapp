# Arbeidsflyt: kommentar på én manuell økonomisk hendelse (ChatGPT via MCP)

Dette er roadmap «Praktisk vedlikehold via ChatGPT» i Forvaltning (#59 6759007909). Grenen var stoppet fordi appen ikke kunne endre kommentaren etter oppretting (#141). Handlingen er nå bygget i appen (#59, ordre 7002365160), og arbeidsflyten er åpen.

Arbeidsflyten **setter, endrer eller tømmer `kommentar`** på **én entydig, vanlig manuell** hendelse etter eksplisitt bestilling fra brukeren. Den bruker bare `data_les`, `data_hent` og `data_skriv` (`mcp-server/README.md` §«Generell skriving»). Den krever ingen ny domenetillatelse og ingen nye MCP-verktøy.

Den gjør ikke noe av dette:

- endrer beløp, fordelinger, status, dato, `opprettet`, koblinger, regel eller kontrollgrunnlag;
- bruker økonomisk korrigering for å endre teksten;
- endrer kommentaren på en mellomværende-, bank- eller kvitteringskoblet hendelse;
- oppretter eller gjenoppretter en hendelse.

## 1. Feltet i appen (kontrakten)

- **Sti:** `hendelser` er en helnode-array. Identiteten er hendelsens `id` inne i elementet, **aldri indeksen**.
- **Hvem kan endres:** `kilde: "manuell"`, ingen `mellomvaerende` og ingen `transaksjonId` eller `receiptId` (`kommentarBerettigelse`).
  - Mellomværende holdes utenfor fordi appen regenererer den kommentaren ved retting og angring (`settOppgjor`).
  - Bank- og kvitteringskoblede hendelser er ikke «vanlig manuell».
- **Form:** en ikke-tom streng, trimmet som ved manuell registrering (`bankimport.ts`: `kommentar.trim() || null`). Linjeskift inne i teksten bevares.
- **Tom form:** tømming **fjerner nøkkelen**. Ved oppretting lagres `null`, som RTDB heller ikke lagrer, så det finnes bare én tom form.
- **Ugyldig råform:** en annen lagret verdi (tall, objekt, tom streng) vises ikke og endres aldri herfra (`ugyldig`).
- **`oppdatert`:** en reell endring setter `oppdatert` til tidspunktet for brukerens lagringsforsøk (ISO). En identisk normalisert verdi gir `allerede`: ingenting skrives, og `oppdatert` står.
- **Appens skrivevei:** «Kommentar» øverst i korrigeringsvinduet fra «Vis hendelser bak dette tallet» i Økonomi. Den er en egen handling med eget «Lagre kommentar», atskilt fra «Lagre korrigering».
  - Kjeden er `useHendelseKommentar.lagre` → `kjorNodeVersjonert` + `besluttKommentar` (review 5971652993). Den leser hele `hendelser` fersk fra serveren i eksportform med prioriteter og ETag. Den avgjør på den verifiserte lesingen og sender PUT av noden i eksportform med `if-match`. En samtidig endring gir 412 og en ny runde. Målet er alltid `id`.
  - Bare målets nøkkel byttes. Andre felt, også ukjente, står. Det samme gjør de andre hendelsene, prioriteter (også på selve kommentaren) og nodens nøkler, også en sparsom form.
  - Et **stopp** sender ingenting: ingen skriving, ingen reindeksering og ingen tapt prioritet. Det avgjøres på serverens verdi, aldri i klientens cache.
  - **Utfall:**
    - endret kommentar siden utkastet startet: `konflikt`, og utkastet står;
    - manglende hendelse: `mangler` (aldri gjenopprettet);
    - flere med samme id: `tvetydig`;
    - ikke lenger vanlig manuell: `ikkeBerettiget`.
  - **Sesjon:** utkast og forsøk er bundet til familie og innloggingssesjon (per `currentUser`-instans, ikke uid). Et bytte gir `byttet` uten at noe sendes.
  - **Frist og tapt svar:** én frist på 15 s for hele operasjonen, også tokenhenting og JSON-lesing. Et token eller svar etter fristen starter aldri en ny forespørsel. Et tapt svar på en sendt PUT gir `ukjent` og et frosset forsøk. En holdt PUT kan bare nå frem hvis noden står nøyaktig som da den ble lest (`if-match`).
  - **Kontroll:** den skrivefrie kontrollen (`lesForsoningNodeFersk`, fersk REST-lesing under samme frist) viser bare nåtilstanden. «Lagre på nytt» er et nytt forsøk. Et sikkert avslag på det avgjør ikke det første (samme mønster som #185).
- **Visning:** kommentaren vises i budsjettets drilldown («Manuelt registrert» når den mangler) og i historikkeksporten. Begge leser feltet slik det er lagret.
- **Legacy (`index.html`):** viser kommentaren (drilldown og eksport), men redigerer den ikke. Legacy skriver ikke forsoningsnodene etter R3b-cutover, så ingen legacy-vei kan overskrive en endret kommentar.
- **Prioriteter:** kommentarveien bevarer prioriteter og nodens form. Den ordinære forsoningsskriveren (`transactForsoningNode`, brukt av korrigering og beslutninger) arbeider fortsatt på `val()` og skriver hele noden som array. Den er uendret.

## 2. Speiling, og hvor grenen stoppes

| Bestilling eller tilstand | Handling |
| --- | --- |
| Ny eller endret kommentar (ikke-tom etter trimming) på én entydig vanlig manuell hendelse | Støttes (3–6). |
| Tømme kommentaren | Støttes: nøkkelen fjernes (4). |
| Kommentaren er allerede slik brukeren ber om | Ingenting skrives. Meld at den allerede er slik. |
| Lagret `kommentar` har en ugyldig form | **Stopp.** Meld formen uten innhold. |
| Mellomværende-, bank- eller kvitteringskoblet hendelse, eller `kilde` ≠ `"manuell"` | **Stopp.** Utenfor arbeidsflyten. |
| Ingen eller flere hendelser treffer | **Stopp**, og be om eksplisitt målvalg. |
| Andre felt (beløp, post, status, dato) | Utenfor arbeidsflyten: det er korrigering i appen. |

## 3. Les og bestem

En eksplisitt og entydig bestilling autoriserer skrivingen (#27 6509067353). Bare et tvetydig mål eller et endret grunnlag avklares.

1. **Finn målet.**
   - `data_les { sti: "hendelser" }` med alle sider (følg `neste` til `null`). Bruk bare `id`, `dato`, `kilde`, koblingsfeltene og fordelingenes `plasseringNavn`/`belop` til å identifisere. Et barn som er `forStor`, leses på egen sti.
   - Krev nøyaktig **én** hendelse med oppgitt `id`, eller ett entydig treff på dato, beløp og post. Flere med samme `id` er `tvetydig`: stopp.
   - Noter **indeksen** målet ligger på nå. Den brukes bare som adresse for denne ene skrivingen, aldri som identitet.
2. **Grunnlaget:** `data_hent { sti: "hendelser/<indeks>" }` gir `verdi` og `versjon` fra samme lesing.
   - Mangler verdien, eller er den `forStor` eller uten `versjon`: stopp.
   - `verdi.id` må fortsatt være målets `id`. Er det en annen, er listen reindeksert: start på nytt fra 3.1.
   - Berettigelsen må fortsatt holde (`kilde: "manuell"`, ingen `mellomvaerende`, `transaksjonId` eller `receiptId`).
   - `kommentar` må mangle eller være en ikke-tom streng. Ellers: stopp (§2).
3. **Den nye kommentaren:** trim. Tom tekst betyr tømming. Er resultatet likt dagens kommentar (eller tomt, og den mangler), skrives ingenting.
4. **Planlagt element:** en kopi av **hele** råverdien fra 3.2 der bare `kommentar` er satt (eller fjernet ved tømming) og `oppdatert` er satt til nå (ISO, UTC). Alle andre felt følger uendret, også felt appen ikke kjenner. Meld hva som **planlegges**. Bekreftet utfall meldes først i 6.

## 4. Skriv

1. Lag opId **én gang** etter `OPID` i `mcp-server/src/data/skriving.ts`: `ÅÅÅÅ-MM-DD_<suffiks>`, med UTC-dato og et tilfeldig suffiks på 8–80 tegn. Noter opId og operasjonen uendret.
2. Send `data_skriv { opId, ops: [{ sti: "hendelser/<indeks>", type: "set", verdi: <planlagt element>, forventet: "<elementversjonen fra samme data_hent>" }] }`.
   - Enhver endring av elementet etter lesingen gir `konflikt`, og ingenting skrives. Det gjelder også en reindeksering, der et annet element står på indeksen, og en sletting.
   - `set` med `forventet: "mangler"` brukes **aldri**: det ville opprettet en hendelse.
   - Delvis skriving på `hendelser/<indeks>/kommentar` brukes **ikke**. En versjon av bare kommentaren vernet ikke mot at elementet på indeksen er byttet.
3. **Kan ikke skrives tapsfritt.** Kopien kan ha noe `data_skriv` avviser: `null`, en tom liste eller et tomt objekt, en ugyldig nøkkel, `__proto__`, `constructor` eller `prototype`, eller en liste med hull. Stopp da uten skriving, og meld grunnen.
4. **Begrensning mot appen:** appen kontrollerer hele listen i samme transaksjon, også at `id` er unik. `data_skriv` på ett element ser bare elementet. En duplikat-`id` som dukker opp et annet sted mellom lesing og skriving, oppdages derfor ikke her, men appen viser den som `tvetydig` etterpå.

## 5. Utfall, konflikt og retry

Ingen utfall fører til en ny automatisk skriving.

| Utfall | Handling |
| --- | --- |
| `committed` | Les tilbake (6). |
| `replay` | Allerede lagret med samme opId. Ingen ny skriving. Les tilbake. |
| `konflikt` | Elementet er endret, flyttet eller slettet siden lesingen. Ingenting er skrevet. Start på nytt fra 3.1 og vis den nye tilstanden. Grunnlaget er endret, så det avklares med brukeren før en eventuell ny skriving med ny versjon og nytt opId. |
| `ukjent_utfall`, `skriving_feilet` | Uavklart. Bare på brukerens forespørsel, og innenfor gyldighetsvinduet (30 dager, og etter `_mcp/vannmerke`), prøves det igjen med **samme opId og samme operasjon**, aldri med et nytt opId. Er `skriving_feilet` `vedvarende`, stopp og meld grunnen. |
| `utlopt` | Kvitteringen kan ikke lenger bevise utfallet, og det meldes som **uavklart**. Les uten å skrive. Avklar med brukeren før en eventuell ny skriving. |
| Andre feil | `ugyldig_skriving`, `invalid_path`, `beskyttet`, `for_stor`, `forelder_er_verdi`, `not_member` og `idempotency_conflict` skriver garantert ingenting. Meld grunnen. |

## 6. Les tilbake og meld

- **Bekreftet utfall** er det `data_skriv` svarte: `committed` eller `replay`, med lagret versjon og `senereEndret` fra den innebygde tilbakelesingen.
- **Nåtilstanden** kommer fra en separat, fersk lesing som finner hendelsen på `id` (3.1). Sammenlign `kommentar` med det planlagte. Ved tømming skal nøkkelen mangle. Kontroller at `fordelinger`, `status` og `dato` er som før.
- **Avvik** meldes som de er, med utfall og nåtilstand hver for seg. Påstå ingen årsak, og «rett» ingenting.
- Kommentaren vises i appen i drilldown under posten og i korrigeringsvinduet for hendelsen.

## 7. Kodeankre og tester

- **Kontrakt:**
  - `web/src/domain/forsoning/hendelseKommentar.ts` (`kommentarBerettigelse`, `normaliserKommentar`, `lesKommentar`, `besluttKommentar`, `vurderKommentarNaatilstand`, tekster);
  - `web/src/data/forsoningSkriving.repository.ts` (`kjorNodeVersjonert`, `lesForsoningNodeFersk`);
  - `web/src/hooks/useHendelseKommentar.ts`;
  - `web/src/features/hverdagsflyt/forvaltning/korrigering/HendelseKommentar.tsx`, vist fra `KorrigerHendelseModal` via `PostDrilldown`.
- **Tester:**
  - domene: `hendelseKommentar.test.ts`;
  - emulator: `hendelseKommentar.integration.test.ts`. Den dekker sett, endre, tøm og identisk; endret kommentar og andre felt; reindeksering og duplikat-id; slettet mål; mellomværende-, bank- og kvitteringskoblet; ugyldig form; ukjente felt; uendret eksportform (prioriteter, sparsom form) etter hvert stopp, med kald og utdatert cache; bevarte prioriteter ved endring; holdt PUT som når frem, og som avvises med 412; 412 med ny runde; sesjonsbytte med samme uid; tilgang;
  - frist: `forsoningSkriving.frist.test.ts` (falsk klokke: token og body som henger eller kommer sent);
  - hook: `useHendelseKommentar.test.tsx`;
  - UI: `HendelseKommentar.test.tsx`;
  - e2e på mobilbredde: `e2e-skriving/hendelse-kommentar.spec.ts`.

Historikk: grenen ble stoppet i #141 fordi appen manglet en redigeringsvei. Råfeltvern kom i #142, og handlingen ble levert i ordre 7002365160.
