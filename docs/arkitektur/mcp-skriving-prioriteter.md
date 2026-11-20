# Firebase-prioriteter i generell MCP-skriving: måling og rettingsgrunnlag

#27, ordre 7027957835, og presisert etter review 5987048510. Dette er grunnlaget for en senere retting. Dokumentet endrer ingenting i runtime. Rettingen bestilles først etter review av dette dokumentet.

**Grunnlaget er en kjent, dokumentert begrensning**, ikke en observert produksjonshendelse. Se `docs/drift/bibliotek-notat.md` §4. Alt nedenfor er målt med syntetiske data mot RTDB-emulatoren. Det er ikke lest, målt eller skrevet noe i produksjon.

## 1. Hva er målt, og hva er ikke målt

Testen ligger i `mcp-server/src/store/dataSkriving.prioritet.integration.test.ts`, og den kjører i CI.

**Oppsett:**

- Familien seedes med prioritet på disse nivåene:
  - familieroten;
  - en urørt domenenode (`budget`, `budget/mat`);
  - målposten med nøstede objekter og blader (`mealLibrary/m1`, `…/navn`, `…/detaljer`, `…/detaljer/a`);
  - en søsterpost (`mealLibrary/m2`);
  - de beskyttede `members` og `members/<uid>`;
  - `_mcp` med et ukjent felt (`_mcp/annet`), `_mcp/vannmerke`, `_mcp/ops` og en eksisterende, ikke utløpt kvittering (`_mcp/ops/2026-11-19_gammel01`);
  - `shopping/_skriver`.
- Hvert kall går gjennom den faktiske veien `skrivData` → `FirebaseAdminStore.transactFamily`.

**Målt:**

- `committed` for hvert kall til den ekte `transactFamily`.
- `value`-hendelser **observert** fra en separat forbindelse.
  - Måleperioden starter først når lytterens første tilbakekall er mottatt.
  - Ved en commit ventes det til minst én hendelse er observert. Ellers brukes et fast observasjonsvindu.
- Faktisk `exportVal()` før og etter, lest fra den separate forbindelsen.

**Ikke målt:** nettverksforespørsler, updater-kjøringer og interne transaksjonsforsøk i SDK-et.

- Et stopp kommuniserer fortsatt med serveren, med lesing og transaksjonsforsøk.
- Målingen sier bare at ingen `transactFamily` committet, at ingen hendelse ble observert i vinduet, og at eksporten er uendret.
- Fravær av hendelser er en observasjon, ikke et bevis på at ingenting ble sendt.

| Kall | Utfall | `transactFamily` | Observert | Prioriteter etterpå |
| --- | --- | --- | --- | --- |
| `set` på et blad (`mealLibrary/m1/navn`) | `committed` | ett kall, `committed: true` | ≥ 1 hendelse | **Bare familieroten står.** Alle nøstede prioriteter er borte, også i `budget`, `members`, `_mcp` (med `ops`, kvittering og `vannmerke`) og `shopping/_skriver`. |
| `update` av ett barn | `committed` | ett kall, `committed: true` | ≥ 1 | Samme |
| `slett` av en post (`mealLibrary/m2`) | `committed` | ett kall, `committed: true` | ≥ 1 | Samme |
| Atomisk flersti (`set` + `slett`) | `committed` | ett kall, `committed: true` | ≥ 1 | Samme |
| `konflikt` (feil forventet versjon) | `konflikt` | ≥ 1 kall, alle `committed: false` | 0 i vinduet | Hele eksporten er uendret |
| Ikke medlem | `not_member` | ≥ 1 kall, alle `committed: false` | 0 i vinduet | Hele eksporten er uendret |
| Replay av en committet opId | `replay` | ≥ 1 kall, alle `committed: false` | 0 i vinduet | Hele eksporten er uendret |
| `idempotens_konflikt` | `idempotency_conflict` | ≥ 1 kall, alle `committed: false` | 0 i vinduet | Hele eksporten er uendret |

**Verdier:**

- Verdiene i urørte domener, `members` og `shopping/_skriver` står etter en commit. Det er bare prioriteten som går tapt.
- **`_mcp` (observert, ikke ønsket kontrakt):** ved commit bygges `_mcp` om til bare `ops` og `vannmerke` (`mcp-server/src/data/skriving.ts` l. 582–600, `mcpUt = { ops, vannmerke? }`).
  - Det ukjente feltet `_mcp/annet` forsvinner med verdi.
  - Den eksisterende kvitteringen og `vannmerke` beholder verdien, men mister prioriteten.
  - Kontrakten krever at beskyttede felt bevares. Ingen kommentar eller kode gir grunnlag for å rydde bort metadata. Dette er derfor et gap, ikke en ønsket oppførsel. Se §4 punkt 4 og `it.fails`-testen for `_mcp`.

Andre stopp, som `utlopt`, `for_stor` og `forelder_er_verdi`, går samme vei i koden: updateren returnerer `undefined` (`dataSkriving.ts` steg 3). Det er ikke målt her.

## 2. Hvorfor: kodeankre

- `mcp-server/src/store/firebaseAdminStore.ts` `transactFamily` (l. 248–266) kjører `ref.transaction(updater, undefined, false)` på hele `families/{f}`.
  - Updateren får `val()`-form, uten prioriteter.
  - Verdien den returnerer, erstatter hele familien.
  - SDK-et beholder bare prioriteten på transaksjonens egen rot, slik målingen viser.
- `mcp-server/src/data/skriving.ts` `besluttSkriving` bygger `neste` på `val()`-form (`lagringsform`, `settPaa`) og bygger `_mcp` på nytt (l. 582–600).
- `mcp-server/src/store/storeContract.ts` l. 277 låser kontrakten «rå val()-form» for `lesNode` og `transactFamily`.

## 3. Hva SDK-et og REST-API-et faktisk tillater

Målt i samme testfil, under «forutsetninger for retting»:

1. **Admin SDK-transaksjon.** Updateren ser `val()` uten prioriteter. En returnert verdi i eksportform (`.priority` og `.value`) lagres derimot **med** prioritetene.
2. **RTDB-REST mot emulatoren** med emulatorens `Bearer owner`.
   - `GET …/families/{f}.json?format=export` med `X-Firebase-ETag: true` gir eksportformen og en ETag.
   - `PUT` av hele familien i eksportform med `if-match` bevarer alle prioriteter.
   - Endres **bare en prioritet** imellom, gir PUT `412`, og ingenting skrives. En ny runde mot fersk ETag lykkes.
   - Dette verifiserer semantikken for eksport og ETag, **ikke** produksjonens ADC-token eller IAM (§5).
   - Webappen bruker samme mønster per post med brukertoken: #185, #186, #189, #190 (`web/src/data/versjonertPost.ts`).

## 4. Rettingsforslag (anbefalt)

**Betinget REST-skriving av familieroten i eksportform**, som erstatning for SDK-transaksjonen i `transactFamily`. Bare `data_skriv` berøres.

1. **Les** `families/{f}` fersk i eksportform med ETag. Det skjer over `RtdbRest` med ADC-tokenet, som `listChildKeys` (`data_nokler`) allerede gjør for lesing (`firebaseAdminStore.ts` l. 43–64, `main.ts` l. 24–40).
2. **Bestem** på `val()`-formen av lesingen med `besluttSkriving`. Disse delene av kontrakten består:
   - familie og medlemskap;
   - beskyttede felt i dataposisjonene;
   - alle-eller-ingen;
   - kildeversjon og `forventet`;
   - opId, idempotens og replay;
   - størrelsesgrenser;
   - full familietilgang, også til fremtidige domener.
3. **Stopp:** ingen PUT.
4. **Ellers:** én `PUT` med `if-match`. Endringene flettes inn i eksportformen sti for sti, slik webappens `flettEksport` gjør (`web/src/data/gaver.repository.ts`).
   - Posisjonene i kallet flettes inn på sine stier.
   - **`_mcp` endres sti for sti, ikke ved ombygging.** Det betyr: sett `_mcp/ops/<opId>` (den nye kvitteringen), slett `_mcp/ops/<id>` for hver dokumentert beskåret kvittering, og sett `_mcp/vannmerke` hvis det endres.
   - Ukjente felt under `_mcp` og alle prioriteter utenfor disse stiene står, med verdi og prioritet.
   - **Dette er en endring i `besluttSkriving`, ikke «uendret»:** l. 582–600 må returnere de navngitte `_mcp`-endringene, altså ny kvittering, beskårne id-er og eventuelt nytt vannmerke, som stiendringer, i stedet for en ombygd `_mcp`.
   - Beslutningen om replay, idempotens, utløp og beskjæring er den samme.
   - Det samme bør gjelde i `val()`-formen, så en ukjent verdi under `_mcp` heller ikke forsvinner der.
   - Et erstattet blad eller objekt beholder sin egen prioritet.
5. **Utfall.** Bare et svar som beviser at **dette** forsøket ikke ble lagret, er et sikkert avslag:
   - `412` gir en ny runde mot fersk lesing, innenfor dagens `MAKS_FORSOK`.
   - Et dokumentert terminalt avslag for dette forsøket, som `401`/`403` eller en bekreftet størrelsesavvisning, kan gi `skriving_feilet`. Bare det, og bare når kvitteringen er lest og mangler, som i dag.
   - **Usikre forløp gir `ukjent_utfall`, aldri `skriving_feilet`:** en PUT sendt uten svar, en transportfeil, en frist, eller et serversvar som ikke kan tolkes sikkert.
   - **I begge tilfeller** brukes kvitteringsoppslag og samme opId som i dag. Et sikkert avslag for dette forsøket sier ingenting om et tidligere eller samtidig forsøk med samme opId, som fortsatt kan ha lagret. Et nytt sikkert avslag avklarer aldri tidligere ukjent historikk.
   - Tilbakelesingen (steg 5) er uendret.

**Hvorfor ikke en SDK-transaksjon med prioriteter fra en separat eksportlesing:** updateren kan bare sammenligne `val()`. En samtidig endring av **bare en prioritet** mellom lesingen og transaksjonen ville ikke bli oppdaget, og den ville bli overskrevet. ETag-en dekker prioriteter (§3). SDK-transaksjonen gjør ikke det.

**Forkastet:**

- *Gjenopprette prioriteter etter commit:* ikke atomisk, og gir ekstra skrivinger.
- *Smalere transaksjon:* `_mcp` ligger på familieroten, så den felles stien er alltid roten.

## 5. Legitimasjon, IAM og rules

- **Ingen IAM-, rules- eller nettverksutvidelse foreslås.**
  - REST-lesing med kjøretidsidentitetens ADC-token mot databasens vertsnavn er i bruk i produksjon (`data_nokler`).
  - Skriveretten (`roles/firebasedatabase.admin`) er gitt i Runbook steg 8 (`mcp-server/README.md`) og brukes i dag av SDK-transaksjonen.
- **Uverifisert produksjonsforutsetning:** at REST-**skriving** med det samme ADC-tokenet virker i produksjon.
  - Emulatormålingen bruker `Bearer owner` og verifiserer ikke produksjonens token eller IAM.
  - Det skal ikke prøveskrives eller bestilles IAM-endring for å avklare det nå.
  - Ved første ekte bruk etter en retting gjelder utfallsreglene i §4 punkt 5: et dokumentert terminalt avslag er sikkert ikke lagret for dette forsøket, alt annet er ukjent med kvitteringsoppslag.
- **Nettverkskostnad utledes ikke her.** Eksportform med prioriteter, JSON over HTTPS, nye runder ved `412` og SDK-ets protokoll skiller seg fra hverandre på måter som ikke er målt. Den kjente belastningen på familieroten fra #184 er bare en referanse.

## 6. Kodeflater og tester en retting trenger

- **`mcp-server/src/store/types.ts`:** ny portmetode for betinget skriving av familien, med beslutning på eksportform og utfallene `lagret`, `stopp`, `avvist`, `ukjent` og `ikkeSendt`. Den erstatter `transactFamily`, som bare brukes av `dataSkriving.ts`.
- **`firebaseAdminStore.ts`:** implementasjon over `RtdbRest` (`emulatorRest` finnes) med én frist rundt token, fetch og body. Skrivevakten (`skrivebeskyttet.ts`) for lesing er urørt.
- **`memoryStore.ts`:** samme port i minnet med eksportform, for enhetstestene.
- **`storeContract.ts`:**
  - kontrakten «rå val()-form» for `transactFamily` byttes ut med prioritetsbevaring;
  - 412 eller ny runde;
  - stopp uten commit.
- **`data/skriving.ts`:**
  - `_mcp`-endringene som stiendringer (§4 punkt 4), så ukjente `_mcp`-verdier bevares;
  - en ren fletting av posisjoner og `_mcp`-endringer inn i eksportform.
- **`data/dataSkriving.ts`:**
  - steg 2–4 kartlegges om fra SDK-avbruddsgrunner (`FORSOKET_AVVIST`) til HTTP-utfall, etter reglene i §4 punkt 5;
  - kvitteringsoppslag og samme opId ved både `skriving_feilet` og `ukjent_utfall`.
- **Tester:**
  - de fem `it.fails`-testene i `dataSkriving.prioritet.integration.test.ts` blir vanlige tester, også den for `_mcp`;
  - de eksisterende `dataSkriving.integration.test.ts` og `dataLesing.integration.test.ts` skal fortsatt være grønne;
  - nye tester: 412, holdt PUT med ukjent utfall og kvitteringsoppslag, transportfeil og frist som ukjent, og et terminalt avslag som ikke avklarer tidligere ukjent.
- **Uendret:** handlelisteverktøyene (`transactShopping`), lesingen (`data_les`, `data_hent`, `data_nokler`), rules og IAM.

## 7. Utenfor denne skiven

- Ingen runtimeendring, deploy, produksjonslesing eller produksjonsskriving.
- Ingen datarydding, Pakket-aktivering eller ny serverfunksjon.
- Ingen valg av periodelåsingsarkitektur (A/B/C) eller produktvalg (V1–V7).
