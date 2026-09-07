# 0001 — Ny teknisk grunnmur for Hverdagsflyt

- **Status:** Vedtatt
- **Dato:** 7. september 2026
- **Deltakere:** Helen (produkteier), Kontrolltårnet/ChatGPT (systemarkitekt), Claude (teknisk implementatør)

## Kontekst

Dagens produksjonsapp er én statisk fil (`index.html`, ~17 000 linjer) med
React + Babel transpilert i nettleseren ved hver sideinnlasting, ingen
byggverktøy, ingen automatiserte tester, ingen CI, og historisk direkte
filopplasting til produksjon via GitHub sitt web-grensesnitt. En uavhengig
kartlegging (se sesjonens tidligere artifacts) fant at **produkt-/domene­
arkitekturen er vesentlig bedre enn den fysiske kodeorganiseringen** — Motor/
Generator/Kontrollpanel-prinsippet fra `designbok.md` er reelt fulgt i koden,
selv uten verktøy som håndhever det.

Hovedhypotesen som ble lagt til grunn: **ny teknisk grunnmur, bevart
produkt-/domenearkitektur.**

## Beslutning

### Teknologistack

React + Vite + TypeScript (`strict: true`) + React Router + domenevise hooks
(ingen global state-motor) + CSS Modules over en delt `tokens.css` + Firebase
modulær SDK mot **fortsatt Realtime Database** (ikke Firestore — ingen
begrunnelse for å bytte databasemotor, kun skrivemønsteret trengte å endres)
+ Vitest/React Testing Library/Playwright + ESLint/Prettier.

**Bevisst utelatt:** Next.js/SSR, Redux/Zustand, Tailwind/CSS-in-JS, GraphQL,
monorepo-verktøy. Ingen av disse løser et problem denne appen faktisk har.

### Lagmodell

Motor (`src/domain/**`) / Generator (`src/generators/**`) / Kontrollpanel
(UI under `src/features/verktoy/**`) uttrykkes som ekte mappegrenser,
håndhevet mekanisk med ESLint (`import/no-restricted-paths`) — ikke bare
navnekonvensjon. Se `docs/arkitektur/oversikt.md` for full lagmodell.

### Firebase-skrivemønster

Fra "les hele samlingen → skriv hele samlingen tilbake" til målrettede
`update()`/`set()`-kall mot kun den noden som faktisk endret seg. Løser både
kostnadsvekst med datamengde og den kappløpsklassen av bugs dagens kode
patchet ad hoc (se kommentar i `index.html` sin `setRecipes`).

### familyId

`FAM = "families/familie1"` hardkodet i ~30 steder i dag. Ny grunnmur: ett
sted (`src/hooks/useFamilyId.ts`), resolver alltid til `"familie1"` i dag.
Ingen multi-tenant-produktfunksjonalitet bygges — kun seamen flyttes billig
nå, før flere filer skrives mot det gamle mønsteret.

### Sikkerhetsmodell

Dagens Firebase-regel (`auth != null` på enhver `$familyId`) lar enhver
innlogget bruker lese/skrive **alle** husstanders data. Ny modell:
`families/{familyId}/members/{uid}`-node, ikke custom claims — null ny
infrastruktur (ingen Cloud Functions/servicekonto), umiddelbar effekt,
redigerbar direkte i Firebase-konsollen. Se
`infra/firebase/database.rules.json`.

**Ikke deployet til produksjon i Fase 0.** Krever at den faktiske
medlemslisten (kjente brukeres UID-er) verifiseres og skrives til
`members`-noden først — se "Overgang" under.

### Preview vs. produksjonsdata

Firebase Hosting-forhåndsvisningskanaler bruker de virkelige backend-
ressursene i prosjektet (samme database, samme brukere) — det finnes ingen
databaseisolasjon per PR i Firebase. Konsekvens:

- **Alle automatiserte tester** (domene, integrasjon, E2E) kjører
  utelukkende mot **Firebase Emulator Suite**, aldri mot en
  Hosting-forhåndsvisning eller produksjon.
- Forhåndsvisningskanaler er **forespørsel-styrt** (`workflow_dispatch`, ikke
  automatisk per push) og bygges med et synlig PREVIEW-banner
  (`VITE_DEPLOY_TARGET=preview`) som påminnelse om at dataene er ekte.
- **Ingen egen staging-Firebase-prosjekt** — vurdert og forkastet: den
  reelle restrisikoen (et menneske som klikker destruktivt i en preview de
  selv åpnet) er liten og kontrollerbar, mens et dupliserte prosjekt er
  reell, løpende driftskostnad uforholdsmessig til Hverdagsflyts størrelse.

### Hosting

Firebase Hosting, ikke GitHub Pages (fjerner behovet for dagens
no-cache-workarounds — GitHub Pages sin standard-caching er årsaken til
`sw.js` sin "cache ingenting"-tilstand og de aggressive `<meta>`-tagger i
`index.html`), og ikke Vercel (sammenfaller med databasen i samme prosjekt —
ett CLI-kall håndterer hosting + regler). Firebase Hosting-forhåndsvisnings-
kanaler er tilgjengelige på Spark-planen (verifisert av Kontrolltårnet mot
Firebase sin dokumentasjon i forrige runde) — ingen Blaze-oppgradering er et
krav for denne løsningen.

## Overgang (migrering fra `index.html`)

Konservativ, modul for modul, med gammel `index.html` som levende fasit til
paritet er bekreftet:

1. **Fase 0** (denne PR-en): grunnmur + Fryser som første vertikale skive.
2. **Fase 1:** datalag/motorer trekkes ut modul for modul, minst til mest
   komplekst, hver med karakteriseringstest skrevet mot dagens faktiske
   oppførsel FØR koden flyttes.
3. **Fase 2:** skjermer flyttes modul for modul. Produksjons-URL byttes i én
   kontrollert overgang per fullført modul-sett — ikke to frontends side om
   side i sanntid mot samme database.
4. **Fase 3:** Bankimport/Kvittering/Økonomi (størst, mest sammenfiltret)
   flyttes sist, med desidert mest testdekning.
5. **Fase 4:** engangsmigreringsverktøyene i dagens `index.html` fjernes
   eller re-implementeres som versjonerte skript i `scripts/migrations/`.
6. **Fase 5:** `index.html` arkiveres når full paritet er bekreftet og Helen
   har brukt ny app i normal drift en avtalt periode uten regresjon.

**Sikkerhetsregel-innstramming** (medlemsnode-modellen) rulles ut i egen,
separat prosess uavhengig av modul-migreringen: medlemslisten skrives manuelt
for kjente brukere, verifiseres, deretter deployes regelen — se
`docs/arkitektur/oversikt.md` §"Firebase security rules".

## Alternativer vurdert og forkastet

| Alternativ | Hvorfor forkastet |
|---|---|
| Firestore i stedet for Realtime Database | Løser ikke det faktiske problemet (skrivegranularitet); stor, ubegrunnet databasemigrering |
| Next.js/SSR-rammeverk | Ingen server-rendering-behov for en Firebase-drevet PWA; legger til hosting-/runtime-kompleksitet uten motytelse |
| Redux/Zustand (global state) | Problemet var ETT stort App()-objekt med all state — løsningen er å dele opp per domene, ikke bytte til et annet sentralt state-bibliotek |
| Custom claims for tilgangsstyring | Krever Cloud Functions/Admin SDK-infrastruktur som ikke finnes i dag, for et behov medlemsnoden løser uten ny infrastruktur |
| Eget staging-Firebase-prosjekt | Reell, løpende driftskostnad for en restrisiko som allerede er liten og menneskestyrt |
| GitHub Pages (behold dagens) | Ingen PR-forhåndsvisning innebygd; separat deploy-mekanisme fra databasen; årsak til dagens cache-workarounds |
| Vercel | Ikke samme prosjekt som databasen; roadmap nevnte det historisk, men ingen konkret fordel over Firebase Hosting ble identifisert |

## Konsekvenser

- Enhver ny modul følger samme mønster (repository → hook → feature) uten
  ny grunnmursdiskusjon — se `docs/arkitektur/oversikt.md`.
- `designbok.md` mister ansvaret for roadmap/backlog og arkitektur/ADR-er
  den tidligere bar alene — se `docs/roadmap.md` og denne mappen.
- Helen trenger ikke lenger laste opp filer — endringer går gjennom PR-er
  Kontrolltårnet kan lese og teste via forhåndsvisning.
