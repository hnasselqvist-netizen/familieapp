/**
 * Basisvarenøkkel (#20, «Merk som basisvare» fra handlelisten, ordre
 * 6651329875). Basisvarer lagres som `staples/{nøkkel}: true`, der
 * nøkkelen er varenavnet med små bokstaver — samme normalisering som
 * generatoren leser med (`staples[navn.toLowerCase()]`) og som
 * `confirmStaple` i index.html skriver med. Ingen ny nøkkelkoding.
 *
 * Et navn som ikke kan være én RTDB-nøkkel (tomt, `.` `#` `$` `[` `]`
 * `/`, kontrolltegn, over 768 byte) avvises før skriving, så det aldri
 * lager undernoder eller en bredere sti.
 *
 * Ren modul.
 */
export type BasisvareNokkel =
  { ok: true; nokkel: string } | { ok: false; grunn: "tomt" | "ugyldige_tegn" | "for_langt" };

/** RTDB-nøkler kan ikke inneholde disse (og ikke `/`, som lager undernoder). */
const FORBUDT = new Set([".", "#", "$", "[", "]", "/"]);
const MAKS_BYTE = 768;

export function basisvareNokkel(navn: string): BasisvareNokkel {
  if (!navn.trim()) return { ok: false, grunn: "tomt" };
  const nokkel = navn.toLowerCase();
  for (const tegn of nokkel) {
    const kode = tegn.charCodeAt(0);
    if (FORBUDT.has(tegn) || kode < 0x20 || kode === 0x7f) {
      return { ok: false, grunn: "ugyldige_tegn" };
    }
  }
  if (new TextEncoder().encode(nokkel).length > MAKS_BYTE) return { ok: false, grunn: "for_langt" };
  return { ok: true, nokkel };
}

/** Er varen allerede basisvare? Bare gyldige navn kan være det. */
export function erBasisvare(navn: string, staples: Readonly<Record<string, unknown>>): boolean {
  const n = basisvareNokkel(navn);
  return n.ok && staples[n.nokkel] === true;
}

/** Navnet kan ikke være én basisvarenøkkel; ingenting er skrevet. */
export class UgyldigBasisvarenavn extends Error {
  readonly grunn: Exclude<BasisvareNokkel, { ok: true }>["grunn"];
  constructor(grunn: Exclude<BasisvareNokkel, { ok: true }>["grunn"]) {
    super(`Ugyldig basisvarenavn (${grunn})`);
    this.name = "UgyldigBasisvarenavn";
    this.grunn = grunn;
  }
}

export const BASISVARE_UGYLDIG_TEKST: Record<
  Exclude<BasisvareNokkel, { ok: true }>["grunn"],
  string
> = {
  tomt: "Varen har ikke noe navn, så den kan ikke merkes som basisvare.",
  ugyldige_tegn:
    "Navnet inneholder tegn som ikke kan lagres som basisvare (. # $ [ ] /). Gi varen et annet navn først.",
  for_langt: "Navnet er for langt til å lagres som basisvare.",
};
