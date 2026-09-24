import { useState } from "react";
import { Card } from "@components/Card";
import { BUDGET_EIER } from "@domain/budsjettfamilie/budsjettfamilie";
import {
  NIVA_REKKEFOLGE,
  summerAlleGrupperAar,
  summerEtterEier,
  summerGrupperManed,
  summerGruppeAar,
  summerKostnaderEtterNiva,
  summerPostAar,
} from "@domain/arsbudsjett/arsbudsjett";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import styles from "./HelhetVisning.module.css";

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

const fmt = (n: number) =>
  new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n || 0);
const fmtMnd = (n: number) => `${fmt(n)}/mnd`;

export interface HelhetVisningProps {
  kostnaderForAar: BudsjettGruppe[];
  inntekterForAar: BudsjettGruppe[];
  sparingForAar: BudsjettGruppe[];
  valgtAar: number;
}

/**
 * Helhet-fanen — Årsbudsjett sitt sammendrag på tvers av kostnader/
 * inntekter/sparing for valgt år. 1:1-port av `HelhetVisning`
 * (§index.html linje 13210–13425).
 */
export function HelhetVisning({
  kostnaderForAar,
  inntekterForAar,
  sparingForAar,
  valgtAar,
}: HelhetVisningProps) {
  const [apentLivsomraade, setApentLivsomraade] = useState<string | null>(null);

  const sumInntekter = summerAlleGrupperAar(inntekterForAar);
  const sumKostnader = summerAlleGrupperAar(kostnaderForAar);
  const sumSparing = summerAlleGrupperAar(sparingForAar);
  const igjenAar = sumInntekter - sumKostnader - sumSparing;

  const manedRadTyper: { id: string; label: string; groups: BudsjettGruppe[] }[] = [
    { id: "inntekter", label: "Inntekter", groups: inntekterForAar },
    { id: "kostnader", label: "Kostnader", groups: kostnaderForAar },
    { id: "sparing", label: "Sparing", groups: sparingForAar },
  ];
  const manedTallForRad = (radId: string, mi: number): number => {
    if (radId === "igjen") {
      return (
        summerGrupperManed(inntekterForAar, mi) -
        summerGrupperManed(kostnaderForAar, mi) -
        summerGrupperManed(sparingForAar, mi)
      );
    }
    const rad = manedRadTyper.find((r) => r.id === radId);
    return rad ? summerGrupperManed(rad.groups, mi) : 0;
  };

  const livsomraadeRader = kostnaderForAar.map((g) => {
    const sum = summerGruppeAar(g);
    return { gruppe: g, sum, andel: sumKostnader > 0 ? (sum / sumKostnader) * 100 : 0 };
  });

  const nivaSum = summerKostnaderEtterNiva(kostnaderForAar);
  const eierKostnader = summerEtterEier(kostnaderForAar, BUDGET_EIER);
  const eierInntekter = summerEtterEier(inntekterForAar, BUDGET_EIER);
  const eierSparing = summerEtterEier(sparingForAar, BUDGET_EIER);
  const harEierData = kostnaderForAar.some((g) => g.items.some((it) => it.meta?.eier));

  return (
    <div>
      <div className={styles.oversiktGrid}>
        {[
          { label: "Inntekter", verdi: sumInntekter, className: styles.olive },
          { label: "Kostnader", verdi: sumKostnader, className: styles.ink },
          { label: "Sparing", verdi: sumSparing, className: styles.hazel },
          {
            label: "Igjen / spillerom",
            verdi: igjenAar,
            className: igjenAar < 0 ? styles.clay : styles.olive,
            uthevet: true,
          },
        ].map((kort) => (
          <div key={kort.label} className={kort.uthevet ? styles.kortUthevet : styles.kort}>
            <div className={styles.kortLabel}>{kort.label}</div>
            <div className={`${styles.kortVerdi} ${kort.className}`}>{fmt(kort.verdi)}</div>
            <div className={styles.kortPerManed}>{fmtMnd(kort.verdi / 12)}</div>
          </div>
        ))}
      </div>

      {igjenAar < 0 && (
        <div className={styles.varsel}>
          Planen for {valgtAar} bruker {fmt(Math.abs(igjenAar))} mer enn årets inntekter og
          planlagte sparing.
        </div>
      )}

      <div className={styles.seksjonsTittel}>Måned for måned</div>
      <div className={styles.tabellScroll}>
        <table className={styles.tabell}>
          <thead>
            <tr>
              <th className={styles.thLabel}></th>
              {MONTHS_SHORT.map((m) => (
                <th key={m} className={styles.thTall}>
                  {m}
                </th>
              ))}
              <th className={styles.thTall}>År</th>
            </tr>
          </thead>
          <tbody>
            {[
              { id: "inntekter", label: "Inntekter" },
              { id: "kostnader", label: "Kostnader" },
              { id: "sparing", label: "Sparing" },
              { id: "igjen", label: "Igjen" },
            ].map((rad) => {
              const aarSum =
                rad.id === "igjen"
                  ? igjenAar
                  : summerAlleGrupperAar(manedRadTyper.find((r) => r.id === rad.id)?.groups ?? []);
              return (
                <tr key={rad.id}>
                  <td className={styles.tdLabel}>{rad.label}</td>
                  {MONTHS_SHORT.map((_, mi) => {
                    const v = manedTallForRad(rad.id, mi);
                    return (
                      <td
                        key={mi}
                        className={`${styles.tdTall} ${rad.id === "igjen" && v < 0 ? styles.clay : ""}`}
                      >
                        {fmt(v)}
                      </td>
                    );
                  })}
                  <td
                    className={`${styles.tdTall} ${styles.tdAarSum} ${rad.id === "igjen" && aarSum < 0 ? styles.clay : ""}`}
                  >
                    {fmt(aarSum)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.seksjonsTittel}>Hvor går pengene — kostnader per livsområde</div>
      <div className={styles.seksjon}>
        {livsomraadeRader.map(({ gruppe, sum, andel }) => {
          const apen = apentLivsomraade === gruppe.id;
          return (
            <div key={gruppe.id} className={styles.gruppeWrapper}>
              <Card
                onClick={() => setApentLivsomraade(apen ? null : gruppe.id)}
                style={{ cursor: "pointer" }}
              >
                <div className={styles.gruppeHeader}>
                  <span className={styles.gruppeLabel}>{gruppe.label}</span>
                  <span className={styles.gruppePerManed}>{fmtMnd(sum / 12)}</span>
                  <span className={styles.gruppeSum}>{fmt(sum)}</span>
                  <span className={styles.gruppeAndel}>{andel.toFixed(0)}%</span>
                </div>
              </Card>
              {apen && (
                <div className={styles.gruppeDetaljer}>
                  {gruppe.items.map((it) => (
                    <div key={it.id} className={styles.postRad}>
                      <span>{it.name}</span>
                      <span className={styles.postBelop}>{fmt(summerPostAar(it))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.seksjonsTittel}>Hva har vi valgt å beskytte?</div>
      <div className={styles.seksjon}>
        {NIVA_REKKEFOLGE.filter((n) => (nivaSum[n.key] ?? 0) > 0 || n.key !== "bygge").map((n) => (
          <div key={n.key} className={styles.nivaRad}>
            <span className={styles.nivaLabel}>{n.label}</span>
            <div className={styles.nivaVerdi}>
              <span className={styles.nivaBelop}>{fmt(nivaSum[n.key] ?? 0)}</span>
              <span className={styles.nivaPerManed}>{fmtMnd((nivaSum[n.key] ?? 0) / 12)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.seksjonsTittel}>Sparing</div>
      <div className={styles.seksjon}>
        {sparingForAar
          .filter((g) => summerGruppeAar(g) !== 0 || g.items.some((it) => summerPostAar(it) !== 0))
          .map((g) => (
            <div key={g.id} className={styles.miniGruppe}>
              <div className={styles.miniGruppeLabel}>{g.label}</div>
              {g.items.map((it) => (
                <div key={it.id} className={styles.miniPostRad}>
                  <span>
                    {it.name}
                    {it.meta?.eier ? ` · ${it.meta.eier}` : ""}
                  </span>
                  <span>{fmt(summerPostAar(it))}</span>
                </div>
              ))}
            </div>
          ))}
      </div>

      <div className={styles.seksjonsTittel}>Inntekter</div>
      <div className={styles.seksjon}>
        {inntekterForAar
          .filter((g) => summerGruppeAar(g) !== 0 || g.items.some((it) => summerPostAar(it) !== 0))
          .map((g) => (
            <div key={g.id} className={styles.miniGruppe}>
              <div className={styles.miniGruppeLabel}>{g.label}</div>
              {g.items.map((it) => (
                <div key={it.id} className={styles.miniPostRad}>
                  <span>
                    {it.name}
                    {it.meta?.eier ? ` · ${it.meta.eier}` : ""}
                  </span>
                  <span>{fmt(summerPostAar(it))}</span>
                </div>
              ))}
            </div>
          ))}
      </div>

      {harEierData && (
        <div>
          <div className={styles.seksjonsTittel}>Fordelt på eier</div>
          <div className={styles.eierGrid}>
            {BUDGET_EIER.map((eier) => (
              <div key={eier} className={styles.eierKort}>
                <div className={styles.eierNavn}>{eier}</div>
                <div className={styles.eierKostnad}>Kostnader: {fmt(eierKostnader[eier] ?? 0)}</div>
                <div className={styles.eierAnnet}>Inntekter: {fmt(eierInntekter[eier] ?? 0)}</div>
                <div className={styles.eierAnnet}>Sparing: {fmt(eierSparing[eier] ?? 0)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
