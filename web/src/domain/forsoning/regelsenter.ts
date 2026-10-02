/**
 * RegelSenter — rene funksjoner for visning (søk, sortering, status,
 * nivå-/sparegruppering, treff i dag) og de tre skriveoperasjonene
 * (oppdater, slett, slå sammen), portert 1:1 fra de komponent-lokale
 * closurene i `RegelSenter` (`index.html` ~12515–12705, §Issue #34, R1).
 *
 * Skriveoperasjonene er rene updatere `(prev) => next` over HELE regel-
 * listen — samme form som legacy sine `setRules(prev => …)`. Datalaget
 * (`data/rules.repository.ts`) kjører dem inne i én transaksjon på hele
 * `rules`-noden i dagens array-form (Kontrolltårn-beslutning 5952884278).
 *
 * Kjente, UENDREDE særegenheter (ikke rettet i R1):
 *  - «Kjør regler» er ikke en del av RegelSenter-sliven (skriver
 *    `transaksjoner`/`hendelser`, hører til R3).
 *  - `slettRegel` og `slaSammenRegler` etterlater `hendelse.regelId` som
 *    peker på en slettet regel (dinglende `regelId`, kartlegging 2.7).
 *  - «Inneholder» matcher også når mønsteret inneholder teksten (via
 *    `regelMatcherTekst`), også i «Treffer i dag».
 */
import { NIVA_REKKEFOLGE, nivaKeyForMeta } from "@domain/arsbudsjett/arsbudsjett";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { MatchType, RegelMode, RegelRecord } from "@app-types/forsoning";
import { finnMalpostForRegel, regelMatcherTekst } from "./regler";
import { normaliserTransaksjonstekst } from "./tekst";

export const MODE_LABEL: Record<RegelMode, string> = {
  auto: "Auto",
  suggest: "Foreslå",
  disabled: "Deaktivert",
  review: "Vurder",
};

export const MATCHTYPE_LABEL: Record<MatchType, string> = {
  er_lik: "Er lik",
  inneholder: "Inneholder",
  starter_med: "Starter med",
};

export interface RegelGrupper {
  budgetGroups: BudsjettGruppe[] | null | undefined;
  incomeGroups: BudsjettGruppe[] | null | undefined;
  sparingGroups: BudsjettGruppe[] | null | undefined;
}

/** Søk i mønster, normalisert mønster og koblet post. Legacy: `filtrert`. */
export function filtrerRegler(regler: readonly RegelRecord[], sok: string): RegelRecord[] {
  if (!sok.trim()) return [...regler];
  const s = sok.trim().toLowerCase();
  return regler.filter(
    (r) =>
      (r.pattern || "").toLowerCase().includes(s) ||
      (r.normalizedPattern || "").toLowerCase().includes(s) ||
      (r.targetName || "").toLowerCase().includes(s),
  );
}

/** 1. aktive først, 2. flest bruk, 3. sist brukt. Legacy: `sortert`. */
export function sorterRegler(regler: readonly RegelRecord[]): RegelRecord[] {
  return [...regler].sort((a, b) => {
    const aAktiv = a.active !== false ? 1 : 0;
    const bAktiv = b.active !== false ? 1 : 0;
    if (aAktiv !== bAktiv) return bAktiv - aAktiv;
    const aBruk = a.timesUsed || 0;
    const bBruk = b.timesUsed || 0;
    if (aBruk !== bBruk) return bBruk - aBruk;
    const aTid = a.lastMatched ? new Date(a.lastMatched).getTime() : 0;
    const bTid = b.lastMatched ? new Date(b.lastMatched).getTime() : 0;
    return bTid - aTid;
  });
}

export interface RegelStatus {
  totalt: number;
  aktive: number;
  automatiske: number;
  kreverVurdering: number;
}

/** Statuspanelet. Legacy: `antallAktive`/`antallAuto`/`antallVurder`. */
export function regelStatus(regler: readonly RegelRecord[]): RegelStatus {
  return {
    totalt: regler.length,
    aktive: regler.filter((r) => r.active !== false).length,
    automatiske: regler.filter((r) => r.mode === "auto").length,
    kreverVurdering: regler.filter((r) => r.mode === "review").length,
  };
}

/**
 * Nivå-nøkkelen regelen vises under. Sparing-regler får `"sparing"`, som
 * aldri matcher noen `NIVA_REKKEFOLGE`-nøkkel — de vises i egen seksjon.
 * Legacy: `nivaKeyForRegel`.
 */
export function nivaKeyForRegel(regel: RegelRecord, grupper: RegelGrupper): string {
  const funnet = finnMalpostForRegel(
    regel,
    grupper.budgetGroups,
    grupper.incomeGroups,
    grupper.sparingGroups,
  );
  if (funnet && funnet.kildeType === "sparing") return "sparing";
  return nivaKeyForMeta(funnet ? funnet.item.meta : null);
}

export interface RegelSeksjon {
  key: string;
  label: string;
  regler: RegelRecord[];
}

/** Sparegrupper (i `sparingGroups`-rekkefølge) med minst én regel. Legacy: `spareReglerGruppert`. */
export function spareReglerGruppert(
  sortert: readonly RegelRecord[],
  grupper: RegelGrupper,
): RegelSeksjon[] {
  return (grupper.sparingGroups || [])
    .map((g) => ({
      key: g.id,
      label: g.label,
      regler: sortert.filter((r) => {
        const f = finnMalpostForRegel(
          r,
          grupper.budgetGroups,
          grupper.incomeGroups,
          grupper.sparingGroups,
        );
        return f !== null && f.kildeType === "sparing" && f.gruppeId === g.id;
      }),
    }))
    .filter((gr) => gr.regler.length > 0);
}

/** Nivåseksjonene i `NIVA_REKKEFOLGE`, kun ikke-tomme. Legacy: render-løkken ~13155. */
export function reglerPerNiva(
  sortert: readonly RegelRecord[],
  grupper: RegelGrupper,
): RegelSeksjon[] {
  return NIVA_REKKEFOLGE.map((niva) => ({
    key: niva.key,
    label: niva.label,
    regler: sortert.filter((r) => nivaKeyForRegel(r, grupper) === niva.key),
  })).filter((s) => s.regler.length > 0);
}

/** «Treffer i dag»: antall eksisterende observasjoner regelen matcher. Legacy: `tellTreff`. */
export function tellTreff(
  regel: RegelRecord,
  transaksjoner: readonly { tekst?: string | null }[] | null | undefined,
): number {
  return (transaksjoner || []).filter((t) =>
    regelMatcherTekst(regel, normaliserTransaksjonstekst(t.tekst)),
  ).length;
}

/** Feltene en redigering kan endre (samme som legacy-UI-et). */
export type RegelFelt = Partial<
  Pick<
    RegelRecord,
    "pattern" | "normalizedPattern" | "matchType" | "mode" | "confidence" | "active" | "multiUse"
  >
>;

/** Mønsterfeltet lagrer både `pattern` og `normalizedPattern`. Legacy: `RegelMonsterFelt.lagre`. */
export const monsterFelt = (utkast: string): RegelFelt => ({
  pattern: utkast,
  normalizedPattern: utkast.toLowerCase(),
});

/** Legacy: `oppdaterRegel`. */
export function oppdaterRegel(
  prev: readonly RegelRecord[] | null | undefined,
  id: string,
  felt: RegelFelt,
  naa: string,
): RegelRecord[] {
  return (prev || []).map((r) => (r.id !== id ? r : { ...r, ...felt, updatedAt: naa }));
}

/** Legacy: `slettRegel`. */
export function slettRegel(
  prev: readonly RegelRecord[] | null | undefined,
  id: string,
): RegelRecord[] {
  return (prev || []).filter((r) => r.id !== id);
}

/**
 * Slå sammen to regler for samme leverandør: behold den med høyest bruk
 * (`>=` → den første ved likhet), summer bruken, slett den andre.
 * Legacy: `slaSammenRegler`. Én bevisst forskjell i KILDE, ikke i regel:
 * legacy velger og summerer fra render-closurens liste (`alle`); her
 * beregnes alt fra listen updateren får — i transaksjonen den ferske
 * serververdien. I normaltilfellet er de identiske; finnes ikke begge
 * reglene (lenger), er resultatet uendret, som legacy sin tidlige `return`.
 */
export function slaSammenRegler(
  prev: readonly RegelRecord[] | null | undefined,
  aId: string,
  bId: string,
  naa: string,
): RegelRecord[] {
  const liste = prev || [];
  const a = liste.find((r) => r.id === aId);
  const b = liste.find((r) => r.id === bId);
  if (!a || !b) return [...liste];
  const [behold, fjern] = (a.timesUsed || 0) >= (b.timesUsed || 0) ? [a, b] : [b, a];
  return liste
    .filter((r) => r.id !== fjern.id)
    .map((r) =>
      r.id !== behold.id
        ? r
        : { ...r, timesUsed: (behold.timesUsed || 0) + (fjern.timesUsed || 0), updatedAt: naa },
    );
}

/** Valg til sammenslåing: veksle, og behold maks de to sist valgte. Legacy: `toggleValgtForSammenslaing`. */
export function velgForSammenslaing(prev: readonly string[], id: string): string[] {
  return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-2);
}

/**
 * Regler som verken havner i en spareseksjon eller en nivåseksjon (f.eks.
 * en post med en `niva`-verdi utenfor `NIVA_REKKEFOLGE`). Legacy-mobil
 * viser ALLE regler i én liste; legacy-web sin nivågruppering skjuler
 * disse stille. React viser dem i en egen «Øvrige»-seksjon, så ingen
 * regel blir usynlig.
 */
export function ovrigeRegler(
  sortert: readonly RegelRecord[],
  grupper: RegelGrupper,
): RegelRecord[] {
  const vist = new Set(
    [...spareReglerGruppert(sortert, grupper), ...reglerPerNiva(sortert, grupper)].flatMap((s) =>
      s.regler.map((r) => r.id),
    ),
  );
  return sortert.filter((r) => !vist.has(r.id));
}
