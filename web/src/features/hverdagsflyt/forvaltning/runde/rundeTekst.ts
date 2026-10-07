import type { Steg, StegId } from "@domain/lonnsdagsrunde/lonnsdagsrunde";
import type { IconName } from "@components/icons";
import { fraLenke } from "@components/fraLenke";

/** «20. oktober» fra en ISO-dato, lest som lokal dato (ikke UTC). */
export function datoTekst(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  if (!a || !m || !d) return iso;
  return new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "long" }).format(
    new Date(a, m - 1, d),
  );
}

export const kr = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(n);

export const STEG_TITTEL: Record<StegId, string> = {
  import: "Importer bankfilen",
  vurdering: "Vurder transaksjonene",
  kvitteringer: "Koble kvitteringene",
  spillerom: "Oppdater Spillerom",
};

export const STEG_IKON: Record<StegId, IconName> = {
  import: "folder-open",
  vurdering: "clipboard-check",
  kvitteringer: "receipt-text",
  spillerom: "chart-column",
};

/**
 * Hvert steg åpner skjermen der jobben faktisk gjøres, med `fra=runde`
 * slik at skjermen viser veien tilbake (§components/Retur.tsx).
 * `transaksjonsko` velger riktig fane når bare forslag venter.
 */
export function stegLenke(id: StegId, transaksjonsko: "vurdering" | "forslag"): string {
  switch (id) {
    case "import":
      return fraLenke("/forvaltning/transaksjoner?verktoy=import", "runde");
    case "vurdering":
      return fraLenke(`/forvaltning/transaksjoner?ko=${transaksjonsko}`, "runde");
    case "kvitteringer":
      return fraLenke("/forvaltning/kvitteringer", "runde");
    case "spillerom":
      return fraLenke("/forvaltning/spillerom", "runde");
  }
}

const flertall = (n: number, en: string, flere: string) => `${n} ${n === 1 ? en : flere}`;

/** Én rolig statuslinje per steg — hva som er gjort, eller hva som gjenstår. */
export function stegStatus(s: Steg, periodeStart: string): string {
  switch (s.id) {
    case "import":
      if (s.ferdig && s.sisteImport) return `Importert ${datoTekst(s.sisteImport)}.`;
      return s.sisteImport
        ? `Sist importert ${datoTekst(s.sisteImport)}, før lønn ${datoTekst(periodeStart)}.`
        : "Ingen bankfil er importert ennå.";
    case "vurdering":
      return s.ferdig
        ? "Ingenting venter på vurdering."
        : `${flertall(s.antall, "transaksjon venter", "transaksjoner venter")}.`;
    case "kvitteringer":
      return s.ferdig
        ? "Kvitteringsinnboksen er tom."
        : `${flertall(s.antall, "kvittering", "kvitteringer")} i innboksen.`;
    case "spillerom": {
      if (s.ferdig) return "Saldo og prognose er oppdatert.";
      const mangler: string[] = [];
      if (!s.saldoOppdatert) mangler.push("oppdater disponibelt beløp etter lønn");
      if (s.prognosedatoPassert) mangler.push("sett ny prognosedato");
      if (s.trengerAvklaring > 0) {
        mangler.push(
          flertall(s.trengerAvklaring, "post trenger avklaring", "poster trenger avklaring"),
        );
      }
      const tekst = mangler.join(", ");
      return tekst.charAt(0).toUpperCase() + tekst.slice(1) + ".";
    }
  }
}
