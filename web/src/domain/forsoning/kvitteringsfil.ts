/**
 * Kvitteringsfiler i vedleggstjenesten (#59, B1) — rene funksjoner.
 *
 * Klientvalideringen er SAMME regel som tjenesten håndhever (signatur fra
 * bytene, ikke MIME; JPEG/PNG/WebP/PDF; størrelsesgrense), bare for tydelige
 * feil før opplasting. Grensen er tjenesten sin; denne er en speiling.
 */
import type { KvitteringFil, KvitteringRecord } from "@app-types/forsoning";

export type KvitteringFilType = KvitteringFil["type"];

/** Speiler tjenestens standardgrense (mcp-server/src/vedlegg/kjerne.ts). */
export const MAKS_FILBYTES = 10 * 1024 * 1024;

export const FILTYPE_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

export function gjenkjennFiltype(b: Uint8Array): KvitteringFilType | null {
  const s = (i: number, ...v: number[]) => v.every((x, j) => b[i + j] === x);
  if (b.length >= 3 && s(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (b.length >= 8 && s(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (b.length >= 12 && s(0, 0x52, 0x49, 0x46, 0x46) && s(8, 0x57, 0x45, 0x42, 0x50)) {
    return "image/webp";
  }
  if (b.length >= 5 && s(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  return null;
}

export type FilAvvisning = "tom" | "for_stor" | "ikke_stottet";

export const FILAVVISNING_TEKST: Record<FilAvvisning, string> = {
  tom: "Filen er tom.",
  for_stor: "Filen er for stor (maks 10 MB).",
  ikke_stottet: "Bare bilder (JPEG, PNG, WebP) og PDF kan lagres.",
};

/** `start` = de første bytene av filen (minst 12). */
export function validerFil(
  start: Uint8Array,
  storrelse: number,
): { ok: true; type: KvitteringFilType } | { ok: false; feil: FilAvvisning } {
  if (storrelse <= 0) return { ok: false, feil: "tom" };
  if (storrelse > MAKS_FILBYTES) return { ok: false, feil: "for_stor" };
  const type = gjenkjennFiltype(start);
  return type ? { ok: true, type } : { ok: false, feil: "ikke_stottet" };
}

export type MedFilUtfall = "lagt_til" | "fantes" | "kvittering_mangler";

/**
 * Legger filmetadata til kvitteringen med STABIL id (aldri arrayposisjon).
 * Idempotent: samme sha256 legges ikke til to ganger. Alle andre felt og
 * andre kvitteringer bevares uendret.
 */
export function medKvitteringsfil(
  prev: readonly KvitteringRecord[],
  receiptId: string,
  fil: KvitteringFil,
): { neste: KvitteringRecord[]; utfall: MedFilUtfall } {
  const r = prev.find((x) => x && x.id === receiptId);
  if (!r) return { neste: [...prev], utfall: "kvittering_mangler" };
  if ((r.vedlegg ?? []).some((f) => f && f.sha256 === fil.sha256)) {
    return { neste: [...prev], utfall: "fantes" };
  }
  return {
    neste: prev.map((x) =>
      x && x.id === receiptId ? { ...x, vedlegg: [...(x.vedlegg ?? []), { ...fil }] } : x,
    ),
    utfall: "lagt_til",
  };
}

export const filstorrelseTekst = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} kB`
    : `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
