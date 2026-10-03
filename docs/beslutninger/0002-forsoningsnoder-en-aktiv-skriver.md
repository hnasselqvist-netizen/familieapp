# 0002 — Forsoningsnodene: én aktiv skriver per node

- **Status:** Vedtatt
- **Dato:** 2. oktober 2026
- **Deltakere:** Kontrolltårnet/ChatGPT (systemarkitekt), Claude (teknisk implementatør)
- **Kilder:** Issue #34, designnote [5952769652](https://github.com/hnasselqvist-netizen/familieapp/issues/34#issuecomment-5952769652), beslutning [5952884278](https://github.com/hnasselqvist-netizen/familieapp/issues/34#issuecomment-5952884278)

## Kontekst

`transaksjoner`, `hendelser`, `receipts` og `rules` under `families/{f}` er
i dag **helnode-arrays**. Legacy (`index.html`) skriver hele listen med
`dbSet(node, next)`, så RTDB-nøklene er array-indekser og `id` ligger inne
i elementet. Legacy leser tilbake med `Object.values`.

Designnoten testet sameksistens konkret mot RTDB-emulatoren:

- En React-transaksjon på hele noden kjøres på nytt når legacy skriver
  underveis. Reacts **egen** skriving er altså trygg.
- En **senere** blind legacy-`dbSet` fra en utdatert lokal tilstand
  overskriver likevel en committet React-endring. Det skjer ved frakobling,
  og ved ferdige arrays som i «Kjør regler» og recovery.
- Rollback til legacy er tapsfri bare så lenge React beholder array-formen.
  Målrettede `node/{id}`-skrivinger gir duplikater etter en legacy-
  reindeksering.

## Beslutning

1. **Én aktiv skriver per node.** En node får en React-skriver først når
   **alle** legacy-skrivere av noden sperres i samme cutover. Legacy kan
   fortsatt lese.
2. **React beholder dagens array-form** og skriver med `transaction()` på
   hele noden, så lenge legacy må kunne være rollback. React skriver aldri
   `node/{id}`.
3. **Ingen nøkkelmigrering** fra indeks til id før legacy er pensjonert for
   noden. Det krever egen beslutning.
4. **Legacy-`setX` gjøres ikke om til transaksjoner** for en midlertidig
   sameksistensperiode.

## Cutover per node (sjekkliste)

1. React-skriveren for noden er ferdig og testet (helnode-transaksjon i
   array-form, med emulatortester for sameksistens og rollback).
2. **Legacy-skrivesperre** i den sentrale setteren (`setRules`,
   `setTransaksjoner`, `setHendelser`, `setReceipts`), med skrivebeskyttet
   UI. Den er én egen, revertérbar `index.html`-commit og krever eksplisitt
   mandat.
3. Sperren og React-skriveren aktiveres i **samme release**.
4. **Alle enheter lastes på nytt.** `sw.js` henter fra nett og cacher
   ingenting, så den gamle skriveren er åpne faner og PWA-er som ikke er
   lastet på nytt.
5. **Røyktest:** legacy skriver ikke lenger noden.

**Rollback:** slå av React-skriveren og reverter sperre-committen. Det
trengs ingen datamigrering, siden shape er uendret.

## Konsekvens for `rules` (R1)

`rules` skrives også av legacy-Bankimport (regel-læring) og av korrigering i
gammel Budsjett/Inntekter/Sparing, ikke bare av legacy-RegelSenter. R1
leverer derfor følgende, med skriving **av**:

- React-RegelSenter;
- `data/rules.repository.ts`;
- aktiveringsporten `web/src/hooks/regelsenterAktivering.ts`.

Skriving aktiveres ved **R3b-cutover**, sammen med sperren og sjekklisten
over.

## Oppdatering (R3b-0, 3. oktober 2026)

Kartleggingen av alle 44 kallsteder for de fire setterne viser at nesten
hver legacy-flyt skriver flere av nodene i samme handling. Cutoveren
gjelder derfor **alle fire nodene samtidig**, med:

- én felles port (`web/src/hooks/forsoningAktivering.ts`; R1-porten for
  `rules` følger den);
- én sperre-commit som anvender
  [`docs/arkitektur/r3b-legacy-skrivesperre.patch`](../arkitektur/r3b-legacy-skrivesperre.patch).

Sjekklisten over gjelder uendret. Paritetsløp og åpne valg står i
[`docs/arkitektur/r3b-cutover.md`](../arkitektur/r3b-cutover.md).
