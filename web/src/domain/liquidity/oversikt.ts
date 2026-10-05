/**
 * Spillerom-dashbordet (§Issue #34, pre-cutover 1), portert fra legacy
 * `ForvaltningScreen` sin «Spillerom»-fane (`index.html` ~5276–5430) og
 * kontantflyt-motoren (~10130–10180): tre beslutningskort, «muligheter»,
 * neste større planlagte utbetaling og fordeling per nivå.
 *
 * Rene funksjoner. Dashbordet leser `liquidity` og `budget`; den eneste
 * skrivingen (saldo) går via den eksisterende `useLiquidity.saveSaldo`.
 */
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { Liquidity } from "@app-types/liquidity";
import { calcSpillerom, erAktivPrognosepost } from "./liquidity";

export interface KontantflytMaaned {
  maanedIndex: number;
  planlagteKostnader: number;
  planlagteInntekter: number;
  kumulativForpliktelse: number;
  poster: { id: string; name: string; gruppe: string; belop: number; paymentPattern: string }[];
}

/** Legacy `calculateCommittedCashflow`: budsjetterte kostnader fra valgt måned ut året. */
export function calculateCommittedCashflow(
  budgetGroups: readonly BudsjettGruppe[] | null | undefined,
  valgtMonth: number,
): KontantflytMaaned[] {
  const alleItems = (budgetGroups || []).flatMap((g) =>
    g.items.map((it) => ({ ...it, gruppe: g.label })),
  );
  const fremtid: KontantflytMaaned[] = [];
  let kumulativ = 0;
  for (let mi = valgtMonth; mi < 12; mi++) {
    let planlagteKostnader = 0;
    const poster: KontantflytMaaned["poster"] = [];
    alleItems.forEach((it) => {
      const mo = it.months && it.months[mi];
      const belop = mo ? mo.budget || 0 : 0;
      if (belop > 0) {
        planlagteKostnader += belop;
        poster.push({
          id: it.id,
          name: it.name,
          gruppe: it.gruppe,
          belop,
          paymentPattern: (it.meta && it.meta.paymentPattern) || "monthly",
        });
      }
    });
    kumulativ += planlagteKostnader;
    fremtid.push({
      maanedIndex: mi,
      planlagteKostnader,
      planlagteInntekter: 0,
      kumulativForpliktelse: kumulativ,
      poster,
    });
  }
  return fremtid;
}

export interface StorreUtbetaling {
  maanedIndex: number;
  navn: string;
  belop: number;
}

/**
 * Legacy `finnNesteStorreUtbetaling`: største kvartalsvise/årlige/egendefinerte
 * post i første måned (fra valgt) som har en. Månedlige poster teller ikke.
 */
export function finnNesteStorreUtbetaling(
  budgetGroups: readonly BudsjettGruppe[] | null | undefined,
  valgtMonth: number,
): StorreUtbetaling | null {
  for (const mnd of calculateCommittedCashflow(budgetGroups, valgtMonth)) {
    const relevante = mnd.poster.filter(
      (p) =>
        p.paymentPattern === "quarterly" ||
        p.paymentPattern === "yearly" ||
        p.paymentPattern === "custom",
    );
    if (relevante.length === 0) continue;
    const storst = relevante.reduce((a, b) => (b.belop > a.belop ? b : a), relevante[0]!);
    return { maanedIndex: mnd.maanedIndex, navn: storst.name, belop: storst.belop };
  }
  return null;
}

export type Niva = "beskytte" | "opprettholde" | "velge";

/**
 * Legacy `totalMonth`: månedens budsjett per nivå. Uten nivå teller posten
 * som «opprettholde»; den gamle modellen (`nodvendig`/`valgfritt`) også.
 */
export function budsjettPerNiva(
  budgetGroups: readonly BudsjettGruppe[] | null | undefined,
  niva: Niva,
  month: number,
): number {
  const alle = (budgetGroups || []).flatMap((g) => g.items);
  const filtrert =
    niva === "opprettholde"
      ? alle.filter((it) => {
          const n = (it.meta && it.meta.niva) || "opprettholde";
          return n === "opprettholde" || n === "nodvendig" || n === "valgfritt";
        })
      : alle.filter((it) => ((it.meta && it.meta.niva) || "opprettholde") === niva);
  return filtrert.reduce(
    (s, it) => s + ((it.months && it.months[month] ? it.months[month]!.budget : 0) || 0),
    0,
  );
}

export interface Mulighet {
  tekst: string;
  type: "positiv" | "noytral";
}

export interface SpilleromOversikt {
  saldo: number;
  harSaldo: boolean;
  harPoster: boolean;
  /** Netto bundet frem til prognosedatoen (utbetalinger − innbetalinger). */
  bundet: number;
  /** Innbetalinger frem til prognosedatoen («kommer inn»). */
  innbetalinger: number;
  /** Utbetalinger frem til prognosedatoen («skal ut»). */
  utbetalinger: number;
  spillerom: number;
  muligheter: Mulighet[];
}

/**
 * Legacy-dashbordets beregning: `calcSpillerom(saldo, poster,
 * prognosedato)` fra i dag, og «muligheter» i samme rekkefølge og ordlyd.
 *
 * **Bevisst avvik (Forvaltning produktfase, #59):** poster markert som
 * oppfylt telles ikke. Legacy-dashbordet tok med alle poster, mens
 * Spillerom-detaljene (og legacy `SpilleromScreen`) bare regner med aktive
 * poster (`erAktivPrognosepost`). En betalt regning ble dermed trukket fra
 * på forsiden, men ikke i detaljene, og de to viste ulikt spillerom. Nå
 * gjelder samme regel overalt.
 */
export function spilleromOversikt(
  liq: Partial<Liquidity> | null | undefined,
  idag: string,
): SpilleromOversikt {
  const l = liq || {};
  const saldo = parseFloat(String(l.saldo)) || 0;
  const progDate = l.prognosisDate || idag;
  const posts = Object.values(l.posts || {}).filter(erAktivPrognosepost);
  // Legacy-dashbordet sender ingen `fraDato` → «fra i dag» (`new Date()`).
  const res = calcSpillerom(saldo, posts, progDate, "");
  const harSaldo = saldo > 0;
  const harPoster = posts.length > 0;
  const muligheter: Mulighet[] = [];
  if (res.spillerom >= 0 && harPoster) {
    muligheter.push({
      tekst: "Alle faste kostnader er dekket frem til valgt dato.",
      type: "positiv",
    });
  }
  if (res.spillerom > 10000) {
    muligheter.push({ tekst: "Du har spillerom til ekstra sparing.", type: "positiv" });
  }
  if (!harSaldo)
    muligheter.push({ tekst: "Oppdater saldo for å få en prognose.", type: "noytral" });
  if (!harPoster) {
    muligheter.push({ tekst: "Ingen prognoseposter registrert ennå.", type: "noytral" });
  }
  return {
    saldo,
    harSaldo,
    harPoster,
    bundet: res.utbetalinger - res.innbetalinger,
    innbetalinger: res.innbetalinger,
    utbetalinger: res.utbetalinger,
    spillerom: res.spillerom,
    muligheter,
  };
}

/**
 * Muligheter justert for saldoforløpet (#59): «Alle faste kostnader er
 * dekket» stemmer ikke når saldoen går under null før prognosedatoen,
 * selv om spillerommet på slutten er positivt. Da utelates linjen —
 * forløpskortet forklarer det i stedet.
 */
export function mulighetervedForlop(
  muligheter: readonly Mulighet[],
  lavesteSaldo: number,
): Mulighet[] {
  if (lavesteSaldo >= 0) return [...muligheter];
  return muligheter.filter(
    (m) => m.tekst !== "Alle faste kostnader er dekket frem til valgt dato.",
  );
}
