import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subscribeBudsjettGrupper } from "@data/budsjettfamilie.repository";
import {
  subscribeHendelser,
  subscribeKvitteringer,
  subscribeTransaksjonRecords,
} from "@data/forsoning.repository";
import { transactForsoningNode } from "@data/forsoningSkriving.repository";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import {
  type VarelinjeUtfall,
  lagreVarelinjer,
  validerVarelinjer,
} from "@domain/forsoning/varelinjer";
import { byggAlleMalPoster } from "@domain/forsoning/fordeling";
import { bakgrunnsforslag } from "@domain/forsoning/kvitteringSkriving";
import { aktiveKvitteringer, forslagIMinnet } from "@domain/forsoning/kvitteringsinnboks";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  HendelseRecord,
  KvitteringRecord,
  MalPost,
  TransaksjonRecord,
  Varelinje,
} from "@app-types/forsoning";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { ForsoningSkrivingStengt, forsoningSkrivingAktiv } from "./forsoningAktivering";
import { useFamilyId } from "./useFamilyId";
import { useForsoningSkriver } from "./useForsoningSkriver";

export interface UseKvitteringsinnboksResult {
  kvitteringer: Loadable<KvitteringRecord[]>;
  /** Kvitteringene med bakgrunnsforslaget beregnet i minnet. */
  medForslag: KvitteringRecord[];
  aktive: KvitteringRecord[];
  transaksjoner: TransaksjonRecord[];
  hendelser: HendelseRecord[];
  /** Kvitteringens plasserbare poster (kostnad + inntekt), til postsøket. */
  poster: MalPost[];
  /** Den felles forsoningsporten — `false` til R3b-cutover. */
  skrivingAktiv: boolean;
  /** Skriver en endring (hendelser → transaksjoner → receipts). Avvises mens porten er av. */
  utfor: (endring: Beslutningsendring) => Promise<void>;
  /**
   * Lagrer de beskrivende varelinjene på én kvittering (#59, C). Bare
   * `varelinjer*` på den kvitteringen røres, mot fersk `receipts`.
   * `forventetVersjon` er `varelinjerVersjon` brukeren startet fra; avviker
   * den, kastes `VarelinjerEndret` og ingenting endres.
   */
  lagreVarelinjer: (
    receiptId: string,
    linjer: Varelinje[],
    forventetVersjon: number,
  ) => Promise<Exclude<VarelinjeUtfall, "konflikt" | "mangler">>;
}

/** Varelinjene er endret et annet sted siden brukeren startet; ingenting er lagret. */
export class VarelinjerEndret extends Error {
  constructor() {
    super(
      "Varelinjene på denne kvitteringen er endret på en annen enhet i mellomtiden. Det du skrev, er tatt vare på.",
    );
    this.name = "VarelinjerEndret";
  }
}

/** Kvitteringen finnes ikke lenger; ingenting er lagret. */
export class KvitteringFinnesIkke extends Error {
  constructor() {
    super("Kvitteringen finnes ikke lenger. Ingenting er lagret; det du skrev, er tatt vare på.");
    this.name = "KvitteringFinnesIkke";
  }
}

/**
 * Kvitteringsinnboksen (§Issue #34 R2) med de skrivende handlingene fra
 * R3b-3. Skriving er stengt bak forsoningsporten til R3b-cutover (ADR
 * 0002); til da er skjermen ren visning og bakgrunnsforslaget beregnes
 * bare i minnet.
 *
 * Med porten på skrives bakgrunnsforslaget som legacy-effekten (~5854):
 * når alle tre nodene er lastet og et forslag faktisk endres, som én
 * helnode-updater mot fersk `receipts`.
 */
export function useKvitteringsinnboks(): UseKvitteringsinnboksResult {
  const familyId = useFamilyId();
  const [kvitteringer, setKvitteringer] = useState<Loadable<KvitteringRecord[]>>(notLoaded);
  const [transaksjoner, setTransaksjoner] = useState<TransaksjonRecord[] | null>(null);
  const [hendelser, setHendelser] = useState<HendelseRecord[] | null>(null);
  const [budgetGroups, setBudgetGroups] = useState<BudsjettGruppe[]>([]);
  const [incomeGroups, setIncomeGroups] = useState<BudsjettGruppe[]>([]);

  useEffect(() => {
    setKvitteringer(loading);
    return subscribeKvitteringer(familyId, (k) => setKvitteringer(loaded(k)));
  }, [familyId]);
  useEffect(() => subscribeTransaksjonRecords(familyId, setTransaksjoner), [familyId]);
  useEffect(() => subscribeHendelser(familyId, setHendelser), [familyId]);
  useEffect(() => subscribeBudsjettGrupper(familyId, "budget", setBudgetGroups), [familyId]);
  useEffect(() => subscribeBudsjettGrupper(familyId, "incomeGroups", setIncomeGroups), [familyId]);

  const ts = useMemo(() => transaksjoner ?? [], [transaksjoner]);
  const hs = useMemo(() => hendelser ?? [], [hendelser]);
  const medForslag = useMemo(
    () =>
      kvitteringer.status === "loaded"
        ? forslagIMinnet(kvitteringer.data, ts, hs, new Date().toISOString())
        : [],
    [kvitteringer, ts, hs],
  );
  const aktive = useMemo(() => aktiveKvitteringer(medForslag, hs), [medForslag, hs]);
  const poster = useMemo(
    () => byggAlleMalPoster(budgetGroups, incomeGroups),
    [budgetGroups, incomeGroups],
  );

  const skrivingAktiv = forsoningSkrivingAktiv();
  const utfor = useForsoningSkriver();
  const skriverForslag = useRef(false);
  useEffect(() => {
    if (!skrivingAktiv || skriverForslag.current) return;
    if (kvitteringer.status !== "loaded" || transaksjoner === null || hendelser === null) return;
    const endring = bakgrunnsforslag(
      kvitteringer.data,
      transaksjoner,
      hendelser,
      new Date().toISOString(),
    );
    if (!endring) return;
    skriverForslag.current = true;
    utfor(endring)
      .catch((err: unknown) => console.error("[Kvitteringsinnboks] Bakgrunnsforslag feilet:", err))
      .finally(() => {
        skriverForslag.current = false;
      });
  }, [skrivingAktiv, kvitteringer, transaksjoner, hendelser, utfor]);

  const lagre = useCallback(
    async (receiptId: string, linjer: Varelinje[], forventetVersjon: number) => {
      if (!forsoningSkrivingAktiv()) throw new ForsoningSkrivingStengt();
      // Ugyldige verdier (null, NaN, negativ rabatt) avvises før transaksjonen.
      validerVarelinjer(linjer);
      const naa = new Date().toISOString();
      let utfall: VarelinjeUtfall = "konflikt";
      await transactForsoningNode<KvitteringRecord>(
        familyId,
        "receipts",
        (prev) => {
          const r = lagreVarelinjer(prev, receiptId, linjer, forventetVersjon, naa);
          // Siste kjøring (mot fersk serververdi) avgjør utfallet.
          utfall = r.utfall;
          return r.neste;
        },
        // Ingen ferdigmelding før serveren har bekreftet lagringen.
        { applyLocally: false },
      );
      if (utfall === "konflikt") throw new VarelinjerEndret();
      if (utfall === "mangler") throw new KvitteringFinnesIkke();
      return utfall;
    },
    [familyId],
  );

  return {
    kvitteringer,
    medForslag,
    aktive,
    transaksjoner: ts,
    hendelser: hs,
    poster,
    skrivingAktiv,
    utfor,
    lagreVarelinjer: lagre,
  };
}
