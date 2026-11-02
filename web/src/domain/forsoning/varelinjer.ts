/**
 * Beskrivende varelinjer på kvitteringer (#59, kvitteringer C). Kontrakten
 * står på `Varelinje` i `@app-types/forsoning`.
 *
 * Varelinjene er BARE beskrivelse. Ingen funksjon her leser eller skriver
 * splits, hendelser, transaksjoner, budsjett, regler eller varebasen, og
 * ingen økonomifunksjon leser varelinjene.
 */
import type { KvitteringRecord, Varelinje, VarelinjeArt } from "@app-types/forsoning";

export const ARTER: { id: VarelinjeArt; navn: string }[] = [
  { id: "vare", navn: "Vare" },
  { id: "pant", navn: "Pant" },
  { id: "retur", navn: "Retur" },
  { id: "justering", navn: "Justering" },
];
const ART_IDER = new Set<string>(ARTER.map((a) => a.id));

// ── Lesing (robust: ugyldige linjer hoppes over, ukjente felt ignoreres) ──

type Raa = Record<string, unknown>;
const erObjekt = (v: unknown): v is Raa => !!v && typeof v === "object" && !Array.isArray(v);
const heltall = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const tekst = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

/** RTDB kan levere en array som objekt med indeksnøkler; rekkefølgen beholdes. */
function somListe(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!erObjekt(raw)) return [];
  return Object.keys(raw)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => raw[k]);
}

export function parseVarelinjer(raw: unknown): Varelinje[] {
  const ut: Varelinje[] = [];
  const sett = new Set<string>();
  for (const v of somListe(raw)) {
    if (!erObjekt(v) || typeof v.id !== "string" || !v.id || sett.has(v.id)) continue;
    sett.add(v.id);
    const l: Varelinje = {
      id: v.id,
      art: ART_IDER.has(v.art as string) ? (v.art as VarelinjeArt) : "vare",
      tekst: typeof v.tekst === "string" ? v.tekst : "",
    };
    const ot = tekst(v.originaltekst);
    if (ot) l.originaltekst = ot;
    if (typeof v.mengde === "number" && Number.isFinite(v.mengde) && v.mengde >= 0)
      l.mengde = v.mengde;
    const enhet = tekst(v.enhet);
    if (enhet) l.enhet = enhet;
    if (heltall(v.enhetsprisOre) && v.enhetsprisOre >= 0) l.enhetsprisOre = v.enhetsprisOre;
    if (heltall(v.belopOre)) l.belopOre = v.belopOre;
    if (heltall(v.rabattOre) && v.rabattOre >= 0) l.rabattOre = v.rabattOre;
    const itemId = tekst(v.itemId);
    if (itemId) l.itemId = itemId;
    ut.push(l);
  }
  return ut;
}

// ── Beregning ──────────────────────────────────────────────────────────

/** Netto for linjen (rabatt trukket én gang), eller `undefined` når beløpet mangler. */
export const nettoOre = (l: Varelinje): number | undefined =>
  l.belopOre === undefined ? undefined : l.belopOre - (l.rabattOre ?? 0);

export interface Varelinjesummer {
  antall: number;
  /** Sum netto for alle linjer med beløp (varer, pant, retur, justering). */
  sumOre: number;
  /** Bare `vare`-linjer: ordinært kjøp. */
  vareOre: number;
  /** Pant, retur og justering samlet, med fortegn. */
  pantReturOre: number;
  rabattOre: number;
  /** Linjer uten beløp; summen er da ufullstendig. */
  utenBelop: number;
  /** Kvitteringens total i øre, hvis den finnes. */
  totalOre: number | undefined;
  /** total − sum, bare når totalen finnes. */
  differanseOre: number | undefined;
}

export function summer(linjer: readonly Varelinje[], total: number | undefined): Varelinjesummer {
  let sumOre = 0;
  let vareOre = 0;
  let pantReturOre = 0;
  let rabattOre = 0;
  let utenBelop = 0;
  for (const l of linjer) {
    const n = nettoOre(l);
    if (n === undefined) {
      utenBelop++;
      continue;
    }
    sumOre += n;
    rabattOre += l.rabattOre ?? 0;
    if (l.art === "vare") vareOre += n;
    else pantReturOre += n;
  }
  const totalOre =
    typeof total === "number" && Number.isFinite(total) ? Math.round(total * 100) : undefined;
  return {
    antall: linjer.length,
    sumOre,
    vareOre,
    pantReturOre,
    rabattOre,
    utenBelop,
    totalOre,
    differanseOre: totalOre === undefined ? undefined : totalOre - sumOre,
  };
}

export type Advarsel =
  | { type: "uten_belop"; antall: number }
  | { type: "avvik_total"; differanseOre: number; ufullstendig: boolean }
  | { type: "mengde_pris"; linjeId: string; forventetOre: number }
  | { type: "rabatt_uten_belop"; linjeId: string };

/**
 * Ikke-blokkerende advarsler. Ingen av dem hindrer lagring; gamle
 * kvitteringer trenger ikke linjer i det hele tatt.
 */
export function advarsler(linjer: readonly Varelinje[], total: number | undefined): Advarsel[] {
  if (linjer.length === 0) return [];
  const s = summer(linjer, total);
  const ut: Advarsel[] = [];
  if (s.utenBelop > 0) ut.push({ type: "uten_belop", antall: s.utenBelop });
  if (s.differanseOre !== undefined && s.differanseOre !== 0) {
    ut.push({ type: "avvik_total", differanseOre: s.differanseOre, ufullstendig: s.utenBelop > 0 });
  }
  for (const l of linjer) {
    if (l.belopOre === undefined && l.rabattOre !== undefined) {
      ut.push({ type: "rabatt_uten_belop", linjeId: l.id });
    }
    if (l.mengde !== undefined && l.enhetsprisOre !== undefined && l.belopOre !== undefined) {
      const forventet = Math.round(l.mengde * l.enhetsprisOre);
      if (Math.abs(forventet - Math.abs(l.belopOre)) > 1) {
        ut.push({ type: "mengde_pris", linjeId: l.id, forventetOre: forventet });
      }
    }
  }
  return ut;
}

// ── Skriving (ren updater mot FERSK receipts-node) ──────────────────────

export type VarelinjeUtfall = "lagret" | "allerede" | "konflikt" | "mangler";

const KJENTE: (keyof Varelinje)[] = [
  "id",
  "art",
  "tekst",
  "originaltekst",
  "mengde",
  "enhet",
  "enhetsprisOre",
  "belopOre",
  "rabattOre",
  "itemId",
];

/**
 * Avviser `null`, `undefined`, NaN og uendelige tall hvor som helst i
 * linjene (RTDB ville stille slettet feltet), med sti i feilen.
 */
export function validerVarelinjer(linjer: readonly Varelinje[]): void {
  const sjekk = (v: unknown, sti: string): void => {
    if (v === null) throw new Error(`null kan ikke lagres (${sti}).`);
    if (v === undefined) throw new Error(`Tom verdi kan ikke lagres (${sti}).`);
    if (typeof v === "number" && !Number.isFinite(v))
      throw new Error(`Ugyldig tall kan ikke lagres (${sti}).`);
    if (Array.isArray(v)) v.forEach((x, i) => sjekk(x, `${sti}/${i}`));
    else if (erObjekt(v)) for (const [k, x] of Object.entries(v)) sjekk(x, `${sti}/${k}`);
  };
  const ider = new Set<string>();
  linjer.forEach((l, i) => {
    if (!l.id) throw new Error(`Varelinje uten id (varelinjer/${i}).`);
    if (ider.has(l.id)) throw new Error(`To varelinjer har samme id (${l.id}).`);
    ider.add(l.id);
    for (const [k, v] of Object.entries(l)) if (v !== undefined) sjekk(v, `varelinjer/${i}/${k}`);
    if (l.rabattOre !== undefined && (!Number.isInteger(l.rabattOre) || l.rabattOre < 0))
      throw new Error(`Rabatt må være et ikke-negativt beløp (varelinjer/${i}).`);
  });
}

/**
 * Den nye linjen flettet inn i den ferske lagrede linjen med samme id:
 * ukjente felt på den lagrede linjen bevares, kjente felt kommer fra den
 * nye (et kjent felt som mangler i den nye, fjernes).
 */
function flettLinje(fersk: unknown, ny: Varelinje): Raa {
  const ut: Raa = erObjekt(fersk) ? { ...fersk } : {};
  for (const k of KJENTE) {
    const v = ny[k];
    if (v === undefined) delete ut[k];
    else ut[k] = v;
  }
  return ut;
}

/** Stabil JSON-tekst (sorterte nøkler) til innholdsbasert skrive-id. */
function stabil(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stabil).join(",")}]`;
  if (erObjekt(v))
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stabil(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/** FNV-1a 32-bit to ganger → 16 heksadesimale tegn. */
function hash(t: string): string {
  const en = (start: number) => {
    let h = start;
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  return en(0x811c9dc5) + en(0x01000193);
}

export const varelinjerSkrivId = (
  receiptId: string,
  forventetVersjon: number,
  linjer: readonly Varelinje[],
): string => hash(`${receiptId}|${forventetVersjon}|${stabil(linjer)}`);

/**
 * Lagrer varelinjene på ÉN kvittering mot den ferske `receipts`-lista.
 * Bare `varelinjer*`-feltene på den kvitteringen røres; alle andre
 * kvitteringer og felt (splits, eiere, matching, koblinger, bilde/Drive/
 * vedlegg, ukjente felt) er uendret.
 *
 * - `forventetVersjon` er `varelinjerVersjon` brukeren startet fra. Avviker
 *   den ferske, er utfallet «konflikt» og ingenting endres.
 * - Er nøyaktig denne lagringen allerede gjort (samme skrive-id), er
 *   utfallet «allerede» (trygg retry).
 */
export function lagreVarelinjer(
  prev: readonly KvitteringRecord[],
  receiptId: string,
  linjer: readonly Varelinje[],
  forventetVersjon: number,
  naa: string,
): { neste: KvitteringRecord[]; utfall: VarelinjeUtfall } {
  validerVarelinjer(linjer);
  const skrivId = varelinjerSkrivId(receiptId, forventetVersjon, linjer);
  const i = prev.findIndex((r) => r && r.id === receiptId);
  if (i < 0) return { neste: [...prev], utfall: "mangler" };
  const fersk = prev[i]!;
  if (fersk.varelinjerSkrivId === skrivId) return { neste: [...prev], utfall: "allerede" };
  if ((fersk.varelinjerVersjon ?? 0) !== forventetVersjon) {
    return { neste: [...prev], utfall: "konflikt" };
  }
  const gamle = new Map(
    somListe((fersk as unknown as Raa).varelinjer)
      .filter(erObjekt)
      .map((l) => [l.id as string, l] as const),
  );
  const nyeLinjer = linjer.map((l) => flettLinje(gamle.get(l.id), l)) as unknown as Varelinje[];
  const oppdatert: KvitteringRecord = {
    ...fersk,
    varelinjerVersjon: forventetVersjon + 1,
    varelinjerSkrivId: skrivId,
    varelinjerOppdatert: naa,
  };
  if (nyeLinjer.length > 0) oppdatert.varelinjer = nyeLinjer;
  else delete oppdatert.varelinjer;
  const neste = [...prev];
  neste[i] = oppdatert;
  return { neste, utfall: "lagret" };
}

/**
 * For editorer som bygger en hel kvittering fra et ELDRE øyeblikksbilde
 * (f.eks. `oppdaterKvittering`): varelinjene og deres versjonsfelt hentes
 * alltid fra den ferske kvitteringen, så en samtidig varelinjelagring
 * aldri slettes av en annen redigering.
 */
export function medFerskeVarelinjer(
  ny: KvitteringRecord,
  fersk: KvitteringRecord,
): KvitteringRecord {
  const ut: KvitteringRecord = { ...ny };
  for (const k of [
    "varelinjer",
    "varelinjerVersjon",
    "varelinjerSkrivId",
    "varelinjerOppdatert",
  ] as const) {
    if (fersk[k] === undefined) delete ut[k];
    else (ut as unknown as Raa)[k] = fersk[k];
  }
  return ut;
}

// ── Inndata ────────────────────────────────────────────────────────────

/**
 * «12,90», «-30», «1 299» → øre; tom → `undefined` (ikke oppgitt);
 * ugyldig → `null`. `negativ` styrer om minus er lov.
 */
export function tolkOre(t: string, negativ: boolean): number | undefined | null {
  const r = t.replace(/\s|kr/gi, "").replace(",", ".").replace(/^−/, "-");
  if (r === "") return undefined;
  const re = negativ ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/;
  if (!re.test(r)) return null;
  const ore = Math.round(Number(r) * 100);
  return Object.is(ore, -0) ? 0 : ore;
}

/** «0,452», «2» → tall; tom → `undefined`; ugyldig/negativ → `null`. */
export function tolkMengde(t: string): number | undefined | null {
  const r = t.replace(/\s/g, "").replace(",", ".");
  if (r === "") return undefined;
  if (!/^\d+(\.\d{1,3})?$/.test(r)) return null;
  return Number(r);
}

export const oreFelt = (ore: number | undefined): string =>
  ore === undefined
    ? ""
    : (ore / 100)
        .toFixed(ore % 100 === 0 ? 0 : 2)
        .replace(".", ",")
        .replace("-", "−");

export const mengdeFelt = (m: number | undefined): string =>
  m === undefined ? "" : String(m).replace(".", ",");

export function kronerTekst(ore: number): string {
  return `${new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(ore / 100)} kr`;
}
