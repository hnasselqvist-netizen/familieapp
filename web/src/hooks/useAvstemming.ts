import { useCallback, useEffect, useMemo, useState } from "react";
import { subscribeTransaksjonRecords } from "@data/forsoning.repository";
import { lagreSaldokontroll, subscribeSaldokontroller } from "@data/saldokontroller.repository";
import {
  type Avstemmingsoversikt,
  avstemmingsoversikt,
  byggSaldoKontroll,
  finnKontroll,
} from "@domain/avstemming/saldoavstemming";
import { settStatus } from "@domain/forsoning/beslutning";
import type { SaldoKontroll } from "@app-types/avstemming";
import type { IgnorertSom, TransaksjonRecord } from "@app-types/forsoning";
import { type Loadable, loaded, loading } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";
import { useForsoningSkriver } from "./useForsoningSkriver";

export interface Avstemming {
  oversikt: Avstemmingsoversikt;
}

export interface UseAvstemmingResult {
  avstemming: Loadable<Avstemming>;
  /** Lagrer faktisk saldo (med fortegn, se `fraVisningsSaldo`) for konto/måned. */
  lagreSaldo: (konto: string, maaned: string, faktiskSaldo: number) => Promise<void>;
  /**
   * Helens avklaring av en ignorert transaksjon (#59, 6062856860): legger
   * bare til `ignorertSom` — statusen forblir «ignorert». Skrives som
   * resten av forsoningen, bak forsoningsporten.
   */
  avklarIgnorert: (transaksjonId: string, som: IgnorertSom) => Promise<void>;
}

/**
 * Saldoavstemming (#59). Leser transaksjonene og kontrollpunktene og
 * utleder statusen hver gang en av dem endres — ingenting av statusen er
 * lagret. Eneste skriving er kontrollpunktet selv, med et øyeblikksbilde av
 * månedens grunnlag fra de FERSKESTE transaksjonene.
 */
export function useAvstemming(): UseAvstemmingResult {
  const familyId = useFamilyId();
  const [transaksjoner, setTransaksjoner] = useState<TransaksjonRecord[] | null>(null);
  const [kontroller, setKontroller] = useState<SaldoKontroll[] | null>(null);
  const skriv = useForsoningSkriver();

  useEffect(() => subscribeTransaksjonRecords(familyId, setTransaksjoner), [familyId]);
  useEffect(() => subscribeSaldokontroller(familyId, setKontroller), [familyId]);

  const avstemming = useMemo<Loadable<Avstemming>>(() => {
    if (!transaksjoner || !kontroller) return loading;
    return loaded({ oversikt: avstemmingsoversikt(transaksjoner, kontroller, new Date()) });
  }, [transaksjoner, kontroller]);

  const lagreSaldo = useCallback(
    async (konto: string, maaned: string, faktiskSaldo: number) => {
      const eksisterende = finnKontroll(kontroller ?? [], konto, maaned);
      await lagreSaldokontroll(
        familyId,
        byggSaldoKontroll(
          transaksjoner ?? [],
          eksisterende,
          konto,
          maaned,
          faktiskSaldo,
          new Date().toISOString(),
        ),
      );
    },
    [familyId, transaksjoner, kontroller],
  );

  const avklarIgnorert = useCallback(
    (transaksjonId: string, som: IgnorertSom) =>
      skriv(settStatus(transaksjonId, "ignorert", { ignorertSom: som })),
    [skriv],
  );

  return { avstemming, lagreSaldo, avklarIgnorert };
}
