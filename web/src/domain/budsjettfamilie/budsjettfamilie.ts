/**
 * Budsjett-familien-motoren (Budsjett/Inntekter/Sparing). Rene
 * funksjoner — ingen React, ingen Firebase. 1:1-karakterisert mot
 * dagens faktiske oppførsel i `index.html` (linje 11477–12506, delte
 * hjelpefunksjoner linje 939, 954, 9591–9723) — se
 * budsjettfamilie.test.ts for karakteriseringstestene skrevet FØR
 * denne porteringen, per ADR 0001 sin Fase 1-prosess.
 *
 * **Én bevisst, dokumentert avviks-fiks fra legacy** (§Kontrolltårn-
 * beslutning, Issue #34, kommentar 5815438614): legacy hardkoder
 * årstallet "2026" i månedsnøkkelen (`monthKey = "2026-"+...`,
 * §index.html linje 11478, 11931, 12300) i stedet for å bruke
 * `CURRENT_BUDGET_YEAR` (`new Date().getFullYear()`, §index.html linje
 * 551), som brukes korrekt andre steder (f.eks. Årsbudsjett). Dette gir
 * identisk resultat i 2026, men ville stille feilkoblet Faktisk-tall/
 * drilldown mot feil år fra og med 2027 — en reell, sannsynligvis
 * utilsiktet feil, ikke ønsket ny atferd. `currentBudgetYear`/
 * `budgetMonthKey` under bruker derfor faktisk inneværende år, ikke det
 * hardkodede tallet.
 *
 * **Bevisst utenfor denne sliven** (§Issue #34-kartlegging): korrigering
 * av hendelser/kvitteringer/regler (`KorrigerHendelseModal`,
 * `KvitteringDetalj`, `oppdaterReglerVedLaering`) — drilldown her er
 * READ-ONLY, ingen skriving til `hendelser`/`receipts`/`rules`.
 */
import type { BankHendelse, BankTransaksjon, Kvittering } from "@app-types/gangen";
import type {
  BudsjettfamilieNode,
  BudsjettGruppe,
  BudsjettPost,
  PostMeta,
} from "@app-types/budsjettfamilie";

/** Meta-modalenes valgmuligheter — låst vokabular, §index.html linje 466–520. */
export const BUDGET_EIER = ["Felles", "Helen", "Eivind"];
export const BUDGET_NIVA = [
  { id: "beskytte", label: "🛡️ Beskytte" },
  { id: "opprettholde", label: "🌱 Opprettholde" },
  { id: "velge", label: "✨ Velge" },
];
export const OPPRETTHOLDE_TYPE = [
  { id: "nodvendig", label: "Nødvendig" },
  { id: "valgfritt", label: "Valgfritt" },
];
export const BUDGET_OPPFORSEL = [
  { id: "fast", label: "Fast" },
  { id: "variabel", label: "Variabel" },
  { id: "fordele", label: "Fordele" },
];
export const BUDGET_KONTOER = ["Regninger", "Felles", "Helen", "Eivind", "MC"];
export const BUDGET_KILDE = [
  { id: "budsjett", label: "Budsjett" },
  { id: "manuell", label: "Manuell" },
  { id: "generator", label: "Generator" },
  { id: "bankimport", label: "Bankimport" },
  { id: "ocr", label: "OCR" },
];
export const SPARING_LIKVIDITET_LABEL: Record<string, string> = {
  tilgjengelig: "Tilgjengelig",
  avsatt: "Avsatt",
  langsiktig: "Langsiktig",
};
const SPARING_LIKVIDITET_DEFAULT: Record<string, string> = {
  buffer: "avsatt",
  generell_sparing: "avsatt",
  feriesparing: "avsatt",
  investering: "langsiktig",
  pensjon: "langsiktig",
  annet: "avsatt",
};

/** Standardmeta for en post uten meta — §index.html linje 522–526. */
export function defaultMeta(): PostMeta {
  return {
    eier: "Felles",
    niva: "opprettholde",
    opprettholdType: "nodvendig",
    oppforsel: "fast",
    forfallsdag: "",
    konto: "Regninger",
    automatisk: false,
    kilde: "budsjett",
    paymentPattern: "monthly",
    arkivert: false,
  };
}

/** Standardmeta for en NY sparepost — §index.html linje 1049–1058. */
export function defaultSparingMeta(groupId: string): PostMeta {
  return {
    eier: "Felles",
    likviditet: SPARING_LIKVIDITET_DEFAULT[groupId] ?? "avsatt",
    konto: "Regninger",
    automatisk: false,
    forfallsdag: "",
    kilde: "budsjett",
    paymentPattern: "monthly",
    arkivert: false,
  };
}

/**
 * Meta-initialisering ved `addItem` — en EKTE, dokumentert forskjell
 * mellom de tre skjermene (§Issue #34-kartlegging), ikke en kopier-lim-
 * feil å rette: Budsjett setter ingen meta-nøkkel i det hele tatt
 * (§index.html linje 11522–11528), Inntekter setter `meta:null`
 * eksplisitt (§linje 11975–11979), Sparing setter gruppens
 * likviditet-standard umiddelbart (§linje 12341–12347).
 */
export function nyPostMeta(
  node: BudsjettfamilieNode,
  groupId: string,
): PostMeta | null | undefined {
  if (node === "budget") return undefined;
  if (node === "incomeGroups") return null;
  return defaultSparingMeta(groupId);
}

/** §index.html linje 954. */
export const isOver = (spent: number, budget: number): boolean => budget > 0 && spent > budget;

/**
 * Om en post matcher en (mulig historisk) plasseringId — direkte id
 * eller via `legacyIds`. §index.html linje 9591–9592.
 */
export const budsjettpostMatcherId = (
  post: { id: string; legacyIds?: string[] },
  id: string,
): boolean => post.id === id || (post.legacyIds ?? []).includes(id);

/**
 * Summerer `actualTotals` (en {plasseringId: beløp}-map fra
 * `beregnFaktiskTotalerFraHendelser`) for ÉN post, på tvers av dens id
 * og eventuelle legacyIds. `undefined` = ingen faktisk-data funnet i det
 * hele tatt — kallestedet faller da tilbake til det lagrede
 * `months[i].spent`. §index.html linje 9602–9609.
 */
export function hentFaktiskForPost(
  actualTotals: Record<string, number> | undefined,
  post: BudsjettPost,
): number | undefined {
  if (!actualTotals) return undefined;
  let sum = 0;
  let funnet = false;
  Object.keys(actualTotals).forEach((id) => {
    if (budsjettpostMatcherId(post, id)) {
      sum += actualTotals[id] ?? 0;
      funnet = true;
    }
  });
  return funnet ? sum : undefined;
}

/**
 * Summerer ferdige hendelser til {plasseringId: beløp} for én måned.
 * En manuelt registrert hendelse (`kilde==="manuell"`) er alltid gyldig
 * — den har verken transaksjonId eller receiptId siden det ikke finnes
 * noen observasjon å bekrefte mot, og skal ALDRI holdes utenfor av den
 * grunn. §index.html linje 9611–9637.
 */
export function beregnFaktiskTotalerFraHendelser(
  hendelser: BankHendelse[] | undefined,
  monthKey: string | undefined,
  gyldigeObservasjonIder?: Set<string>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  (hendelser ?? []).forEach((h) => {
    if (!h || h.status !== "ferdig") return;
    if (gyldigeObservasjonIder !== undefined) {
      const harGyldigObservasjon =
        h.kilde === "manuell" ||
        (!!h.transaksjonId && gyldigeObservasjonIder.has(h.transaksjonId)) ||
        (!!h.receiptId && gyldigeObservasjonIder.has(h.receiptId));
      if (!harGyldigObservasjon) return;
    }
    if (monthKey !== undefined && monthKey !== null) {
      if (!h.dato) return;
      if (h.dato.slice(0, 7) !== monthKey) return;
    }
    (h.fordelinger ?? []).forEach((f) => {
      if (!f.plasseringId) return;
      totals[f.plasseringId] = (totals[f.plasseringId] ?? 0) + (f.belop || 0);
    });
  });
  return totals;
}

export interface HendelseDrillDownRad {
  hendelseId: string;
  dato: string;
  tekst: string;
  belop: number;
  plasseringNavn: string | null;
  eiere: { person: string; prosent: number }[];
  erKvittering: boolean;
  erManuell: boolean;
  receiptId: string | null;
}

/**
 * Finner hendelsene (rent lesende — se filens toppkommentar) som
 * faktisk bidrar til én post for én måned — samme filterkriterier som
 * `beregnFaktiskTotalerFraHendelser`, slik at drilldownens rader alltid
 * summerer til nøyaktig det budsjettvisningen viser. §index.html linje
 * 9686–9723.
 */
export function finnHendelserForPost(
  hendelser: BankHendelse[] | undefined,
  transaksjoner: BankTransaksjon[] | undefined,
  receipts: Kvittering[] | undefined,
  post: BudsjettPost,
  monthKey: string | undefined,
  gyldigeObservasjonIder?: Set<string>,
): HendelseDrillDownRad[] {
  const rader: HendelseDrillDownRad[] = [];
  (hendelser ?? []).forEach((h) => {
    if (!h || h.status !== "ferdig") return;
    if (gyldigeObservasjonIder !== undefined) {
      const harGyldigObservasjon =
        h.kilde === "manuell" ||
        (!!h.transaksjonId && gyldigeObservasjonIder.has(h.transaksjonId)) ||
        (!!h.receiptId && gyldigeObservasjonIder.has(h.receiptId));
      if (!harGyldigObservasjon) return;
    }
    if (monthKey !== undefined && monthKey !== null) {
      if (!h.dato || h.dato.slice(0, 7) !== monthKey) return;
    }
    (h.fordelinger ?? []).forEach((f) => {
      if (!budsjettpostMatcherId(post, f.plasseringId)) return;
      const transaksjon = h.transaksjonId
        ? (transaksjoner ?? []).find((t) => t.id === h.transaksjonId)
        : null;
      const receipt = h.receiptId ? (receipts ?? []).find((r) => r.id === h.receiptId) : null;
      const tekst = transaksjon
        ? transaksjon.tekst || "(ukjent)"
        : receipt
          ? receipt.merchant || "(ukjent)"
          : h.kilde === "manuell"
            ? h.kommentar || "Manuelt registrert"
            : "(observasjon mangler)";
      rader.push({
        hendelseId: h.id,
        dato: h.dato ?? "",
        tekst,
        belop: f.belop || 0,
        plasseringNavn: f.plasseringNavn ?? null,
        eiere: f.eiere ?? [],
        erKvittering: !!h.receiptId,
        erManuell: h.kilde === "manuell",
        receiptId: h.receiptId ?? null,
      });
    });
  });
  rader.sort((a, b) => new Date(b.dato || 0).getTime() - new Date(a.dato || 0).getTime());
  return rader;
}

/** §index.html linje 11514/11967/12328 (`gBudget`). */
export function summerGruppeBudsjett(gruppe: BudsjettGruppe, monthIndex: number): number {
  return gruppe.items.reduce((s, it) => s + (it.months[monthIndex]?.budget ?? 0), 0);
}

/** §index.html linje 11515/11968/12329 (`gSpent`) — Faktisk der tilgjengelig, ellers lagret `spent`. */
export function summerGruppeFaktisk(
  gruppe: BudsjettGruppe,
  monthIndex: number,
  actualTotals: Record<string, number>,
): number {
  return gruppe.items.reduce((s, it) => {
    const faktisk = hentFaktiskForPost(actualTotals, it);
    return s + (faktisk !== undefined ? faktisk : (it.months[monthIndex]?.spent ?? 0));
  }, 0);
}

/**
 * Inneværende budsjettår — samme kontrakt som legacy sin
 * `CURRENT_BUDGET_YEAR` (§index.html linje 551), IKKE det hardkodede
 * "2026" de tre skjermene selv bruker. Se filens toppkommentar.
 */
export function currentBudgetYear(now: Date): number {
  return now.getFullYear();
}

/** `{år}-{måned, 2 siffer}` — brukt til å filtrere hendelser per måned. */
export function budgetMonthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}
