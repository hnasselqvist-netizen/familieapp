# Roadmap og backlog

Oppdatert av Kontrolltårnet 29.10.2026 etter Helens bestilling om å prioritere
skrivetilgang og hente neste oppgave løpende. Dette er produktkøen; aktivt
oppdrag og leveransebevis ligger i GitHub #20 (Mat), #59 (Forvaltning) og #27
(ChatGPT-integrasjon). Lukkede #43 er droppet og skal ikke gjenåpnes eller
videreføres som et utviklingskartprosjekt.

## Arbeidsmåte

- Hent neste lille, nyttige leveranse herfra når en utbedring/funksjon er
  reviewet, merget, publisert og relevant etterkontroll er utført. Ikke vent
  på en ny bestilling fra Helen. Åpen etterkontroll etter første ekte bruk
  kan følges separat hvis den ikke blokkerer neste arbeid.
- Bruk én aktiv implementeringsoppgave om gangen. Brukerobserverte feil og
  dataintegritet prioriteres foran køen. Ikke avbryt en aktiv PR uten grunn.
- Kontroller faktisk kode, ferske data og nyere GitHub-beslutninger før
  oppstart: gamle roadmap-punkter er ikke bevis på at funksjonen mangler.
- Skriv et konkret oppdrag i riktig issue med omfang, akseptansekriterier,
  avhengigheter og testkrav. Når en PR åpnes er den aktiv handoff-kanal.
  Kontroller faktisk mottak; en kommentar alene beviser ikke oppstart.
- Oppdater denne køen ved leveranse eller omprioritering. Marker separat
  planlagt, startet, merget, deployet og brukerbekreftet der det er relevant.
- Helen involveres ved reelle uavklarte produktvalg, nødvendige
  konto-/rettighetsendringer eller vesentlig datarisiko. Tekniske,
  reversible valg håndteres av Kontrolltårnet og Claude.

## Prioritert kø

| Rekkefølge | Leveranse | Begrunnelse og avgrensning |
|---|---|---|
| 0 | Avslutt pågående leveranser | #84 er merget som 152afd8. Claude har rapportert grønn main-CI og produksjonsdeploy 40952209137 samt skrivefri etterkontroll. Kontrolltårnet verifiserer Actions uavhengig. Første ekte duplikatsammenslåing følges opp uten prøveskriving. |
| 1 | Kontrollert skrivetilgang for ChatGPT: første nyttige handling (#27) | Lesing er faktisk testet i ChatGPT: data_nokler og data_les fungerer. Handleliste-skriving finnes allerede bak sperre og shopping:write, men er ikke aktiv. Kartlegg gjenbruk først: dagens markør, sammenslåing, idempotens og full-lesingens skrivevakt må fortsatt være trygge. Velg dette som første snitt hvis eksisterende kode kan gjøres trygg uten en større ombygging; ellers lever oppskriftsflyten nedenfor først og dokumenter hvorfor. |
| 2 | Oppskrift fra bilde → godkjent lagring i Kokebok (#27) | ChatGPT tolker bildet, slår opp varer, viser utkast/uklarheter og lagrer via en egen validert oppskriftskommando. Gjenbruk appens datamodell og domeneregler. Ikke bygg separat Cloud Vision/OCR-tjeneste som en forutsetning. |
| 3 | Små forbedringer i daglig Mat-flyt | Vurder først «Merk som basisvare» direkte fra handlelisten. Avklar eksisterende adferd før bygging. Prioriter deretter konkrete bruksfunn; ikke gjeninnfør allerede leverte variant-/UI-prosjekter. |
| 4 | Forvaltning: gjenstående praktiske hull (#59) | Kartlegg faktisk React-støtte for Generator/Generator v2, Kontoer og plassering av Regelsenter/Årsbudsjett. Velg minste brukerrettede mangel; ikke bygg om leverte bankimport-, regel- eller spilleromsløsninger. |
| 5 | Bedre middagsforslag og familiesmak | Bygg videre på eksisterende Førsteutkast/historikk/feedback. Skilj familiepreferanser fra nye brukerkontoer/roller. Nye familieroller krever et reelt behov. |
| 6 | Matlager: kjøleskap/tørrvarer og forbruksstøtte | Utvid etter faktisk nytte og lav registreringskostnad. Automatisk nedtelling krever avklaring av faktisk bruk, mengde/enhet, batch, samtidighet og angring; bekreftet middag betyr ikke automatisk uttak av alle ingredienser. |
| 7 | Økonomisk innsikt og menyer | Månedlig forbruk mot budsjett, sammenligning med fjorår og eventuelt gjenbrukbare menyer. Prioriter innsikt først når datagrunnlag og konkret beslutning den støtter er avklart. Menyer i middagsplan finnes allerede; eget forhåndsdefinert menybibliotek er ikke besluttet. |

### Skrivetilgang: rammer og leveransemål

Målet er at Helen kan be ChatGPT vedlikeholde Hverdagsflyt gjennom konkrete
handlinger. Full lesing innebærer ikke generell rå database-skriving.

1. Kartlegg faktisk deployet MCP-kode, runtime-IAM, scopes, skrivevakt og
   appens samtidige skriveveier. Flere gamle README-statuslinjer er utdaterte.
2. Lever én typed/validert handling med medlemskap/familie hentet fra
   autorisert kobling, idempotens, konfliktvern og tydelig resultat.
   Bevar lesekontraktens skrivevern.
3. Bruk eksisterende instruksjon fra Helen som autorisasjon når den er
   tilstrekkelig konkret; ikke krev rutinemessig dobbeltbekreftelse.
   Oppskriftsutkast må få avklart reelle uklarheter før lagring.
4. Test retry, avvist tilgang, samtidige endringer, delvise feil og
   tilbakelesing i emulator. Ingen automatiserte produksjonsskrivetester.
5. Klargjør nødvendige IAM-/OAuth-/driftsendringer konkret for review.
   Denne roadmap-bestillingen gir mandat til design og implementering,
   men er ikke en instruks om å slå av sperrer eller gi generell write-IAM.
   Følg gjeldende godkjenningsgrense for faktisk sikkerhetsutvidelse.
6. Erklær først skrivetilgang klar når verktøyet er tilgjengelig i ChatGPT
   og en avgrenset, brukerbestilt handling er skrevet og tilbakelest.
7. Utvid senere til middagsbibliotek, middagsplan og fryser etter faktisk
   behov. Økonomisk skriving vurderes særskilt; ingen generisk data_skriv.

## Vurdering av den opprinnelige juli-listen

Alle opprinnelige punkter er beholdt som levert funksjonalitet eller
kandidat nedenfor. «Må kartlegges» betyr ikke at det mangler.

| Opprinnelig punkt | Vurdering per 29.10 |
|---|---|
| Motor v1 / calcSpillerom | Levert grunnmur; videreføres. |
| Generator v1, kostnader, inntekter, disponibelt og Generator-senter | Eksisterende funksjonalitet. React-paritet og eventuelle hull vurderes i prioritet 4. |
| Generator v2 / automatisk plassering etter forfallsdag | Må kartlegges mot dagens generator og «Oppdater fra budsjett» før ny bestilling. Prioritet 4. |
| Årsbudsjett / alle 12 måneder | Finnes som planleggingsverktøy i produktfasit og appsporet. Ikke behandle som ubegynt. Eventuell plassering/paritet hører til prioritet 4. |
| Middagsforslag basert på historikk | Førsteutkast og feedback er levert. Videre kvalitet/læring er prioritet 5. |
| Transaksjonsimport DNB og SpareBank 1 | Levert. Nye formatfeil følges som konkrete feil. |
| Regelmotor for kategorisering | Levert; ikke et nytt prosjekt. |
| Splitt av enkeltransaksjon | Eksisterende økonomiflyt; kartlegg eventuelle konkrete mangler før bestilling. |
| Duplikatsjekk ved bankimport | Eksisterende importkontroll; juli-formuleringen om dato ±2 dager er ikke en ny godkjent matchregel. |
| Statistikk, månedlig budsjett mot faktisk | Grunnleggende faktisk/budsjett finnes. Ny innsikt må avgrenses; prioritet 7. |
| Sammenligning med samme periode i fjor | Senere kandidat, prioritet 7; kontroller historikkgrunnlaget først. |
| Familiemedlemmer / hvem likte den | Vurder eksisterende feedback og preferanser; prioritet 5, uten automatisk utvidelse av roller. |
| Kvitteringslagring i Google Drive | Kvitteringsflyt og lagrede bilder finnes; varig bildebackend/Drive-integrasjon er eget avklaringsspor, ikke erklært ferdig. |
| Automatisk frysernedtelling ved bekreftet middag | Parkert med eksplisitt forbruks-/mengdeavklaring; prioritet 6. |
| Kjøleskap og tørrvarer | Matlager v1 med fryser og basisvarer er levert. Full beholdningsutvidelse er prioritet 6. |
| OCR fra bilde i Kokebok | Flyttes til ChatGPT-oppskriftsflyten, prioritet 2. Egen OCR-infrastruktur er ikke en forutsetning. |
| Merk som basisvare fra handlelisten | Kandidat til neste lille Mat-leveranse etter skriveinngangen, prioritet 3. |
| Forhåndsdefinerte menyer i Kokebok (Alternativ B) | Senere kandidat, prioritet 7. Avklar mot låst prinsipp om menyer direkte i planen. |

## Leveransebevis og aktive kanaler

- Mat/Kjøkken og nåværende duplikataktivering: #20, #28, #77, #83 og #84.
- Forvaltning og spillerom: #59 og leveransene lenket der, inkludert #63 og #75.
- ChatGPT-lesing og videre skriveinngang: #27 og #80.
- ChatGPTs fulle familielesing er faktisk testet 29.10 med data_nokler
  og små data_les-utdrag fra mealLibrary, meals, freezer, budget og transaksjoner.
  Dette var bare lesing; det attesterer ikke runtime-IAM eller Firebase-regler.
