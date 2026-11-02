# Avstemming AV-1: felles avledet modell og kompakt PC-flate

**Status:** implementert etter #59 6572970205. Bygger på bestillingen i 6542147711, oppdelingen i 6542267549 og presiseringene i 6542342933. AV-2 (mobil handlingskø) kommer i en egen PR.

## Modell (`web/src/domain/avstemming/avstemmingsko.ts`)

Modellen er ren og bygger bare på de eksisterende vurderingene: `avstemmingsoversikt` og `vurderKontoMaaned`. Saldo-, motpost-, dublett- og fortegnsberegningen er uendret. Ingenting lagres. Rader, problemer og status utledes på nytt fra abonnementet hver gang transaksjoner eller kontrollpunkter endres.

- **Periode:** samme måneder som i dag, fra `foersteAvstemmingsmaaned` til siste avsluttede måned. Inneværende og fremtidige måneder er aldri med.
- **Kontoer:** kontoene i oversikten, pluss de konfigurerte kontoene (`KONTOER` i `transaksjonsoversikt.ts`, uten «alle»). Det er listen bankimporten bruker. Rekkefølgen er MC først, så alfabetisk.
- **Rad per konto og måned:** inngående (forrige måneds faktiske), inn, ut, avledet, beregnet, faktisk og differanse, alt i øre med fortegn. MC-gjeld er negativ. Manglende verdier er `null`, aldri 0.
- **Fase per rad:**
  - `aktiv` krever saldo og kan ha problemer.
  - `start` er måneden med kontoens første registrerte saldo, altså startsaldoen. Den er grunnlag for neste måned. Den regnes ikke som avstemt og er heller ikke et problem.
  - `foer_start` er før startsaldoen. Den er ikke del av avstemmingen og lager ingen problemer.
  - `ingen_data` er en konfigurert konto uten bevegelser eller saldo. Den vises, men lager ikke problemer.
- **Kontoer uten saldo noensinne** er aktive fra første bevegelse, og hver måned mangler saldo. En aktiv måned uten bevegelser krever også saldo. Ingen konto er ferdig bare fordi den mangler bevegelser.
- **Problemer** står i prioritert rekkefølge, slik at neste handling kommer først:
  1. `ukjent_konto`
  2. `mangler_saldo`
  3. `startpunkt` (saldo etter et hull)
  4. `uavklart_ignorert`
  5. `avledet_mulig_importert`
  6. `avledet_kilde_endret`
  7. `avledet_endret`
  8. `avvik`
  9. `manglende_motpost` (ved avvik: interne overføringer på andre kontoer uten motpost)
  10. `grunnlag_endret`
  11. `avledet` (ikke bankverifisert)
- **Ukjent konto** er et problem i måneden selv, uten kontorad.
- **OK** betyr status «avstemt» og ingen problemer igjen. Delvis løst er ikke OK.
- **Samlet status (`maanedsstatus`)** for valgt måned teller bankavstemte, avvik eller usikker, manglende grunnlag, avledede, avstemte med åpne forhold, startsaldo og ukjent konto. Den lister også andre måneder med åpne problemer, så en OK-måned aldri skjuler eldre avvik.

## PC-flaten (`AvstemmingPC.tsx`)

- **Bred flate:** fra 64rem, og bare på `/forvaltning/avstemming` (`routes/rom.ts`). Mobil er uendret i AV-1.
- **Oversikt:** årsvalg, samlet status med lenker til andre måneder med åpne forhold, og konto×måned-matrisen som kompakt historikk. Klikk på en celle velger både konto og måned.
- **Kontotabell:** kolonnene Konto, Inngående, Inn, Ut, Beregnet utgående, Faktisk utgående, Differanse og Status/handling. Overskriften står fast og tabellen har avgrenset scroll, som i PC-1.
- **Detaljpanel:** viser én konto og periode. Årsak og neste handling kommer først. Regnestykket og «Historikk og angring» (med «Ikke dublett», motposter og avledede) er foldet ut ved behov.
- **Gjenbruk:** delene er flyttet uendret til `avstemmingDeler.tsx` og brukes av begge flatene. Ingen nye skriveveier. «Bekreft saldoen på nytt» lagrer samme saldo med ferskt grunnlag via `lagreSaldo`.
- **Tastatur:** Enter i saldofeltet lagrer. Når raden manglet saldo, går fokus etter bekreftet lagring videre til neste konto som mangler saldo.
- **Utkast og pågående lagring:** ligger i `saldoUtkast` over valget mellom PC og mobil. De står derfor ved feil, ved breddeendring og ved levende abonnementsendring. Bare en bekreftet lagring fjerner utkastet.
- **Ikke løst før bekreftet:** databasen viser en lokal skriving før serveren har bekreftet den. Derfor følger PC-flaten med på skrivinger som ikke er bekreftet, per konto og måned. Det gjelder saldo, avklaring og korrigeringer. Raden viser «Lagrer…» og aldri «Avstemt» før lagringen er bekreftet. Standardvalget av konto låses når det vises, så panelet ikke hopper til en annen konto når en lagring løser problemet.

## Reversible valg som er tatt

- En konfigurert konto uten noen data lager ikke problemer, men vises som «Ingen data». Ellers ville en konto som aldri brukes til bankavstemming, bli et evig åpent forhold.
- Første registrerte saldo i perioden er startsaldo («start»), ikke et problem. Et senere hull gir både `mangler_saldo` i hullet og `startpunkt` i måneden etter.
- `manglende_motpost` meldes bare ved avvik. En intern overføring uten koblet motpost påvirker ikke avstemmingen av sin egen konto.
