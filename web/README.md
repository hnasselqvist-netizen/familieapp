# Hverdagsflyt — web

Den nye tekniske grunnmuren for Hverdagsflyt (React + Vite + TypeScript +
Firebase). Se [`../docs/arkitektur/oversikt.md`](../docs/arkitektur/oversikt.md)
for arkitekturen og [`../README.md`](../README.md) for hvordan dette forholder
seg til dagens produksjonsapp (`../index.html`).

## Forutsetninger

- Node 22 (se `.nvmrc`) — `nvm use`
- Java 11+ (kun for Firebase Realtime Database-emulatoren)

## Kom i gang

```bash
npm install
cp .env.example .env.local   # valgfritt — standardverdiene bruker emulatoren
npm run dev
```

Appen kjører som standard mot **Firebase Emulator Suite**, ikke mot
produksjonsdata. Start emulatoren i et eget terminalvindu før du logger inn
lokalt:

```bash
npm run emulators
```

## Vanlige kommandoer

| Kommando                          | Hva den gjør                                                |
| --------------------------------- | ----------------------------------------------------------- |
| `npm run dev`                     | Utviklingsserver med hot reload                             |
| `npm run build`                   | Produksjonsbygg (`tsc -b && vite build`)                    |
| `npm run typecheck`               | TypeScript, ingen emit                                      |
| `npm run lint`                    | ESLint, inkludert modulgrense-håndheving                    |
| `npm run format` / `format:check` | Prettier                                                    |
| `npm test`                        | Domene- og komponenttester (Vitest, ingen Firebase)         |
| `npm run test:integration`        | Datalag-tester mot en ekte, lokal Firebase Emulator         |
| `npm run test:e2e`                | Playwright-smoke mot en emulator-bygget app                 |
| `npm run emulators`               | Starter Firebase Emulator Suite (RTDB + Auth + UI på :4000) |

`test:integration` og `test:e2e` starter og stopper emulatoren selv
(`firebase emulators:exec`) — de trenger ikke `npm run emulators` kjørende
ved siden av.

## Modulgrenser

`src/domain/**`, `src/generators/**`, `src/data/**`, `src/hooks/**` og
`src/features/**` har hver sitt ansvar, håndhevet av `eslint.config.js` — se
[`../docs/arkitektur/oversikt.md`](../docs/arkitektur/oversikt.md) for
detaljene. `npm run lint` feiler på et brudd.

## Miljøvariabler

Se `.env.example`. `.env.test` er commitet med vilje — det inneholder kun
"demo-"-prosjekt-verdier for Firebase Emulator Suite (en Firebase-dokumentert
konvensjon, ingen hemmeligheter). Ekte produksjonsverdier settes kun som
GitHub Actions-secrets (se `.github/workflows/preview.yml`) og aldri
committes.

## Kjent miljøkvirk (kun i proxy-sandkasser)

`firebase-tools` sin `emulators:exec`/`emulators:start` sender lokale
loopback-kall (til sin egen emulator på `127.0.0.1`) gjennom `HTTPS_PROXY`
uten å respektere `NO_PROXY`. I et miljø med en organisasjonshåndhevet
utgående proxy (som denne økten kjørte i) feiler dette med en kryptisk
`Unable to parse JSON`-feil ved oppstart av regel-lasting. Løsning i et slikt
miljø: kjør emulator-kommandoene med `HTTPS_PROXY`/`https_proxy` eksplisitt
unsatt for akkurat den prosessen — vanlig CI (GitHub Actions) har ingen
`HTTPS_PROXY` satt i utgangspunktet og trenger ikke denne workaroundet.
