import { useCallback, useEffect, useState } from "react";
import { deleteFreezerItem, subscribeFreezer, transactFreezerItem } from "@data/freezer.repository";
import {
  applyBatchAdjustmentToItemFields,
  applyNewBatchToItemFields,
  type ResolvedVare,
} from "@domain/freezer/freezer";
import type { FreezerBatch, FreezerItem } from "@app-types/freezer";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface NewBatchInput {
  count: number;
  unit: string;
  gramsPerUnit: number | null;
}

export interface UseFreezerResult {
  freezer: Loadable<FreezerItem[]>;
  addBatch: (vare: ResolvedVare, batch: NewBatchInput) => Promise<void>;
  adjustBatchCount: (itemId: string, batchId: string, delta: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
}

/**
 * React-binding for fryseren.
 *
 * `addBatch`/`adjustBatchCount` muterer via `transactFreezerItem`
 * (§data/freezer.repository.ts), IKKE ved å regne ut neste verdi fra
 * lokal React-tilstand og skrive den ubetinget: to raske, konkurrerende
 * kall (to "+"-klikk, to batch-endringer på samme vare før
 * `onValue` har rukket å oppdatere `freezer`) ville ellers begge kunne
 * lese samme utdaterte utgangspunkt og la den siste skrivingen vinne —
 * nøyaktig den klassen bug den nye grunnmuren skal beskytte mot
 * (§Kontrolltårn-review, Fase 0 runde 2). `currentItems()` brukes KUN
 * til å slå opp HVILKEN post-id en operasjon gjelder (f.eks. "finnes det
 * allerede en fryserpost med dette varenavnet"), aldri til å regne ut
 * selve den nye verdien — det gjør transaksjonens `updater` mot
 * Firebase sin faktiske, ferskeste serververdi.
 */
export function useFreezer(): UseFreezerResult {
  const familyId = useFamilyId();
  const [freezer, setFreezer] = useState<Loadable<FreezerItem[]>>(notLoaded);

  useEffect(() => {
    setFreezer(loading);
    const unsubscribe = subscribeFreezer(familyId, (data) => setFreezer(loaded(data)));
    return unsubscribe;
  }, [familyId]);

  const currentItems = useCallback((): FreezerItem[] => {
    return freezer.status === "loaded" ? freezer.data : [];
  }, [freezer]);

  const addBatch = useCallback(
    async (vare: ResolvedVare, batchInput: NewBatchInput) => {
      const newBatch: FreezerBatch = { id: crypto.randomUUID(), ...batchInput };
      const existing = currentItems().find((i) => i.name.toLowerCase() === vare.name.toLowerCase());
      const targetItemId = existing?.id ?? crypto.randomUUID();
      await transactFreezerItem(familyId, targetItemId, (current) =>
        applyNewBatchToItemFields(current, vare, newBatch),
      );
    },
    [familyId, currentItems],
  );

  const adjustBatchCount = useCallback(
    async (itemId: string, batchId: string, delta: number) => {
      await transactFreezerItem(familyId, itemId, (current) =>
        current ? applyBatchAdjustmentToItemFields(current, batchId, delta) : null,
      );
    },
    [familyId],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      await deleteFreezerItem(familyId, itemId);
    },
    [familyId],
  );

  return { freezer, addBatch, adjustBatchCount, removeItem };
}
