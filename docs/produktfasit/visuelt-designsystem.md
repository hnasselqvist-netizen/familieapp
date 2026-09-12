# Hverdagsflyt — Visuelt designsystem

> Autoritativ kilde for visuell utforming i Hverdagsflyt (`web/`).
> Samler prinsipper som tidligere lå spredt mellom produktfasit,
> produksjons-Gangen (`index.html`) og tidligere designarbeid, til ÉN
> kilde (§Kontrolltårn-handoff, Issue #20, PR #26-review: "Etabler én
> autoritativ visuell fasit i repoet først").
>
> For produktvisjon, domenemodell og låste produktbeslutninger, se
> [`designbok.md`](designbok.md) — dette dokumentet dekker KUN visuell
> utforming (farger, typografi, rytme, materialer, komponentuttrykk),
> ikke hva appen gjør.

## 1. Designfilosofi

- Hverdagsflyt er et hjem med rom.
- Rommet kommer før funksjonen.
- Første følelsen skal være: **«Her var det godt å komme inn.»**
- Skjermen viser det brukeren ønsker å ta en beslutning om akkurat nå.
- Systemet gjør forarbeidet og bærer overgangene.
- UI-et viser overleveringer og neste naturlige valg.
- Språket inviterer og støtter.
- Historikk ligger dypere i rommene og brukes som inspirasjon og læring.
- Hvert rom har én tydelig gave/oppgave.
- Materialer, typografi, rytme og ikonfamilie gjør at alle rom oppleves som samme hjem.

## 2. Fargefamilie

`--g-*` er den semantiske tokenfamilien for Hverdagsflyt-rommene
(`web/src/styles/tokens.css`) — bevisst adskilt fra kjernepaletten
(`--color-*`) som resten av appen (Forvaltning, Verktøy) fortsatt
bruker. Siste godkjente kalibrering fra produksjons-Gangen, bekreftet
av Helen via Kontrolltårn-review på PR #26:

| Token | Hex | Bruk |
|---|---|---|
| `--g-bg` | `#ECDFC8` | Rombakgrunn |
| `--g-green` | `#5E7457` | Primær grønn — aktiv tilstand, primærhandling, positiv markering |
| `--g-green-soft` | `#AEB287` | Myk grønn |
| `--g-terracotta` | `#D7A18B` | Terrakotta — aksent, destruktiv handling |
| `--g-text` | `#3B352F` | Primær tekst |
| `--g-text-soft` | `#7E7468` | Sekundær tekst |
| `--g-line` | `#CDC5B5` | Strukturelle linjer/kanter |
| `--g-furniture` | `#EEE0CD` | Varm møbelflate — uke-/repertoar-/kortflater |
| `--g-accent-soft` | `#E8CDBD` | Myk ikon-/aksentflate — sirkulære ikonbakgrunner |
| `--g-calm` | `#D9D5B8` | Rolig grønn materialflate (f.eks. "Vi ordner") |
| `--g-divider` | `#E3D7BE` | Lys materialskillelinje INNI en `--g-calm`-flate — IKKE samme som strukturell `--g-line` |

`--color-clay*` (destruktivt) og `--color-olive*` (fremdrift/suksess)
fra kjernepaletten er bevisst IKKE erstattet med `--g-*`-ekvivalenter —
de er semantiske farger, ikke merkevareidentitet, og brukes fortsatt
der de allerede var etablert (§tidligere Kjøkken-harmoniseringsskiver).

## 3. Typografi

`Instrument Sans` er UI- og display-font i Hverdagsflyt. `Allura`
brukes KUN til den håndskrevne, emosjonelle aksenten (Gangens
avsluttende hilsen). Begge lastes faktisk inn i `web/index.html` via
Google Fonts — samme oppsett som produksjonens `index.html`
(`Instrument+Sans:wght@400;500;600&family=Allura`). `--font-ui` og
`--font-display` er begge satt til `"Instrument Sans", sans-serif`
(`web/src/styles/tokens.css`).

| Nivå | Størrelse/vekt | Bruk |
|---|---|---|
| H1 | 28px / 600 | Romskjermens hovedtittel (`RoomHeader` sin tittel) |
| H2 | 20px / 600 | Seksjonstittel inni en skjerm |
| H3 | 16px / 500 | Undertittel |
| Brødtekst | 15px / 400 | Hovedinnhold i rader/kort |
| Sekundærtekst | 14px / 400 | Metadata, støtteinformasjon |
| Eyebrow/romlabel | 12px / 600, uppercase, `0.16em` letter-spacing | Romidentitet over en tittel (f.eks. `KJØKKEN`) |
| Støtteetikett/fanetekst | 12–13px | Fanetekst, små etiketter |

**Godkjente hero-unntak** (Gangen, ikke generalisert til andre rom):
- Gangens hilsen: `37px / 400`, line-height `1.06`
- Gangens dato: `14px`, italic
- Gangens håndskrift: `Allura 28px`

## 4. Rytme og materialer

- Grunnrytme: `6 / 12 / 20 / 32px` (`--g-space-xs/sm/md/lg` i `tokens.css`)
- Store rom-/møbelflater: radius `18–22px` (`--g-radius-lg: 22px`)
- Mellomstore flater: radius `14px` (`--g-radius-md: 14px`)
- Kontroller: radius `8–12px` (`--radius-sm`/`--radius-md` fra kjernepaletten)
- Møbelskygge: `0 2px 8px rgba(59,53,47,.05)`
- Små løft: `0 1px 3px rgba(59,53,47,.04)`
- Hierarki skapes primært med luft, typografi, størrelse, rytme, plassering og materialtone — ikke med sterke fargekontraster
- Relaterte rader samles i ÉTT møbel med innrykkede skillelinjer (marginert `border-bottom`, ikke full bredde) — se `GangenScreen`s "Det viktigste for deg nå" og `PlanScreen`s uke-møbel for referanseimplementering
- Selvstendige objekter kan få egen flate
- Rommets bakgrunn og møblene leses som beslektede materialer, aldri sterke, konkurrerende kontraster

## 5. Komponentuttrykk

- **Primær handling:** grønn (`--g-green`), varm og tydelig, minimum ca. 44px berøringshøyde
- **Sekundær handling:** lys varm materialflate (`--g-bg`/`--g-furniture`), grønn/mørk tekst, rolig kant (`--g-line`)
- **Destruktiv handling:** terrakotta/leire-familie (`--g-terracotta` eller `--color-clay*` der destruktiv semantikk allerede er etablert)
- **Input:** varm lys flate, 16px tekst på mobil (unngår iOS-auto-zoom), rolig kant, grønn fokusmarkering
- **Dialog/bottom sheet:** romslig, varm materialflate, H2-tittel, 15px brødtekst, tydelig handlingsområde
- **Ikoner:** Lucide via CSS-maske/`currentColor` (`Icon`-komponenten); rom-/seksjonsidentitet kan bruke myke sirkulære ikonflater (`--g-accent-soft`) slik Gangen gjør
- **Illustrasjoner:** håndlaget, varm nordisk/malt karakter; dekorasjon bygger atmosfære og ligger utenfor informasjonsflyten (`aria-hidden`, `pointer-events:none`)

## 6. Delte atomer

Disse komponentene (`web/src/components/`) er de konkrete byggeklossene
resten av Hverdagsflyt komponerer med. Se hver komponents egen
toppkommentar for implementeringsdetaljer.

- **`RoomHeader`** — romheaderen: eyebrow (romfarge, 12px/600/0.16em) → H1-tittel (28px/600, Instrument Sans) → valgfri beskrivelse (15px/400) → valgfri handlingsrad. Mobilkomposisjon: handlingsraden får egen, rolig rad under tittel/beskrivelse når den ikke får plass ved siden av (`flex-wrap`).
- **`Button`** — `primary` (grønn), `secondary` (varm materialflate), `destructive` (terrakotta/leire). Minimum ca. 44px berøringshøyde.
- **`Card`** — standard Hverdagsflyt-møbel: varm overflate, `--g-line`-kant, stor myk radius, diskret skygge. Andre semantiske flater (f.eks. et nøytralt admin-kort) velges eksplisitt via variant, ikke som standard.
- **`Modal`** — samme materialspråk som resten av rommet: åpning av en arbeidsflate skal oppleves som samme rom, ikke en ny stil.

## 7. Kjøkkenet (Mat)

Mat er **Kjøkkenet** — ett av Hverdagsflyts rom, med `KJØKKEN` som
romlabel/eyebrow på alle fem flater (Middagsplan/Middagsbibliotek/
Kokebok/Handleliste/Fryser). Kjøkkenet er varmere og mer arbeidsrettet
enn Gangen; Handlelisten er den mest operative flaten av de fem — se
`designbok.md` §"Hverdagsflyt og Verktøy" for hvorfor tetthetsgradienten
finnes.

Den interne Kjøkken-navigasjonen (`MatLayout`) leses som en lavmælt
arbeidsbenk/hylle i rommet: fem like store berøringsmål, Lucide-ikon
ca. 20px + 12px-label, samme rombakgrunn/materialfamilie som resten av
Kjøkkenet, grønn aktiv-markering med en myk, organisk aktivmarkør,
minimal vertikal plass slik at innholdet forblir hovedpersonen.

## 8. Visuell QA

Enhver skive som endrer visuelt uttrykk i Hverdagsflyt-rommene skal
verifiseres med skjermbilder ved ~390px bredde av samtlige berørte
skjermer, vurdert som ÉN sekvens (ikke isolerte enkeltskjermer) —
reviewkriteriet er at de ved første blikk oppleves som **samme hjem**,
med riktig tetthetsgradient mellom rommene.
