# Teknisk arkitektur — oversikt

> Beskriver den **nye** tekniske grunnmuren (`web/`), etablert i Fase 0.
> For produktfilosofi, domenemodell og låste designbeslutninger, se
> [`../produktfasit/designbok.md`](../produktfasit/designbok.md). For hvorfor
> disse valgene ble tatt (og hvilke alternativer som ble vurdert), se
> [`../beslutninger/`](../beslutninger/). Denne filen oppdateres etter hvert
> som flere moduler migreres fra `index.html` — se
> [`../beslutninger/0001-ny-teknisk-grunnmur.md`](../beslutninger/0001-ny-teknisk-grunnmur.md)
> for migreringsfasene.

## Status

Produksjonsappen som faktisk betjener brukere i dag er fortsatt den historiske
`index.html` i repo-roten. `web/` er den nye grunnmuren, under oppbygning
modul for modul — se `docs/beslutninger/0001-ny-teknisk-grunnmur.md` for
migreringsstrategien. Ingen produksjons-URL peker på `web/` ennå.

Migrert til `web/` så langt: **Fryser** (`src/features/hverdagsflyt/mat/freezer/`).
Alt annet vises via en midlertidig `LegacyBridge` som lenker ut til dagens app.

## Teknologistack

| Lag | Valg |
|---|---|
| Rammeverk | React 18+ (funksjonskomponenter, hooks) |
| Byggverktøy | Vite |
| Språk | TypeScript, `strict: true` |
| Routing | React Router |
| State | Domenevise React-hooks — ingen global state-motor (Redux/Zustand) |
| Styling | CSS Modules over en delt `src/styles/tokens.css` |
| Backend | Firebase Realtime Database (modulær SDK v9+) + Firebase Auth |
| Hosting | Firebase Hosting (ikke GitHub Pages, ikke Vercel) |
| Testing | Vitest (domene/komponent), Firebase Emulator Suite (integrasjon), Playwright (E2E-smoke) |
| Kvalitet | ESLint (+ react-hooks, + egne importgrense-regler), Prettier |

## Lagmodellen

Speiler designbok.md sin Motor/Generator/Kontrollpanel-modell, nå som ekte,
mekanisk håndhevede mappegrenser (`eslint.config.js`, regelen
`import/no-restricted-paths`) — ikke bare navnekonvensjon:

```
src/features/**      UI — skjermer og kontrollpaneler
       │  bruker kun
src/hooks/**          React-binding: abonnement + not_loaded/loading/loaded-status
       │  bruker kun
src/data/**            Repositories — ENESTE lag som importerer Firebase SDK
       │
   Firebase (Realtime Database + Auth)

src/generators/**    Bygger input til en motor — kan lese src/data/** og src/domain/**
       │  brukes av
src/domain/**          Motorer — rene funksjoner, ingen React- eller Firebase-import
```

Et brudd på denne retningen feiler `npm run lint` — se testene som demonstrerer
dette i praksis: `src/domain/freezer/freezer.test.ts` (rene funksjoner, ingen
mocking) vs. `src/data/freezer.repository.integration.test.ts` (mot en ekte
emulator).

## Datamodell og skrivemønster

Data ligger fortsatt i Firebase Realtime Database under
`families/{familyId}/...` — samme struktur som i dag, se
[`../produktfasit/designbok.md`](../produktfasit/designbok.md) §"Datakilder"
for den fulle stien-tabellen (uendret av Fase 0).

**Endret fra dagens `index.html`:** skriving skjer nå målrettet, mot det ene
elementet som faktisk endret seg (f.eks. `families/familie1/freezer/{id}`),
aldri ved å serialisere og overskrive en hel samling — se
`src/data/freezer.repository.ts` og `src/data/items.repository.ts` for
mønsteret alle nye repositories følger.

## familyId

Ett sted i koden vet hvilken husstand som er aktiv:
`src/hooks/useFamilyId.ts`. I dag resolver den alltid til `"familie1"` — ingen
UI, ingen husstandsvelger, ingen multi-tenant-funksjonalitet. Poenget er
utelukkende at det er ÉTT sted å endre senere, ikke et hardkodet strengverdi
spredt over dusinvis av filer slik `FAM = "families/familie1"` er i dagens
`index.html`.

## Firebase security rules

Versjonert i [`../../infra/firebase/database.rules.json`](../../infra/firebase/database.rules.json),
deployes via `firebase deploy --only database` (manuelt inntil videre — ikke
en del av noen automatisk CI-pipeline, se ADR 0001). Modellen er
medlemskapsbasert: `families/{familyId}/members/{uid}` avgjør tilgang, ikke
custom claims. **Ikke deployet til produksjon ennå** — se ADR 0001 for
overgangsplanen (medlemslisten må verifiseres først).

## Testlag

| Lag | Verktøy | Kjøres mot | Kommando |
|---|---|---|---|
| Domene/motor | Vitest | Ingenting (rene funksjoner) | `npm test` |
| Komponent | Vitest + React Testing Library | jsdom | `npm test` |
| Datalag/integrasjon | Vitest | Firebase Emulator Suite | `npm run test:integration` |
| E2E/smoke | Playwright | Emulator-bygget app | `npm run test:e2e` |

Automatiserte tester rører **aldri** en Hosting-forhåndsvisning eller
produksjon — kun den lokale emulatoren. Se ADR 0001 for resonnementet.

## Hosting og deploy

- **Produksjon:** Firebase Hosting, `web/dist` (se `firebase.json` i repo-roten).
  Ikke i bruk ennå — `index.html` er fortsatt live.
- **Forhåndsvisning:** forespørsel-styrt via `.github/workflows/preview.yml`
  (`workflow_dispatch`, ikke automatisk per push). Bygges med
  `VITE_DEPLOY_TARGET=preview`, som viser et synlig PREVIEW-banner i appen
  (`src/routes/AppLayout.tsx`).
- **CI:** `.github/workflows/ci.yml` — typecheck, lint, format, alle
  testlag, bygg. Påkrevd på PR mot `main`.

## Kjøre lokalt

Se [`../../web/README.md`](../../web/README.md).
