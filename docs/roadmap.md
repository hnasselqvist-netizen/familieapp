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
| 0 | Etterkontroll av levert duplikatfunksjon | #84 er merget som 152afd8 og publisert. Kontrolltårnet har 29.10 uavhengig verifisert main-CI 40951727885 (alle fire jobber) og production.yml 40952209137, inkludert live-deploysteget, success på eksakt merge-SHA. Skrivefri kontroll 21:48Z: markør ok, ingen stopp/uavklart historikk, 25 varer/20 fullførte, digest uendret. Første ekte duplikatsammenslåing følges separat uten prøveskriving og blokkerer ikke #27. |
| 1 | Full skrivetilgang for ChatGPT til familiens Hverdagsflyt-data (#27) | Helens presisering 29.10 erstatter planen om ett domene om gangen. Bygg en komplett skriveinngang for alle data under egen families node, også eksisterende og fremtidige domener, uten nye kodeleveranser eller nye domene-scopes for hver handling. Helen bestemmer hvilke konkrete data som skal endres gjennom sine instruksjoner. |
| 2 | Bruk full skriveinngang til praktisk vedlikehold | Oppskrift fra bilde → Kokebok er første naturlige brukstilfelle, ikke en begrensning i tilgangen. Samme inngang skal kunne håndtere middagsplan, bibliotek, lager, handleliste, økonomi og historikk etter konkret instruks. Ingen separat OCR-tjeneste er nødvendig. |
| 3 | Små forbedringer i daglig Mat-flyt | Vurder først «Merk som basisvare» direkte fra handlelisten. Avklar eksisterende adferd før bygging. Prioriter deretter konkrete bruksfunn; ikke gjeninnfør allerede leverte variant-/UI-prosjekter. |
| 4 | Forvaltning: gjenstående praktiske hull (#59) | Kartlegg faktisk React-støtte for Generator/Generator v2, Kontoer og plassering av Regelsenter/Årsbudsjett. Velg minste brukerrettede mangel; ikke bygg om leverte bankimport-, regel- eller spilleromsløsninger. |
| 5 | Bedre middagsforslag og familiesmak | Bygg videre på eksisterende Førsteutkast/historikk/feedback. Skilj familiepreferanser fra nye brukerkontoer/roller. Nye familieroller krever et reelt behov. |
| 6 | Matlager: kjøleskap/tørrvarer og forbruksstøtte | Utvid etter faktisk nytte og lav registreringskostnad. Automatisk nedtelling krever avklaring av faktisk bruk, mengde/enhet, batch, samtidighet og angring; bekreftet middag betyr ikke automatisk uttak av alle ingredienser. |
| 7 | Økonomisk innsikt og menyer | Månedlig forbruk mot budsjett, sammenligning med fjorår og eventuelt gjenbrukbare menyer. Prioriter innsikt først når datagrunnlag og konkret beslutning den støtter er avklart. Menyer i middagsplan finnes allerede; eget forhåndsdefinert menybibliotek er ikke besluttet. |

### Skrivetilgang: Helens presisering og leveransemål

**Status 30.10:** PR #85 er teknisk og produktmessig reviewet på eksakt
`a6af4b0` (review 5710975862) og squash-merget med forventet head som
`d0e734a418bedd02e3750369c272fc7d6ded0c95`. Begge tidligere reviewblokkeringer
er løst: streng feilmetadatafiltrering og ekte emulator-samspill med appens
sammenslåing/angring. Alle fire PR-CI-jobber i 41030077343 er success;
MCP-loggen bekrefter 354 enhetstester og 71 emulator-/integrasjonstester.
Kontrolltårnets lokale enhetstester er også 354/354. Main-CI 41040905353
på eksakt merge-SHA er uavhengig verifisert success med alle fire faktiske
jobber. Dokumentasjonscommit `5581914` har også alle fire jobber success
i 41040972491. Grønn main-CI er dermed ikke lenger en deployavhengighet.

**Aktivering klargjort 30.10:** Helen har utført MCP-deploy med skriving av.
Kontrolltårnet har uavhengig lest Actions-run 41051804397 og deployjobben:
success på eksakt `663018c3a188bc44bad767fce78eedbde8dc2acf`, inkludert
verifiseringssteget. Claude rapporterer revisjon `hverdagsflyt-mcp-00034-46p`.
Helen har deretter godkjent den ekstra tekniske myndigheten i
`instances.update` og rapportert Auth0 `data:write` tildelt. IAM-rollen
`hverdagsflytRtdbSkriver` med nøyaktig get/update og binding til riktig
runtime-konto er kontrollert fra hennes Cloud Shell-utdata (#27
6523018510/6523086677), ikke fra selvstendig GCP-lesing i Work.

Claude har bekreftet mottak og levert aktiverings-PR #86 (6523179363).
Kontrolltårnet har reviewet alle fire filer på eksakt `e27c118` (review
5713760846), rettet for tidlig driftsattest i dokumentasjonen og merget med
forventet head som `5453ad0c8cf5a198a11537f2be3b740822b00c4f`.
PR-CI 41071588080 har alle fire faktiske jobber success. Første CI på
`b18ca00` (41057838842) bekrefter 354 enhetstester og 71 emulatortester.
Eneste atferdsendring er `MCP_DATA_SKRIVING=aktiv` i neste MCP-deploy;
`MCP_HANDLELISTE_SKRIVING` forblir av. Ingen IAM/rules endres av workflowen.

**Gjenstår:** grønn main-CI, MCP-aktiveringsdeploy fra main, deretter ny
tilkobling og faktisk verktøy-/scopekontroll. Work har ingen MCP-dispatch
i verktøyregisteret og verken gh eller gcloud installert; Claude har
uttrykkelig ikke tillatelse til å starte MCP-workflowen. Helen må derfor
starte `deploy-mcp-cloudrun.yml` med `les-ekte-data` etter grønn main-CI.
Hosting (`production.yml`) trengs ikke og er ingen erstatning.
Merge alene attesterer ikke aktivering. Ingen produksjonsprøveskriving.
Første ekte brukerbestilte skriving og tilbakelesing følges separat.

Faktisk Work-register 30.10 har `data_nokler`, `data_les` og `data_hent`,
men ikke `data_skriv`. `data_hent` er skrivefritt verifisert på
`shopping/_skriver`: verdi og kildeversjon fra samme lesing.

Separat #84-etterkontroll 30.10 14:25Z: markør ok, 25 varer/20 fullførte,
uendret digest `9cc32448…3dce`, ingen stopp eller sammenslåingshistorikk.
Første ekte sammenslåing gjenstår; den blokkerer ikke skriveinngangen.

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
