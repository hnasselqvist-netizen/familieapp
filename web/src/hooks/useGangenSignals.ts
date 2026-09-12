import { useEffect, useState } from "react";
import {
  subscribeBankHendelser,
  subscribeReceipts,
  subscribeTransaksjoner,
} from "@data/gangen.repository";
import { tellKvitteringerKlareForKobling, tellTrengerVurdering } from "@domain/gangen/gangen";
import type { BankHendelse, BankTransaksjon, Kvittering } from "@app-types/gangen";
import { type Loadable, loaded, loading } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface GangenSignals {
  trengerVurdering: number;
  kvitteringerKlareForKobling: number;
}

/**
 * Kombinerer de tre uavhengige Bankimport/Kvittering-abonnementene
 * Gangen trenger til ett `Loadable`-resultat — speiler produksjonens
 * `coreDataStatus` (§index.html linje 2466-2477): Gangen skal ALDRI
 * konkludere ("ingenting venter") basert på data som ikke har ankommet
 * ennå, så `status` blir først `"loaded"` når ALLE TRE kildene har fått
 * sitt første snapshot — ikke bare den raskeste.
 */
export function useGangenSignals(): Loadable<GangenSignals> {
  const familyId = useFamilyId();
  const [transaksjoner, setTransaksjoner] = useState<BankTransaksjon[] | null>(null);
  const [hendelser, setHendelser] = useState<BankHendelse[] | null>(null);
  const [receipts, setReceipts] = useState<Kvittering[] | null>(null);

  useEffect(() => {
    setTransaksjoner(null);
    setHendelser(null);
    setReceipts(null);
    const unsubTransaksjoner = subscribeTransaksjoner(familyId, setTransaksjoner);
    const unsubHendelser = subscribeBankHendelser(familyId, setHendelser);
    const unsubReceipts = subscribeReceipts(familyId, setReceipts);
    return () => {
      unsubTransaksjoner();
      unsubHendelser();
      unsubReceipts();
    };
  }, [familyId]);

  if (transaksjoner === null || hendelser === null || receipts === null) {
    return loading;
  }

  return loaded({
    trengerVurdering: tellTrengerVurdering(transaksjoner, hendelser),
    kvitteringerKlareForKobling: tellKvitteringerKlareForKobling(receipts),
  });
}
