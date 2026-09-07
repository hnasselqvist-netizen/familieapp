# Roadmap & backlog

> Flyttet ut av `designbok.md` som del av Fase 0-grunnmuren (§dokumentasjonsprinsippet,
> `docs/beslutninger/0001-ny-teknisk-grunnmur.md`) — designbok.md er nå kun
> produktfasit (visjon, prinsipper, domenemodell), ikke roadmap/backlog i tillegg.
> Innholdet under er for øvrig flyttet **verbatim**, ikke oppdatert eller
> kvalitetssikret utover det — det er et produktansvar for Helen/Kontrolltårnet,
> ikke noe Fase 0 (teknisk grunnmur) har tatt stilling til.
>
> **Én rettelse er gjort, av Kontrolltårnet før merge:** de to punktene om
> "Vercel for automatisk deploy fra GitHub" er fjernet fra «Neste» og
> «Backlog» — de var utdaterte i det øyeblikket denne runden låste
> **Firebase Hosting** som målarkitektur (§`docs/beslutninger/0001-ny-teknisk-grunnmur.md`),
> og skulle ikke stå som et fremtidig, planlagt punkt i motstrid med en
> allerede låst beslutning. Automatisert deploy fra GitHub er nå dekket av
> `.github/workflows/ci.yml`/`preview.yml`, ikke noe som gjenstår som
> uavklart roadmap-arbeid.

---

## 4. Roadmap

### Levert (Juli 2026)

- Motor v1: `calcSpillerom` — ren funksjon, testet og låst
- Generator v1: produserer prognoseposter fra budsjett og inntekter
- Kostnader: gruppebasert, budsjett + faktisk, metadata, InlineNum
- Inntekter: søstermodul til Kostnader, identisk struktur, `incomeGroups`-path
- Generator-senter: kontrollpanel med samlet tabell, filtre og modal-redigering
- Disponibelt nå: inline redigering av saldo direkte fra dashboardet

### Neste

- Generator v2: automatisk kjøring basert på forfallsdag (forutsetter at forfallsdag er satt i Generator-senteret for alle automatiske poster)
- Årsbudsjett-visning (alle 12 måneder samtidig)
- Middagsforslag basert på historikk

### Senere

- Transaksjonsimport fra DNB og SpareBank 1
- Statistikk og trender i økonomimodulen
- Familiemedlemmer («hvem likte den»)
- Kvitteringslagring (Google Drive)
- Lager: kjøleskap og tørrvarer (fryser er første steg)
- OCR fra bilde i kokebok

---

## 5. Backlog

- Familimedlem-oppsett for «hvem likte den»
- Årsbudsjett-visning (alle 12 måneder samtidig)
- Transaksjonsimport DNB (CSV-format dokumentert)
- Transaksjonsimport SpareBank 1 (CSV-format dokumentert)
- Regelmotor for kategorisering av transaksjoner
- Splitt av enkeltransaksjon på flere kategorier
- Duplikatsjekk ved import (dato ±2 dager + beløp)
- Statistikk: månedlig forbruk mot budsjett
- Statistikk: sammenligning mot samme periode fjoråret
- Automatisk nedtelling i fryser ved bekreftelse av middag
- Kjøleskap og tørrvarer som egne lagerlister
- OCR fra bilde i kokebok (krever Cloud Vision eller lignende)
- «Merk som basisvare» direkte fra handlelisten (ikke bare via generator)
- Forhåndsdefinerte menyer i kokeboken (Alternativ B)

---

_Opprinnelig sist oppdatert: Juli 2026 — versjon 1.2 (av designbok.md, før utflytting)_
