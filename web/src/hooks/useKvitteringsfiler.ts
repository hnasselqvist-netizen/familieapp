import { useCallback, useMemo } from "react";
import type { KvitteringFil, KvitteringRecord } from "@app-types/forsoning";
import { transactForsoningNode } from "@data/forsoningSkriving.repository";
import {
  hentKvitteringsfil,
  lastOppKvitteringsfil,
  vedleggTjenesteAktiv,
} from "@data/kvitteringsfil.repository";
import {
  FILAVVISNING_TEKST,
  type MedFilUtfall,
  medKvitteringsfil,
  validerFil,
} from "@domain/forsoning/kvitteringsfil";
import { forsoningSkrivingAktiv } from "./forsoningAktivering";
import { useAuthUser } from "./useAuthUser";
import { useFamilyId } from "./useFamilyId";

/** Er vedleggstjenesten slått på (produksjonsaktivering AV som standard)? */
export const kvitteringsfilerAktiv = (): boolean => vedleggTjenesteAktiv();

/** En avvisning brukeren skal se (validering eller kvittering som mangler). */
export class KvitteringsfilAvvist extends Error {
  constructor(melding: string) {
    super(melding);
    this.name = "KvitteringsfilAvvist";
  }
}

export interface Kvitteringsfiler {
  /** Tjenesten er slått på (VITE_VEDLEGG_TJENESTE=aktiv). */
  aktiv: boolean;
  /** Opplasting krever i tillegg skriveporten for forsoningsnodene. */
  kanLasteOpp: boolean;
  /**
   * Validerer, laster opp originalbytene og legger metadata til kvitteringen
   * (stabil id, helnode-transaksjon). Løses først når metadataen er bekreftet
   * lagret. Kan trygt prøves igjen: samme fil gir samme sti og ingen duplikat.
   */
  lastOpp: (r: KvitteringRecord, fil: File) => Promise<void>;
  hent: (r: KvitteringRecord, f: KvitteringFil) => Promise<Blob>;
}

export function useKvitteringsfiler(): Kvitteringsfiler {
  const familyId = useFamilyId();
  const bruker = useAuthUser();
  const hvem = bruker ? bruker.displayName || bruker.email || bruker.uid : "ukjent";
  const aktiv = vedleggTjenesteAktiv();

  const lastOpp = useCallback(
    async (r: KvitteringRecord, fil: File) => {
      const start = new Uint8Array(await fil.slice(0, 16).arrayBuffer());
      const sjekk = validerFil(start, fil.size);
      if (!sjekk.ok) throw new KvitteringsfilAvvist(FILAVVISNING_TEKST[sjekk.feil]);
      const lagret = await lastOppKvitteringsfil(familyId, r.id, fil);
      const meta: KvitteringFil = {
        sha256: lagret.sha256,
        type: lagret.type,
        storrelse: lagret.storrelse,
        filnavn: fil.name || "kvittering",
        lastetOpp: new Date().toISOString(),
        av: hvem,
      };
      let utfall = "lagt_til" as MedFilUtfall;
      await transactForsoningNode<KvitteringRecord>(
        familyId,
        "receipts",
        (prev) => {
          const res = medKvitteringsfil(prev, r.id, meta);
          utfall = res.utfall;
          return res.neste;
        },
        { applyLocally: false },
      );
      if (utfall === "kvittering_mangler") {
        throw new KvitteringsfilAvvist(
          "Kvitteringen finnes ikke lenger. Filen er lagret, men ikke koblet.",
        );
      }
    },
    [familyId, hvem],
  );

  const hent = useCallback(
    (r: KvitteringRecord, f: KvitteringFil) => hentKvitteringsfil(familyId, r.id, f.sha256),
    [familyId],
  );

  return useMemo(
    () => ({ aktiv, kanLasteOpp: aktiv && forsoningSkrivingAktiv(), lastOpp, hent }),
    [aktiv, lastOpp, hent],
  );
}
