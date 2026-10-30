/**
 * Versjonen av en datanode: en serverberegnet digest av den kanoniske
 * formen. `data_hent` returnerer den sammen med verdien fra ÉN `get()`
 * (samme snapshot), og `data_skriv` sammenligner den inne i transaksjonen
 * med det klienten så. Samme rene funksjon brukes begge steder, så
 * versjonen fra lesingen og fra transaksjonen er sammenlignbare.
 *
 * Kanonisk form = RTDB-ens lagringsform:
 *  - `null`/`undefined` og tomme objekter finnes ikke (RTDB lagrer dem ikke);
 *  - arrays er objekter med indeksnøkler (RTDB lagrer dem slik, og `val()`
 *    gir array eller objekt avhengig av nøklene — begge gir samme versjon);
 *  - objektnøkler sorteres (kodepunktorden), og JSON skiller streng, tall
 *    og boolsk (`"1"` ≠ `1` ≠ `true`);
 *  - prioriteter er ikke med: både lesingen og transaksjonen bruker `val()`,
 *    og appen bruker ingen prioriteter.
 *
 * `_mcp` på familieroten (MCP-ens egen kvitteringslogg) er ikke familiedata
 * og er aldri med i rotens versjon — ellers ville rotversjonen i en
 * kvittering avhenge av kvitteringen selv. Se `skriving.ts` §Beskyttede felt.
 *
 * Ren: ingen I/O.
 */
import { createHash } from "node:crypto";

/** Versjonen av en node som ikke finnes. */
export const MANGLER = "mangler";

/** Rotens interne nøkkel (MCP-kvitteringer) — aldri del av familiedataene. */
export const MCP_NOKKEL = "_mcp";

const erObjekt = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * RTDB-ens lagringsform som et nytt tre (aldri delt med inndata): arrays →
 * indeksobjekter, `null`/`undefined`/tomme noder borte. Objektene bygges
 * med egne egenskaper (`defineProperty`), så en nøkkel som `__proto__` i
 * eksisterende data aldri blir en prototype-endring. `undefined` = finnes ikke.
 */
export function lagringsform(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const ut: Record<string, unknown> = {};
    v.forEach((x, i) => {
      const s = lagringsform(x);
      if (s !== undefined) settEgen(ut, String(i), s);
    });
    return Object.keys(ut).length > 0 ? ut : undefined;
  }
  if (erObjekt(v)) {
    const ut: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      const s = lagringsform(v[k]);
      if (s !== undefined) settEgen(ut, k, s);
    }
    return Object.keys(ut).length > 0 ? ut : undefined;
  }
  return v;
}

/** Egen, tellbar egenskap — også for `__proto__` (aldri prototype-setteren). */
export function settEgen(o: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

/** Deterministisk JSON (sorterte nøkler) — også fingeravtrykket i `skriving.ts`. */
export function kanoniskJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => kanoniskJson(x ?? null)).join(",")}]`;
  if (erObjekt(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${kanoniskJson(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * Versjonen av en verdi slik `val()` gir den. `rot: true` for familieroten:
 * da er `_mcp` ikke med.
 */
export function versjonAv(verdi: unknown, valg: { rot?: boolean } = {}): string {
  const lagret = lagringsform(valg.rot ? utenMcp(verdi) : verdi);
  if (lagret === undefined) return MANGLER;
  return `v1-${createHash("sha256").update(kanoniskJson(lagret)).digest("hex").slice(0, 32)}`;
}

/** Familieroten uten `_mcp` (ny grunn kopi; andre verdier urørt). */
export function utenMcp(rot: unknown): unknown {
  if (!erObjekt(rot) || !(MCP_NOKKEL in rot)) return rot;
  const ut: Record<string, unknown> = {};
  for (const k of Object.keys(rot)) if (k !== MCP_NOKKEL) settEgen(ut, k, rot[k]);
  return ut;
}
