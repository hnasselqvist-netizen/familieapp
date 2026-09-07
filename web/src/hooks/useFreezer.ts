import { useCallback, useEffect, useState } from "react";
import { deleteFreezerItem, subscribeFreezer, writeFreezerItem } from "@data/freezer.repository";
import {
  addBatch as addBatchToItems,
  adjustBatchCount as adjustBatchCountInItems,
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
 * React-binding for fryseren. Domenelogikken (§domain/freezer/freezer.ts)
 * regner ut det nye øyeblikksbildet; denne hooken skriver KUN den ene
 * fryserposten som faktisk endret seg til Firebase — aldri hele samlingen.
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
      const items = currentItems();
      const newBatch: FreezerBatch = { id: crypto.randomUUID(), ...batchInput };
      const newItemId = crypto.randomUUID();
      const next = addBatchToItems(items, vare, newBatch, newItemId);
      const affected = next.find((i) => i.name.toLowerCase() === vare.name.toLowerCase());
      if (affected) await writeFreezerItem(familyId, affected);
    },
    [familyId, currentItems],
  );

  const adjustBatchCount = useCallback(
    async (itemId: string, batchId: string, delta: number) => {
      const items = currentItems();
      const next = adjustBatchCountInItems(items, itemId, batchId, delta);
      const stillExists = next.find((i) => i.id === itemId);
      if (stillExists) {
        await writeFreezerItem(familyId, stillExists);
      } else {
        await deleteFreezerItem(familyId, itemId);
      }
    },
    [familyId, currentItems],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      await deleteFreezerItem(familyId, itemId);
    },
    [familyId],
  );

  return { freezer, addBatch, adjustBatchCount, removeItem };
}
