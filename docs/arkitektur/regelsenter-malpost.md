# Regelsenter: endre koblet målpost

**Status:** implementert etter #59 6643098967 (Helens bestilling 6543518396). Koden ligger i `web/src/domain/forsoning/regelMal.ts`, `hooks/useRegelsenter.ts` (`endreMal`) og `RegelsenterView.tsx` (`MalVelger`).

## Valg

- **Mulige mål:** dagens aktive poster i de tre eksisterende strukturene: kostnad (`budget`), inntekt (`incomeGroups`) og sparing (`sparingGroups`). Det er samme kilder som `finnMalpostForRegel`. Arkiverte poster er ikke valg, og det finnes ingen ny økonomistruktur.
- **Visning:** hvert valg viser post, livsområde og type. Valget bæres som **type + id**, så like navn på ulike steder (for eksempel «Vedlikehold» under Bolig som kostnad og som sparing) holdes fra hverandre.
- **Søk:** treffer post, livsområde og type. Valgene er vanlige knapper, så de nås med tastatur (Tab, Enter).

## Lagring

`endreRegelMal` lager én sammenhengende endring av `targetId`, `targetType`, `targetName` og `targetGruppe` i en transaksjon på `rules`.

- **Grunnlag:** endringen bygger på fersk regelliste og siste kjente struktur. Navn og livsområde hentes fra strukturen, ikke fra utkastet.
- **Gruppefeltet** erstattes alltid, så et foreldet livsområde blir aldri hengende.
- **Alt annet beholdes slik det ligger nå:** mønster, matchtype, konto, eiere, confidence, mode, active, multiUse, brukstelling og ukjente felt. Det gjelder også samtidige endringer.
- **Utfall:**
  - `lagret`;
  - `uendret`: hele målet stemmer allerede, også navn og livsområde. Et flyttet, omdøpt eller fjernet livsområde lagres som en endring (review 5776966235);
  - `regel_slettet`: regelen gjenopprettes ikke;
  - `mal_ugyldig`: målet er slettet, arkivert eller av feil type;
  - `endret_samtidig`: målet er endret et annet sted siden utkastet ble laget.
- Ved alle utfall unntatt `lagret` er regellisten uendret.
- Skrivingen bruker `applyLocally: false`. Lytterne ser derfor bare det serverbekreftede målet, og «Koblet mot» viser det gamle målet til det nye er bekreftet.
- Skrivingen går bak samme aktiveringsport som resten av Regelsenteret (`regelsenterSkrivingAktiv`).

## Oppførsel i skjermen

- Utkastet lagres bare med «Lagre målpost». Det lagres aldri ved Avbryt, Lukk eller bytte av regel.
- Under lagring er knappen sperret, så det blir ingen dobbeltskriving.
- Ved feil eller avvisning står utkastet, og knappen blir «Prøv igjen».
- Ved `endret_samtidig` lagres ingenting. Utfallet bærer regelens faktiske mål fra transaksjonen (type, id og navn). «Prøv igjen» bygger på dette, ikke på renderen da lagringen startet, så en ny lagring er et bevisst valg mot bekreftet grunnlag.
- Slettes regelen mens detaljen er åpen, står detaljen med siste kjente innhold og en tydelig melding. Lagring er da sperret.

## Avgrensning

Endringen gjelder regelen for fremtidig og eksplisitt regelbruk:

- ingen transaksjoner, hendelser eller kontrollmetadata endres;
- ingen historisk omplassering;
- «Kjør regler» kjøres ikke automatisk.
