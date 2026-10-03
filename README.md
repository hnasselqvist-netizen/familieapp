# Hverdagsflyt (familieapp)

Middagsplan, kokebok, handleliste og økonomi for familien.

## To kodebaser, midlertidig

Repoet inneholder to ting mens vi migrerer:

- **`index.html`** (repo-roten) — dagens produksjonsapp. Alt brukere faktisk
  ser i dag. Ingen byggverktøy; én stor fil, transpilert i nettleseren.
  Fortsatt fasiten for "riktig oppførsel" til hver del er migrert og
  verifisert — se `docs/beslutninger/0001-ny-teknisk-grunnmur.md`.
- **`web/`** — den nye tekniske grunnmuren (React + Vite + TypeScript +
  Firebase). Under oppbygning modul for modul. Se `web/README.md` for
  hvordan den kjøres lokalt.

Ingen produksjons-URL peker på `web/` ennå.

I tillegg: **`mcp-server/`** — Kontrolltårnets MCP-kontrollflate mot
Hverdagsflyt-data (Issue #27). Foundation, ikke deployet — se
[`mcp-server/README.md`](mcp-server/README.md).

## Dokumentasjon

**[Utviklingskart](docs/utviklingskart.md)** — visuell status fra GitHub, med
Nå / Neste / Venter på. Åpnes på `/utviklingskart/` i lokal kjøring eller en
Hosting-preview som inneholder kartet. Ingen Firebase eller ekstra innlogging.

| Hva | Hvor |
|---|---|
| Produktvisjon, UX-prinsipper, domenemodell (Motor/Generator/Kontrollpanel) | [`docs/produktfasit/designbok.md`](docs/produktfasit/designbok.md) |
| Teknisk arkitektur (stack, lagmodell, datamodell) | [`docs/arkitektur/oversikt.md`](docs/arkitektur/oversikt.md) |
| Arkitekturbeslutninger og hvorfor | [`docs/beslutninger/`](docs/beslutninger/) |
| Roadmap og backlog | [`docs/roadmap.md`](docs/roadmap.md) |
| Instruksjoner for Claude Code i dette repoet | [`CLAUDE.md`](CLAUDE.md) |

## Roller

Helen er produkteier. Kontrolltårnet (ChatGPT) er prosjektleder,
systemarkitekt og overordnet QA. Claude er teknisk implementatør, og
arbeider direkte mot GitHub via Claude Code — se `CLAUDE.md`.
