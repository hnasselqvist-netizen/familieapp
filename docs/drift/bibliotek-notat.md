# Arbeidsflyt: notat på én middag i Middagsbiblioteket (ChatGPT via MCP)

Dette er roadmap «Praktisk vedlikehold via ChatGPT» (#27 6747848773). Arbeidsflyten ble stoppet i #137 fordi appen manglet feltet. Feltet er nå bygget i appen (Mat #20, ordre 6998241717), og arbeidsflyten er åpen.

Arbeidsflyten **oppretter, endrer eller tømmer `notat`** på **én entydig eksisterende** middag etter eksplisitt bestilling fra brukeren. Den bruker bare `data_les`, `data_hent` og `data_skriv` (`mcp-server/README.md` §«Generell skriving»). Den krever ingen ny domenetillatelse og ingen nye MCP-verktøy.

Den gjør ikke noe av dette:

- endrer andre felt på middagen, eller notat på en variant (finnes ikke);
- oppretter en middag;
- gjenoppretter en slettet middag.

## 1. Feltet i appen (kontrakten)

- **Sti:** `mealLibrary/{nøkkel}/notat`, på selve middagen. Nodenøkkelen er identiteten.
- **Form:** en ikke-tom streng. Linjeskift bevares, og appen lagrer CRLF som LF. Teksten trimmes ikke. Høyst 2000 tegn (`MAKS_NOTAT`).
- **Tom form:** et tomt notat lagres aldri. Tømming **fjerner nøkkelen**, så det finnes bare én tom form. Et notat som bare består av mellomrom og linjeskift, regnes som tomt.
- **Ugyldig råform:** en annen lagret verdi (tall, objekt, tom streng) vises ikke og endres ikke av appen. Vanlige endringer i appen lar den stå uendret (`medBevartePostfelt`).
- **Appens skrivevei** (`useMealLibrary.lagreNotat` → `skrivMealLibraryEntryVersjonert` + `besluttNotat`):
  - fersk REST-lesing av posten i eksportform med ETag;
  - avgjørelse mot notatet utkastet startet fra (`kilde`);
  - PUT av posten i eksportform med `if-match` på eksakt nøkkel.

  Bare `notat` endres. Prioriteter og andre felt står. En samtidig endring gir 412 og en ny runde. Et notat som er endret siden utkastet startet, gir `konflikt`. En manglende middag gir `mangler` og blir aldri gjenopprettet. Et tapt svar gir `ukjent`, og deretter en skrivefri kontroll (`sjekkNotat`). Et nytt forsøk der notatet allerede er likt utkastet, gir `allerede` uten skriving.
- **Visning:** «Notat» i middagens detaljvisning (`MiddagsNotat`), med bevarte linjeskift og eksplisitt «Lagre notat». Det finnes ingen autosave.
- **Legacy (`index.html`):** viser og redigerer ikke notat. Endringene per post der (`skrivBibliotekPost`) skriver `{...cur, …}` på fersk verdi og bevarer derfor `notat`. Endring og sletting i legacy sammenligner hele råposten (`stabilOppskrift`). Et notat som er endret siden visningen, gir derfor legacys eksisterende konflikttekst, ingen stille overskriving. Legacy-transaksjonene bruker `val()`, så de bevarer ikke prioriteter. Det gjelder hele posten og er uendret fra før. Bevaringen av ukjente toppfelt, som `notat` er for legacy, er dekket av `web/e2e-legacy/middagsbibliotek-skrivevei.spec.ts`.

## 2. Speiling, og hvor grenen stoppes

| Bestilling eller tilstand | Handling |
| --- | --- |
| Nytt eller endret notat (ikke-tomt etter normalisering, høyst 2000 tegn) på én entydig middag | Støttes (3–6). |
| Tømme notatet | Støttes: nøkkelen fjernes (4). |
| Notatet er allerede slik brukeren ber om | Ingenting skrives. Meld at notatet allerede er slik. |
| Lagret `notat` har en ugyldig form | **Stopp.** Appen endrer den ikke; meld formen uten innhold. |
| Ingen eller flere middager treffer navnet | **Stopp**, og be om eksplisitt målvalg. |
| Notat på en variant, eller andre felt | Utenfor arbeidsflyten. |
| Over 2000 tegn | **Stopp**, som appen. |

## 3. Les og bestem

En eksplisitt og entydig bestilling autoriserer skrivingen (#27 6509067353). Bare et tvetydig mål eller et endret grunnlag avklares.

1. **Finn målet.**
   - **Oppslag på navn:** `data_les { sti: "mealLibrary" }` med alle sider (følg `neste` til `null`). Bare nøkkel og `name` brukes.
     - Et barn som er `forStor`, leses på egen sti.
     - Kan et barn ikke leses, eller er `name` ikke tekst, kan det ikke brukes til å fastslå at et treff er entydig. Stopp da, og be om eksplisitt målvalg.
     - Et treff er en middag der `name` er lik det oppgitte navnet, trimmet og uten hensyn til store og små bokstaver. Krev nøyaktig ett treff.
   - **Utpekt mål** (nøkkel fra samtalen) bindes til nodenøkkelen.
2. **Grunnlaget:** `data_hent { sti: "mealLibrary/<nøkkel>" }` gir `verdi` og `versjon` fra samme lesing.
   - Mangler verdien, eller er den `forStor` eller uten `versjon`: stopp. En manglende middag gjenopprettes aldri.
   - `name` må fortsatt treffe målet. Er middagen borte eller omdøpt, avklar målet.
   - `notat` må mangle eller være en ikke-tom streng. Ellers: stopp (§2).
3. **Det nye notatet:** normaliser som appen. CRLF/CR blir LF, og ingen trimming av innholdet. Tomt eller bare mellomrom og linjeskift betyr tømming. Høyst 2000 tegn.
   - Er resultatet likt dagens notat (eller tomt, og notatet mangler), skrives ingenting.
4. **Planlagt post:** en kopi av **hele** råverdien fra 2.2 der bare `notat` er satt, eller fjernet ved tømming. Alle andre felt følger uendret, også felt appen ikke kjenner. Meld hva som **planlegges**. Bekreftet utfall meldes først i 6.

## 4. Skriv

1. Lag opId **én gang** etter `OPID` i `mcp-server/src/data/skriving.ts`: `ÅÅÅÅ-MM-DD_<suffiks>`, med UTC-dato og et tilfeldig suffiks på 8–80 tegn. Noter opId og operasjonen uendret.
2. Send `data_skriv { opId, ops: [{ sti: "mealLibrary/<nøkkel>", type: "set", verdi: <planlagt post>, forventet: "<postversjonen fra samme data_hent>" }] }`.
   - Enhver endring i middagen etter lesingen gir `konflikt`, og ingenting skrives. Det gjelder også en sletting.
   - Delvis `update` eller `set` på `mealLibrary/<nøkkel>/notat` brukes **ikke**. En versjon av bare `notat` vernet ikke mot at middagen er slettet imellom. `set` med `forventet: "mangler"` på `notat` ville da opprettet en ny post med bare `notat`, altså gjenopprettet en slettet middag.
3. **Kan ikke skrives tapsfritt.** Kopien kan ha noe `data_skriv` avviser: en ugyldig nøkkel, `__proto__`, `constructor` eller `prototype`, en tom liste eller et tomt objekt, eller en liste med hull. Stopp da uten skriving, og meld grunnen.
4. **Prioriteter:** `data_skriv` arbeider på `val()`-form (`mcp-server/src/data/versjon.ts`) og bevarer ikke prioriteter. Appens egen notatlagring bevarer dem. Det er en kjent forskjell i den generelle kontrakten, ikke spesiell for notat.

## 5. Utfall, konflikt og retry

Ingen utfall fører til en ny automatisk skriving.

| Utfall | Handling |
| --- | --- |
| `committed` | Les tilbake (6). |
| `replay` | Allerede lagret med samme opId. Ingen ny skriving. Les tilbake. |
| `konflikt` | Middagen er endret eller slettet siden lesingen. Ingenting er skrevet. Les på nytt (3.2), og vis den nye tilstanden. Grunnlaget er endret, så det avklares med brukeren før en eventuell ny skriving med ny versjon og nytt opId. |
| `ukjent_utfall`, `skriving_feilet` | Uavklart. Bare på brukerens forespørsel, og innenfor gyldighetsvinduet (30 dager, og etter `_mcp/vannmerke`), prøves det igjen med **samme opId og samme operasjon**, aldri med et nytt opId. Er `skriving_feilet` `vedvarende`, stopp og meld grunnen. |
| `utlopt` | Kvitteringen kan ikke lenger bevise utfallet, og det meldes som **uavklart**. Les uten å skrive. Avklar med brukeren før en eventuell ny skriving. |
| Andre feil | `ugyldig_skriving`, `invalid_path`, `beskyttet`, `for_stor`, `forelder_er_verdi`, `not_member` og `idempotency_conflict` skriver garantert ingenting. Meld grunnen. |

## 6. Les tilbake og meld

- **Bekreftet utfall** er det `data_skriv` svarte: `committed` eller `replay`, med lagret versjon og `senereEndret` fra den innebygde tilbakelesingen.
- **Nåtilstanden** kommer fra en separat, fersk `data_hent { sti: "mealLibrary/<nøkkel>" }`. Sammenlign `notat` med det planlagte. Ved tømming skal nøkkelen mangle.
- **Avvik** meldes som de er, med utfall og nåtilstand hver for seg. Påstå ingen årsak, og «rett» ingenting.
- Notatet vises i appen under «Notat» i middagens detaljvisning.

## 7. Kodeankre og tester

- **Kontrakt:**
  - `web/src/types/shopping.ts` (`MealLibraryEntry.notat`);
  - `web/src/domain/mealLibrary/notat.ts` (`normaliserNotat`, `lesNotat`, `besluttNotat`, `vurderNotatOppfolging`);
  - `web/src/data/mealLibrary.repository.ts` (`parseMealLibraryEntry`, `medBevartePostfelt`, `skrivMealLibraryEntryVersjonert`, `lesMealLibraryEntryEksport`);
  - `web/src/hooks/useMealLibrary.ts` (`lagreNotat`, `sjekkNotat`);
  - `web/src/features/hverdagsflyt/mat/bibliotek/MiddagsNotat.tsx`.
- **Tester:**
  - domene: `notat.test.ts`;
  - emulator: `mealLibrary.notat.integration.test.ts`. Den dekker nytt notat, endring, tømming, prioritet og råfelt, samtidig notat og samtidig annet felt, manglende og slettet middag, ugyldig råform, tapt svar med oppfølging og nytt forsøk, frist og avvist. Den dekker også at vanlige endringer bevarer notatet;
  - UI: `MiddagsNotat.test.tsx`;
  - e2e på mobilbredde: `e2e-skriving/bibliotek-notat.spec.ts`;
  - MCP: `mcp-server/src/store/dataSkriving.integration.test.ts` dekker `set`, konflikt, replay og tilbakelesing.

Historikk: #137 stoppet arbeidsflyten fordi feltet manglet. #138 rettet råfelttapet. Feltet ble levert i ordre 6998241717.
