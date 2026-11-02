# Kvitteringer C: beskrivende varelinjer

**Status:** implementert etter #59 6569368020. Utgangspunktet er kartlegging 6541086349 §3/§6. Den gamle Storage/claims-delen gjelder ikke.

Varelinjene er **bare beskrivelse**. Økonomien går fortsatt splits → hendelse. Ingen økonomifunksjon leser varelinjene, og varelinjene skriver aldri budsjett, hendelser, transaksjoner, regler, læring eller varebase. Butikk, dato og total er fortsatt kvitteringens egne felt.

## Kontrakt (`web/src/types/forsoning.ts`)

På `KvitteringRecord`:

```ts
varelinjer?: Varelinje[];       // valgfri; gamle kvitteringer trenger ingen
varelinjerVersjon?: number;     // øker ved hver varelinjelagring (versjonsvakt)
varelinjerSkrivId?: string;     // innholdsbasert id for idempotent retry
varelinjerOppdatert?: string;

interface Varelinje {
  id: string;                   // stabil, uavhengig av rekkefølge og arrayform
  art: "vare" | "pant" | "retur" | "justering";
  tekst: string;
  originaltekst?: string;       // teksten slik den står på kvitteringen
  mengde?: number;              // f.eks. 2 eller 0.452
  enhet?: string;
  enhetsprisOre?: number;       // ≥ 0
  belopOre?: number;            // linjebeløp FØR rabatt, med fortegn
  rabattOre?: number;           // ≥ 0, trekkes fra én gang
  itemId?: string;              // fremtidig kobling; opprettes ikke her
}
```

- **Penger** lagres i heltallsøre. Netto for en linje er `belopOre − (rabattOre ?? 0)`, så rabatten trekkes nøyaktig én gang.
- **Manglende felt** betyr «ikke oppgitt», aldri 0. En linje uten `belopOre` er ufullstendig og telles ikke i summen. Ekte 0 lagres som 0.
- **Pant, retur og justering** har fortegn i `belopOre`, for eksempel pantelapp −3,00. De summeres for seg og regnes ikke som varer eller ordinært forbruk.
- **Advarsler** stopper aldri lagring. De gjelder linjer uten beløp, avvik mellom linjesummen og `total`, og mengde × enhetspris som ikke stemmer med linjebeløpet.

## Skriving

- **Bare egne felt:** `lagreVarelinjer` (`web/src/domain/forsoning/varelinjer.ts`) er en ren updater mot fersk `receipts`, i én helnode-transaksjon som de andre forsoningsskriverne. Bare `varelinjer*` på riktig kvittering endres. Alle andre felt og kvitteringer står urørt: splits og eiere, matching, koblinger, bilde, Drive, vedlegg og ukjente felt.
- **Versjonsvakt:** avviker `varelinjerVersjon` fra versjonen brukeren startet fra, gir det konflikt, og ingenting endres. Samme lagring på nytt gir «allerede».
- **Ukjente felt på linjer** bevares per stabil `id`. Kjente felt som fjernes i skjemaet, slettes.
- **Ugyldige verdier:** `null`, NaN, negativ rabatt og duplikat-id avvises før transaksjonen.
- **Andre editorer:** `oppdaterKvittering`, økonomisk redigering forberedt fra et eldre øyeblikksbilde, tar alltid varelinjene fra den ferske kvitteringen, slik den allerede gjør med vedlegg. Bakgrunnsforslag og kobling sprer den ferske kvitteringen og bevarer dem.
- **Kontrollgrunnlaget** (kvalitetssikret) bruker en hviteliste av felt og påvirkes ikke av varelinjer.

## UI

Varelinjene ligger i kvitteringsvinduet i `/forvaltning/kvitteringer`, under fordelingen. De har eget utkast og egen «Lagre varelinjer», og teksten sier at de ikke påvirker økonomien.

- **Ferdig behandlede kvitteringer** kan åpnes fra «Vis ferdig behandlede». Der kan bare varelinjene redigeres.
- **Utkastet bevares** ved feil og konflikt, og ved levende endring fra en annen enhet. En lagring fra en annen enhet tas bare inn når brukeren ikke har ulagrede endringer. Ved konflikt kan brukeren lagre sin versjon likevel eller forkaste sin.
- **Vinduet lukkes ikke** hvis kvitteringen blir ferdig koblet eller forkastet andre steder.
- **Lukkevern:** ingen vei ut av vinduet kaster et ulagret varelinjeutkast eller en pågående varelinjelagring stille. Det gjelder «Lagre endringer» og «Forkast» på kvitteringen, Lukk, ✕ og bakgrunnen. Kvitteringen lagres eller forkastes som valgt, men vinduet blir stående med utkastet og et eksplisitt valg: lagre varelinjene eller «Forkast varelinjene og lukk». Mens en varelinjelagring pågår, kan vinduet ikke lukkes. Varelinjer lagres aldri som bieffekt av den økonomiske lagringen.
