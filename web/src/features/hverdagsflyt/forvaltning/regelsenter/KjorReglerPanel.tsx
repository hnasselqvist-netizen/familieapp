import { type ReactNode, useMemo, useState } from "react";
import {
  TYPE_LABEL_R,
  forhandsvisKjorRegler,
  gruppeLabelFor,
} from "@domain/forsoning/kjorReglerForhandsvisning";
import type { EndringsplanLinje } from "@domain/forsoning/regler";
import type { RegelGrupper } from "@domain/forsoning/regelsenter";
import type { HendelseRecord, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import styles from "./RegelsenterScreen.module.css";

export interface KjorReglerPanelProps {
  regler: RegelRecord[];
  grupper: RegelGrupper;
  transaksjoner: TransaksjonRecord[];
  hendelser: HendelseRecord[];
  /** Forhåndsvisningen kan ikke åpnes før transaksjonene er lest. */
  transaksjonerLastet: boolean;
}

// Legacy `fmtDR`/`fmtBR` (~12886): dd.mm, hele kroner.
const fmtDR = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("nb-NO", { day: "2-digit", month: "2-digit" }) : "";
const fmtBR = (n?: number | null) =>
  new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n || 0);

const transaksjonLinje = (t: TransaksjonRecord) =>
  `${fmtDR(t.dato)} · ${t.tekst} · ${t.konto || "?"} · ${t.retning === "inn" ? "+" : "-"}${fmtBR(t.belop)} kr`;

/**
 * «Kjør regler» — KUN forhåndsvisningen (§Issue #34), portert fra
 * legacy-RegelSenter (`index.html` ~12866–13006): samme motorer, samme
 * seksjoner og tekster. «Bruk resultatet» skriver `transaksjoner` og
 * `hendelser` og finnes ikke her før R3b-cutover (ADR 0002).
 *
 * Avvik fra legacy: forhåndsvisningen beregnes løpende fra live data mens
 * den er åpen (legacy fryser planen ved klikk, fordi den skal godkjennes og
 * revalideres før skriving — det trengs ikke når ingenting skrives).
 */
export function KjorReglerPanel({
  regler,
  grupper,
  transaksjoner,
  hendelser,
  transaksjonerLastet,
}: KjorReglerPanelProps) {
  const [apen, setApen] = useState(false);
  const g = useMemo(
    () => ({
      budgetGroups: grupper.budgetGroups ?? [],
      incomeGroups: grupper.incomeGroups ?? [],
      sparingGroups: grupper.sparingGroups ?? [],
    }),
    [grupper],
  );
  const resultat = useMemo(
    () =>
      apen
        ? forhandsvisKjorRegler(
            transaksjoner,
            hendelser,
            regler,
            g.budgetGroups,
            g.incomeGroups,
            g.sparingGroups,
          )
        : null,
    [apen, transaksjoner, hendelser, regler, g],
  );

  if (!resultat) {
    return (
      <div className={styles.kjorPanel}>
        <button
          type="button"
          className={styles.kjorKnapp}
          disabled={!transaksjonerLastet}
          onClick={() => setApen(true)}
        >
          Forhåndsvis «Kjør regler»
        </button>
        <div className={styles.kjorHint}>
          Se hva dagens regler ville gjort med transaksjoner som fortsatt venter. Ingenting endres.
        </div>
      </div>
    );
  }

  const { evaluering, oppsummering: o } = resultat;
  const seksjon = (
    tittel: string,
    tone: string | undefined,
    linjer: EndringsplanLinje[],
    rad: (l: EndringsplanLinje) => ReactNode,
  ) =>
    linjer.length > 0 && (
      <section className={styles.kjorSeksjon} aria-label={tittel}>
        <h3 className={tone}>
          {tittel} ({linjer.length})
        </h3>
        {linjer.map((l) => (
          <div key={l.transaksjonId} className={styles.kjorLinje}>
            {rad(l)}
          </div>
        ))}
      </section>
    );

  return (
    <div className={styles.kjorPanel} role="region" aria-label="Forhåndsvisning av Kjør regler">
      <div className={styles.kjorOverskrift}>
        Reglene fant {o.auto.length + o.forslag.length} treff av {evaluering.vurdert} vurderte
        transaksjoner
      </div>

      {seksjon("Behandles automatisk", styles.kjorToneAuto, o.auto, (l) => (
        <>
          <div>{l.transaksjon && transaksjonLinje(l.transaksjon)}</div>
          <div className={styles.kjorDetalj}>
            → {TYPE_LABEL_R[l.target?.kildeType ?? ""] || "Kostnad"} ·{" "}
            {l.target && gruppeLabelFor(l.target, g)} / {l.regel?.targetName} · faktisk{" "}
            {(l.fordeling?.belop ?? 0) >= 0 ? "+" : ""}
            {fmtBR(l.fordeling?.belop)} kr
          </div>
        </>
      ))}

      {seksjon("Til vurdering", styles.kjorToneForslag, o.forslag, (l) => (
        <>
          <div>{l.transaksjon ? transaksjonLinje(l.transaksjon) : "(transaksjon)"}</div>
          <div className={styles.kjorDetalj}>
            → Foreslått: {l.regel?.targetName} · Krever vurdering
          </div>
        </>
      ))}

      {seksjon("Røres ikke — på vent", styles.kjorToneVent, o.paaVent, (l) => (
        <span className={styles.kjorDetalj}>
          {l.transaksjon ? l.transaksjon.tekst : "(transaksjon)"} — På vent, treff funnet men ikke
          skrevet
        </span>
      ))}

      {seksjon("Mål mangler — kan ikke utføres", styles.kjorToneMangler, o.malMangler, (l) => (
        <span className={styles.kjorToneMangler}>
          {l.transaksjon ? l.transaksjon.tekst : "(transaksjon)"} — regel «{l.regel?.pattern}» peker
          mot en post som ikke finnes
        </span>
      ))}

      {o.ingenTreffAntall > 0 && (
        <div className={styles.kjorHint}>
          {o.ingenTreffAntall} transaksjon(er) uten treff — uendret.
        </div>
      )}

      {!o.noeAaSkrive && o.malMangler.length === 0 && (
        <div className={styles.kjorHint}>Ingen nye treff akkurat nå.</div>
      )}

      <div className={styles.notis} role="note">
        Kun forhåndsvisning — ingenting er skrevet.
        {o.noeAaSkrive && " For å bruke resultatet: kjør regler i den gamle appen."}
      </div>

      <button type="button" className={styles.kjorLukk} onClick={() => setApen(false)}>
        Lukk forhåndsvisningen
      </button>
    </div>
  );
}
