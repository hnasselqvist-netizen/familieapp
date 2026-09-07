/**
 * Fryser-motoren — rene funksjoner, ingen React, ingen Firebase.
 *
 * Portert 1:1 fra oppførselen til FreezerScreen i dagens index.html
 * (linje ~5077–5121: add/adjustBatch/batchLabel/totalGrams). Eneste
 * bevisste endring: id-generering er flyttet UT av disse funksjonene
 * og inn til kalleren (se src/hooks/useFreezer.ts) — funksjonene her
 * er dermed fullt deterministiske og krever ingen mocking i tester.
 * Selve regelen ("samme enhet + samme gram-per-enhet slås sammen,
 * ellers ny batch") er ikke endret.
 */
import type { FreezerBatch, FreezerItem } from "@app-types/freezer";

/** Menneskelesbar etikett for én batch — f.eks. "2 pk à 500 g" eller "3 stk". */
export function batchLabel(batch: FreezerBatch): string {
  if (batch.gramsPerUnit) return `${batch.count} ${batch.unit} à ${batch.gramsPerUnit} g`;
  if (batch.unit !== "stk") return `${batch.count} ${batch.unit}`;
  return `${batch.count} stk`;
}

/** Summert gramvekt på tvers av alle batcher som faktisk har gramsPerUnit satt. */
export function totalGrams(item: FreezerItem): number | null {
  const total = item.batches.reduce(
    (sum, b) => (b.gramsPerUnit ? sum + b.count * b.gramsPerUnit : sum),
    0,
  );
  return total > 0 ? total : null;
}

export interface ResolvedVare {
  id: string;
  name: string;
}

/**
 * Legger en ny batch til fryseren for en gitt (allerede funnet-eller-
 * opprettet) vare. Matcher eksisterende fryserpost på navn
 * (case-insensitivt — som i dag). Finnes posten fra før OG finnes en
 * batch med samme enhet+gramsPerUnit, økes antallet på den eksisterende
 * batchen. Ellers legges en ny batch til, eller en helt ny fryserpost
 * opprettes.
 *
 * `newBatch` og `newItemId` er ferdig genererte id-er fra kalleren —
 * denne funksjonen tar ingen beslutning om ID-er selv.
 */
export function addBatch(
  items: FreezerItem[],
  vare: ResolvedVare,
  newBatch: FreezerBatch,
  newItemId: string,
): FreezerItem[] {
  const existing = items.find((i) => i.name.toLowerCase() === vare.name.toLowerCase());
  if (!existing) {
    return [...items, { id: newItemId, itemId: vare.id, name: vare.name, batches: [newBatch] }];
  }
  const sameSize = existing.batches.find(
    (b) => b.unit === newBatch.unit && b.gramsPerUnit === newBatch.gramsPerUnit,
  );
  const newBatches = sameSize
    ? existing.batches.map((b) =>
        b.id === sameSize.id ? { ...b, count: b.count + newBatch.count } : b,
      )
    : [...existing.batches, newBatch];
  return items.map((i) =>
    i.id === existing.id ? { ...i, itemId: vare.id, batches: newBatches } : i,
  );
}

/**
 * Justerer antallet på én batch med `delta` (kan være negativ). En
 * batch som når 0 fjernes; en fryserpost uten gjenværende batcher
 * fjernes helt — nøyaktig dagens oppførsel (§adjustBatch/removeItem).
 */
export function adjustBatchCount(
  items: FreezerItem[],
  itemId: string,
  batchId: string,
  delta: number,
): FreezerItem[] {
  return items
    .map((i) => {
      if (i.id !== itemId) return i;
      return {
        ...i,
        batches: i.batches
          .map((b) => (b.id !== batchId ? b : { ...b, count: Math.max(0, b.count + delta) }))
          .filter((b) => b.count > 0),
      };
    })
    .filter((i) => i.batches.length > 0);
}

/** Fjerner en fryserpost i sin helhet, uavhengig av batch-innhold. */
export function removeFreezerItem(items: FreezerItem[], itemId: string): FreezerItem[] {
  return items.filter((i) => i.id !== itemId);
}
