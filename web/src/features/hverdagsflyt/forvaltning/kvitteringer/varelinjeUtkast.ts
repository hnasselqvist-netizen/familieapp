import type { Varelinje, VarelinjeArt } from "@app-types/forsoning";
import { mengdeFelt, oreFelt, tolkMengde, tolkOre } from "@domain/forsoning/varelinjer";

/** Én linje i skjemaet: tall som tekst til de lagres. */
export interface LinjeUtkast {
  id: string;
  art: VarelinjeArt;
  tekst: string;
  /** Uendret fra den lagrede linjen; skjemaet redigerer den ikke. */
  originaltekst?: string;
  itemId?: string;
  mengde: string;
  enhet: string;
  enhetspris: string;
  belop: string;
  rabatt: string;
}

export const tilUtkast = (l: Varelinje): LinjeUtkast => ({
  id: l.id,
  art: l.art,
  tekst: l.tekst,
  originaltekst: l.originaltekst,
  itemId: l.itemId,
  mengde: mengdeFelt(l.mengde),
  enhet: l.enhet ?? "",
  enhetspris: oreFelt(l.enhetsprisOre),
  belop: oreFelt(l.belopOre),
  rabatt: oreFelt(l.rabattOre),
});

export const tomLinje = (id: string): LinjeUtkast => ({
  id,
  art: "vare",
  tekst: "",
  mengde: "",
  enhet: "",
  enhetspris: "",
  belop: "",
  rabatt: "",
});

export type Feltfeil = Partial<
  Record<"tekst" | "mengde" | "enhetspris" | "belop" | "rabatt", string>
>;

/**
 * Skjemaet som lagringsklare linjer, eller feltfeil per linje. Tomme
 * felt blir «ikke oppgitt» (utelatt), aldri 0.
 */
export function tilLinjer(
  utkast: readonly LinjeUtkast[],
): { linjer: Varelinje[]; feil: null } | { linjer: null; feil: Record<string, Feltfeil> } {
  const feil: Record<string, Feltfeil> = {};
  const linjer: Varelinje[] = [];
  for (const u of utkast) {
    const f: Feltfeil = {};
    if (!u.tekst.trim()) f.tekst = "Skriv hva linjen gjelder.";
    const mengde = tolkMengde(u.mengde);
    if (mengde === null) f.mengde = "Mengde skrives som 2 eller 0,452.";
    const enhetspris = tolkOre(u.enhetspris, false);
    if (enhetspris === null) f.enhetspris = "Skriv prisen i kroner, for eksempel 39,90.";
    const belop = tolkOre(u.belop, true);
    if (belop === null) f.belop = "Skriv beløpet i kroner, for eksempel 24,90 eller −3.";
    const rabatt = tolkOre(u.rabatt, false);
    if (rabatt === null) f.rabatt = "Skriv rabatten som et positivt beløp, for eksempel 10.";
    if (Object.keys(f).length > 0) {
      feil[u.id] = f;
      continue;
    }
    const l: Varelinje = { id: u.id, art: u.art, tekst: u.tekst.trim() };
    if (u.originaltekst) l.originaltekst = u.originaltekst;
    if (u.itemId) l.itemId = u.itemId;
    if (mengde !== undefined && mengde !== null) l.mengde = mengde;
    if (u.enhet.trim()) l.enhet = u.enhet.trim();
    if (enhetspris !== undefined && enhetspris !== null) l.enhetsprisOre = enhetspris;
    if (belop !== undefined && belop !== null) l.belopOre = belop;
    if (rabatt !== undefined && rabatt !== null) l.rabattOre = rabatt;
    linjer.push(l);
  }
  return Object.keys(feil).length > 0 ? { linjer: null, feil } : { linjer, feil: null };
}

/** Er skjemaet ulikt de lagrede linjene? */
export function erEndret(utkast: readonly LinjeUtkast[], lagret: readonly Varelinje[]): boolean {
  return JSON.stringify(utkast) !== JSON.stringify(lagret.map(tilUtkast));
}
