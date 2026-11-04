import { useCallback, useMemo, useRef, useState } from "react";
import { BRED_FLATE, useMediaQuery } from "@hooks/useMediaQuery";
import {
  type AvstemmingsRad,
  avstemmingsmodell,
  berorteNokler,
  medBekreftet,
} from "@domain/avstemming/avstemmingsko";
import { type Avstemmingsoversikt, forrigeMaaned } from "@domain/avstemming/saldoavstemming";
import { KONTOER } from "@domain/forsoning/transaksjonsoversikt";
import type { TransaksjonRecord } from "@app-types/forsoning";
import { AvstemmingMobil } from "./AvstemmingMobil";
import { AvstemmingPC } from "./AvstemmingPC";
import type { AvklarIgnorert, Korrigeringshandlinger, LagreSaldo } from "./korrigeringTyper";
import { SaldoUtkastKontekst, saldoNokkel, useSaldoUtkastLager } from "./saldoUtkast";

export interface AvstemmingViewProps {
  oversikt: Avstemmingsoversikt;
  /** Lagrer faktisk saldo med fortegn (MC-gjeld negativ) for konto/måned. */
  onLagre: LagreSaldo;
  /** Helens avklaring av en ignorert transaksjon: dublett eller ekte bankbevegelse. */
  onAvklarIgnorert: AvklarIgnorert;
  /** Alle transaksjoner, for motposter på andre kontoer. */
  transaksjoner: readonly TransaksjonRecord[];
  /** Reversible korrigeringer fra avvikshjelpen (dublett ↔ ekte bevegelse). */
  korrigering: Korrigeringshandlinger;
  /** Viser året før det tidligste (for startsaldo lenger bak). */
  onVisTidligereAar?: () => void;
}

/**
 * Kontoene bankimporten kjenner (`KONTOER`, legacy ~6555) — kilden til
 * «konfigurerte kontoer» (AV-1, 6542342933). De vises på PC selv uten data.
 */
const KONFIGURERTE = KONTOER.filter((k) => k.id !== "alle").map((k) => k.id);

/**
 * Saldoavstemming per konto og kalendermåned (#59). Helens regnestykke:
 * faktisk saldo forrige måned + månedens importerte bevegelser = beregnet
 * saldo, mot faktisk saldo fra banken. Status er utledet (§domain/avstemming)
 * og revurderes når transaksjonene endres; å lagre en saldo gjør aldri noe
 * «avstemt» av seg selv.
 *
 * AV-1 (#59, 6572970205): på bred flate (fra 64rem) vises en kompakt
 * PC-arbeidsflate fra den felles modellen (`avstemmingsko`); mobil er
 * uendret. Valgt måned, valgt konto og saldoutkast ligger her, over
 * valget, så ingenting går tapt når vinduet endrer bredde.
 */
export function AvstemmingView(props: AvstemmingViewProps) {
  const { oversikt, transaksjoner } = props;
  const bred = useMediaQuery(BRED_FLATE);
  const lager = useSaldoUtkastLager();
  const [maaned, setMaaned] = useState(oversikt.maaneder[0] ?? "");
  const [valgtKonto, setValgtKonto] = useState<string | null>(null);
  // Mobilens «Vis full oversikt» (AV-2) — her, så den står ved breddeskift.
  const [visAlle, setVisAlle] = useState(false);
  const modell = useMemo(
    () => avstemmingsmodell(oversikt, transaksjoner, KONFIGURERTE),
    [oversikt, transaksjoner],
  );
  const { venter, sporet } = useVentendeSkrivinger(props);
  // Alle PC-flater viser den sist bekreftede raden mens en skriving som
  // berører den, venter (review 5764883177). Raden fra før skrivingen
  // startet, ligger i `bekreftet` fra forrige render.
  const bekreftet = useRef<Record<string, AvstemmingsRad>>({});
  const vist = medBekreftet(
    modell,
    bekreftet.current,
    (konto, m) =>
      venter(konto, m) ||
      lager.hent(saldoNokkel(konto, m)).lagrer ||
      lager.hent(saldoNokkel(konto, forrigeMaaned(m))).lagrer,
  );
  bekreftet.current = vist.bekreftet;
  return (
    <SaldoUtkastKontekst.Provider value={lager}>
      {bred ? (
        <AvstemmingPC
          {...props}
          {...sporet}
          modell={vist.modell}
          maaned={maaned}
          onVelgMaaned={setMaaned}
          valgtKonto={valgtKonto}
          onVelgKonto={setValgtKonto}
        />
      ) : (
        <AvstemmingMobil
          {...props}
          {...sporet}
          modell={vist.modell}
          maaned={maaned}
          onVelgMaaned={setMaaned}
          visAlle={visAlle}
          onVisAlle={setVisAlle}
        />
      )}
    </SaldoUtkastKontekst.Provider>
  );
}

/**
 * Skrivinger som ikke er bekreftet ennå, per konto/måned. Databasen viser en
 * lokal skriving før serveren har bekreftet den; på PC skal ingen rad se
 * løst ut før lagringen er bekreftet (6572970205), så raden viser «Lagrer…»
 * så lenge en skriving som berører den, venter.
 */
function useVentendeSkrivinger({
  transaksjoner,
  onAvklarIgnorert,
  korrigering,
}: AvstemmingViewProps): {
  venter: (konto: string, maaned: string) => boolean;
  sporet: Pick<AvstemmingViewProps, "onAvklarIgnorert" | "korrigering">;
} {
  const [ventende, setVentende] = useState<Record<string, number>>({});
  const endre = useCallback((nokler: string[], d: number) => {
    setVentende((v) => {
      const n = { ...v };
      for (const k of nokler) {
        n[k] = (n[k] ?? 0) + d;
        if (n[k]! <= 0) delete n[k];
      }
      return n;
    });
  }, []);
  const sporet = useMemo(() => {
    // Alle rader skrivingen kan endre, fra grunnlaget FØR skrivingen —
    // også motpostkontoen og -måneden og koblede motparter (5765532045).
    const nokkel = (id: string, ekstra: { konto: string; dato: string }[] = []) =>
      berorteNokler(transaksjoner, id, ekstra);
    const spor =
      <A extends unknown[]>(fn: (...a: A) => Promise<void>, nokler: (...a: A) => string[]) =>
      async (...a: A) => {
        const k = [...new Set(nokler(...a))];
        endre(k, 1);
        try {
          await fn(...a);
        } finally {
          endre(k, -1);
        }
      };
    const k = korrigering;
    return {
      onAvklarIgnorert: spor(onAvklarIgnorert, (id) => nokkel(id)),
      korrigering: {
        merkDublett: spor(k.merkDublett, (id) => nokkel(id)),
        angreDublett: spor(k.angreDublett, (id) => nokkel(id)),
        omklassifiser: spor(k.omklassifiser, (id) => nokkel(id)),
        leggTilMotpost: spor(k.leggTilMotpost, (id, konto, dato) => nokkel(id, [{ konto, dato }])),
        bekreftMotpostPaaNytt: spor(k.bekreftMotpostPaaNytt, (id, konto, dato) =>
          nokkel(id, [{ konto, dato }]),
        ),
        angreMotpost: spor(k.angreMotpost, (id) => nokkel(id)),
        avsluttMotpost: spor(k.avsluttMotpost, (id) => nokkel(id)),
        kobleImportert: spor(k.kobleImportert, (kilde, motpost) => [
          ...nokkel(kilde),
          ...nokkel(motpost),
        ]),
      },
    };
  }, [transaksjoner, onAvklarIgnorert, korrigering, endre]);
  const venter = useCallback(
    (konto: string, maaned: string) => (ventende[saldoNokkel(konto, maaned)] ?? 0) > 0,
    [ventende],
  );
  return { venter, sporet };
}
