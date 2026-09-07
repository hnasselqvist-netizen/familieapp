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
 *
 * §Kontrolltårn-review (Fase 0, runde 2): de to `...ItemFields`-
 * funksjonene er kjernen i fiksen for stale-state/lost-update-risikoen
 * som ble påpekt i useFreezer. De opererer på verdien til ÉN
 * fryserpost-node (samme form som faktisk lagres i Firebase — uten
 * `id`, siden id-en er stien, ikke et felt), og er designet for å kalles
 * inne i en RTDB-transaksjon (§data/freezer.repository.ts sin
 * `transactFreezerItem`), der Firebase selv garanterer at `current`
 * alltid er den ferskeste server-verdien — aldri en potensielt utdatert
 * React-tilstand. `addBatch`/`adjustBatchCount` (liste-scoped) er bevart
 * med uendret oppførsel for karakteriseringstestene, men bygger nå på
 * de samme feltfunksjonene i stedet for å duplisere regelen.
 */
import type { FreezerBatch, FreezerItem, FreezerItemFields } from "@app-types/freezer";

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
 * Slår en ny batch sammen med en eksisterende batch-liste: samme
 * enhet+gramsPerUnit øker antallet på den eksisterende batchen, ellers
 * legges `newBatch` til som en ny batch. Den ene, delte kjernen bak både
 * liste- og ett-post-variantene under.
 */
function mergeBatchIntoBatches(batches: FreezerBatch[], newBatch: FreezerBatch): FreezerBatch[] {
  const sameSize = batches.find(
    (b) => b.unit === newBatch.unit && b.gramsPerUnit === newBatch.gramsPerUnit,
  );
  if (!sameSize) return [...batches, newBatch];
  return batches.map((b) => (b.id === sameSize.id ? { ...b, count: b.count + newBatch.count } : b));
}

/**
 * Ett-post-variant av "legg til batch" — opererer på gjeldende verdi for
 * ÉN fryserpost-node (eller `null` hvis posten ikke finnes ennå), ikke på
 * hele listen. Kalleren har allerede avgjort HVILKEN post (id/sti) dette
 * gjelder (typisk ved å slå opp på varenavn før transaksjonen startes) —
 * denne funksjonen tar ingen beslutning om hvilken post det er, kun hva
 * den nye verdien for akkurat den posten skal være.
 */
export function applyNewBatchToItemFields(
  current: FreezerItemFields | null,
  vare: ResolvedVare,
  newBatch: FreezerBatch,
): FreezerItemFields {
  if (!current) {
    return { itemId: vare.id, name: vare.name, batches: [newBatch] };
  }
  return { ...current, itemId: vare.id, batches: mergeBatchIntoBatches(current.batches, newBatch) };
}

/**
 * Ett-post-variant av "juster batch-antall". Returnerer `null` når posten
 * skal fjernes helt (siste batch nådde 0) — matcher `adjustBatchCount`
 * sin liste-oppførsel, uttrykt som "denne noden skal ikke lenger finnes"
 * i stedet for "filtrert bort fra en liste".
 */
export function applyBatchAdjustmentToItemFields(
  current: FreezerItemFields,
  batchId: string,
  delta: number,
): FreezerItemFields | null {
  const batches = current.batches
    .map((b) => (b.id !== batchId ? b : { ...b, count: Math.max(0, b.count + delta) }))
    .filter((b) => b.count > 0);
  return batches.length > 0 ? { ...current, batches } : null;
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
 *
 * Liste-scoped variant, bevart for karakteriseringstestene — selve
 * skrivingen til Firebase bruker `applyNewBatchToItemFields` via en
 * transaksjon (§data/freezer.repository.ts), ikke denne.
 */
export function addBatch(
  items: FreezerItem[],
  vare: ResolvedVare,
  newBatch: FreezerBatch,
  newItemId: string,
): FreezerItem[] {
  const existing = items.find((i) => i.name.toLowerCase() === vare.name.toLowerCase());
  const fields = applyNewBatchToItemFields(existing ?? null, vare, newBatch);
  if (!existing) return [...items, { id: newItemId, ...fields }];
  return items.map((i) => (i.id === existing.id ? { id: i.id, ...fields } : i));
}

/**
 * Justerer antallet på én batch med `delta` (kan være negativ). En
 * batch som når 0 fjernes; en fryserpost uten gjenværende batcher
 * fjernes helt — nøyaktig dagens oppførsel (§adjustBatch/removeItem).
 *
 * Liste-scoped variant, bevart for karakteriseringstestene — selve
 * skrivingen til Firebase bruker `applyBatchAdjustmentToItemFields` via
 * en transaksjon (§data/freezer.repository.ts), ikke denne.
 */
export function adjustBatchCount(
  items: FreezerItem[],
  itemId: string,
  batchId: string,
  delta: number,
): FreezerItem[] {
  return items.flatMap((i) => {
    if (i.id !== itemId) return [i];
    const next = applyBatchAdjustmentToItemFields(i, batchId, delta);
    return next ? [{ id: i.id, ...next }] : [];
  });
}

/** Fjerner en fryserpost i sin helhet, uavhengig av batch-innhold. */
export function removeFreezerItem(items: FreezerItem[], itemId: string): FreezerItem[] {
  return items.filter((i) => i.id !== itemId);
}
