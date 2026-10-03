/**
 * Kvitteringens splitt-redigering (§Issue #34 R3b-3), portert fra legacy
 * `KvitteringDetalj` (`leggTilSplit`, `byttSplitTarget`, `oppdaterSplit`,
 * `oppdaterSplitEiere`, `fjernSplit`) og registreringsskjemaet i
 * `KvitteringInnboksScreen` (`nyLeggTilSplit`, `nyOppdaterSplit`,
 * `nyFjernSplit`) — `index.html` ~5528–6060. Begge legacy-variantene har
 * samme regler; de skiller seg bare i hvor resultatet lagres.
 *
 * Rene funksjoner på en splittliste. Siste linje er alltid totalen minus
 * resten (`beregnRestPaaSisteLinje`, felt `amount`).
 */
import type { Eierandel, KvitteringSplit, MalPost } from "@app-types/forsoning";
import { beregnRestPaaSisteLinje, jevnFordelEiere } from "./fordeling";

const medRest = (splits: KvitteringSplit[], total: number) =>
  beregnRestPaaSisteLinje(
    splits as unknown as Record<string, unknown>[],
    total,
    "amount",
  ) as unknown as KvitteringSplit[];

/** Ny splitt mot `post`, standard eier = postens egen (legacy `leggTilSplit`). */
export function leggTilSplit(
  splits: readonly KvitteringSplit[],
  post: MalPost,
  total: number,
): KvitteringSplit[] {
  const nySplit: KvitteringSplit = {
    targetType: post.targetType as KvitteringSplit["targetType"],
    targetId: post.id,
    targetName: post.name,
    amount: 0,
    ocrDescription: "",
    description: "",
    learning: { approved: false, source: "manual" },
    eiere: jevnFordelEiere([post.eier || "Felles"]),
  };
  return medRest([...splits, nySplit], total);
}

/** Bytter KUN målet på en eksisterende splitt — alt annet bevares (legacy `byttSplitTarget`). */
export function byttSplitMaal(
  splits: readonly KvitteringSplit[],
  idx: number,
  post: MalPost,
): KvitteringSplit[] {
  return splits.map((sp, i) =>
    i !== idx
      ? sp
      : {
          ...sp,
          targetType: post.targetType as KvitteringSplit["targetType"],
          targetId: post.id,
          targetName: post.name,
        },
  );
}

/** Beløp (`"12,5"` → 12.5, ugyldig → 0, så rest på siste) eller beskrivelse (legacy `oppdaterSplit`). */
export function oppdaterSplit(
  splits: readonly KvitteringSplit[],
  idx: number,
  felt: "amount" | "description",
  verdi: string | number,
  total: number,
): KvitteringSplit[] {
  const nye = splits.map((sp, i) =>
    i !== idx
      ? sp
      : {
          ...sp,
          [felt]: felt === "amount" ? parseFloat(String(verdi).replace(",", ".")) || 0 : verdi,
        },
  );
  return felt === "amount" ? medRest(nye, total) : nye;
}

/** Legacy `oppdaterSplitEiere`. */
export function settSplitEiere(
  splits: readonly KvitteringSplit[],
  idx: number,
  eiere: Eierandel[],
): KvitteringSplit[] {
  return splits.map((sp, i) => (i !== idx ? sp : { ...sp, eiere }));
}

/** Legacy `fjernSplit`: rest flyttes til ny siste linje, tom liste forblir tom. */
export function fjernSplit(
  splits: readonly KvitteringSplit[],
  idx: number,
  total: number,
): KvitteringSplit[] {
  const nye = splits.filter((_, i) => i !== idx);
  return nye.length > 0 ? medRest(nye, total) : nye;
}

/** Legacy postsøk i kvitteringen: navnet inneholder søket, maks 15 treff. */
export function sokMalPoster(poster: readonly MalPost[], sok: string): MalPost[] {
  const s = sok.trim().toLowerCase();
  if (!s) return [];
  return poster.filter((p) => p.name.toLowerCase().includes(s)).slice(0, 15);
}

/** Skjemaets lokale utkast — skrives først ved «Registrer»/«Lagre endringer». */
export interface KvitteringUtkast {
  merchant: string;
  purchaseDate: string;
  /** Rå tekst fra beløpsfeltet. */
  total: string;
  allocationMode: "single" | "split" | null;
  splits: KvitteringSplit[];
}

/**
 * Totalen splittene regnes mot. Registreringsskjemaet (legacy `nyTotalTall`)
 * leser et tallfelt; detaljvisningen (legacy `BelopFelt`) godtar komma.
 */
export function utkastTotal(u: KvitteringUtkast, variant: "ny" | "rediger"): number {
  return variant === "ny"
    ? parseFloat(u.total) || 0
    : parseFloat(String(u.total).replace(",", ".")) || 0;
}
