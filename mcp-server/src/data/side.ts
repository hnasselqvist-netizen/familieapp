/**
 * Sidedeling for full lesing — ren, uten I/O. Ingenting kuttes bort: et barn
 * som er for stort for én side, rapporteres med størrelse og leses videre på
 * sin egen sti, og en lang tekst leses i deler med `fraTegn`. Alle felt og
 * all historikk kan dermed nås, uansett hvor stor noden er.
 */
import { rtdbNokkelOrden } from "./sti";

export type Primitiv = string | number | boolean;

/** Det adapteren leser for én sti: `antall + 1` barn, så vi vet om det finnes mer. */
export interface LestSide {
  finnes: boolean;
  /** Satt når noden er en primitiv verdi (ingen barn). */
  verdi?: Primitiv;
  /** Barn i RTDB-nøkkelorden, etter markøren. */
  barn: [string, unknown][];
}

export interface ForStor {
  bytes: number;
  type: "node" | "tekst";
  /** For `node`: antall direkte barn. */
  antallBarn?: number;
  /** For `tekst`: lengde i tegn. */
  lengde?: number;
}

export type Barn = { nokkel: string; verdi: unknown } | { nokkel: string; forStor: ForStor };

export interface DataSide {
  type: "mangler" | "verdi" | "tekstdel" | "node";
  verdi?: Primitiv;
  /** `tekstdel`: hele tekstens lengde, startposisjon, delen og neste startposisjon. */
  lengde?: number;
  fraTegn?: number;
  del?: string;
  nesteFraTegn?: number | null;
  /** `node`: barna på denne siden og markøren til neste side (`null` = siste side). */
  barn?: Barn[];
  neste?: string | null;
}

export const bytesAv = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

function forStor(v: unknown, bytes: number): ForStor {
  if (typeof v === "string") return { bytes, type: "tekst", lengde: v.length };
  return {
    bytes,
    type: "node",
    antallBarn: Array.isArray(v)
      ? v.filter((x) => x !== undefined && x !== null).length
      : Object.keys(v as object).length,
  };
}

/**
 * `antall` barn eller `maksBytes` (det som nås først) per side. Minst ett
 * barn kommer alltid med, så sidedelingen alltid går framover.
 */
export function byggSide(
  lest: LestSide,
  valg: { antall: number; maksBytes: number; fraTegn: number },
): DataSide {
  if (!lest.finnes) return { type: "mangler" };
  if (lest.verdi !== undefined) {
    const v = lest.verdi;
    if (typeof v === "string" && (valg.fraTegn > 0 || bytesAv(v) > valg.maksBytes)) {
      return tekstdel(v, valg.fraTegn, valg.maksBytes);
    }
    return { type: "verdi", verdi: v };
  }

  const barn: Barn[] = [];
  let brukt = 0;
  let neste: string | null = null;
  for (const [i, [nokkel, verdi]] of lest.barn.entries()) {
    if (i >= valg.antall) {
      neste = barn[barn.length - 1]!.nokkel;
      break;
    }
    const bytes = bytesAv(verdi);
    const rad: Barn =
      bytes > valg.maksBytes ? { nokkel, forStor: forStor(verdi, bytes) } : { nokkel, verdi };
    const radBytes = bytesAv(rad);
    if (barn.length > 0 && brukt + radBytes > valg.maksBytes) {
      neste = barn[barn.length - 1]!.nokkel;
      break;
    }
    barn.push(rad);
    brukt += radBytes;
  }
  return { type: "node", barn, neste };
}

/**
 * En del av en lang tekst. Posisjonene er UTF-16-tegn (JavaScripts
 * `string.length`), og et surrogatpar deles aldri.
 */
function tekstdel(v: string, fraTegn: number, maksTegn: number): DataSide {
  const start = Math.min(fraTegn, v.length);
  let slutt = Math.min(start + maksTegn, v.length);
  if (slutt < v.length && slutt > start && /[\uD800-\uDBFF]/.test(v[slutt - 1]!)) slutt -= 1;
  return {
    type: "tekstdel",
    lengde: v.length,
    fraTegn: start,
    del: v.slice(start, slutt),
    nesteFraTegn: slutt < v.length ? slutt : null,
  };
}

/** Grunn nøkkelliste for `data_nokler`, sidedelt med samme markør som `data_les`. */
export function nokkelside(
  nokler: readonly string[],
  etter: string | null,
  antall: number,
): { nokler: string[]; neste: string | null; totalt: number } {
  const sortert = [...nokler].sort(rtdbNokkelOrden);
  const fra = etter === null ? 0 : sortert.findIndex((k) => rtdbNokkelOrden(k, etter) > 0);
  const rest = fra < 0 ? [] : sortert.slice(fra);
  const side = rest.slice(0, antall);
  return {
    nokler: side,
    neste: rest.length > antall ? side[side.length - 1]! : null,
    totalt: sortert.length,
  };
}
