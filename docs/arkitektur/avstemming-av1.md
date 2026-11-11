# Avstemming AV-1: felles avledet modell og kompakt PC-flate

**Status:** AV-1 implementert etter #59 6572970205 (#106). AV-2 (mobil handlingskø) implementert etter 6633102535, se [§ Mobilflaten](#mobilflaten-av-2-avstemmingmobiltsx). Bygger på bestillingen i 6542147711, oppdelingen i 6542267549 og presiseringene i 6542342933.

## Modell (`web/src/domain/avstemming/avstemmingsko.ts`)

Modellen er ren og bygger bare på de eksisterende vurderingene: `avstemmingsoversikt` og `vurderKontoMaaned`. Saldo-, motpost-, dublett- og fortegnsberegningen er uendret. Ingenting lagres. Rader, problemer og status utledes på nytt fra abonnementet hver gang transaksjoner eller kontrollpunkter endres.

- **Periode:** samme måneder som i dag, fra `foersteAvstemmingsmaaned` til siste avsluttede måned. Inneværende og fremtidige måneder er aldri med.
- **Kontoer:** kontoene i oversikten, pluss de konfigurerte kontoene (`KONTOER` i `transaksjonsoversikt.ts`, uten «alle»). Det er listen bankimporten bruker. Rekkefølgen er MC først, så alfabetisk.
- **Rad per konto og måned:** inngående (forrige måneds faktiske), inn, ut, avledet, beregnet, faktisk og differanse, alt i øre med fortegn. MC-gjeld er negativ. Manglende verdier er `null`, aldri 0.
- **Fase per rad:**
  - `aktiv` krever saldo og kan ha problemer.
  - `start` er måneden med kontoens første registrerte saldo, altså startsaldoen. Den er grunnlag for neste måned og regnes ikke som avstemt.
  - `foer_start` er før startsaldoen.
  - I begge fasene kreves ingen saldo. De lager aldri `mangler_saldo` eller `startpunkt`, så tomme perioder gir ingen kø.
  - Faktisk åpent grunnlag er likevel et problem og står i samlet status (review 5764883177). Det gjelder uavklart ignorert, avledet/usikkert og endret grunnlag etter etterimport.
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

- **Bred flate:** fra 64rem, og bare på `/forvaltning/avstemming` (`routes/rom.ts`). Under 64rem gjelder mobilflaten (AV-2).
- **Oversikt:** årsvalg, samlet status med lenker til andre måneder med åpne forhold, og konto×måned-matrisen som kompakt historikk. Klikk på en celle velger både konto og måned.
- **Kontotabell:** kolonnene Konto, Inngående, Inn, Ut, Beregnet utgående, Faktisk utgående, Differanse og Status/handling. Overskriften står fast og tabellen har avgrenset scroll, som i PC-1.
- **Detaljpanel (`KontoPanel.tsx`):** viser én konto og periode. Årsak og neste handling kommer først. Regnestykket og «Historikk og angring» (med «Ikke dublett», motposter og avledede) er foldet ut ved behov.
- **Gjenbruk:** delene er flyttet uendret til `avstemmingDeler.tsx` og brukes av begge flatene. Ingen nye skriveveier. «Bekreft saldoen på nytt» lagrer samme saldo med ferskt grunnlag via `lagreSaldo`.
- **Tastatur:** Enter i saldofeltet lagrer. Når raden manglet saldo, går fokus etter bekreftet lagring videre til neste konto som mangler saldo.
- **Utkast og pågående lagring:** ligger i `saldoUtkast` over valget mellom PC og mobil. De står derfor ved feil, ved breddeendring og ved levende abonnementsendring. Bare en bekreftet lagring fjerner utkastet.
- **Ikke løst før bekreftet:** databasen viser en lokal skriving før serveren har bekreftet den.
  - PC-flaten følger derfor med på skrivinger som ikke er bekreftet, per konto og måned. Det gjelder saldo, avklaring og korrigeringer.
  - `berorteNokler` finner alle rader en skriving kan endre, fra grunnlaget før skrivingen (review 5765532045):
    - kildens egen konto og måned;
    - den avledede motpostens konto og måned, også ved angring og avslutning;
    - ved ny bekreftelse både gammel og ny plassering;
    - koblet motpart nå og før korrigeringen, og årsaken til korrigeringen;
    - transaksjoner som peker hit.
  - `medBekreftet` viser den sist bekreftede raden, merket `lagrer`, så lenge en skriving venter. Det gjelder alle flater på PC og mobil: tabell, panel og handlingskort, samlet status, andre måneders åpne forhold, matrisen og de fulle kontokortene.
  - Ingenting vises som løst før lagringen er bekreftet og vurdert på nytt. Ved avvisning ruller databasen tilbake.
  - Standardvalget av konto låses når det vises.
- **Saldosvar og nyere tekst:** svaret på en saldolagring gjelder bare teksten som ble sendt.
  - Har brukeren skrevet videre, står den nyere teksten, og panelet går ikke videre til neste konto.
  - Ingen lagring skjer implisitt.

## Mobilflaten (AV-2, `AvstemmingMobil.tsx`)

- **Samme modell og handlinger som PC:** roten sender den viste, bekreftede modellen (`medBekreftet`) og de sporede handlingene (`useVentendeSkrivinger`) til begge flatene. Ingen beregning eller skrivevei er endret.
- **Kompakt periodevelger:** årsknapper og en månedsliste. Samlet status står under, med lenker til andre måneder med åpne forhold, så en OK-måned aldri skjuler eldre avvik.
- **Handlingskø:** ett kort per konto og måned med problemer igjen. Kortet er `KontoPanel` med `kompakt`: årsak og neste handling først; regnestykket og «Historikk og angring» er foldet. Saldofeltet står fremme bare når et problem trenger det (manglende saldo, startpunkt, avvik, endret grunnlag), ellers ligger det under «Endre saldo».
  - Et kort forsvinner først når lagringen er bekreftet og den nye vurderingen ikke har noe igjen. Delvis løst beholder kortet med resten.
  - Ved feil står kortet, utkastet og feilmeldingen. Ved avvisning ruller databasen tilbake, og kortet står uendret.
  - En senere import gjenåpner kortet live.
  - Ukjent konto står øverst i køen med lenke til Transaksjoner. Avledet motpost gir alltid et kort («Venter på ekte motpost») og telles aldri som bankavstemt. Åpent grunnlag før eller ved start skjules ikke.
  - Står ingenting igjen i måneden, vises «Ingenting gjenstår i …».
- **«Gå til konto, måned» (review 5771685104):** velger både konto og måned, som på PC.
  - Målkontoen vises øverst i køen med «Historikk og angring» åpent, og overskriften får fokus. Det gjelder også når kontoen ikke har eget kort, for eksempel en bankavstemt kildekonto der en avledet motpost må bekreftes på nytt.
  - Målet står ved breddeskift, også når kilden ligger i en annen måned. PC viser samme konto. «Lukk» fjerner målpanelet.
- **Full oversikt og historikk:** bak én diskret knapp (`aria-expanded`). Den viser matrisen og de fulle kontokortene for alle kontoer i måneden, også løste, startsaldo og konfigurerte kontoer uten data. «Ikke dublett», motposter og avledede angres herfra. Kontokortene viser «Lagrer…» mens en skriving venter.
- **Tilstand som står:** utkast, feil og pågående lagring ligger i `saldoUtkast` (nøkkel konto og måned) og står ved kortflytting, levende oppdatering, periodebytte og breddeskift. Valg av måned og «Vis full oversikt» ligger i roten og står ved breddeskift.

## Reversible valg som er tatt

- En konfigurert konto uten noen data lager ikke problemer, men vises som «Ingen data». Ellers ville en konto som aldri brukes til bankavstemming, bli et evig åpent forhold.
- Første registrerte saldo i perioden er startsaldo («start»), ikke et saldoproblem. Et senere hull gir både `mangler_saldo` i hullet og `startpunkt` i måneden etter.
- `manglende_motpost` meldes bare ved avvik. En intern overføring uten koblet motpost påvirker ikke avstemmingen av sin egen konto.
- Mobilens kø viser bare valgt måned. Andre måneder med åpne forhold nås fra samlet status, ikke som én lang liste over alle måneder.
