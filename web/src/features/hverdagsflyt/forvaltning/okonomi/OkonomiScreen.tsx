import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import { RoomHeader } from "@components/RoomHeader";
import { MonthNav } from "@features/hverdagsflyt/forvaltning/budsjettfamilie/MonthNav";
import { type Belop, beregnOkonomibilde } from "@domain/budsjettfamilie/okonomi";
import { useBudsjettfamilie } from "@hooks/useBudsjettfamilie";
import type { BudsjettfamilieNode } from "@app-types/budsjettfamilie";
import { type Omrade } from "./okonomiLenke";
import styles from "./OkonomiScreen.module.css";
import { OmradeGrupper } from "./OmradeGrupper";

const OMRADER: { omrade: Omrade; navn: string; node: BudsjettfamilieNode }[] = [
  { omrade: "inntekter", navn: "Inntekter", node: "incomeGroups" },
  { omrade: "kostnader", navn: "Kostnader", node: "budget" },
  { omrade: "sparing", navn: "Sparing", node: "sparingGroups" },
];

const kr = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(n);

/**
 * `/forvaltning/okonomi` — inntekter, kostnader og sparing som én samlet
 * flate (Forvaltning produktfase, #59; Kontrolltårnet 6000881287).
 * Erstatter de tre separate toppnivåskjermene Budsjett, Inntekter og
 * Sparing; de gamle rutene sender hit med riktig område valgt.
 *
 *  - Én månedsvelger for alle tre områdene, så tallene alltid gjelder
 *    samme periode.
 *  - Sammendraget øverst er samtidig områdevelgeren: én rad per område med
 *    hittil/budsjett, og netto under. Ett område er åpent av gangen.
 *  - Gruppene, postredigering og drilldown er uendret (`OmradeGrupper`).
 *
 * Tallene regnes med `beregnOkonomibilde`, samme funksjon som forsidens
 * økonomikort, så forsiden og denne flaten viser alltid like tall.
 */
export function OkonomiScreen() {
  const [params, setParams] = useSearchParams();
  const valgt = OMRADER.find((o) => o.omrade === params.get("omrade")) ?? OMRADER[1]!;
  const [month, setMonth] = useState(() => new Date().getMonth());

  const inntekter = useBudsjettfamilie("incomeGroups", month);
  const kostnader = useBudsjettfamilie("budget", month);
  const sparing = useBudsjettfamilie("sparingGroups", month);
  const bf = { inntekter, kostnader, sparing };

  if (
    inntekter.grupper.status !== "loaded" ||
    kostnader.grupper.status !== "loaded" ||
    sparing.grupper.status !== "loaded"
  ) {
    return <div className={styles.laster}>Laster…</div>;
  }

  // Faktisk-totalene er de samme for alle tre nodene (samme hendelser).
  const bilde = beregnOkonomibilde(
    {
      incomeGroups: inntekter.grupper.data,
      budgetGroups: kostnader.grupper.data,
      sparingGroups: sparing.grupper.data,
    },
    month,
    kostnader.actualTotals,
  );
  const aktiv = bf[valgt.omrade];
  const aktiveGrupper = aktiv.grupper.status === "loaded" ? aktiv.grupper.data : [];

  const velg = (omrade: Omrade) => setParams({ omrade }, { replace: true });

  return (
    <div className={styles.side}>
      <RoomHeader
        eyebrow="FORVALTNING"
        title="Økonomien"
        description="Inntekter, kostnader og sparing"
      />
      <MonthNav month={month} onChange={setMonth} />

      <Card>
        <div className={styles.kolonneHode} aria-hidden>
          <span />
          <span>Hittil</span>
          <span>Budsjett</span>
        </div>
        <div role="tablist" aria-label="Område">
          {OMRADER.map((o) => {
            const erValgt = o.omrade === valgt.omrade;
            return (
              <button
                key={o.omrade}
                type="button"
                role="tab"
                id={`omrade-${o.omrade}`}
                aria-selected={erValgt}
                aria-controls="omrade-panel"
                className={`${styles.rad} ${erValgt ? styles.valgt : ""}`}
                onClick={() => velg(o.omrade)}
              >
                <span className={styles.navn}>
                  {o.navn}
                  {erValgt && <Icon name="chevron-down" size={14} />}
                </span>
                <span className={styles.belop}>{kr(bilde[o.omrade].faktisk)}</span>
                <span className={styles.belopSoft}>{kr(bilde[o.omrade].budsjett)}</span>
              </button>
            );
          })}
        </div>
        <NettoRad belop={bilde.igjen} />
      </Card>

      <section role="tabpanel" id="omrade-panel" aria-label={valgt.navn} className={styles.panel}>
        <OmradeGrupper
          key={valgt.omrade}
          node={valgt.node}
          grupper={aktiveGrupper}
          bf={aktiv}
          emptyMessage={
            valgt.omrade === "sparing"
              ? (g) => `Ingen poster i «${g.label}» ennå. Legg til under.`
              : undefined
          }
        />
      </section>
    </div>
  );
}

function NettoRad({ belop }: { belop: Belop }) {
  return (
    <div className={`${styles.rad} ${styles.netto}`}>
      <span className={styles.navn}>Netto</span>
      {/* Nøytral farge, som på forsiden: netto hittil er ofte negativ
          tidlig i måneden — det er informasjon, ikke en alarm. */}
      <span className={styles.belop}>{kr(belop.faktisk)}</span>
      <span className={styles.belopSoft}>{kr(belop.budsjett)}</span>
    </div>
  );
}
