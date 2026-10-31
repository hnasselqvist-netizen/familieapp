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

### Omprioritering 31.10: gave- og relasjonsmodulen tilbake før jul

Helen har løftet det tidligere avtalte behovet igjen fordi julegavehandelen
starter nå. Dette er gjeldende kø: aktivt kvitteringsarbeid B/C →
gave- og relasjonsmodul med julegaveplanlegging først → AV-1 → AV-2 →
regelmotor. Kvalitetssikring og mellomværende er allerede publisert.
Ikke start parallell implementering eller avbryt aktiv B1; hvis B-aktivering
avventer nødvendig operatørhandling, vurder et trygt oppgaveskifte fremfor
å la julegavebehovet bli stående bak en driftsventing.

Tidligere avtalt produktgrunnlag, hentet fram fra Helens beslutninger
26.07: Relasjoner er et felles register i appen, ikke bare en økonomimodul.
Minst mulig administrasjon. Grupper: nærmeste familie, utvidet familie,
venner og andre; gruppene gir standardanledninger og gavebudsjett.
Person har navn, gruppe, valgfri fødselsdato/notater og unntaksanledninger.
Jul og bursdag er standard; øvrige anledninger registreres ved behov.
Registrer anledning som utgangspunkt, med enkel idéliste og automatisk
gavehistorikk. Startsiden skal vise «Hva trenger oppmerksomhet nå?».
Juleplanlegging skal vise mottakere og status for manglende/ferdige gaver.
Gavepapir, kort og gavebånd har egen felles budsjettpost, ikke fordelt
på en mottaker.

Første nyttige leveranse avgrenses rundt årets julegavehandel med dette
registeret som grunnlag: hvem, anledning, ideer, budsjett og gavestatus.
Dette er gjeninnført plan, ikke påstand om implementert funksjon eller
ferdig teknisk kontrakt. Før oppstart kontrolleres faktisk kode og eldre
produktfasit; gjenbruk eksisterende økonomimodell uten dobbeltføring.
Ingen personregistre eller gaveposter opprettes i produksjon på eget initiativ.
Detaljert implementeringsoppdrag gis ved tur, etter kartlegging.
Denne omprioriteringen overstyrer eldre køformuleringer nedenfor.

### Kontrolltårn 31.10: #97/#96 publisert og etterkontrollert; kvittering B neste

Dette er gjeldende status og overstyrer tidligere venting på Hosting.
production.yml 41218628036 er uavhengig verifisert completed/success på
eksakt `ef086ac2529cd829049146c766b038c4ebda1f03`. Live-jobb 124588335388
og «Deploy til Firebase Hosting (live)» success. Main-CI 41214620499 på
samme SHA er grønn. Claude rapporterte faktisk deploy i #59 6545933630.

Skrivefri etterkontroll 17:17Z: alle fire forsoningsnoder har identiske
antall OG digester som førgrunnlaget 15:18:30Z: 1406 transaksjoner,
1280 hendelser, 49 receipts og 52 rules. Ingen nye referansebrudd;
to kjente gamle regelreferanser består. Handleliste: markør ok,
28 varer/19 fullførte, uendret digest `91424c76…31af9d`, ingen
sammenslåing/stopp. Ingen produksjonsdata eller kontrollmarkeringer
er endret av Work; ingen ekte mellomværende opprettet.

Avhuking/hele søket (#97) og mellomværende (#96) er dermed publisert
og relevante skrivefrie kontroller er utført. Første brukerbekreftelse
kan følges separat. Ingen ny deploy bestilles av denne docs-endringen.

Neste aktive bestilling: kvittering B1, #59 6546642665. Fersk main er
kontrollert: eksisterende bildevisning er levert, ny filopplasting/
fil-tjeneste og varelinjemodell mangler. Revidert backendvurdering
6541616036 ligger til grunn. Teknisk arbeidsretning er S2(b), separat
serverformidlet tilgang med Firebase ID-token og ferskt RTDB-medlemskap,
uten familyId-claim. Første komplette reviewbare kodeleveranse bygges
med emulator/falskt objektlager og produksjonsaktivering AV.
Ingen ny tjeneste tas i bruk; ingen bucket/IAM/rules/billing eller
deploy endres før konkret, samlet aktiveringsgrunnlag er klart til Helen.
Originalbytes, tilgang per forespørsel, servervalidering, innholdsadressert
opprett-bare, synlig retry ved delvis feil, autentisert visning/nedlasting,
bevaring av eldre vedlegg og kvalitetssikringsgrunnlag inngår.
Full kontrakt/testkrav er i handoff-kommentaren; faktiske driftsukjente og
priser skal kildeverifiseres før aktivering. Claude har bekreftet mottak og
første handling i #59 6547274471: offisielle størrelses-/timeoutgrenser,
deretter kort tjenestekontrakt og implementering mot emulator/falskt lager.
B1 er eneste aktive implementering. Ingen B1-commit eller PR er pushet ved
kontroll 18:16Z; arbeidsgrenen peker ennå på #96-hodet 4e5207e. Ingen ny
bestilling fra Helen trengs. Lavest prioriterte postering → intern overføring
er også mottatt i samme kommentar og skal ikke avbryte aktivt arbeid.
Deretter B-aktivering/etterkontroll og C (varelinjer), så gave- og
relasjonsmodulen med julegaveplanlegging først, deretter AV-1/AV-2 før
regelmotor; periodelåsing er fortsatt senere behov.

### Kontrolltårn 31.10: #97 og #96 reviewet og merget – avventer Hosting

Dette er gjeldende status. Claudes fullstendige handoff er mottatt i
#59 6545130634: alt pushet og ingen lokale/upushede endringer.
Grenbegrensningen er løst innen tillatte grener; regelmotoren er bevart
i historikken. Det gamle tilgangsoppdraget er ferdig.

#97 kvalitetssikring (avhuking og hele søket) er reviewet på eksakt
`dc9310e1192cbacb74fbcddabb6722234a99db8b`, review 5723531329.
Work rettet ett hull: også beskrivelsen av søk/filtre fryses sammen
med treffsettet, slik at bekreftelsen ikke beskriver andre treff.
1365 enhetstester lokalt, typecheck/lint/build grønne. Alle fire
faktiske CI-jobber i 41214092790 success, inkludert integrasjon og
begge E2E-steg. Squash-merget med forventet head som
`ac7d5273557d9668498e78f6841a0bb554af501c`.

#96 mellomværende er re-reviewet på eksakt
`4e5207ee6e5c95cb368599d1037153eb33300935`, review 5723532599.
Retry bruker lagret avtale, retting/angring har versjonsvern og
hendelsesskriving bruker applyLocally:false. Work rettet UI-et til å
fryse versjonen ved åpning av Rett, så et eldre utkast ikke overtar
en nyere versjon fra abonnementet. Regresjon er lagt til.
1390 enhetstester lokalt, typecheck/lint/build grønne. Alle fire
faktiske CI-jobber i 41214095497 success, inkludert integrasjon og
begge E2E-steg. Squash-merget med forventet head som
`00b34f4c467e6228a343cc323dedeffe7857b4ac`; ingen mergekonflikt.

Lokale fulle suiter er kjørt med TZ=UTC og maxWorkers=2, etter at
første bredkjøring ga utslag i eksisterende tidssonefølsomme datotester
og en timeout under parallelle suiter. Alle består med disse innstillingene.

Begge funksjoner er merget, IKKE publisert. Neste steg er grønn main-CI
på samlet kode, så Helen starter production.yml på main: hun har
uttrykkelig bedt om beskjed når det er klart. Work-registeret har
ingen Actions-dispatch, github_fetch er GET-only og gh er ikke
installert. Ingen sperre omgås. Etter deploy verifiseres eksakt SHA,
run/live-steg og skrivefri etterkontroll. Ingen MCP-deploy er nødvendig.
Kvitteringer B/C er neste implementering etter publisering/etterkontroll,
deretter AV-1 og AV-2 før regelmotor; periodelåsing er senere behov.

Skrivefri kontroll 15:18Z: 1406 transaksjoner, 1280 hendelser, 49 receipts,
52 rules; ingen nye referansebrudd, bare to kjente gamle regelreferanser.
Handleliste: markør ok, 28 varer/19 fullførte, ingen sammenslåingshistorikk
eller stopp, samme digest `91424c76…31af9d`. Ingen produksjonsdata,
kontrollmarkeringer eller ekte gave-/oppgjørsposter er opprettet/endret.

### Kontrolltårn 31.10: #94 publisert, #96 til retting, kvalitetssikring lokalt klar

Dette er gjeldende leveransestatus og overstyrer eldre oppfølgingsavsnitt.
#94 er uavhengig bekreftet publisert: production.yml 41203741547 på
`f7e92b6a44f14b71e1b48b34e4bf86c976a4de0e`, live-jobb 124544527543 og
live-deploy-steget success. Main-CI 41203330530 har fire faktiske
success-jobber. Helen har prøvd funksjonen; UI-justeringene nedenfor gjenstår.
Ingen ny deploy eller automatisk prøvemerking bestilles.

Claude har bekreftet mottak av avhuking, skjult hvem/når og køen i #59
6544248692, hele søket i 6544523084/6544685965, og periodelåsing i
6544685965. Avhuking `3a94fef` og massekontroll `98bcf2d` er ferdige
lokalt ifølge Claude, med lokale tester/visuell kontroll, men ikke pushet
til PR. De er derfor ikke reviewet eller publisert. Claude rapporterer
pushbegrensning til to grener. Konkret tillatt grenløsning er etterspurt
i #59 6544719929; ikke be Helen om ny generell tillatelse hvis eksisterende
mandat er tilstrekkelig, og ikke omgå en faktisk teknisk sperre.

Mellomværende #95 er levert som #96 på eksakt
`2d28bd000aa2a48411e1e7ebed6aed3a01a89e85`.
Alle fire faktiske CI-jobber i 41207486005 er success, inkludert
integrasjon og begge E2E-steg. Review 5723280487 holder merge tilbake:
retry etter delvis registrering kan gi ulik avtale og kostnad; retting/
angring mangler forventet grunnlag for oppgjørslinjen; spekulativ lokal
RTDB-oppdatering kan fjerne handlingskort før serverbekreftet lagring.
To domenereproer er kjørt uavhengig med PR-ens uendrede domenekode.
Avgrensede rettinger og regresjoner er bestilt i PR, som er aktiv
handoff. Mottak av dette nye reviewet gjenstår. Ikke merge for å frigjøre
gren. Ingen ekte gave-/oppgjørsposter er opprettet av Kontrolltårnet.

Skrivefri nåkontroll 14:28Z: 1406 transaksjoner, 1280 hendelser, 49 receipts,
52 rules; ingen transaksjons-/kvitteringsreferansebrudd, bare to kjente
gamle regelreferanser. Ny baseline under brukerens dataarbeid, ikke
bevis på uendret database over deploy. Handleliste: markør ok,
28 varer/19 fullførte, ingen sammenslåingshistorikk eller stopp,
digest `91424c76…31af9d`. Fem id-løse poster er fortsatt kjent
legacy-identitetsavvik; ingen opprydding eller automatisk sammenslåing.
Første ekte sammenslåing gjenstår. Full lese-/skriveinngang og
transaksjonssøk finnes i faktisk Work-register; tilgangsarbeidet bestilles
ikke på nytt. Ingen produksjonsdata er endret i denne oppfølgingen.

### Utvidelse 31.10: kvalitetssikre hele søket

Helen bestiller også «Kvalitetssikre alle treff (N)» på PC og mobil.
Dette opphever tidligere avgrensning om ingen massemerking i avhukingsskiven.
Omfanget er hele treffsettet for tekstsøk og alle aktive filtre, også utenfor
synlige rader/sider. Vis antall og bekreft omfang før lagring. Frys ID-er og
kontrollgrunnlag; nye treff eller et krympende kontrollfilter endrer ikke
settet underveis. Bevar konfliktvern, ærlig delvis feil og trygg gjentakelse;
allerede kontrollert på samme grunnlag hoppes over. Hvem/når lagres bare i
Firebase. Ingen automatisk kontroll av ekte data eller masseoppheving.
Inngår i prioritet 1 sammen med avhukingsjusteringen; én aktiv implementering.
Konkret oppdrag er mottatt i #59 6544523084/6544685965; lokalt klar, venter pushet PR.

### Ny brukerjustering 31.10: kvalitetssikring som avhuking

Helen har prøvd #94 i appen og vil erstatte tekstlenken med en synlig,
kompakt avhukingsboks per PC-rad og tilsvarende på mobilkort. Dette er
prioritet 1 kvalitetssikring; konkret oppdrag i #59 6544187094.
Tom boks betyr ikke kontrollert; avhuket betyr kvalitetssikret på gjeldende
grunnlag. Fjerne hake opphever kontroll. Endret grunnlag vises med tom boks
og «Endret etter kontroll», og kan bekreftes på nytt. Bevar eksisterende
filtre, kontrollgrunnlag, historikk og sikker lagring/feilhåndtering.
Hvem og når skal bare lagres i Firebase, ikke vises i UI (Helens siste
presisering). Massemerking av hele søket er nå bestilt i avsnittet over;
ingen automatisk merking av ekte data. Én aktiv implementering: Claude bekrefter status på #95 og tar
UI-rettingen ved nærmeste trygge skifte. Deretter mellomværende og
kvitteringer, deretter AV-1 og AV-2; regelmotor uten datolås etter disse. Mottak bekreftet i 6544248692; lokalt klar.


**Overstyrende prioritering fra Helen 31.10.2026:** Kvalitetssikring →
mellomværende #95 → kvitteringer → gave- og relasjonsmodul (julegaver først) →
AV-1 (modell + PC) → AV-2 (mobil + handlingskø).
Regelmotoren prioriteres etter alle disse høyere prioriterte leveransene,
uten datolås, selv om arbeid er startet.
Bevar gren/utkast og bytt oppgave. Dette overstyrer eldre utsagn om
regelmotor som neste oppgave og begrunnelsen om ikke å avbryte aktiv PR.
Når de høyere prioriterte leveransene er utført, kan regelmotoren tas opp
igjen uten ny bestilling fra Helen. Dette opphever tidligere datolås til 20.11.
Handoff og krav om mottaksbekreftelse: #59 6543789687.

| Rekkefølge | Leveranse | Begrunnelse og avgrensning |
|---|---|---|
| Levert og publisert 31.10 | Årsbudsjett: oppdater detaljlinjen umiddelbart ved «resten av året» (#59) | Rotårsak: ukontrollerte `defaultValue`-celler. Rettet med kontrollert celle og ærlige lagringsfeil i #92, reviewet på 8ee6c30 og merget som b457d18. Publisert med production.yml 41194092735 på d76cd18; live-jobb 124516642467 success, uavhengig kontrollert. Skrivefri etterkontroll tatt av Work 10:57Z (ny baseline; Helen gjør datarettinger parallelt). Ingen dataretting. Venter brukerbekreftelse i appen. |
| Levert | Driftsdokumentasjon for skriveinngangen (#88 / #27) | #88 er re-reviewet på f513813 (5719329589), fire CI-jobber i 41137530060 er success og merget som 188211c. Brukerbekreftet skriving i handleliste og Forvaltning. Docs-only, ingen ny produksjonsdeploy kreves. Custom-role-rotårsaken er fortsatt ukjent. |
| Levert og kontrollert i ChatGPT | Filtrert transaksjonssøk for ChatGPT (#27 / #59) | #89 er re-reviewet på ad830cf (5719978022) og squash-merget som 87c3c1 med forventet head. Begge reviewfunn er løst; fire PR-CI-jobber success i 41141040537, 393 enhetstester og 75 emulatortester. MCP-run 41181593485 er verifisert success på 218c0ed (revisjon 00038-phr, 100 % trafikk); skrivefri etterkontroll viser uendrede data. Helen har fornyet tilkoblingen; verktøyet er tilgjengelig og et smalt kombinert søk er kontrollert mot data_hent for både transaksjon og hendelse med identiske versjoner. Hosting-deploy trengs ikke. Kombiner konto, eier, tekst, dato og status; returner små sider med stabile ID-er. Støtter presis oppfølging uten fulle råuttrekk. |
| Levert og publisert 31.10, brukerbekreftelse gjenstår | PC-arbeidsflate og kvalitetssikring av transaksjoner (#59) | PC-1 (bred tabell/mobilkort fra én radmodell, splitter per rad, faste overskrifter) re-reviewet og squash-merget som 70a4070 (#91). Publisert med production.yml 41195125728 på 70a4070; live-jobb 124519645972 success, uavhengig kontrollert av Work; skrivefri nåkontroll 11:07Z uten nye referansebrudd. **Neste implementering (6542594363): «kvalitetssikret»** som egen skive i eksisterende tabell/kort, før AV-1: kontrollstatus Ikke kontrollert / Kvalitetssikret / Endret etter kontroll, avhuking per transaksjon, hvem/når bare i Firebase, filter, separat kontrollmetadata per stabil transaksjons-ID med semantisk grunnlag. Massemerking av hele søket er bestilt og lokalt klar; se gjeldende status over. PC-2 (sidepanel/URL-tilstand) etter AV-2. Ingen lagringsløsning for nye kvitteringer er endelig valgt. |
| Levert og publisert 31.10, brukerbekreftelse gjenstår | Mellomværende: gaveutlegg mot abonnementer (#95 / #59) | Helen bestilte bygging 31.10. Hele 3299 på Gaver i oktober uten bankeffekt; 467 reduksjon av Abonnementer fra oktober, rest2832 etter første oppgjør. Justerbart månedsbeløp, vedvarende handlingskort også for glemte måneder, oppgjørshistorikk/angring, årsskifte og siste deloppgjør/stopp ved null. Kartlegg eksisterende bankuavhengige hendelser; faktisk kostnad, ikke bare budsjettendring. Én aktiv implementering. Mottak bekreftet; #96 til retting etter review 5723280487. Ingen ekte poster registrert. Full kontrakt/testkrav i #95. |
| Neste: B1 bestilt, A publisert | Kvitteringer: varig bilde/PDF og detaljerte dagligvarekjøp (#59) | Kartlegging levert i #59 6541086349 etter bekreftet mottak 6541019719. Kontrolltårnet har bestilt skive A: sikker visning/nedlasting av eksisterende bilder i én PR. Ingen ny lagring, IAM/rules, claims eller backend-/kostnadsvalg bestilt. Helen løfter dette 30.10. Kartlegg nåværende lagring og faktisk støtte før implementering. Bevar originalfil og strukturerte varelinjer, mengde/enhet, pris/rabatt, butikk/dato, total og transaksjonskobling. Unngå dobbelttelling og tap av eksisterende kvitteringer. Backend, tilgang, størrelsesgrenser og PDF-/bildevisning må avklares teknisk. |
| Etter kvitteringer B/C, før AV-1/AV-2 | Gave- og relasjonsmodul: julegaveplanlegging først | Gjeninnført og løftet av Helen 31.10 fordi julegavehandelen starter. Felles relasjonsregister med grupper, standardanledninger og gavebudsjett; personunntak, enkel idéliste, automatisk historikk og juleoversikt med mottakere/manglende/ferdige gaver. Se omprioriteringen over for tidligere avtalt grunnlag og avgrensning. Planlagt; faktisk eksisterende støtte kartlegges før bestilling. Ingen parallell implementering eller automatisk oppretting av ekte personer/gaver. |
| Etter gave- og relasjonsmodulen, før regelmotor – akseptert 31.10 | Avstemming: kompakt PC-tabell og mobil status/handlingskort (#59) | AV-1 (felles modell/PC) → AV-2 (mobil/handlingskø), akseptert i 6542342933 med presiseringer: konfigurerte kontoer uten startpunkt/saldo og ukjent konto skal synes; eldre åpne forhold skal ikke skjules av valgt måneds OK; tomme/fremtidige perioder begrenses uten å skjule uavklart grunnlag. Helens siste presisering: AV-1 og AV-2 skal begge leveres før regelmotoren, etter kvalitetssikring, mellomværende og kvitteringer. Ingen endring i saldo/motpost/dublett/skrivevei. |
| Etter kvitteringer B/C | Regelsenter: endre koblet budsjettpost | Helen bestilte 31.10 i #59 6543518396. Bekreftet UI-hull: «Koblet mot» er bare tekst i RegelDetalj. Velg gyldig målpost/type/livsområde og lagre mål-feltene sammenhengende; bevar øvrige vilkår/eier. Ingen historisk masseomplassering. Mottak gjenstår; ikke start parallelt med aktiv leveranse. |
| 3 | Praktisk vedlikehold via ChatGPT | Oppskrift fra bilde → Kokebok, middagsplan, bibliotek, lager og økonomi etter konkret instruks. Skriveinngangen er generell; ingen domenevis aktivering. |
| 4 | Små forbedringer i daglig Mat-flyt | Vurder «Merk som basisvare» fra handlelisten mot faktisk eksisterende kode. |
| 5 | Forvaltning: øvrige praktiske hull (#59) | Kartlegg faktisk støtte for generator, kontoer og Regelsenter/Årsbudsjett før nye bestillinger. |
| 6 | Bedre middagsforslag og familiesmak | Bygg på Førsteutkast/historikk/feedback uten automatisk nye brukerroller. |
| 7 | Matlager: kjøleskap/tørrvarer og forbruksstøtte | Lav registreringskostnad. Automatisk nedtelling krever avklaring av bruk/mengde/batch og angring. |
| 8 | Økonomiske trender og finansiering av felleskostnader | Først etter kontrollert datagjennomgang og godkjent harmonisering. Skill eier/ansvar fra betaler og finansieringskilde; interne overføringer og MC-oppgjør må ikke dobbeltelles. Sammenlign kun perioder med kjent kontodekning. |
| Etter høyere prioriterte leveranser, uten datolås | Regelmotor: boliglån/tallmønstre og CC Mat-feiltreff (#59) | Helens siste presisering 31.10 opphever datolåsen: kvalitetssikring, mellomværende, kvitteringer, AV-1 og AV-2 leveres først. Bevar arbeid på gren/utkast og ta opp igjen når høyere prioriterte leveranser er utført, uten ny brukerbestilling eller venting til bestemt dato. Ingen historisk dataretting eller regelomskriving. |
| Senere, køplass avklares før oppstart | Periodelåsing av ferdige perioder (#59) | Helen bestilte behovet 31.10: kunne låse ferdige perioder mot utilsiktede endringer. Ingen endring i aktiv kø og ingen låsing av ekte data nå. Før bygging: avklar måned/per konto, låsevilkår og kontrollert gjenåpning med spor; kartlegg håndheving i UI/import/automatiske koblinger/MCP, flytting/sletting og avledede motposter samt etterimport. Låsing er eksplisitt og separat fra kvalitetssikring/avstemming. Ikke ferdig teknisk kontrakt. |
| Separat | Første ekte duplikatsammenslåing (#84) | Følg skrivefritt etter faktisk brukerbruk; ingen automatisk sammenslåing. |
| Lavest prioritet per 31.10 | Endre postert transaksjon til intern overføring (#59) | Helen melder at hun kan postere en overføring ved en feil og må kunne rette dette selv i appen. Legg til eksplisitt handling på eksisterende postert transaksjon; gjenbruk dagens intern-overføringslogikk og motpartshåndtering. Fjern/reverser den gamle økonomifordelingen uten å endre bankbevegelsen eller dobbeltelle motposten. Bevar spor, konfliktvern og korrekt «Endret etter kontroll». Kartlegg eksisterende støtte før implementering og test saldo/økonomisummer, begge kontoer, manglende motpost og feil/retry. Ingen endring av dagens aktive kø og ingen generell historisk dataretting. |

### Oppfølging 31.10: kvalitetssikring #94 reviewet og merget

Dette er gjeldende status og overstyrer eldre reviewblokkeringer nedenfor.
#94 er re-reviewet/godkjent på eksakt `e97c7fb99bab411ac178e3954ee802c547723b53`
(review 5722791261). Motpostgrunnlag-funnet er løst og domene-/emulator-
regresjoner er kontrollert. Alle fire faktiske CI-jobber i 41202702816
har success, inkludert integrasjon og begge E2E-steg. Squash-merget med
forventet head som `cedd59bc9ce34bc4ada9c81df3b633556d5535b0`.

Publisering og etterkontroll gjenstår. Claude har konkret handoff i #94
6543644861: grønn main-CI før production.yml, deretter eksakt deploy-SHA,
run/live-jobb og skrivefri etterkontroll. Mottak av denne handoffen er
ennå ikke bekreftet. Ikke erklær funksjonen klar og ikke prøvemerk ekte
transaksjoner automatisk. Ingen MCP-deploy trengs for denne PR-en.
Regelmotorfeilene er neste aktive implementering etter fullført publisering
og kontroll; øvrig kø og Helens prioritering av regelpostredigering etter
kvitteringsarbeidet består. Ingen nye produksjonsdataendringer i dette
review-/mergearbeidet.

### Oppfølging 31.10 kl. 13:43: #94 motpostgrunnlag og regelmotor-kø

Dette avsnittet overstyrer eldre status nedenfor. #94 er fortsatt eneste
aktive implementering på eksakt `f8e3c3786c7016104007cdc1e196c4013c259266`.
De to opprinnelige P1-funnene er løst og re-reviewet i PR-kommentar
6543489123. Alle fire faktiske jobber i CI 41199102790 er success,
inkludert integrasjon og begge E2E-steg. Ingen ny SHA eller bekreftelse på
mottak av det siste reviewet foreligger ved denne kontrollen.

Ett konkret funn blokkerer fortsatt merge: `forventetMotpost` mangler i
det semantiske kontrollgrunnlaget. Bytte av mottakerkonto/periode,
kildeavtrykk, avslutning eller erstatning kan dermed endre saldoeffekten
uten at kvalitetssikringsstatus endres. Avgrenset retting og regresjoner
er bestilt i 6543489123 og fulgt opp i #59 6543491911. Ikke gjenta
oppdraget uten ny informasjon. Ingen merge eller deploy av #94 er utført.

Neste etter fullført #94: regelmotorens brukerobserverte feil (#59
6543087796 / 6543491911). Tall-/mottakerregelen for boliglån er mottatt
av Claude i 6543230336; samme oppgave skal også rette at «Mat» feilaktig
treffer «CC Mat» gjennom omvendt substring-matching. Mottak av den nye
CC Mat-presiseringen gjenstår. Ingen historisk massebehandling eller
produksjonsregelendring er bestilt. Deretter AV-1, AV-2, PC-2 og
massemerking. Kvittering B/C og egen MCP-støtte for serverstemplet,
eksplisitt kvalitetssikring beholdes i køen; ingen generell skrivesperre.
MCP-kontrakt 6543081842 har fått tekniske presiseringer i 6543489123.

Skrivefri nåkontroll 12:42Z: 1406 transaksjoner, 1280 hendelser, 49
receipts og 52 rules; ingen transaksjons-/kvitteringsreferansebrudd,
bare de to kjente gamle regelreferansene. Dette er en ny baseline etter
Helens import/dataarbeid, ikke en påstand om uendret database. Ingen
produksjonsdata er endret i denne oppfølgingen. Handlelisten har korrekt
markør, 26 varer/19 fullførte, samme digest `831a2ef7…0992`, ingen
sammenslåingshistorikk og ingen stopp. Første ekte sammenslåing gjenstår.
Full generell familieskriving og lesing er tilgjengelig i Work-registeret;
det gamle tilgangsoppdraget er ferdig og bestilles ikke på nytt.

### Oppfølging 31.10: kvalitetssikring #94 til retting

Dette avsnittet overstyrer eldre kø-/statusbeskrivelser nedenfor. #93 er
reviewet på 3684b09 (5722583722) og squash-merget med forventet head som
ae509120ccae452a0ed83a218b459c1e19edb0c5. Docs-only; ingen deploy trengs.
#92 og #91 er publisert: Actions/live-steg er uavhengig kontrollert for
41194092735 på d76cd18 og 41195125728 på 70a4070. Main-CI 41194845956
og #93-CI 41195994289 har fire faktiske success-jobber hver.

Claude har bekreftet at AV-1 ikke var startet (6542655838), og har levert
kvalitetssikring i #94 på eksakt 75d3c32157da68ab8d549b4c703fadbc9480a034.
Dette er eneste aktive implementering. Fire faktiske CI-jobber i
41197399584 er success, inkludert emulator/integrasjon og begge E2E-steg.
Teknisk/produktmessig review 5722586456 holder merge tilbake på to P1-funn:
banktekst og kvitteringens innhold/vedlegg samt alle reelle koblingsveier
mangler i kontrollgrunnlaget; ny generell MCP-sperre på
transaksjonskontroller bryter mandatet og presiseringen i #59 6541752414.
Claude er bedt om revidert kontrakt, konkret retting og regresjoner,
inkludert eksplisitt brukerbestilt kontroll via ChatGPT med troverdig
identitet, konfliktvern, idempotens og spor. Ingen ny prinsippgodkjenning
kreves; ingen IAM/rules-endring eller produksjonsprøveskriving er bestilt.
Mottak av dette nye reviewet er ennå ikke bekreftet. Ikke start massemerking,
AV-1, AV-2 eller PC-2 før aktiv leveranse er ferdig reviewet/publisert/kontrollert.

Nåkontroll 11:48Z: 1379 transaksjoner, 1258 hendelser, 49 receipts og 51
rules. Ingen transaksjons-/kvitteringsreferansebrudd; to kjente gamle
regelreferanser består. Fire transaksjonshull og to hendelseshull; ingen
komprimering eller retting utført. Brukerstyrt dataarbeid pågår separat,
så dette er ikke en påstand om uendret database over deploy.
Handlelisten har korrekt markør, 26 varer/19 fullførte, uendret digest
831a2ef7…0992 og ingen sammenslåingshistorikk eller stopp. Første ekte
sammenslåing følges separat. Kontoutskriftsperiode-kartlegging er parkert
etter Helens konkrete dataretting (#59 6542808603); ikke bygg ny
periodesemantikk for den saken.

### Oppfølging 31.10 kl. 11:42: #92 merget, #91 konfliktløsning

Årsbudsjettoppdraget er faktisk mottatt og levert i #59 6542075706 /
6542186683. #92 er teknisk/produktmessig reviewet på eksakt
`8ee6c302b0150a4d49ad0320ebd12c71be88fb4f` (5722388089), alle fire
faktiske CI-jobber i 41192533565 er success, inkludert begge emulator-E2E.
Squash-merget med forventet head som `b457d183a801be3f9ae3465ba1802c2037a9056d`.
Kontrollerte celler synkroniserer lagrede verdier uten å miste fokusutkast;
feil vises. Ingen endring i atomisk datalagring eller produksjonsdata.
Hosting-deploy/etterkontroll gjenstår; MCP-deploy trengs ikke.

#91 er re-reviewet/godkjent på eksakt `834304c8b1d84ac80d14564abfab0ab4b1a2fd83`
(5722389352). Begge reviewfunn er løst: post/eier per splitt i samme tr,
og sticky overskrift mot en avgrenset reell scrollflate. Fire faktiske
CI-jobber success i 41193077022; loggen bekrefter 1282 enhetstester,
174 integrasjonstester og 17+14 emulator-E2E. Ingen lokale fullsuiter i
denne Work-økten. Faktisk mergeforsøk med forventet head ble avvist 405
«merge conflicts» etter #92. Claude har fått konfliktløsning og ny CI /
re-review før merge i #91 6542342798. Mottak av denne nye handoffen gjenstår.
Begge E2E-testene skal bevares. Hosting koordineres via Claude etter grønn
main-CI; eksakt deploy-SHA/run og skrivefri etterkontroll må verifiseres.

Avstemming er faktisk mottatt i #59 6542267549. To sekvensielle PR-er er
akseptert i 6542342933: AV-1 felles modell/PC, deretter AV-2 mobil/kø,
etter fullført publisering og etterkontroll av #92/#91. Ikke filtrer bort
konfigurerte kontoer med manglende nødvendig grunnlag, ukjente kontoer eller
eldre uavklarte perioder fra samlet status. Ingen ny implementering starter
før foregående leveranse er ferdig. Dette overstyrer eldre «mottak gjenstår»
og direkte PC-2-rekkefølge nedenfor.

Separat skrivefri shopping-kontroll 10:39Z: markør ok, 26 varer/19
fullførte, ingen stopp eller sammenslåingshistorikk, uendret digest
`831a2ef7…0992`. Første ekte sammenslåing gjenstår. Ingen data rettet.

### Bestilt 31.10: kompakt Avstemming på PC og handlingskort på mobil

Helen opplever for mye scrolling og for store informasjonsblokker i dagens
Avstemming. Bestilt separat responsiv leveranse etter årsbudsjettfiksen og
#91-reviewrettingene, før videre PC-2/kvalitetssikring. Én aktiv oppgave;
kvittering B/C og varelinjer beholdes i køen. Faktisk mottak gjenstår.

PC: kompakt kontotabell for valgt periode med inngående saldo, inn/ut,
beregnet/faktisk utgående saldo, differanse og status. Bare valgt konto
åpner handlings-/detaljpanel; historisk matrise kan velge konto og måned.
Mobil: enkel samlet periodestatus og bare nødvendige handlingskort under.
Kort forsvinner først etter lagring og ny beregning, og bare når alle
relevante problemer er løst. Etterimport kan få kort til å komme tilbake.
Avledet er ikke bankverifisert; manglende saldo/startpunkt/ukjent konto og
endret grunnlag skal ikke skjules som OK. Unngå tomme fremtidige kort.
Bevar diskret full oversikt, historikk og angring etter at et kort er borte.
Felles modell, saldo- og korreksjonslogikk; ingen automatisk dataretting.
Test faktisk lagring/feil/delvis løst/etterimport, mobil/PC-paritet og tastatur
mot emulator. Konkret oppdrag er gitt i #59.

### Prioritert brukerfeil 31.10: Årsbudsjett

Helens nyeste prioritering overstyrer neste implementeringsoppgave PC-1:
rett visningen etter «samme beløp resten av året» først. Helen har nå
bekreftet at en refresh viser alle beløpene riktig, og at summeringslinjen
allerede var oppdatert. Det rapporterte tilfellet gjelder dermed foreldet
detaljvisning etter vellykket lagring, ikke manglende lagring.
Skrivefri data_hent 31.10 09:57Z av `budget/fritid/hobby` viste også 265 i
alle 12 måneder på både detalj og foreldrepost.

Avgrens rettingen til at alle berørte detaljfelt og summer vises korrekt
umiddelbart etter bekreftelse, uten refresh. Verifiser faktisk brukerflyt
med blur/bekreftelse, at tidligere måneder og andre poster bevares, og at
resultatet er identisk etter reload. Ingen produksjonsdataretting.
Tidligere bestilling i #59 6541936120 / 6541949897 presiseres med denne
brukerbekreftelsen; kontroller faktisk mottak. PC-1/2, kvalitetssikring og
kvittering B/C beholdes etter denne avgrensede feilrettingen.

### Leveranseoppfølging 31.10: #90 og PC-1

#90 er reviewet på eksakt `e69eb8e` (5722187784) og squash-merget med
forventet head som `3bff30dded94e96a4b164d115d7c5a5e9d56d6f8`.
PR-CI 41187878607 har fire faktiske jobber success. Work har i tillegg
kjørt uavhengig domenekontroll av fire bildeformater, bytebevaring,
avvisninger, størrelsesgrense og filnavn; full React-suite er kontrollert
via CI, ikke kjørt lokalt. Main-CI 41189215862 på merge-SHA og 41189276445 på deploygrunnlaget
har fire faktiske success-jobber hver, uavhengig kontrollert. Hosting-run
41189615436 er completed/success på eksakt
`0368bba25548d389e24f842197966cafd3df74f2`; jobb 124503510504 og
live-deploy-steget er success. Deploy startet etter grønn CI. A er publisert;
ingen MCP-deploy kreves. Ingen produksjonsdata endret.

Den ene eksisterende base64-kvitteringen er ferskt kontrollert med
`forkastet=true`. Den er dermed utilgjengelig i aktiv innboks. Ikke
gjenåpne den for å teste. A er en avgrenset funksjonsleveranse, ikke
brukerbekreftet visning av ekte bilde. Historiske/koblede vedlegg skal
kunne nås i PC-2/detaljpanelet.

Claudes mottak av bestillingen er bekreftet i 6541453576. PC-kartlegging
6541592690 og backendvurdering 6541616036 er levert. Kontrolltårnets
review og konkret videreføring ligger i #59 6541752414. Neste ene
implementeringsoppgave er PC-1: bred transaksjonstabell og mobilkort fra
felles modell, kombinerte filtre/sortering, korrekt eier/splitt, eksakte
beløp, summer og eksisterende korrigering uten tapt utvalg. PC-1 er nå levert til review i #91 på 6084967. Kontrolltårnet har lest kode og
verifisert alle fire faktiske CI-jobber i 41190770974 success. Før merge må
post og eier holdes vertikalt sammen per splitt også når tekst brytes, og
faste overskrifter fungere ved faktisk scrolling. Reviewet er gitt som
PR-kommentar fordi GitHub avviser REQUEST_CHANGES på samme konto som
PR-forfatteren. Årsbudsjettfiksen tas først i separat PR, så #91-rettinger
og re-review/merge/deploy. Ingen merge av #91 er utført. Deretter PC-2 med sidepanel og URL-tilstand, så kvalitetssikring,
så ny bilde/PDF-opplasting B og varelinjer C.

Kontrollkontrakten er foreløpig: separat node og avledet kontrollgrunnlag
støttes, men kvitteringskoblinger, relevante tekst-/vedleggsendringer,
kontraktversjoner, samtidighet, historikk og eksplisitt kontroll via
ChatGPT må ferdigstilles før implementering. Ingen automatisk godkjenning.

Serverformidlet lagring S2 med egen tjeneste er foretrukket teknisk retning,
ikke aktivert eller endelig driftsgodkjent. Bucket/region/billing, priser,
Hosting-grenser, faktisk nettverkskostnad, RTDB-metadataskriving og samspill
med eksisterende hele-node-skrivere må avklares. Ingen operatørsteg til
Helen før en konkret, reviewet pakke er klar.

### Godkjent 31.10: PC-kontrollflate og kvalitetssikring

Helen har godkjent forslaget etter egen EasyPark-gjennomgang. Mobil er for
rask oversikt og enkle oppgaver; PC er arbeidsflaten for systematisk kontroll.
Oppdrag og krav er gitt i #59 6541424565, etter kartleggingsbestilling
6541384507. Dette er bestilt arbeid, ikke dokumentasjon på faktisk oppstart.
Fullfør aktiv kvitteringsskive A først. Deretter PC-tabell og kvalitetssikring
som separate avgrensede leveranser, én implementeringsoppgave om gangen.

- Én app med felles domene/data/skriveveier og ulike oppsett etter plass.
  PC-tabell skal vise dato inkl. år, tekst, konto, eksakt beløp, faktisk
  eierfordeling, budsjettpost/type og status. Splitt og manglende informasjon
  skal ikke presenteres som entydig eier eller automatisk avvik.
- Kombinerte filtre/sortering og antall/sum for synlig utvalg. Korrigering
  skal bevare søk/filter/posisjon. Detaljpanel/navigasjon avgrenses etter
  Claudes tekniske vurdering; behold gode mobilflater og øvrige rom.
- Kvalitetssikring er separat fra behandlet. Kun eksplisitt brukerhandling,
  ingen automatisk historisk godkjenning. Vis ikke kontrollert,
  kvalitetssikret eller endret etter kontroll. Lagre hvem/når og grunnlaget
  som ble kontrollert. Relevant dataendring må kreve ny kontroll, også ved
  MCP-skriving; ustabile metadata må ikke skape falske endringer.
- Datakontrakt, relevante avhengigheter (transaksjon/hendelse/kvittering),
  samtidighet og bevaring gjennom eksisterende skrivere skal reviewes.
  Ingen endring i økonomisummer eller regler fra selve kontrollmarkeringen.
- Nye kvitteringsbilder/PDF (B) og varelinjer (C) er fortsatt prioritert.
  Lagringsvalg er åpent: Firebase Storage er foretrukket kandidat for filer,
  RTDB for metadata/varelinjer. Revidert vurdering skal konkretisere
  medlemskap/tilbakekalling, serverhåndheving, eksisterende bucket/region/
  billing, gjeldende priser og nødvendige operatørsteg før aktivering.
  Ingen ny IAM/rules/billing-endring er godkjent gjennom UI-bestillingen.

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

**Publisert 31.10.2026 — PR #89 / 87c3c1, MCP-run 41181593485 på 218c0ed. Søket er nå bekreftet tilgjengelig i ChatGPT etter fornyet tilkobling.** Legg til et
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
Ingen Hosting-deploy kreves. Søkeverktøyet er nå tilgjengelig etter Helens fornyede tilkobling. Et smalt
kombinert søk er kontrollert mot separat data_hent av både transaksjon og
hendelse: begge finnes og har identiske versjoner. Ingen data endret.
Siste åpne etterkontroll for #89 er dermed fullført; ingen ny deploy kreves.
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
