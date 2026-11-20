# Firebase-prioriteter i generell MCP-skriving: måling og rettingsgrunnlag

#27, ordre 7027957835. Dette er grunnlaget for en senere retting. Dokumentet endrer ingenting i runtime. Rettingen bestilles først etter review av dette dokumentet.

**Grunnlaget er en kjent, dokumentert begrensning**, ikke en observert produksjonshendelse. Se `docs/drift/bibliotek-notat.md` §4. Alt nedenfor er målt med syntetiske data mot RTDB-emulatoren. Det er ikke lest, målt eller skrevet noe i produksjon.

## 1. Hva er målt

Testen ligger i `mcp-server/src/store/dataSkriving.prioritet.integration.test.ts`, og den kjører i CI.

**Oppsett:**

- Familien seedes med prioritet på disse nivåene:
  - familieroten;
  - en urørt domenenode (`budget`, `budget/mat`);
  - målposten med nøstede objekter og blader (`mealLibrary/m1`, `…/navn`, `…/detaljer`, `…/detaljer/a`);
  - en søsterpost (`mealLibrary/m2`);
  - de beskyttede `members`, `members/<uid>`, `_mcp`, `_mcp/annet` og `shopping/_skriver`.
- Hvert kall går gjennom den faktiske veien `skrivData` → `FirebaseAdminStore.transactFamily`.
- Resultatet er faktisk `exportVal()` lest fra en **separat** forbindelse.
- Det telles:
  - utfallet av hver transaksjon (`committed`);
  - `value`-hendelser på familien sett fra den separate forbindelsen. En skriving gir en hendelse, også når den bare endrer prioriteter.

| Kall | Utfall | Transaksjoner | Hendelser | Prioriteter etterpå |
| --- | --- | --- | --- | --- |
| `set` på et blad (`mealLibrary/m1/navn`) | `committed` | 1, committed | 1 | **Bare familieroten står.** Alle 13 nøstede prioriteter er borte, også i `budget`, `members`, `_mcp` og `shopping/_skriver`. |
| `update` av ett barn | `committed` | 1, committed | 1 | Samme |
| `slett` av en post (`mealLibrary/m2`) | `committed` | 1, committed | 1 | Samme |
| Atomisk flersti (`set` + `slett`) | `committed` | 1, committed | 1 | Samme |
| `konflikt` (feil forventet versjon) | `konflikt` | ≥ 1, ingen committed | 0 | Hele eksporten står uendret |
| Ikke medlem | `not_member` | ≥ 1, ingen committed | 0 | Hele eksporten står uendret |
| Replay av en committet opId | `replay` | ≥ 1, ingen committed | 0 | Hele eksporten står uendret |
| `idempotens_konflikt` | `idempotency_conflict` | ≥ 1, ingen committed | 0 | Hele eksporten står uendret |

**Verdier:**

- Verdiene i urørte domener og beskyttede felt står etter en commit. Det er bare prioritetene som går tapt.
- **Unntaket er `_mcp`:** ved commit bygges `_mcp` om til bare `ops` (og `vannmerke` når det finnes). Ukjente felt under `_mcp` forsvinner med verdi. Det skjer i `mcp-server/src/data/skriving.ts` l. 582–600, der `mcpUt = { ops, vannmerke? }`. `_mcp` er MCP-ens eget navnerom, så dette er trolig tilsiktet. Det er notert her fordi ordren spør om kvitteringsmetadata.

**Stopp sender ingenting:** konflikt, avslag og replay committer ikke og gir ingen serverhendelse. Avslagene er målt med de fire formene i tabellen. Andre stopp, som `utlopt`, `for_stor` og `forelder_er_verdi`, går samme vei: updateren returnerer `undefined`, se `dataSkriving.ts` steg 3. Det er ikke målt her.

## 2. Hvorfor: kodeankre

- `mcp-server/src/store/firebaseAdminStore.ts` `transactFamily` (l. 248–266) kjører `ref.transaction(updater, undefined, false)` på hele `families/{f}`.
  - Updateren får `val()`-form, uten prioriteter.
  - Verdien den returnerer, erstatter hele familien.
  - SDK-et beholder bare prioriteten på transaksjonens egen rot, slik målingen viser.
- `mcp-server/src/data/skriving.ts` `besluttSkriving` bygger `neste` på `val()`-form (`lagringsform`, `settPaa`).
- `mcp-server/src/store/storeContract.ts` l. 277 låser kontrakten «rå val()-form» for `lesNode` og `transactFamily`.

## 3. Hva SDK-et og REST-API-et faktisk tillater

Målt i samme testfil, under «forutsetninger for retting»:

1. **Admin SDK-transaksjon.**
   - Updateren ser `val()` uten prioriteter.
   - En returnert verdi i eksportform (`.priority` og `.value`) lagres derimot **med** prioritetene.
   - SDK-et kan altså skrive prioriteter, men updateren vet ikke hvilke som finnes.
2. **RTDB-REST med Admin-legitimasjon.**
   - `GET …/families/{f}.json?format=export` med `X-Firebase-ETag: true` gir eksportformen og en ETag.
   - `PUT` av hele familien i eksportform med `if-match` bevarer alle prioriteter.
   - Endrer en annen klient **bare en prioritet** imellom, gir PUT `412`, og ingenting skrives. En ny runde mot fersk ETag lykkes.
   - Webappen bruker allerede samme mønster per post: #185, #186, #189, #190 (`web/src/data/versjonertPost.ts`).

## 4. Rettingsforslag (anbefalt)

**Betinget REST-skriving av familieroten i eksportform**, som erstatning for SDK-transaksjonen i `transactFamily`. Bare `data_skriv` berøres.

1. **Les** `families/{f}` fersk i eksportform med ETag. Dette er samme `RtdbRest` og samme ADC-token som `listChildKeys` (`data_nokler`) allerede bruker i produksjon (`firebaseAdminStore.ts` l. 43–64, `main.ts` l. 24–40).
2. **Bestem** på `val()`-formen av lesingen med den uendrede `besluttSkriving`. Kontrakten består da som i dag:
   - familie og medlemskap;
   - beskyttede felt;
   - alle-eller-ingen;
   - kildeversjon og `forventet`;
   - opId, idempotens og replay;
   - vannmerke og beskjæring;
   - størrelsesgrenser;
   - full familietilgang, også til fremtidige domener.
3. **Stopp:** ingen PUT. Det er det samme som i dag, se tabellen.
4. **Ellers:** flett posisjonene og `_mcp` inn i eksportformen sti for sti, slik webappens `flettEksport` gjør (`web/src/data/gaver.repository.ts`). Send én `PUT` med `if-match`.
   - Prioriteter står på urørte domener, beskyttede felt, søsken og foreldre.
   - Et erstattet blad eller objekt beholder sin egen prioritet.
5. **Utfall:**
   - `412`: ny runde mot fersk lesing, innenfor dagens `MAKS_FORSOK`.
   - `401`/`403` eller `400`/`413` (avvist eller for stor): bevist ikke lagret, det vil si `skriving_feilet` som i dag.
   - Sendt uten svar, eller frist: `ukjent_utfall`, og kvitteringen slås opp som i dag (steg 4).
   - Tilbakelesingen (steg 5) er uendret.

**Hvorfor ikke en SDK-transaksjon med prioriteter fra en separat eksportlesing:** updateren kan bare sammenligne `val()`. En samtidig endring av **bare en prioritet** mellom lesingen og transaksjonen ville ikke bli oppdaget, og den ville bli overskrevet. ETag-en dekker prioriteter, som målingen i §3 viser. SDK-transaksjonen gjør ikke det.

**Forkastet:**

- *Gjenopprette prioriteter etter commit:* ikke atomisk, og gir ekstra skrivinger.
- *Smalere transaksjon:* `_mcp` ligger på familieroten, så den felles stien er alltid roten.

## 5. Legitimasjon, IAM og rules

- **Ingen IAM-, rules- eller nettverksutvidelse foreslås.**
  - REST-lesingen bruker allerede kjøretidsidentiteten med ADC-tokenet mot databasens vertsnavn (`data_nokler`).
  - Skriveretten (`roles/firebasedatabase.admin`) er gitt i Runbook steg 8 (`mcp-server/README.md`) og brukes i dag av SDK-transaksjonen.
  - Admin-tilgang går forbi rules på samme måte over REST som over SDK-et.
- **Ikke verifisert:** at REST-**skriving** med samme ADC-token virker i produksjon. Lesingen gjør det. Det må bekreftes ved første ekte bruk etter en retting, ikke med produksjonstester nå. Feiler den, er utfallet `skriving_feilet` (bevist ikke lagret), ikke datatap.
- **Last:** SDK-transaksjonen sender allerede hele familieroten. En REST-PUT av roten har samme størrelse, pluss én GET. Den kjente belastningen på familieroten fra #184 refereres, men er ikke målt på nytt, og ingen ytelse lovt.

## 6. Kodeflater og tester en retting trenger

- **`mcp-server/src/store/types.ts`:** ny portmetode for betinget skriving av familien, med beslutning på eksportform og utfallene `lagret`, `stopp`, `avvist`, `ukjent` og `ikkeSendt`. Den erstatter `transactFamily`, som bare brukes av `dataSkriving.ts`.
- **`firebaseAdminStore.ts`:** implementasjon over `RtdbRest` (`emulatorRest` finnes) med én frist rundt token, fetch og body. Skrivevakten (`skrivebeskyttet.ts`) for lesing er urørt.
- **`memoryStore.ts`:** samme port i minnet med eksportform, for enhetstestene.
- **`storeContract.ts`:**
  - kontrakten «rå val()-form» for `transactFamily` byttes ut med prioritetsbevaring;
  - 412 eller ny runde;
  - stopp uten skriving.
- **`data/skriving.ts`:** en ren fletting av posisjoner og `_mcp` inn i eksportform. `besluttSkriving` er uendret.
- **`data/dataSkriving.ts`:**
  - steg 2–4 kartlegges om fra SDK-avbruddsgrunner (`FORSOKET_AVVIST`) til HTTP-status;
  - verifiseringen av avvisninger mot fersk lesing blir en del av REST-lesingen.
- **Tester:**
  - de fire `it.fails`-testene i `dataSkriving.prioritet.integration.test.ts` blir vanlige tester;
  - de eksisterende `dataSkriving.integration.test.ts` og `dataLesing.integration.test.ts` skal fortsatt være grønne;
  - nye tester: 412, holdt PUT med ukjent utfall og kvitteringsoppslag, og et innloggingsuavhengig tjenestetoken.
- **Uendret:** handlelisteverktøyene (`transactShopping`), lesingen (`data_les`, `data_hent`, `data_nokler`), rules og IAM.

## 7. Utenfor denne skiven

- Ingen runtimeendring, deploy, produksjonslesing eller produksjonsskriving.
- Ingen datarydding, Pakket-aktivering eller ny serverfunksjon.
- Ingen valg av periodelåsingsarkitektur (A/B/C) eller produktvalg (V1–V7).
