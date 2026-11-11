import { useEffect, useMemo, useRef } from "react";
import { type Location, useBlocker, useSearchParams } from "react-router-dom";
import { Retur } from "@components/Retur";
import { type Seksjon, arbeidsko } from "@domain/forsoning/transaksjonsoversikt";
import { lesOversiktTilstand, skrivOversiktTilstand } from "@domain/forsoning/oversiktUrl";
import { useTransaksjonsoversikt } from "@hooks/useTransaksjonsoversikt";
import styles from "./TransaksjonsoversiktScreen.module.css";
import { TransaksjonsoversiktView } from "./TransaksjonsoversiktView";

/**
 * Transaksjoner (§Issue #34 R3-les) — kun visning. Ikke koblet til
 * hovednavigasjonen; nåbar på `/forvaltning/transaksjoner`. Legacy-
 * Bankimport i `index.html` er urørt og forblir eneste skriver.
 */
const KOER: readonly Seksjon[] = ["vurdering", "forslag", "paavent"];

export function TransaksjonsoversiktScreen() {
  const data = useTransaksjonsoversikt();
  const [params, setParams] = useSearchParams();
  // Visning, filtre, sortering og valgt transaksjon ligger i URL-en (#59,
  // PC-2): reload, dyplenke og tilbake/frem gir samme utvalg og valg.
  // Ugyldige verdier normaliseres; andre parametre (ko, verktoy, fra) står.
  const tilstand = useMemo(() => lesOversiktTilstand(params), [params]);
  // Ulagret korrigering (PC-2): tilbake/frem, lenker og reload som ville
  // forlatt valget, holdes igjen til brukeren har valgt synlig. Søk, filter
  // og sortering endrer ikke valget og går fritt.
  const korrigerer = useRef(false);
  const blokkering = useBlocker(
    ({ currentLocation, nextLocation }) =>
      korrigerer.current && forlaterValget(currentLocation, nextLocation),
  );
  useEffect(() => {
    const vakt = (e: BeforeUnloadEvent) => {
      if (korrigerer.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", vakt);
    return () => window.removeEventListener("beforeunload", vakt);
  }, []);
  const ko = params.get("ko");
  const startSeksjon = KOER.find((s) => s === ko) ?? "vurdering";
  if (data.transaksjoner.status !== "loaded") {
    return <div className={styles.laster}>Laster…</div>;
  }
  const startMedImport = params.get("verktoy") === "import";
  const koer = arbeidsko(data.transaksjoner.data, data.hendelser, data.rules);
  // Kom brukeren for å importere, er en tom kø ikke «ferdig» — da har hun
  // bare ikke importert ennå. Returen er da en vanlig lenke.
  const vurdert = koer.vurdering.length === 0 && koer.forslag.length === 0;
  return (
    <>
      <Retur ferdig={!startMedImport && vurdert} ferdigTekst="Alt er vurdert." />
      <TransaksjonsoversiktView
        transaksjoner={data.transaksjoner.data}
        hendelser={data.hendelser}
        receipts={data.receipts}
        rules={data.rules}
        budgetGroups={data.budgetGroups}
        incomeGroups={data.incomeGroups}
        sparingGroups={data.sparingGroups}
        liquidityPosts={data.liquidityPosts}
        skrivingAktiv={data.skrivingAktiv}
        onUtfor={data.utfor}
        startSeksjon={startSeksjon}
        startMedImport={startMedImport}
        kontroller={data.kontroller}
        onSettKvalitetssikring={data.settKvalitetssikring}
        tilstand={tilstand}
        onTilstand={(ny, { replace }) =>
          setParams((forrige) => skrivOversiktTilstand(forrige, ny), { replace })
        }
        onKorrigerer={(aktiv) => {
          korrigerer.current = aktiv;
        }}
        navigasjonVenter={
          blokkering.state === "blocked"
            ? { fortsett: () => blokkering.reset(), forkast: () => blokkering.proceed() }
            : null
        }
      />
    </>
  );
}

/** Navigasjonen bytter side eller valgt transaksjon. */
function forlaterValget(fra: Location, til: Location): boolean {
  if (fra.pathname !== til.pathname) return true;
  const valgt = (l: Location) => lesOversiktTilstand(new URLSearchParams(l.search)).valgt;
  return valgt(fra) !== valgt(til);
}
