/**
 * Gangen som dagens ene inngang (#59, Kontrolltårnet 2026-10-07, retning 1).
 *
 * Gangen skal svare på «Er det noe jeg trenger å ta meg av nå?» og gjøre
 * overgangene mellom rommene. Rene funksjoner: mottar allerede hentede
 * og resolverte data, returnerer hvilke punkter Gangen viser og i hvilken
 * rekkefølge. Ingen Firebase, ingen ruter, ingen tekstformatering utover
 * det punktene selv bærer.
 *
 * **Låst produktvalg C (Helen, 2026-10-07):** ingen økonomi i Gangen
 * utover køene som venter. Spillerom-status og beløp hører hjemme i
 * Forvaltning, og fravær av økonomisignal når alt er i orden er en del av
 * roen. Derfor tar denne modulen ikke inn likviditetsdata i det hele tatt.
 *
 * Rekkefølgen er tidsfølsomhet: middagen i dag kan ikke vente, køene kan.
 * «Middagen er ikke planlagt» og «varer til middagen» utelukker hverandre,
 * så med dagens fire punkttyper når listen aldri over `MAKS_PUNKTER`.
 * Grensen er likevel håndhevet her, så et nytt punkt ikke kan gjøre Gangen
 * til et dashbord.
 */

export const MAKS_PUNKTER = 3;

/** En ingrediens slik middagen faktisk løses (oppskrift, variant eller handlegrunnlag). */
export interface MiddagsIngrediens {
  itemId?: string | null;
  name: string;
}

/** En planlagt middag: visningsnavn og ingrediensene den løses til (tom for hendelser). */
export interface Middag {
  navn: string;
  ingredienser: MiddagsIngrediens[];
}

export interface HandlelisteVare {
  itemId: string | null;
  name: string;
  done: boolean;
}

export interface FryserVare {
  itemId: string;
  name: string;
  /** Summen av alle batchers antall. */
  antall: number;
}

export interface GangenGrunnlag {
  /** Transaksjoner brukeren må ta stilling til (vurdering + forslag, se `tellTrengerVurdering`). */
  trengerVurdering: number;
  /** Av `trengerVurdering`: de som er forslag til match (`foresoatt_match`). */
  forslagTilMatch: number;
  kvitteringerKlareForKobling: number;
  /** `null` = ingen middag planlagt i dag. */
  middagIDag: Middag | null;
  middagIMorgen: Middag | null;
  handleliste: HandlelisteVare[];
  fryser: FryserVare[];
}

export type GangenPunkt =
  | { art: "middag-uplanlagt" }
  | { art: "middag-handle"; middag: string; antall: number }
  | { art: "transaksjoner"; antall: number; ko: "vurdering" | "forslag" }
  | { art: "kvitteringer"; antall: number };

const norm = (s: string) => s.trim().toLowerCase();

function samme(a: { itemId?: string | null; name: string }, b: MiddagsIngrediens): boolean {
  if (a.itemId && b.itemId) return a.itemId === b.itemId;
  return norm(a.name) === norm(b.name);
}

/**
 * Varene på handlelisten som ikke er kjøpt ennå og som inngår i middagen.
 * Handlelisten lagrer ikke hvilken middag en vare kom fra, så koblingen er
 * på vare-ID (samme identitet som Kokebok og Fryser bruker), med navn som
 * reserve for fritekstvarer. Utsagnet «står på handlelisten» er sant
 * uansett hvorfor varen ble lagt dit.
 */
export function middagsvarerPaHandlelisten(
  middag: Middag,
  handleliste: readonly HandlelisteVare[],
): HandlelisteVare[] {
  return handleliste.filter((v) => !v.done && middag.ingredienser.some((i) => samme(v, i)));
}

/**
 * Fryservarer som hører til middagen: en ingrediens som ligger i fryseren,
 * eller en hel rett med samme navn som middagen (f.eks. en frossen
 * lasagne). Bare varer med noe igjen (`antall > 0`) teller.
 */
export function middagsvarerIFryseren(middag: Middag, fryser: readonly FryserVare[]): FryserVare[] {
  return fryser.filter(
    (f) =>
      f.antall > 0 &&
      (norm(f.name) === norm(middag.navn) || middag.ingredienser.some((i) => samme(f, i))),
  );
}

export function dagensPunkter(g: GangenGrunnlag): GangenPunkt[] {
  const punkter: GangenPunkt[] = [];

  if (!g.middagIDag) {
    punkter.push({ art: "middag-uplanlagt" });
  } else {
    const mangler = middagsvarerPaHandlelisten(g.middagIDag, g.handleliste);
    if (mangler.length > 0) {
      punkter.push({ art: "middag-handle", middag: g.middagIDag.navn, antall: mangler.length });
    }
  }

  if (g.trengerVurdering > 0) {
    const iVurdering = g.trengerVurdering - g.forslagTilMatch;
    punkter.push({
      art: "transaksjoner",
      antall: g.trengerVurdering,
      ko: iVurdering > 0 ? "vurdering" : "forslag",
    });
  }

  if (g.kvitteringerKlareForKobling > 0) {
    punkter.push({ art: "kvitteringer", antall: g.kvitteringerKlareForKobling });
  }

  return punkter.slice(0, MAKS_PUNKTER);
}

/**
 * «Vi ordner»: det appen allerede har forberedt. Ingen handling kreves,
 * så ingen lenker. Morgendagens middag nevnes bare når noe av den ligger
 * i fryseren. Da er linjen en forberedelse (ta den opp i kveld), ikke en
 * oppgave Gangen holder fast i.
 */
export function viOrdner(g: GangenGrunnlag): string[] {
  const linjer: string[] = [];
  if (g.middagIDag) linjer.push(`I dag: ${g.middagIDag.navn}.`);

  if (g.middagIMorgen) {
    const frosne = middagsvarerIFryseren(g.middagIMorgen, g.fryser);
    if (frosne.length > 0) {
      const helRett = frosne.some((f) => norm(f.name) === norm(g.middagIMorgen!.navn));
      linjer.push(
        helRett
          ? `I morgen: ${g.middagIMorgen.navn}. Den ligger i fryseren.`
          : `I morgen: ${g.middagIMorgen.navn}. ${listeTekst(frosne.map((f) => f.name))} ligger i fryseren.`,
      );
    }
  }

  if (g.handleliste.length > 0 && g.handleliste.every((v) => v.done)) {
    linjer.push("Handlelisten er klar.");
  }
  if (g.trengerVurdering === 0) linjer.push("Ingen nye vurderinger venter.");
  return linjer;
}

/** «A», «A og B», «A, B og C» — med stor forbokstav, siden den starter en setning. */
function listeTekst(navn: string[]): string {
  const unike = [...new Set(navn)];
  const tekst =
    unike.length <= 1
      ? (unike[0] ?? "")
      : `${unike.slice(0, -1).join(", ")} og ${unike[unike.length - 1]}`;
  return tekst.charAt(0).toUpperCase() + tekst.slice(1);
}
