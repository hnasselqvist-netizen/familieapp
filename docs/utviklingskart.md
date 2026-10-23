# Utviklingskart

En egen, liten side for å se hovedspor, aktiv skive, **Nå**, **Neste** og **Venter på**.
Åpne **`/utviklingskart/`** på en lokal Vite-server eller en eksisterende Firebase
Hosting-preview. Siden laster ikke Hverdagsflyt-appen, innlogging eller Firebase.

## Hvordan det virker

`web/public/utviklingskart/` er vanlig HTML, CSS og JavaScript-moduler. Vite kopierer
filene uendret. Ingen ekstra pakke, backend, GitHub-secret, database eller build-jobb
er nødvendig for å oppdatere innholdet.

Nettleseren leser det offentlige repoets issues, PR-er og de tre handoff-kanalene
#20, #27 og #34 fra GitHub REST API. Data hentes ved åpning og hvert 15. minutt mens
siden er synlig. Ved tilbakekomst til fanen oppdateres en eldre oversikt. Normalt
trengs fem GET-kall per oppdatering; paginering følger med når repoet vokser.
GitHubs uautentiserte kvote deles av klienter på samme IP. Ved rate limit venter
kartet til oppgitt reset; ved annen feil venter det 15 minutter. Siste komplette
oversikt beholdes i nettleserens lokale lagring, med tidspunkt og feilmelding.
Delvis henting erstatter aldri den siste komplette oversikten.

## Status og informasjonskilder

Stegene gjelder **aktiv skive / siste bekreftede leveranse**, ikke prosentvis
ferdigstilling av hele produktområdet. Et spor kan gå fra «I bruk» tilbake til
«Bygges» når neste skive får en PR.

| Kilde                                   | Status                                                |
| --------------------------------------- | ----------------------------------------------------- |
| Åpen draft PR                           | Bygges                                                |
| Åpen, reviewklar PR                     | Review                                                |
| Merget PR                               | Klar, aldri automatisk I bruk                         |
| Lukket PR uten merge                    | Ingen leveranse                                       |
| Eksplisitt, kildebelagt handoff-notat   | Kartlagt, Designet, Bygges, Review, Klar eller I bruk |
| Ingen bekreftet bygging eller leveranse | Kartlagt, merket «Ingen bekreftet byggestatus»        |

PR-er fordeles etter sporord i tittelen (første treff), eksplisitte historiske
grunnmur-PR-numre eller en entydig `Issue #34` / `Closes #34`-referanse i beskrivelsen.
MCP i starten av en tittel veier dermed tyngre enn Handleliste senere i samme tittel.
Utviklingskartets egne PR-er ignoreres. Ukjente PR-titler blir ikke tvangsplassert.
Ved flere åpne PR-er brukes sist oppdatert PR i hovedvisningen; alle finnes under
«Kilder og handoff». `blocked` eller `blokkert` på en åpen PR gir «Venter på».

Ingen naturlig språk-tekst blir tolket som «ferdig» eller «blokkert». Gamle
kommentarer om IAM eller cutover kan derfor ikke automatisk bli dagens blokkering.
Den siste handoff-kommentaren lenkes under sporet.

## Hva må vedlikeholdes?

**PR-løpet krever ingenting ekstra.** Fortsett å åpne, gjøre reviewklar og merge
PR-er som før. Kjente titler og issue-referanser gjør resten.

Mellom PR-er kan Kontrolltårnet enten oppdatere det lille notatet i `tracks.mjs`
som del av vanlig GitHub-arbeid, **eller** legge et kort strukturert notat i en
handoff-kommentar det allerede skriver. Eksempel:

```html
<!-- utviklingskart {"stage":"Designet","now":"R1-kontrakten er valgt.","next":"Bygg RegelSenter med skriving av.","waiting":""} -->
```

Bare **nyeste kommentar** kan levere dette notatet. Dermed henger ikke en gammel
blokkering igjen etter en ny handoff. Notatet ligger i en HTML-kommentar og gjør
ikke den vanlige GitHub-samtalen lengre. `stage` og `now` er påkrevd; `next` og
`waiting` er valgfrie. Feltlengder begrenses ved visning. PR-status overstyrer
kortnotatet mens en PR er åpen; en nyere merge overstyrer et eldre notat.

De fire første notatene i `tracks.mjs` er kildebelagte øyeblikksbilder fra repoets
faktiske arbeid, undersøkt 2. oktober 2026. De husker sist observerte kommentar-ID
og tidspunkt. En ny eller redigert siste handoff skjuler et eldre notat. Kartet
viser da ny handoff og status på siste leveranse frem til et nytt kortnotat finnes.
Ingen automatisk semantisk oppsummering eller ny sannhetskilde introduseres.

Ved nytt hovedspor: legg til navn, handoff-issue og tittelmønster i `tracks.mjs`.
Oppdater filen når en handoff-kanal erstattes. Teknisk grunnmur deler #20 som
historisk cutover-kilde; nye PR-er om CI/hosting/grunnmur oppdages fra titlene.

## Lokal kjøring og QA

Fra `web/`, bruk vanlig `npm ci` og `npm run dev`. Åpne
`http://localhost:5173/utviklingskart/`. Ingen emulator eller Firebase-konfig trengs
for **denne siden**. En lokal forhåndsvisning av bygget bruker samme URL-sti.

Fra repo-roten:

```sh
node --test tools/utviklingskart/model.test.mjs
```

Testene dekker statusprioritet, merge kontra lukking, utdaterte notater,
klassifisering, blokkering, paginering, rate limit og ufullstendige svar. En separat
GitHub Actions-workflow kjører disse ved kartendringer. Vanlig web-CI kontrollerer
og bygger også de statiske filene og kjører `browser.test.mjs` med den eksisterende
Playwright-installasjonen. Nettlesertesten bruker en liten lokal HTTP-server og
mockede GitHub-svar: 390/1100px, kilder, cache/offline, rate limit, tekst-/lenkesikkerhet
og null Firebase-kall. Den kan kjøres med `node tools/utviklingskart/browser.test.mjs`
etter at web-avhengighetene og Playwright Chromium er installert. Ingen deploy skjer
automatisk.

## Preview, produksjon og rollback

Eksisterende `preview.yml` kan brukes manuelt med kart-PR-nummeret. Åpne bare
`/utviklingskart/` på preview-origin for kart-review. Kartet selv gjør ingen
Firebase-kall. Resten av Hverdagsflyt-previewen bruker fortsatt ekte backend, som
dokumentert i ADR 0001.

PR-en endrer ingen Firebase-rules, data, eksisterende produktnavigasjon eller
deploy-workflows. Kartet blir tilgjengelig i produktets hosting først når noen
bevisst deployer et bygg som inneholder det. Ingen produksjonsdeploy er del av
dette oppdraget. Rollback er å fjerne kartmappen og den isolerte test-workflowen.

Hvis repoet senere blir privat, slutter direkte, tokenfri GitHub-lesing å fungere.
Da kan en Action produsere en statisk JSON-fil; klienten skal aldri få et PAT-token.
