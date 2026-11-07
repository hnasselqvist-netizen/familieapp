import { useCallback, useEffect, useState } from "react";
import {
  type SkriveUtfall,
  subscribeFreezer,
  transactFreezerItem,
  transactFreezerNode,
  transactFreezerSamling,
} from "@data/freezer.repository";
import {
  applyBatchAdjustmentToItemFields,
  fjernHvisUendret,
  leggTilVedCommit,
  type MaalvalgAvvisning,
  observertMaal,
  type ResolvedVare,
  type SletteAvvisning,
} from "@domain/freezer/freezer";
import type { FreezerBatch, FreezerItem } from "@app-types/freezer";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface NewBatchInput {
  count: number;
  unit: string;
  gramsPerUnit: number | null;
}

/** Utfall av «Legg til». Alt annet enn `lagret` betyr at ingenting er bekreftet lagret. */
export type LeggTilUtfall = SkriveUtfall<MaalvalgAvvisning>;
/** Utfall av «Fjern varen». `ukjent`: vi vet ikke om posten ble fjernet. */
export type FjernUtfall = SkriveUtfall<SletteAvvisning>;

export interface UseFreezerResult {
  freezer: Loadable<FreezerItem[]>;
  addBatch: (vare: ResolvedVare, batch: NewBatchInput) => Promise<LeggTilUtfall>;
  adjustBatchCount: (itemId: string, batchId: string, delta: number) => Promise<void>;
  /** Fjerner posten bare hvis den er uendret siden `observert` (det brukeren så). */
  removeItem: (observert: FreezerItem) => Promise<FjernUtfall>;
}

/**
 * React-binding for fryseren.
 *
 * `addBatch` velger målpost ved commit med én transaksjon på samlingen
 * (`transactFreezerSamling` + `leggTilVedCommit`, #20 ordre 6698904630): den lokale listen gir bare
 * hvilken post brukeren så (`observertMaal`), selve valget gjøres på fersk
 * serververdi. `adjustBatchCount` muterer via `transactFreezerItem`
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
      const observertId = observertMaal(currentItems(), vare.name);
      const nyNodeId = crypto.randomUUID();
      return transactFreezerSamling<MaalvalgAvvisning>(familyId, (samling) => {
        const r = leggTilVedCommit(samling, vare, newBatch, observertId, nyNodeId);
        return "avvisning" in r ? { avvisning: r.avvisning } : { samling: r.samling };
      });
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
    (observert: FreezerItem) =>
      transactFreezerNode<SletteAvvisning>(familyId, observert.id, (current) =>
        fjernHvisUendret(current, observert),
      ),
    [familyId],
  );

  return { freezer, addBatch, adjustBatchCount, removeItem };
}
