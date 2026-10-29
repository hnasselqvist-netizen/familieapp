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
| 1 | Full skrivetilgang for ChatGPT til familiens Hverdagsflyt-data (#27) | Helens presisering 29.10 erstatter planen om ett domene om gangen. Bygg en komplett skriveinngang for alle data under egen families node, også eksisterende og fremtidige domener, uten nye kodeleveranser eller nye domene-scopes for hver handling. Helen bestemmer hvilke konkrete data som skal endres gjennom sine instruksjoner. |
| 2 | Bruk full skriveinngang til praktisk vedlikehold | Oppskrift fra bilde → Kokebok er første naturlige brukstilfelle, ikke en begrensning i tilgangen. Samme inngang skal kunne håndtere middagsplan, bibliotek, lager, handleliste, økonomi og historikk etter konkret instruks. Ingen separat OCR-tjeneste er nødvendig. |
| 3 | Små forbedringer i daglig Mat-flyt | Vurder først «Merk som basisvare» direkte fra handlelisten. Avklar eksisterende adferd før bygging. Prioriter deretter konkrete bruksfunn; ikke gjeninnfør allerede leverte variant-/UI-prosjekter. |
| 4 | Forvaltning: gjenstående praktiske hull (#59) | Kartlegg faktisk React-støtte for Generator/Generator v2, Kontoer og plassering av Regelsenter/Årsbudsjett. Velg minste brukerrettede mangel; ikke bygg om leverte bankimport-, regel- eller spilleromsløsninger. |
| 5 | Bedre middagsforslag og familiesmak | Bygg videre på eksisterende Førsteutkast/historikk/feedback. Skilj familiepreferanser fra nye brukerkontoer/roller. Nye familieroller krever et reelt behov. |
| 6 | Matlager: kjøleskap/tørrvarer og forbruksstøtte | Utvid etter faktisk nytte og lav registreringskostnad. Automatisk nedtelling krever avklaring av faktisk bruk, mengde/enhet, batch, samtidighet og angring; bekreftet middag betyr ikke automatisk uttak av alle ingredienser. |
| 7 | Økonomisk innsikt og menyer | Månedlig forbruk mot budsjett, sammenligning med fjorår og eventuelt gjenbrukbare menyer. Prioriter innsikt først når datagrunnlag og konkret beslutning den støtter er avklart. Menyer i middagsplan finnes allerede; eget forhåndsdefinert menybibliotek er ikke besluttet. |

### Skrivetilgang: Helens presisering og leveransemål

Helen har uttrykkelig bedt om **full skrivetilgang**, fremfor først en liten
handling og så domenevise utvidelser. Hun tar ansvar for å be om endringer
bare i data hun faktisk vil endre. Dette erstatter tidligere roadmap-tekst
om smale domenevise skrivekontrakter og ingen generell data_skriv.

Omfanget er alle data under den autoriserte familiens node, med oppretting,
endring og sletting på vilkårlige relative stier, også ukjente/fremtidige
felt. Det omfatter ikke andre familier eller administrasjon av IAM,
Auth0 eller Firebase-regler.

- Bygg full tilgang som én sammenhengende leveranse. Ikke krev ny
  implementering, domene-scope eller aktivering for hver nye datatype.
- Familiens identitet og medlemskap skal fortsatt avledes/kontrolleres
  server-side. Generell familiedata-skriving krever et eget skrivescope;
  data:read og leseverktøyene skal fortsatt være rent skrivefrie.
- Bruk verktøy som kan uttrykke oppretting, oppdatering og sletting
  presist, bevare urørte/ukjente felt og utføre atomiske endringer når
  flere stier hører sammen. Avklar RTDBs null/slett-semantikk tydelig.
- Bruk kildeversjon/forventet førtilstand for å avvise overskriving ved
  samtidige endringer; ikke overskriv en hel node fra en gammel kopi.
  Retry må ikke gjenta mengdeøkninger eller opprette duplikater.
- Brukerens konkrete beskjed er autorisasjonen. Ikke innfør en obligatorisk
  ny godkjenningsrunde for hver skriving. Spør bare når ønsket endring
  faktisk er uklar eller en konsekvens ikke er dekket av instruksen.
  Full tilgang er ikke en stående beskjed om å endre eller rydde data
  uten et konkret oppdrag.
- Bevar appens datakontrakter, markører, operasjonsmetadata og
  sammenslåings-/angrehistorikk ved bruk. Oppgi tydelig feil og utfall,
  og tilbakeles endringen før den rapporteres som fullført.
- Kartlegg og klargjør nødvendige runtime-IAM-, OAuth- og deployendringer
  samlet. Helen har autorisert at full familiedata-skriving etableres;
  spør ikke på nytt om dette prinsippvalget. Hvis verktøytilgang eller
  konto-oppsett krever en faktisk handling fra henne, gi et konkret,
  samlet engangssteg etter at kode og kontrollgrunnlag er klart.
- Test alle skriveformer, ugyldige stier, scope/medlemskap/familieisolasjon,
  samtidighet, retry og feil mot emulator. Ingen automatiserte tester
  skal skrive i produksjon. Første virkelige skriving skal være en
  konkret brukerbestilt endring, med tilbakelesing.
- Leveransen er ferdig når verktøyene er publisert, tilgjengelige i
  ChatGPT med riktig tilgang og faktisk brukerbestilt skriving er
  verifisert. Skill teknisk klar fra første bruk verifisert.

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
