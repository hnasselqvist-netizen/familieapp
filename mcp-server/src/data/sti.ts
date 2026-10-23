/**
 * Stier for full lesing (`data_nokler` / `data_les`). En sti er ALLTID
 * relativ til `families/{familyId}` for familien koblingen gir — familien
 * kommer aldri fra forespørselen, og det finnes ingen måte å nå noe over
 * familienoden (`..`, absolutte stier og `mcp/` er umulige: `.` og `/` i
 * starten avvises, og stien settes alltid sammen under familienoden).
 *
 * Ren: ingen I/O.
 */

/** RTDB-ens grense for nøkkellengde er 768 byte; dybden begrenses for å stoppe misbruk. */
const MAKS_NOKKEL_BYTES = 768;
export const MAKS_DYBDE = 32;

export class UgyldigSti extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UgyldigSti";
  }
}

/**
 * `""` = familienoden selv. Ellers segmenter skilt med `/`. Hvert segment
 * må være en gyldig RTDB-nøkkel: ikke tomt, ingen `. # $ [ ]`, ingen
 * kontrolltegn og maks 768 byte.
 */
export function parseSti(sti: string): string[] {
  if (sti === "") return [];
  const segmenter = sti.split("/");
  if (segmenter.length > MAKS_DYBDE) {
    throw new UgyldigSti(`Stien er dypere enn ${MAKS_DYBDE} nivåer.`);
  }
  for (const s of segmenter) {
    if (s === "") throw new UgyldigSti("Stien har et tomt segment (start, slutt eller «//»).");
    // eslint-disable-next-line no-control-regex
    if (/[.#$[\]\u0000-\u001f\u007f]/.test(s)) {
      throw new UgyldigSti("Et segment inneholder et tegn RTDB ikke tillater i nøkler.");
    }
    if (Buffer.byteLength(s, "utf8") > MAKS_NOKKEL_BYTES) {
      throw new UgyldigSti("Et segment er lengre enn RTDB-ens nøkkelgrense.");
    }
  }
  return segmenter;
}

/** Full RTDB-sti. `familyId` er allerede validert av `authorizeToolCall`. */
export const familieSti = (familyId: string, segmenter: readonly string[]) =>
  [`families/${familyId}`, ...segmenter].join("/");

/**
 * RTDB-ens nøkkelorden (`orderByKey`), som Firebase-SDK-ets `nameCompare`:
 * nøkler som tolkes som 32-biters heltall (ledende nuller og `-0` tillatt)
 * kommer først, numerisk, og ved likt tall den korteste først; deretter
 * resten, leksikografisk. Brukes av in-memory-adapteren og av grunn
 * nøkkellisting, så rekkefølgen og markøren (`etter`) er den samme som
 * serverens spørring gir (verifisert mot emulatoren i kontrakttesten).
 */
export function rtdbNokkelOrden(a: string, b: string): number {
  if (a === b) return 0;
  const ia = heltall(a);
  const ib = heltall(b);
  if (ia !== null && ib !== null) return ia - ib || a.length - b.length;
  if (ia !== null) return -1;
  if (ib !== null) return 1;
  return a < b ? -1 : 1;
}

function heltall(k: string): number | null {
  if (!/^-?(0*)\d{1,10}$/.test(k)) return null;
  const n = Number(k);
  return n >= -2147483648 && n <= 2147483647 ? n : null;
}
