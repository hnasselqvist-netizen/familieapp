/**
 * Historikkeksport (Forvaltning produktfase, #59 — «Mer» over på React):
 * port av legacy `byggHistorikkEksport`/`byggHistorikkCsv` med hjelpere
 * (`index.html` ~9760–9935). Rene funksjoner, ingen DOM/Firebase.
 *
 * ÉN fordeling = ÉN rad (en splitt gir flere rader fra samme hendelse).
 * `fordeling.belop` eksporteres direkte — den er allerede den signerte
 * effekten. Bare `status: "ferdig"`-hendelser med minst én fordeling tas
 * med, samme kriterium som Faktisk-beregningen.
 */
import { budsjettpostMatcherId } from "@domain/budsjettfamilie/budsjettfamilie";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  Eierandel,
  HendelseRecord,
  KvitteringRecord,
  PlasseringType,
  TransaksjonRecord,
} from "@app-types/forsoning";

type Grupper = readonly BudsjettGruppe[] | null | undefined;

type AktivPost =
  { navn: string; gruppe: string; plasseringType: PlasseringType } | { tvetydig: true };

/**
 * Legacy `finnAktivPostForPlassering`: finn dagens post for en historisk
 * plassering — først i den historiske typen, så på tvers av de andre.
 * Mer enn ett treff på tvers er tvetydig (ingen gjetting).
 */
export function finnAktivPostForPlassering(
  plasseringId: string,
  plasseringType: string,
  budgetGroups: Grupper,
  incomeGroups: Grupper,
  sparingGroups: Grupper,
): AktivPost | null {
  if (!plasseringId) return null;
  const typeStrukturer: { type: PlasseringType; grupper: Grupper }[] = [
    { type: "budget", grupper: budgetGroups },
    { type: "income", grupper: incomeGroups },
    { type: "sparing", grupper: sparingGroups },
  ];
  const historiskType: PlasseringType =
    plasseringType === "income" ? "income" : plasseringType === "sparing" ? "sparing" : "budget";

  const historisk = typeStrukturer.find((s) => s.type === historiskType)!;
  for (const g of historisk.grupper || []) {
    const item = (g.items || []).find((it) => budsjettpostMatcherId(it, plasseringId));
    if (item) return { navn: item.name, gruppe: g.label, plasseringType: historiskType };
  }

  const treff: AktivPost[] = [];
  typeStrukturer
    .filter((s) => s.type !== historiskType)
    .forEach((s) => {
      (s.grupper || []).forEach((g) => {
        const item = (g.items || []).find((it) => budsjettpostMatcherId(it, plasseringId));
        if (item) treff.push({ navn: item.name, gruppe: g.label, plasseringType: s.type });
      });
    });
  if (treff.length === 1) return treff[0]!;
  if (treff.length > 1) return { tvetydig: true };
  return null;
}

const TYPE_LABEL: Record<string, string> = {
  budget: "Kostnad",
  income: "Inntekt",
  sparing: "Sparing",
};

/** «Felles» (ingen eiere), «Helen» (én), eller «Helen 50 % | Eivind 50 %». */
export function formaterEierTekst(eiere: readonly Eierandel[] | null | undefined): string {
  if (!eiere || eiere.length === 0) return "Felles";
  if (eiere.length === 1) return eiere[0]!.person;
  return eiere.map((e) => e.person + " " + e.prosent + " %").join(" | ");
}

/** Maskinvennlig eierdata — «Helen:50|Eivind:50». */
export function formaterEierdata(eiere: readonly Eierandel[] | null | undefined): string {
  if (!eiere || eiere.length === 0) return "Felles:100";
  return eiere.map((e) => e.person + ":" + e.prosent).join("|");
}

export const HISTORIKK_KOLONNER = [
  "Dato",
  "År",
  "Måned",
  "Type",
  "Livsområde / gruppe",
  "Post",
  "Beløp effekt",
  "Eier",
  "Eierdata",
  "Kilde",
  "Kommentar",
  "Transaksjonstekst",
  "Normalisert tekst",
  "Bankbeløp",
  "Bankretning",
  "Konto",
  "Importkilde",
  "Kvittering",
  "Hendelse-ID",
  "Transaksjon-ID",
  "Kvittering-ID",
  "Plassering-ID",
  "Plasseringstype",
  "Regel-ID",
  "Oppslag status",
] as const;

export type HistorikkKolonne = (typeof HISTORIKK_KOLONNER)[number];
export type HistorikkRad = Record<HistorikkKolonne, string | number>;

export type OppslagStatus = "OK" | "Tvetydig plassering" | "Uavklart plassering";

export function byggHistorikkEksport(
  hendelser: readonly HendelseRecord[] | null | undefined,
  transaksjoner: readonly TransaksjonRecord[] | null | undefined,
  _receipts: readonly KvitteringRecord[] | null | undefined,
  budgetGroups: Grupper,
  incomeGroups: Grupper,
  sparingGroups: Grupper,
): HistorikkRad[] {
  const rader: HistorikkRad[] = [];
  (hendelser || []).forEach((h) => {
    if (!h || h.status !== "ferdig") return;
    if (!h.fordelinger || h.fordelinger.length === 0) return;

    const transaksjon = h.transaksjonId
      ? ((transaksjoner || []).find((t) => t.id === h.transaksjonId) ?? null)
      : null;
    const kilde =
      h.kilde === "manuell"
        ? "manuell"
        : h.receiptId
          ? "kvittering"
          : h.transaksjonId
            ? "bank"
            : "ukjent";

    h.fordelinger.forEach((f) => {
      const aktivPost = finnAktivPostForPlassering(
        f.plasseringId,
        f.plasseringType,
        budgetGroups,
        incomeGroups,
        sparingGroups,
      );
      const erTvetydig = !!(aktivPost && "tvetydig" in aktivPost);
      const ok = aktivPost && !("tvetydig" in aktivPost) ? aktivPost : null;
      const dato = h.dato || "";
      rader.push({
        Dato: dato,
        År: dato ? dato.slice(0, 4) : "",
        Måned: dato ? dato.slice(0, 7) : "",
        Type: ok
          ? TYPE_LABEL[ok.plasseringType] || "Kostnad"
          : TYPE_LABEL[f.plasseringType] || "Kostnad",
        "Livsområde / gruppe": ok ? ok.gruppe : "Uavklart",
        Post: ok ? ok.navn : f.plasseringNavn || "",
        "Beløp effekt": f.belop || 0,
        Eier: formaterEierTekst(f.eiere),
        Eierdata: formaterEierdata(f.eiere),
        Kilde: kilde,
        Kommentar: h.kommentar || "",
        Transaksjonstekst: transaksjon ? transaksjon.tekst || "" : "",
        "Normalisert tekst":
          transaksjon && transaksjon.normalizedText ? transaksjon.normalizedText : "",
        Bankbeløp: transaksjon ? transaksjon.belop : "",
        Bankretning: transaksjon ? transaksjon.retning || "" : "",
        Konto: transaksjon ? transaksjon.konto || "" : "",
        Importkilde: "",
        Kvittering: h.receiptId ? "Ja" : "Nei",
        "Hendelse-ID": h.id,
        "Transaksjon-ID": h.transaksjonId || "",
        "Kvittering-ID": h.receiptId || "",
        "Plassering-ID": f.plasseringId,
        Plasseringstype: f.plasseringType,
        "Regel-ID": h.regelId || "",
        "Oppslag status": (ok
          ? "OK"
          : erTvetydig
            ? "Tvetydig plassering"
            : "Uavklart plassering") satisfies OppslagStatus,
      });
    });
  });
  return rader;
}

/** Standard CSV-escaping for semikolonseparert fil. */
export function escapeCsvFelt(verdi: unknown): string {
  const s = verdi === null || verdi === undefined ? "" : String(verdi);
  if (s.includes(";") || s.includes("\n") || s.includes("\r") || s.includes('"')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Komma som desimaltegn (norsk Excel), ellers urørt. */
export function formaterTallForCsv(tall: unknown): string {
  if (tall === null || tall === undefined || tall === "") return "";
  return String(tall).replace(".", ",");
}

const NUMERISKE = new Set<HistorikkKolonne>(["Beløp effekt", "Bankbeløp"]);

/** Komplett CSV med UTF-8 BOM, header og CRLF. */
export function byggHistorikkCsv(rader: readonly HistorikkRad[] | null | undefined): string {
  const header = HISTORIKK_KOLONNER.map(escapeCsvFelt).join(";");
  const linjer = (rader || []).map((r) =>
    HISTORIKK_KOLONNER.map((k) =>
      escapeCsvFelt(NUMERISKE.has(k) ? formaterTallForCsv(r[k]) : r[k]),
    ).join(";"),
  );
  return "﻿" + [header, ...linjer].join("\r\n");
}

export interface HistorikkSammendrag {
  antallHendelser: number;
  antallRader: number;
  forsteDato: string | null;
  sisteDato: string | null;
  antallUavklart: number;
  antallTvetydig: number;
}

/** Legacy `HistorikkEksportScreen` sitt sammendrag over eksporten. */
export function historikkSammendrag(
  hendelser: readonly HendelseRecord[] | null | undefined,
  rader: readonly HistorikkRad[],
): HistorikkSammendrag {
  const datoer = rader
    .map((r) => String(r["Dato"]))
    .filter(Boolean)
    .sort();
  return {
    antallHendelser: (hendelser || []).filter(
      (h) => h && h.status === "ferdig" && h.fordelinger && h.fordelinger.length > 0,
    ).length,
    antallRader: rader.length,
    forsteDato: datoer[0] ?? null,
    sisteDato: datoer[datoer.length - 1] ?? null,
    antallUavklart: rader.filter((r) => r["Oppslag status"] === "Uavklart plassering").length,
    antallTvetydig: rader.filter((r) => r["Oppslag status"] === "Tvetydig plassering").length,
  };
}
