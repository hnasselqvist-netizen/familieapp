# CLAUDE.md

Instruksjoner for Claude Code i dette repoet. Hold denne filen kort og
handlingsorientert — den skal lenke til dokumentasjon, ikke gjenfortelle den.
Se [`README.md`](README.md) for hvordan repoet er organisert.

## Les først

1. [`docs/produktfasit/designbok.md`](docs/produktfasit/designbok.md) — produktvisjon, låste designprinsipper, domenemodell. Les før du bygger ny funksjonalitet.
2. [`docs/produktfasit/visuelt-designsystem.md`](docs/produktfasit/visuelt-designsystem.md) — autoritativ kilde for visuell utforming (farger, typografi, rytme, materialer, komponentuttrykk). Les før du endrer visuelt uttrykk i noe Hverdagsflyt-rom.
3. [`docs/arkitektur/oversikt.md`](docs/arkitektur/oversikt.md) — teknisk stack, lagmodell, datamodell.
4. [`docs/beslutninger/`](docs/beslutninger/) — hvorfor arkitekturen ser ut som den gjør, og hvilke alternativer som ble vurdert.

## To kodebaser under migrering

- `index.html` (repo-roten) = dagens produksjonsapp. Rør den ikke uten et
  eksplisitt oppdrag om det — den er fortsatt fasiten for "riktig
  oppførsel" til en modul er migrert og verifisert.
- `web/` = ny grunnmur (React + Vite + TypeScript + Firebase). Alt nytt
  arbeid skjer her, én modul om gangen, etter mønsteret i
  `docs/arkitektur/oversikt.md`.

Ved migrering av en modul: skriv en karakteriseringstest mot dagens faktiske
oppførsel i `index.html` FØR koden flyttes, flytt så koden, og verifiser
samme test mot den nye versjonen. Se `src/domain/freezer/freezer.test.ts` i
`web/` for et eksempel.

## Kjøre lokalt

Se [`web/README.md`](web/README.md). Kort versjon, fra `web/`:

```bash
npm install
npm run emulators      # eget vindu
npm run dev             # peker mot emulatoren som standard
```

Før du åpner en PR (fra `web/`):

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

`npm run test:integration` og `npm run test:e2e` krever Java (Firebase
Realtime Database-emulatoren) — kjør dem når endringen faktisk berører
datalaget eller en hel brukerflyt, ikke nødvendigvis for hver liten endring.

## Ting som ALDRI endres uten en eksplisitt produktbeslutning

- De låste prinsippene i `docs/produktfasit/designbok.md` (§"Låste
  prinsipper", §"Låste beslutninger" per modul).
- Modulgrensene håndhevet i `web/eslint.config.js` — utvid dem heller enn å
  omgå dem.
- `families/{familyId}`-seamen (`web/src/hooks/useFamilyId.ts`) — ikke bygg
  multi-tenant-UI eller familieroller uten at det er eksplisitt bedt om.
- Firebase security rules (`infra/firebase/database.rules.json`) — deployes
  aldri automatisk. Se `docs/beslutninger/0001-ny-teknisk-grunnmur.md`
  §"Overgang" for hvorfor og hvordan.

## Sikkerhet: preview vs. produksjonsdata

Firebase Hosting-forhåndsvisningskanaler bruker ekte backend-ressurser (samme
database som produksjon). Automatiserte tester skal derfor **aldri** kjøre
mot en preview-URL eller produksjon — kun mot Firebase Emulator Suite (se
`web/README.md`). Ikke legg til noe som endrer dette uten å diskutere det
først — se `docs/beslutninger/0001-ny-teknisk-grunnmur.md`.

## PR-arbeidsflyt

Branch per endring → implementer → `npm run typecheck && npm run lint && npm test && npm run build` lokalt → åpne PR (bruk malen: `.github/pull_request_template.md`) → CI kjører samme sjekker pluss integrasjons-/e2e-tester mot emulatoren → Kontrolltårnet leser diffen. Ikke merge egne PR-er uten eksplisitt beskjed om det.
