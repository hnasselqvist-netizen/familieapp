import { useEffect, useMemo, useState } from "react";
import {
  subscribeHendelser,
  subscribeKvitteringer,
  subscribeTransaksjonRecords,
} from "@data/forsoning.repository";
import { aktiveKvitteringer, forslagIMinnet } from "@domain/forsoning/kvitteringsinnboks";
import type { HendelseRecord, KvitteringRecord, TransaksjonRecord } from "@app-types/forsoning";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseKvitteringsinnboksResult {
  kvitteringer: Loadable<KvitteringRecord[]>;
  /** Kvitteringene med bakgrunnsforslaget beregnet I MINNET (aldri skrevet). */
  medForslag: KvitteringRecord[];
  aktive: KvitteringRecord[];
  transaksjoner: TransaksjonRecord[];
  hendelser: HendelseRecord[];
}

/**
 * Kvitteringsinnboksen, kun lesing (§Issue #34 R2). Ingen skrivefunksjoner
 * finnes — kvitteringer registreres, redigeres, kobles og forkastes
 * fortsatt i legacy til R3-cutover (ADR 0002).
 */
export function useKvitteringsinnboks(): UseKvitteringsinnboksResult {
  const familyId = useFamilyId();
  const [kvitteringer, setKvitteringer] = useState<Loadable<KvitteringRecord[]>>(notLoaded);
  const [transaksjoner, setTransaksjoner] = useState<TransaksjonRecord[]>([]);
  const [hendelser, setHendelser] = useState<HendelseRecord[]>([]);

  useEffect(() => {
    setKvitteringer(loading);
    return subscribeKvitteringer(familyId, (k) => setKvitteringer(loaded(k)));
  }, [familyId]);
  useEffect(() => subscribeTransaksjonRecords(familyId, setTransaksjoner), [familyId]);
  useEffect(() => subscribeHendelser(familyId, setHendelser), [familyId]);

  const medForslag = useMemo(
    () =>
      kvitteringer.status === "loaded"
        ? forslagIMinnet(kvitteringer.data, transaksjoner, hendelser, new Date().toISOString())
        : [],
    [kvitteringer, transaksjoner, hendelser],
  );
  const aktive = useMemo(() => aktiveKvitteringer(medForslag, hendelser), [medForslag, hendelser]);

  return { kvitteringer, medForslag, aktive, transaksjoner, hendelser };
}
