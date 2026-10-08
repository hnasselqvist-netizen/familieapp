import { type ReactNode, useMemo, useState } from "react";
import type { BrukKjorReglerUtfall, KjorReglerResultat } from "@domain/forsoning/brukKjorRegler";
import {
  TYPE_LABEL_R,
  forhandsvisKjorRegler,
  gruppeLabelFor,
} from "@domain/forsoning/kjorReglerForhandsvisning";
import type { EndringsplanLinje } from "@domain/forsoning/regler";
import { type RegelGrupper, ansvarTekst } from "@domain/forsoning/regelsenter";
import type { HendelseRecord, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import styles from "./RegelsenterScreen.module.css";

export interface KjorReglerPanelProps {
  regler: RegelRecord[];
  grupper: RegelGrupper;
  transaksjoner: TransaksjonRecord[];
  hendelser: HendelseRecord[];
  /** Forhåndsvisningen kan ikke åpnes før transaksjonene er lest. */
  transaksjonerLastet: boolean;
  /** Den felles forsoningsporten (`hooks/forsoningAktivering.ts`) — `false` til R3b-cutover. */
  skrivingAktiv?: boolean;
  /** «Bruk resultatet» med planen brukeren godkjente (`useRegelsenter`). */
  onBrukResultat?: (godkjentPlan: EndringsplanLinje[]) => Promise<BrukKjorReglerUtfall>;
}

// Legacy `fmtDR`/`fmtBR` (~12886): dd.mm, hele kroner.
const fmtDR = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("nb-NO", { day: "2-digit", month: "2-digit" }) : "";
const fmtBR = (n?: number | null) =>
  new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n || 0);

const transaksjonLinje = (t: TransaksjonRecord) =>
  `${fmtDR(t.dato)} · ${t.tekst} · ${t.konto || "?"} · ${t.retning === "inn" ? "+" : "-"}${fmtBR(t.belop)} kr`;

/**
 * «Kjør regler» (§Issue #34), portert fra legacy-RegelSenter (`index.html`
 * ~12866–13020): samme motorer, samme seksjoner og tekster.
 *
 * «Bruk resultatet» skriver `transaksjoner` og `hendelser`, og vises bare
 * når den felles forsoningsporten er på (R3b-cutover, ADR 0002). Med
 * porten av er panelet ren forhåndsvisning.
 *
 * Forhåndsvisningen beregnes løpende fra live data mens den er åpen.
 * Planen brukeren ser når hen trykker «Bruk resultatet», er den godkjente;
 * `brukKjorRegler` bygger en fersk plan og skriver ingenting hvis den
 * avviker (samme revalidering og advarsel som legacy).
 */
export function KjorReglerPanel({
  regler,
  grupper,
  transaksjoner,
  hendelser,
  transaksjonerLastet,
  skrivingAktiv = false,
  onBrukResultat,
}: KjorReglerPanelProps) {
  const [apen, setApen] = useState(false);
  const [kjorer, setKjorer] = useState(false);
  const [feilet, setFeilet] = useState(false);
  const [advarsel, setAdvarsel] = useState<string | null>(null);
  const [sisteResultat, setSisteResultat] = useState<KjorReglerResultat | null>(null);
  const kanSkrive = skrivingAktiv && !!onBrukResultat;
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

  const lukk = () => {
    setApen(false);
    setAdvarsel(null);
  };

  if (!resultat) {
    return (
      <div className={styles.kjorPanel}>
        <button
          type="button"
          className={styles.kjorKnapp}
          disabled={!transaksjonerLastet}
          onClick={() => {
            setApen(true);
            setFeilet(false);
            setSisteResultat(null);
          }}
        >
          {kanSkrive ? "Kjør regler" : "Forhåndsvis «Kjør regler»"}
        </button>
        <div className={styles.kjorHint}>
          {kanSkrive
            ? "Bruk dagens regler på transaksjoner som fortsatt venter."
            : "Se hva dagens regler ville gjort med transaksjoner som fortsatt venter. Ingenting endres."}
        </div>
        {feilet && (
          <div className={styles.kjorToneMangler}>⚠ Noe gikk galt. Se konsollen for detaljer.</div>
        )}
        {sisteResultat && <ResultatBlokk r={sisteResultat} />}
      </div>
    );
  }

  const { evaluering, plan, oppsummering: o } = resultat;

  const brukResultat = async () => {
    if (!onBrukResultat) return;
    setKjorer(true);
    setFeilet(false);
    try {
      const utfall = await onBrukResultat(plan);
      if (utfall.status === "endret") {
        setAdvarsel(utfall.advarsel);
      } else {
        setSisteResultat(utfall.resultat);
        lukk();
      }
    } catch (err) {
      console.error("[KjorRegler] Feilet:", err);
      setFeilet(true);
      lukk();
    } finally {
      setKjorer(false);
    }
  };
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
      {advarsel && (
        <div className={styles.kjorAdvarsel} role="alert">
          ⚠ {advarsel}
        </div>
      )}

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
            {fmtBR(l.fordeling?.belop)} kr · ansvar {ansvarTekst(l.fordeling?.eiere)}
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

      {kanSkrive ? (
        <div className={styles.kjorHandlinger}>
          <button type="button" className={styles.kjorLukk} onClick={lukk} disabled={kjorer}>
            Avbryt
          </button>
          <button
            type="button"
            className={styles.kjorKnapp}
            onClick={() => void brukResultat()}
            disabled={kjorer || !o.noeAaSkrive}
          >
            {kjorer ? "Bruker resultatet…" : "Bruk resultatet"}
          </button>
        </div>
      ) : (
        <>
          <div className={styles.notis} role="note">
            Kun forhåndsvisning — ingenting er skrevet.
            {o.noeAaSkrive && " For å bruke resultatet: kjør regler i den gamle appen."}
          </div>
          <button type="button" className={styles.kjorLukk} onClick={lukk}>
            Lukk forhåndsvisningen
          </button>
        </>
      )}
    </div>
  );
}

/** Legacy sin kvittering etter «Bruk resultatet» (~13010–13018). */
function ResultatBlokk({ r }: { r: KjorReglerResultat }) {
  return (
    <div className={styles.kjorResultat} role="status">
      <div className={styles.kjorResultatTittel}>✓ Reglene er kjørt</div>
      {r.auto > 0 && <div>• {r.auto} behandlet</div>}
      {r.forslagSkrevet > 0 && <div>• {r.forslagSkrevet} klare for vurdering</div>}
      {r.malMangler > 0 && <div>• {r.malMangler} trenger ny plassering</div>}
      {r.forslagPaaVent > 0 && <div>• {r.forslagPaaVent} på vent — urørt</div>}
    </div>
  );
}
