# Roadmap og backlog

Oppdatert av Kontrolltårnet 31.10.2026 etter Helens bestilling om å prioritere
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
| Levert | Driftsdokumentasjon for skriveinngangen (#88 / #27) | #88 er re-reviewet på f513813 (5719329589), fire CI-jobber i 41137530060 er success og merget som 188211c. Brukerbekreftet skriving i handleliste og Forvaltning. Docs-only, ingen ny produksjonsdeploy kreves. Custom-role-rotårsaken er fortsatt ukjent. |
| Publisert; tilkoblingskontroll gjenstår | Filtrert transaksjonssøk for ChatGPT (#27 / #59) | #89 er re-reviewet på ad830cf (5719978022) og squash-merget som 87c3c1 med forventet head. Begge reviewfunn er løst; fire PR-CI-jobber success i 41141040537, 393 enhetstester og 75 emulatortester. MCP-run 41181593485 er verifisert success på 218c0ed (revisjon 00038-phr, 100 % trafikk); skrivefri etterkontroll viser uendrede data. Nytt verktøy mangler fortsatt i eksisterende ChatGPT-tilkobling, som må fornyes før et smalt søk kan bekreftes. Hosting-deploy trengs ikke. Kombiner konto, eier, tekst, dato og status; returner små sider med stabile ID-er. Støtter presis oppfølging uten fulle råuttrekk. |
| 1, implementering A bestilt | Kvitteringer: varig bilde/PDF og detaljerte dagligvarekjøp (#59) | Kartlegging levert i #59 6541086349 etter bekreftet mottak 6541019719. Kontrolltårnet har bestilt skive A: sikker visning/nedlasting av eksisterende bilder i én PR. Ingen ny lagring, IAM/rules, claims eller backend-/kostnadsvalg bestilt. Helen løfter dette 30.10. Kartlegg nåværende lagring og faktisk støtte før implementering. Bevar originalfil og strukturerte varelinjer, mengde/enhet, pris/rabatt, butikk/dato, total og transaksjonskobling. Unngå dobbelttelling og tap av eksisterende kvitteringer. Backend, tilgang, størrelsesgrenser og PDF-/bildevisning må avklares teknisk. |
| 3 | Praktisk vedlikehold via ChatGPT | Oppskrift fra bilde → Kokebok, middagsplan, bibliotek, lager og økonomi etter konkret instruks. Skriveinngangen er generell; ingen domenevis aktivering. |
| 4 | Små forbedringer i daglig Mat-flyt | Vurder «Merk som basisvare» fra handlelisten mot faktisk eksisterende kode. |
| 5 | Forvaltning: øvrige praktiske hull (#59) | Kartlegg faktisk støtte for generator, kontoer og Regelsenter/Årsbudsjett før nye bestillinger. |
| 6 | Bedre middagsforslag og familiesmak | Bygg på Førsteutkast/historikk/feedback uten automatisk nye brukerroller. |
| 7 | Matlager: kjøleskap/tørrvarer og forbruksstøtte | Lav registreringskostnad. Automatisk nedtelling krever avklaring av bruk/mengde/batch og angring. |
| 8 | Økonomiske trender og finansiering av felleskostnader | Først etter kontrollert datagjennomgang og godkjent harmonisering. Skill eier/ansvar fra betaler og finansieringskilde; interne overføringer og MC-oppgjør må ikke dobbeltelles. Sammenlign kun perioder med kjent kontodekning. |
| Separat | Første ekte duplikatsammenslåing (#84) | Følg skrivefritt etter faktisk brukerbruk; ingen automatisk sammenslåing. |

### Helens prioritering 30.10: utvikling først, datakvalitet parallelt

Hovedprioritet er Kontrolltårnets operative oppfølging av Claude: konkret
oppdrag, faktisk mottak, review, CI, merge og relevant deploy/etterkontroll.
Én implementeringsoppgave om gangen. Filtrert transaksjonssøk er neste
etter driftsdokumentasjonen; deretter kvitteringslagring og dagligvaredetaljer.

Kontrolltårnet gjør ved siden av en utvidet skrivefri gjennomgang av alle
Forvaltning-data etter Helens eksplisitte lesemandat. Første leveranse er en
avviksrapport til hennes vurdering: sammenlign lagrede regler og faktisk
behandling, eier, plassering/type, splitting, refusjoner og duplikat-/statusfunn.
Forskjeller fra dagens regel er observasjoner, ikke automatisk feil; regler
kan være endret etter behandlingen. Ikke gjenta den allerede utførte rettingen
av Fellesforbundet 15.09. Dataretting utføres senere på konkret godkjent
omfang med fersk kildeversjon og etterkontroll, ikke som uoppfordret opprydding.

Etter harmonisering skal dataene brukes til trender og fordeling av hvem
som finansierer felles kostnader. Kontoeier er ikke det samme som kostnadseier.
Regningskonto/Felleskonto og MC krever avstemming av innbetalinger og oppgjør.
Begrensninger i periode-/kontodekning skal vises før prosenter presenteres.

**Overstyrende status til den historiske loggen under:** Skriving er nå
brukerverifisert i handleliste (Tannbørster, Iste) og Forvaltning (eier på
Fellesforbundet 15.09). #27 6534680053 rapporterer Helens gjennomførte
admin-binding, ny deploy og fjerning av custom-role-bindingen. Ingen generell
konklusjon om at custom roles ikke støttes. #88 er merget; dokumentasjonen er levert.

### Filtrert transaksjonssøk for ChatGPT (#27 / #59)

**Publisert 31.10.2026 — PR #89 / 87c3c1, MCP-run 41181593485 på 218c0ed. Nytt søk i ChatGPT-tilkoblingen gjenstår å bekrefte.** Legg til et
skrivefritt søkeverktøy som filtrerer på serveren etter konto, felles/privat,
tekst/motpart (for eksempel Fellesforbundet og Skruvat), dato og eventuelt
behandlingsstatus. Filtrene skal kunne kombineres, med begrenset antall treff
og stabil paginering. Returner bare nødvendige treffelt, stabil transaksjons-ID
og kilde-/versjonsgrunnlag for presis oppfølging med data_hent før endring.
Avklar hvor felles/privat faktisk lagres i dagens datakontrakt og følg samme
semantikk som appen, også når opplysningen ligger på tilknyttet hendelse.

Behovet er å finne for eksempel fem transaksjoner fra Eivinds konto merket
felles uten å hente hele transaksjonslisten og rå bankrader til samtalen.
Bevar familieisolasjon og lesescope; test kombinerte filtre, tomme treff,
paginering og at søket ikke skriver. Prioriter som konkret Forvaltning- og
ChatGPT-forbedring etter avslutning av aktiv skrivefeil/etterkontroll, innen
én aktiv implementeringsoppgave. Punktet registreres nå; det er ikke en
bestilling om å avbryte pågående arbeid.

### Reviewstatus 31.10: transaksjonssøk og separat etterkontroll

Claude har bekreftet og rettet reviewet i #89 6535205688. Re-review på
`ad830cff60ac7e182069c91b7b80d033f7bc7ac9` er godkjent (5719978022).
Total nøkkelorden med siste strengskille og to regresjonstester løser
sidegjentakelsen; samtidighet og ansvar >0 kontra 100 % er dokumentert.
PR-en er squash-merget med forventet head som
`87c3c19369c1f258df88c913522dca61373dc60c`.
Alle fire faktiske PR-CI-jobber i 41141040537 er success; MCP-loggen
bekrefter 393 enhetstester og 75 emulator-/integrasjonstester. Work har
også kjørt 393/393 lokalt (Node 24; CI/produksjon bruker Node 22).
Main-CI 41148194334 på merge-SHA og 41148225758 på 218c0ed er verifisert
grønne med fire faktiske jobber hver. MCP-run 41181593485 er completed/success
på eksakt `218c0ed722e123d8542547cbec19d93d9a1ab702`. Work har lest jobb
124479944233 og loggen: revisjon `hverdagsflyt-mcp-00038-phr` har 100 prosent
trafikk; deploy og health/resource/issuer/scopes/401-verifisering er grønne.
Skrivefri kontroll 07:43:58Z viser uendrede fire forsoningsdigester mot
00:05:37Z og uendret shopping-digest, korrekt markør og ingen historikk/stopp.
Kun de to kjente regelreferansebruddene består. Ingen produksjonsdata endret.
Ingen Hosting-deploy kreves. Søkeverktøyet er ennå ikke i denne eksisterende
Work-tilkoblingens register; oppfriskning og smalt søk med data_hent-sammenligning
følges som separat åpen etterkontroll. Ikke erklær dette brukerbekreftet ennå.
Kvitteringskartleggingen er levert i #59 6541086349, mottak/oppstart bekreftet
6541019719. Work har kontrollert de faktiske React-panelene og ferske tellinger:
49 receipts, 35 Drive-koblinger, ett base64-bilde, ingen annen imageUrl og fem
forkastede. Skive A er bestilt: sikker visning og bytebevarende nedlasting av
eksisterende bilder i begge paneler. Implementeringsmottak gjenstår å bekrefte.
Skive B (ny bilde/PDF-lagring) og C (varelinjer) venter; Storage/custom claims
er et forslag, ikke valgt. Tilbakekalling/medlemskap, serverhåndheving og konkret
drift/kostnad må avklares før B. Ingen nye brukerhandlinger om dette nå.

Datakvalitet, separat: Helen har gitt konkret klarsignal til utvalgte
Notion-kommentarer. Work-hovedsamtalen rapporterer 35 eierkorrigeringer,
15 endringer til sparing og 3 regeloppdateringer, lagret og tilbakelest.
Notion-rapporten viser nå bare uavklarte funn med egen endringslogg.
Dette er utført brukerbestilt arbeid, ikke et nytt oppdrag til Claude
eller stående tillatelse til opprydding. Ikke gjenta rettingene. EasyPark
og øvrige uavklarte funn avventer videre vurdering.

Separat skrivefri #84-kontroll 30.10 22:50:20Z: markør ok, 26 varer/19
fullførte, ingen stopp eller sammenslåingshistorikk. Digest `831a2ef7…0992`.
Dette er fersk tilstand etter brukerbestilte endringer, ikke uendret mot den
gamle 25/20-kontrollen. Fem kjente poster uten id består. Ingen data ryddet;
første ekte sammenslåing gjenstår og blokkerer ikke søkeleveransen.

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

**Aktiveringsdeploy verifisert 30.10 14:34Z:** MCP-run 41072539758 er
completed/success på eksakt `2060790b32e3e99699d729c2f3e56da0fcf5ea43`.
Kontrolltårnet har lest run, jobb 124120078671 og loggen direkte:
revisjon `hverdagsflyt-mcp-00035-s96` tar 100 prosent trafikk.
Deploy- og verifiseringssteg er success; health, resource/issuer/scopes
og 401 uten token er kontrollert av workflowen. Generell skriving er
slått på i serverkonfigurasjonen; handlelisteskriving forblir av.
Main-CI 41072337382 på merge-SHA `5453ad0` og 41072425168 på faktisk
deployet SHA `2060790` er begge completed/success med alle fire jobber.
Deployen startet mens main-CI fortsatt pågikk; disse er nå grønne.
Ingen ny deploy skal bestilles. Hosting er ikke berørt.

**Første bruk 30.10 — feilretting har prioritet:** Helen har koblet til på nytt.
Work har faktisk `data_skriv` og `data_hent`; autentisering ved første
skrivekall ble akseptert. Timesjekken er gjenaktivert. Ny tilkobling,
IAM/Auth0-oppsett og tidligere deploy skal ikke bestilles på nytt uten
et nytt, konkret funn.

To ekte brukerbestilte endringer er forsøkt, med identiske retries per
operasjons-ID: først Tannbørster på handlelisten, deretter oppretting av
Tannbørster i Diverse med handlelistekobling og gjenåpning av eksisterende
Iste-post. Begge returnerer `ukjent_utfall`; smal tilbakelesing viser at
Tannbørster-nodene mangler og Iste fortsatt er avkrysset med uendret
versjon. Ingen lagret endring er bekreftet. Skriveinngangen er dermed
publisert, men fungerer ikke ved første faktiske bruk.

Helen har bestilt koordinert sjekk og fiks. Aktivt feilrettingsoppdrag
med operasjons-ID-er, etterkontroller og konkrete kodefunn ligger i
#27 kommentar 6525665315. Claude skal bekrefte mottak, finne underliggende
transaksjonsfeil via sanitert logging/skrivefrie kontroller og levere
emulatorverifisert retting på egen gren til review. Claude har bekreftet mottak og første undersøkelse i #27 6526384059.
Han lager en diagnoseretting på egen gren: dagens tryggFeil leser bare
`code`, mens Firebase-SDK-ets avbruddsgrunn kan ligge i Error-meldingen.
Kontrolltårnet har verifisert code-only-logikken på main og gitt konkrete
reviewkrav i 6526540457: fast feilkodevokabular, ingen rå meldingslogging,
og ingen påstand om «ingenting skrevet» uten dokumentert terminalt utfall.
**Diagnoseretting merget 30.10:** #87 er re-reviewet og godkjent på eksakt
`4e65da0` (review 5716407063), squash-merget med forventet head som
`a1f5c1f843dd0f4375add289a3779adb8739dae1`. Alle tidligere reviewfunn er
løst: kvitteringslesefeil og eksisterende ukjent format gir ukjent utfall;
fravær bekreftes mot rå null/undefined; klienten beholder samme opId og
løftet gjelder bare dette forsøket. CI 41094469716 har alle fire faktiske
jobber success. MCP-jobbloggen bekrefter 371 enhetstester og 74 emulator- /
integrasjonstester; Kontrolltårnet har også kjørt 371/371 lokalt.

**Diagnoseretting publisert og logggrunnlag mottatt 30.10:** Helen har
utført den manuelle deployen og levert logguttrekket. Kontrolltårnet har
uavhengig verifisert MCP-run 41119675406 success på eksakt
`9b11f7d0bb83702cb57a9da45be3b74abc697be2`, jobb 124282923356 med grønt
deploy- og verifiseringssteg. Revisjon `hverdagsflyt-mcp-00036-n24` tar
100 prosent trafikk. Main-CI var tidligere verifisert grønn; #87 er nå ute.
Hosting-deploy trengs ikke.

Helens skrivefrie logguttrekk viser eksplisitt Firebase-avvisning
`permission_denied` på familienodens transaksjon ved fire tidligere
skriveforsøk 14:45–14:47Z. En tidligere `insufficient_scope`-hendelse
14:43Z er separat og forklarer ikke i seg selv de senere databaseavvisningene.
Avvisningsgrunnen er dermed kjent; underliggende runtime-/credential-/IAM-
årsak er fortsatt uavklart. Ingen ny skriving er forsøkt etter deploy.

Nytt diagnosegrunnlag og konkret videreføring av eksisterende feilretting
er sendt til Claude i #27 kommentar 6532367620. Faktisk mottak og første
kodeundersøkelse er bekreftet i 6532599509. Ingen åpen PR per 21:18Z.
Kontrolltårnet har reviewet diagnosen: offisiell Firebase-dokumentasjon
beskriver custom roles og instances.update som data-skriverettighet; bare
forhåndsdefinerte roller som eneste løsning er ikke dokumentert. Konkret
kildegrunnlag og krav til revidert diagnose/kontrollpakke er sendt i
6533663408. Kontroller historisk IAM-tidslinje, aktiv revisjons identitet,
effektive rettigheter og relevante avhengigheter før Helen bes om nye
operatørsteg. Prosjektets deny-liste alene utelukker ikke arvet policy.
Ingen bredere rolle eller IAM/rules-endring er godkjent/bestilt nå.
Kontroller faktisk identitet og SDK-autorisasjon før nye tilgangstiltak.
Deploy og logghenting er ikke lenger blokkeringer. Timesjekken er faktisk
gjenaktivert. Ingen ny handling kreves av Helen nå, og ingen IAM/Auth0-steg
skal gjentas uten nye konkrete funn. Ingen automatisert produksjonsprøveskriving;
første virkelige endring følges opp kontrollert etter retting.
Denne brukerobserverte feilen blokkerer ferdigmelding og neste
implementeringsoppgave i køen.

Separat #84-etterkontroll 30.10 21:17:59Z: markør ok, 25 varer/20 fullførte,
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
