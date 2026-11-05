# Transaksjoner: detaljpanel og URL-tilstand (PC-2)

**Status:** implementert etter #59, ordre 6647608110. Koden ligger i:

- `web/src/domain/forsoning/oversiktUrl.ts` (URL-kontrakt);
- `web/src/domain/forsoning/transaksjonDetalj.ts` (regel- og kvitteringsgrunnlag);
- `transaksjoner/TransaksjonDetalj.tsx` (panelet);
- `TransaksjonsoversiktView.tsx` (valg, ventende forkast, fokus);
- `TransaksjonsoversiktScreen.tsx` (URL og navigasjonsvakt).

## URL-kontrakt

Visning, filtre, sortering og valgt transaksjon ligger i URL-en. Reload, dyplenke og tilbake/frem gir derfor samme utvalg og samme valg.

| Nøkkel                  | Verdi                                                          | Standard (skrives ikke) |
| ----------------------- | -------------------------------------------------------------- | ----------------------- |
| `visning`               | `alle`                                                         | «Til behandling»        |
| `maaned`                | `ÅÅÅÅ-MM`                                                      | alle                    |
| `konto`, `eier`, `post` | fri tekst uten kontrolltegn, maks 80 tegn (`post` 128)         | alle                    |
| `status`                | tilstandskategori (`ferdig`, `pa_vent`, …)                     | alle                    |
| `kontroll`              | `ikke_kontrollert`, `kvalitetssikret`, `endret_etter_kontroll` | alle                    |
| `sok`                   | søketekst, kontrolltegn fjernes, maks 100 tegn                 | tom                     |
| `sorter`, `rekkefolge`  | kjent kolonne; `synkende`/`stigende`                           | dato, synkende          |
| `valgt`                 | stabil transaksjons-ID (`[A-Za-z0-9_\-:.]`, maks 128)          | ingen                   |

- **Valget:** `valgt` gjelder bare «Alle transaksjoner». Det er alltid en ID, aldri en indeks, så en endring i arrayet kan aldri åpne en annen rad.
- **Ugyldige og ukjente verdier** normaliseres til standard.
- **Andre parametre** (`ko`, `verktoy`, `fra`, …) står urørt og i sin rekkefølge.
- **Ingen beløp** eller andre økonomiske detaljer skrives til URL-en. Den inneholder bare visningsparametre og det brukeren selv har skrevet i søket.
- **Historikk:**
  - Valg, filtervalg, sortering og visning lager hver sin historikkoppføring.
  - Første tegn i et nytt søk lager én oppføring, og resten av søket erstatter den (`erstatterHistorikk`). «Tilbake» går derfor til visningen før søket, ikke ett tegn tilbake.

## Panelet

- **Layout:**
  - Ved 80rem (1280 px) og bredere er panelet et sidepanel ved tabellen, med rollen `region`.
  - Under det er panelet et ark over listen eller tabellen, med rollen `dialog` og `aria-modal`. Arket ligger over bunnmenyen, som den delte Modal-en.
  - Tabellen eller kortene bak forblir montert.
  - Elementet er det samme i begge layoutene, så et breddebytte monterer ikke innholdet på nytt.
- **Innhold:**
  - banktekst, dato, konto og eksakt beløp med retning;
  - behandlingsstatus, og kvalitetssikring som en separat status;
  - fordeling per splitt med post, eier og beløp.
- **Regel:**
  - Regelen vises slik den er nå, og panelet sier det: regelen kan være endret etter at transaksjonen ble plassert.
  - En slettet regel vises som slettet.
  - Et lært forslag vises som forslag.
- **Kvitteringer:**
  - Panelet viser alle koblingsveier: kvitteringens `transactionId`, hendelsens `receiptId` og kvitteringens `hendelseId`.
  - Samme kvittering vises én gang med alle veiene.
  - Flere kvitteringer vises alle, med en merknad.
  - Forkastede kvitteringer gjenopplives ikke, bare telles.
- **Ugyldig eller slettet ID:** panelet viser en synlig melding. Ingen annen rad åpnes.
- **Utfiltrert valg:** valget står, med merknaden «Filteret skjuler denne transaksjonen i listen».

## Korrigering

- **Ett skjema:** korrigering skjer i panelet med det ene delte skjemaet (`KorrigerHendelseSkjema`), som også brukes av `KorrigerHendelseModal`. Det finnes ingen annen korrigeringsvei i Transaksjoner.
- **Lagring:** utkastet lagres bare med «Lagre korrigering» og går gjennom samme `onUtfor` som før. Datakontrakten er uendret.
- **Bytte og lukking:** et radbytte, «Lukk detaljer» eller Escape mens en korrigering er åpen gir et synlig valg: «Fortsett korrigering» eller «Forkast utkastet». Fokus går til det trygge valget. Ingenting forkastes i stillhet, og URL-en endres først når brukeren har valgt.
- **Navigasjon:** nettleserens tilbake/frem, en lenke eller «Til behandling» som ville byttet eller lukket valget holdes igjen med samme synlige valg (`useBlocker` i `TransaksjonsoversiktScreen`). Reload og lukking av fanen får nettleserens egen advarsel (`beforeunload`). Søk, filter og sortering endrer ikke valget og går fritt.
- **Breddeskift:** et breddeskift (sidepanel ↔ ark) beholder utkastet.
- **Hendelsen forsvinner** (slettet et annet sted) under korrigering: panelet sier fra («Hendelsen finnes ikke lenger»). Det finnes da ikke noe utkast å verne, så verken radbytte eller navigasjon holdes igjen.

## Fokus og tastatur

- Overskriften i panelet får fokus når en transaksjon åpnes.
- Escape lukker panelet. Ved lukking går fokus tilbake til raden som åpnet det.
- I arket går Tab rundt inne i arket.
- Hver rad har en egen knapp «Vis detaljer: …» med `aria-pressed`. Kvalitetssikring og «Korriger kobling» per rad er uendret.

## Tester

- **Domene:** `oversiktUrl.test.ts` (roundtrip, ugyldige verdier, andre parametre, historikk) og `transaksjonDetalj.test.ts` (regelgrunnlag, alle koblingsveier, forkastet).
- **Komponent:** `TransaksjonDetalj.test.tsx`, med ekte ruter og mocket datalag. Den dekker:
  - dyplenke, valg, Escape og fokus;
  - tilbake/frem, filter og sortering i URL, og søkshistorikk;
  - ugyldig ID og utfiltrert valg;
  - regel (nåværende og slettet), kvitteringer og eksakt beløp;
  - sidepanel og ark;
  - korrigering av riktig hendelse, og utkast over breddeskift;
  - ventende forkast, og holdt igjen tilbake/frem og sidebytte.
- **E2E mot emulatoren:** `e2e-skriving/forsoning.spec.ts` «PC-2». Den dekker:
  - dyplenke, reload og tilbake/frem;
  - Escape og fokus, og ugyldig ID;
  - korrigering i panelet med utkast over breddeskift, holdt igjen «frem» og forkastvalg, der ingenting skrives før «Lagre»;
  - visuell kontroll ved 390, 640, 800, 1024 og 1280 px uten vannrett rulling.
