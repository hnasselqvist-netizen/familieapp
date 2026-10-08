import type { IconName } from "@components/icons";

export interface Fane {
  til: string;
  navn: string;
  ikon: IconName;
  /** Rutene (prefikser) som hører til fanen. */
  hjem: readonly string[];
}

/**
 * De fem faste delene av Forvaltning (#59, Kontrolltårnet 2026-10-07:
 * «fast fanerad, fem separate faner»). Lønnsdagsrunden, Avstemming og Oppsett
 * (Regelsenter, Årsbudsjett) er ikke egne faner. De starter fra Oversikt og
 * hører hjemme der, så Oversikt er aktiv mens de er åpne.
 */
export const FORVALTNING_FANER: readonly Fane[] = [
  {
    til: "/forvaltning",
    navn: "Oversikt",
    ikon: "clipboard-check",
    hjem: [
      "/forvaltning/runde",
      "/forvaltning/avstemming",
      "/forvaltning/regelsenter",
      "/forvaltning/arsbudsjett",
    ],
  },
  {
    til: "/forvaltning/spillerom",
    navn: "Spillerom",
    ikon: "chart-column",
    hjem: ["/forvaltning/spillerom"],
  },
  {
    til: "/forvaltning/transaksjoner",
    navn: "Transaksjoner",
    ikon: "landmark",
    hjem: ["/forvaltning/transaksjoner"],
  },
  {
    til: "/forvaltning/kvitteringer",
    navn: "Kvitteringer",
    ikon: "receipt-text",
    hjem: ["/forvaltning/kvitteringer"],
  },
  {
    til: "/forvaltning/okonomi",
    navn: "Økonomi",
    ikon: "piggy-bank",
    hjem: ["/forvaltning/okonomi"],
  },
];

/** Hvilken fane en rute hører til. Forsiden og alt som ikke er en egen fane, hører til Oversikt. */
export function aktivFane(pathname: string): string {
  const sti = pathname.replace(/\/+$/, "") || "/";
  const treff = FORVALTNING_FANER.find((f) =>
    f.hjem.some((h) => sti === h || sti.startsWith(h + "/")),
  );
  return (treff ?? FORVALTNING_FANER[0]!).til;
}
