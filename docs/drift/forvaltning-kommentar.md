# Arbeidsflyt: kommentar på én manuell økonomisk hendelse (ChatGPT via MCP) — stoppet

Dette er roadmap «Praktisk vedlikehold via ChatGPT» i Forvaltning, bestilt i #59 (6759007909). Oppdraget er å endre bare kommentaren på én eksisterende manuell økonomisk hendelse etter eksplisitt bestilling fra brukeren.

**Status: grenen er stoppet før noe kall beskrives.** `HendelseRecord` har et valgfritt felt `kommentar`, men appen har ingen vei for å endre det etter at hendelsen er laget. Det finnes derfor ingen semantikk å speile for `oppdatert` eller for tømming. For mellomværende-hendelser regenererer appen kommentaren ved neste retting eller angring. ChatGPT skal svare at kommentarer på økonomiske hendelser ikke kan endres herfra ennå, og ikke skrive.

## 1. Hva koden har

Verifisert mot fersk `main` (`48ef744`).

- **Lagring:** `hendelser` er en helnode-array (`web/src/data/forsoningSkriving.repository.ts`). React er eneste skriver etter R3b-cutover (`hooks/forsoningAktivering.ts`). Den skriver alltid hele noden i én transaksjon, og aldri `hendelser/{id}`. Felt appen ikke kjenner, bevares når en hendelse kopieres med spredning.
- **Felt** (`HendelseRecord` i `web/src/types/forsoning.ts`): `kommentar?: string | null`, `kilde?: "manuell"`, `mellomvaerende?` og `opprettet`/`oppdatert`.
- **Hvor `kommentar` skrives.** Bare når en hendelse lages:
  - **Manuell registrering:** `ManuellRegistreringPanel` → `lagreManuellRegistrering` → `byggManuellHendelse` (`domain/forsoning/bankimport.ts` og `fordeling.ts`). Teksten trimmes, og tom tekst blir `null`, som RTDB ikke lagrer.
  - **Mellomværende** (`domain/mellomvaerende/mellomvaerende.ts`): kostnad og oppgjør får en generert kommentar, for eksempel «‹avtale›: oppgjør ‹måned›». Disse hendelsene har også `kilde: "manuell"`.
- **Hvor den vises:** som tekst for en manuell hendelse i budsjettets drilldown (`budsjettfamilie.ts`, ellers «Manuelt registrert»), og i historikkeksporten (`historikkeksport.ts`).
- **Ingen redigering:** ingen skjerm, hook eller domenefunksjon endrer `kommentar` på en eksisterende hendelse. Korrigering (`byggKorrigertHendelse`) beholder kommentaren uendret, endrer fordelinger og status, og setter `oppdatert`.

## 2. Hvorfor grenen stoppes

1. **Det finnes ingen ordinær skrivevei å speile.** Å endre kommentaren er en ny handling, ikke en eksisterende appoperasjon.
2. **Semantikken er ikke avklart.**
   - **`oppdatert`:** alle appendringer av en hendelse setter `oppdatert` til nå. Om en ren kommentarendring skal gjøre det samme, er ikke bestemt.
   - **Tømming:** ved oppretting blir tom tekst et fravær. Ved redigering er det ikke bestemt om tømming skal fjerne nøkkelen eller lagre tom tekst. I drilldown vises «Manuelt registrert» når kommentaren mangler.
3. **Koblet effekt i mellomværende.** Ved retting og angring bygger `settOppgjor` oppgjørshendelsen på nytt, og `kommentar` genereres da på nytt fra avtalen. En kommentar endret via MCP ville blitt overskrevet stille. Dette er karakterisert i `mellomvaerende.test.ts`. Mellomværende-hendelser må derfor uansett holdes utenfor. Felt appen ikke kjenner, forsvant tidligere også. Siden #59 6759853829 bevares de på hendelsen og i `mellomvaerende`-koblingen. Den appstyrte kommentaren regenereres fortsatt.
4. **Kontrollstatus påvirkes ikke, men gir ingen støtte.** «Kvalitetssikret» og «Endret etter kontroll» gjelder transaksjoner (`kvalitetssikring.ts`). En manuell hendelse har ingen transaksjon, og `kommentar` er ikke en del av kontrollgrunnlaget. Dette er altså ingen hindring, men det viser heller ingen etablert semantikk.

**Teknisk** kunne `data_skriv` gjort én `set` på `hendelser/<indeks>` med elementversjonen fra samme `data_hent`. En reindeksering ville gitt `konflikt`, fordi elementet på indeksen da har en annen `id`. Det skal likevel ikke brukes før punkt 2 og 3 er avklart.

Beløp, fordelinger, status, koblinger og regler er ikke rørt av denne leveransen.

## 3. Hva som må til for å åpne grenen (forslag, ikke bestilt)

1. **Produktbeslutning:**
   - Skal en kommentar kunne endres, og hvor i appen?
   - Skal `oppdatert` settes?
   - Hva betyr tømming? Forslaget er at nøkkelen fjernes, som ved oppretting.
   - Mellomværende-hendelser holdes utenfor.
2. **Handlingen i appen,** for eksempel i korrigeringsmodalen: én domenefunksjon som endrer bare `kommentar` (trimmet; tom fjerner nøkkelen) via `transactForsoningNode`, med tester.
3. **Deretter dokumentasjon av kallet,** etter mønsteret i [`fryser-mengde.md`](fryser-mengde.md):
   - les smalt;
   - finn én entydig hendelse med `kilde: "manuell"` og uten `mellomvaerende`;
   - kopier hele råelementet;
   - skriv med elementversjonen;
   - konflikt og retry uten ny automatisk skriving;
   - les tilbake.

Ingenting i denne leveransen endrer appkode, data, verktøy, deploy, IAM eller rules.
