/**
 * Bankfil-parsing (SpareBank 1 / DNB-Mastercard / annet) — rene
 * funksjoner, portert 1:1 fra de komponent-lokale hjelperne i
 * `BankimportScreen` (`index.html` ~6555–6715, §Issue #34, R0).
 *
 * Kjent, UENDRET oppførsel (kartlegging §4, "DNB betaling vs. skyldig
 * beløp"): DNB-grenen leser kun `inn`/`ut`-kolonnene; filtreringen av
 * kortbetalinger skjer i import-steget på teksten `"innbetaling"`, ikke her.
 */
import type { Retning, TransaksjonRecord } from "@app-types/forsoning";

export type BankKilde = "sparebank1" | "dnb" | "annet";

export interface ParsetRad {
  dato: string;
  tekst: string;
  belop: number;
  retning: Retning;
  konto: string;
}

/** CSV med `;` eller `,`, BOM-/CRLF-tolerant, header lowercased. Legacy: `parseCSV`. */
export function parseCSV(tekst: string): Record<string, string>[] {
  const renset = tekst
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = renset.trim().split("\n");
  if (lines.length < 2) return [];
  const forste = lines[0]!;
  const sep = forste.includes(";") ? ";" : ",";
  const hdr = forste.endsWith(sep) ? forste.slice(0, -1) : forste;
  const headers = hdr.split(sep).map((h) => h.replace(/"/g, "").trim().toLowerCase());
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const cl = line.endsWith(sep) ? line.slice(0, -1) : line;
      const vals = cl.split(sep).map((v) => v.replace(/"/g, "").trim());
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = vals[i] || "";
      });
      return obj;
    });
}

const tall = (s: string | undefined) =>
  parseFloat((s || "").replace(/\s/g, "").replace(",", ".")) || 0;

/** Én rå rad → normalisert observasjon. Legacy: `mapRad`. */
export function mapRad(rad: Record<string, string>, kilde: BankKilde | string): ParsetRad {
  let dato = "";
  let tekst = "";
  let belop = 0;
  let retning: Retning = "ut";
  let konto = "";
  if (kilde === "sparebank1") {
    dato = rad["dato"] || rad["rentedato"] || "";
    tekst = rad["beskrivelse"] || rad["forklaring"] || rad["tekst"] || "";
    const valInn = tall(rad["inn"] || rad["inn paa konto"]);
    const valUt = tall(rad["ut"] || rad["ut fra konto"]);
    if (valInn > 0) {
      belop = valInn;
      retning = "inn";
    } else if (valUt < 0) {
      belop = Math.abs(valUt);
      retning = "ut";
    } else if (valUt > 0) {
      belop = valUt;
      retning = "ut";
    }
    konto = (rad["konto"] || "").trim();
  } else if (kilde === "dnb") {
    const rawDato = rad["dato"] || rad["transaksjonsdato"] || "";
    const excelNum = parseFloat(rawDato);
    if (!isNaN(excelNum) && excelNum > 40000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(excelNum) * 86400000);
      dato = d.toISOString().slice(0, 10);
    } else {
      dato = rawDato;
    }
    if (dato && /^\d{2}\.\d{2}\.\d{4}$/.test(dato)) {
      const [dd, mm, yyyy] = dato.split(".");
      dato = `${yyyy}-${mm}-${dd}`;
    }
    tekst =
      rad["beløpet gjelder"] || rad["belopet gjelder"] || rad["beskrivelse"] || rad["tekst"] || "";
    const valInn = tall(rad["inn"]);
    const valUt = tall(rad["ut"]);
    if (valInn > 0) {
      belop = valInn;
      retning = "inn";
    } else if (valUt > 0) {
      belop = valUt;
      retning = "ut";
    }
  } else {
    dato = rad["dato"] || rad["date"] || rad["transaksjonsdato"] || "";
    tekst = rad["tekst"] || rad["beskrivelse"] || rad["description"] || rad["forklaring"] || "";
    const rawB = tall(rad["belop"] || rad["amount"] || "0");
    belop = Math.abs(rawB);
    retning = rawB < 0 ? "inn" : "ut";
    konto = (rad["konto"] || "").trim();
  }
  if (dato && /^\d{2}\.\d{2}\.\d{4}$/.test(dato)) {
    const [dd, mm, yyyy] = dato.split(".");
    dato = `${yyyy}-${mm}-${dd}`;
  }
  return { dato, tekst: tekst.slice(0, 120), belop, retning, konto };
}

/**
 * Duplikatnøkkel: dato | beløp | retning | tekst[0..30] | konto. Retning er
 * med så de to sidene av en intern overføring ikke regnes som samme
 * observasjon. Legacy: `dupKey`.
 */
export function dupKey(
  t: Pick<TransaksjonRecord, "dato" | "belop" | "tekst"> & {
    retning?: string | null;
    konto?: string | null;
  },
): string {
  return [
    t.dato,
    String(t.belop),
    t.retning || "",
    (t.tekst || "").slice(0, 30).trim(),
    t.konto || "",
  ].join("|");
}

/** Kontofilterets kanoniske kontonøkkel. Legacy: `normaliserKonto`. */
export function normaliserKonto(t: { konto?: string | null; importkilde?: string | null }): string {
  const k = (t.konto || t.importkilde || "").toLowerCase();
  if (k === "mc" || k === "dnb" || k === "mastercard") return "MC";
  if (k.includes("regning")) return "regningskonto";
  if (k.includes("felles")) return "felleskonto";
  if (k.includes("helen")) return "helen";
  if (k.includes("eivind")) return "eivind";
  if (k.includes("krav")) return "krav";
  return k || "?";
}
