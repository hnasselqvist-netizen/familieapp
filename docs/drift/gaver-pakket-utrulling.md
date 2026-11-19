# Utrulling: gavestatus «Pakket» (forberedelse → aktivering)

Ordre #20 7005959850, review 5973381911. «Pakket» rulles ut i **to trinn**. En eldre åpen fane kjenner ikke statusen og kan skrive «ide» over den (se §3). Valget åpnes derfor først når slike faner er håndtert.

| Tilstand | Hva det betyr |
| --- | --- |
| **Klargjort** | Forberedelsen er merget (PR #187). |
| **Publisert av** | Forberedelsen er live med `PAKKET_AKTIVERT = false`. Appen leser, viser og regner med `pakket`, men ingen kan velge den. |
| **Aktivert** | En egen aktiveringscommit med `PAKKET_AKTIVERT = true` er merget og publisert. |
| **Første ekte bruk** | En ekte gave settes til Pakket. Det følges separat. |

## 1. Hva forberedelsen endrer (PR #187)

- **Kontrakt og lesing:** `GaveStatus` får `pakket`, og parseren leser den. Eldre kjente statuser (`ide`, `kjopt`, `gitt`) rundtrippes uendret.
- **Beregning:** `erKjopt` og `iPlanen` teller Pakket nøyaktig som Kjøpt («Ferdig», summer, helårs gaveverdi). Pakket er ikke Gitt.
- **Visning:** en gave som allerede er `pakket`, vises som «Pakket» i statusvalget sitt, mellom Kjøpt og Gitt.
- **Av-bryter** (`web/src/domain/gaver/statusAktivering.ts`): `PAKKET_AKTIVERT = false`, og `kanVelgeStatus` styrer valget.
  - **UI:** «Pakket» tilbys ikke i noe statusvalg (listene for jul og løpende ideer, gaveeditoren og «Registrer gave»). Unntaket er en gave som allerede er pakket.
  - **Hook** (`useGaver`): `settGaveStatus`, `lagreGave` og `registrerGave` avviser `pakket` med `StatusIkkeAktivert` før noe skrives. Unntaket er at en gave som allerede er pakket, beholder statusen.
  - En pakket gave kan endres til en annen status, og lagres med uendret status i editoren.
- **Skrivevakt `gaveVakt`** (samme versjon OG kjent status) brukes for alle gaveskrivinger. En fane med denne versjonen eller nyere overskriver aldri en status den ikke kjenner. Skrivingen avvises som `EndretAvAndre`, og ingenting skrives.
- **Uendret:** ingen migrering, automatisk overgang, økonomi- eller budsjettendring, rules/IAM eller ny datamodell.

## 2. Hvordan av-modus er testet

- **Domene** (`gaver.test.ts`): `PAKKET_AKTIVERT` er `false`. `statusValg()` og `statusValg("kjopt")` gir Idé, Kjøpt, Gitt. `statusValg("pakket")` gir alle fire. `kanVelgeStatus` er dekket.
- **UI** (`Gaver.test.tsx`):
  - en kjøpt gave tilbyr ikke Pakket;
  - editoren for en idé og «Registrer gave» tilbyr ikke Pakket;
  - en pakket gave vises som Pakket, er «Ferdig» og har sum som Kjøpt;
  - den kan endres bort, og editoren beholder Pakket ved lagring.
- **Hook** (`useGaver.test.tsx`): å velge Pakket avvises før skriving, gjennom statusvalg, editor (ny og eksisterende) og registrering. Ingenting skrives. En pakket gave kan endres til Kjøpt og lagres med uendret Pakket.
- **e2e på 390 px** (`e2e-skriving/gaver-pakket.spec.ts`): en seedet pakket gave vises, er «Ferdig» og kan endres bort. En annen gave tilbyr ikke Pakket.
- **På-modus** (oppførselen etter aktivering) er låst med bryteren slått på i testene: `Gaver.pakketAktivert.test.tsx` og `useGaver.pakketAktivert.test.tsx`.
- **Datalaget** (`gaver.repository.integration.test.ts`): statusrundtur med Pakket, konflikt, retry, slettet gave, ukjent status og karakterisering av eldre fane.

## 3. Hva en eldre åpen fane kan gjøre

**En fane lastet før forberedelsen ble publisert:**
- Den viser en pakket gave som **Idé**. Gaven teller ikke som kjøpt, og personen kan stå som «Mangler gave».
- Lagring i gaveeditoren sender hele skjemaet, også `status: "ide"`. Vakten der ser bare versjonen. Lagringen **skriver altså «ide» over «pakket»** når versjonen er uendret.
- Statusvalget og «valgt» skriver bare det brukeren velger.
- Så lenge Pakket ikke kan velges (av-modus), finnes det ingen pakket gaver fra appen, og fanen har ingenting å overskrive.

**En fane lastet etter at forberedelsen ble publisert:**
- Den viser Pakket riktig og skriver aldri over den.
- Den kan ikke velge Pakket før aktivering.
- Den overskriver heller ingen senere ukjent status (`gaveVakt`).

## 4. Før aktivering: hvilke klienter må lastes på nytt eller lukkes

**Alle Hverdagsflyt-faner og installerte appvinduer som ble åpnet før forberedelsen ble publisert,** på alle enheter (mobil, nettbrett, PC), må lastes inn på nytt eller lukkes. Appen har ingen automatisk oppdatering, så en fane som står åpen, beholder den gamle koden.

Når forberedelsen er publisert og etterkontrollert, får Helen én konkret beskjed:

> Last inn på nytt eller lukk alle åpne Hverdagsflyt-faner og -vinduer på alle enheter. Si fra når det er gjort.

Aktiveringscommiten tas først etter det.

**ChatGPT/MCP:** `data_skriv` skal ikke skrive `status: "pakket"` på gaver før aktivering. Det finnes ingen egen arbeidsflyt for gaver.

## 5. Hva som ikke kan verifiseres teknisk

- At alle eldre faner faktisk er lastet på nytt eller lukket. Appen rapporterer ikke hvilken versjon åpne klienter kjører, og ingenting lagres om det.
- At ingen eldre fane gjenopprettes fra nettleserens økt (for eksempel ved gjenåpning av lukkede faner) med gammel kode i minnet. En normal gjenåpning laster på nytt fra Hosting, men det kan ikke garanteres for alle nettlesere.
- Det finnes derfor ingen garanti for at alle klienter er oppdatert. Aktiveringen hviler på brukerens bekreftelse i §4 og på at risikoen er avgrenset: én eldre fane, én gaveredigering, én status.

## 6. Aktivering (egen commit, senere)

- Sett `PAKKET_AKTIVERT = true` i `statusAktivering.ts`.
- Snu domenetesten for bryteren til `true`.
- Flytt eller gjør gjeldende på-modus-testene (`*.pakketAktivert.test.tsx`) som standard.
- Oppdater roadmap og kartlegging til «aktivert».
- Vanlig review, merge, fire grønne main-jobber og Hosting.
- Ingen datamigrering.

## 7. Rollback

- **Før aktivering:** forberedelsen kan reverteres trygt. Ingen pakket gaver er laget av appen, og eldre versjoner viser alle andre statuser som før.
- **Etter aktivering, tilbake til forberedt:** revert aktiveringscommiten (bryteren til `false`). Eksisterende pakket gaver vises fortsatt riktig, teller som kjøpt og kan endres bort eller beholdes. Ingen nye kan velges.
- **Ikke revert forberedelsen etter aktivering.** En versjon uten `pakket` viser pakket gaver som Idé og kan skrive «ide» over dem (§3). Trengs det, skal pakket gaver først endres til en annen status i appen.
