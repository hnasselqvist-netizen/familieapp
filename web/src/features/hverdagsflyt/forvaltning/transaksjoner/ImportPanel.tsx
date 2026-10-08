import { useState } from "react";
import {
  type PreviewRad,
  byggImportPreview,
  gjorImport,
  velgManuellKonto,
} from "@domain/forsoning/bankimport";
import { normaliserKonto } from "@domain/forsoning/bankimportParse";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import { findMatchingRule } from "@domain/forsoning/regler";
import { normaliserTransaksjonstekst } from "@domain/forsoning/tekst";
import { KONTOER } from "@domain/forsoning/transaksjonsoversikt";
import type { RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import type { LiquidityPost } from "@app-types/liquidity";
import styles from "./TransaksjonsoversiktScreen.module.css";

const KILDER = [
  { id: "sparebank1", label: "SpareBank 1" },
  { id: "dnb", label: "DNB / Mastercard" },
  { id: "annet", label: "Annet" },
];
const KILDE_HINT: Record<string, string> = {
  sparebank1:
    "SpareBank 1: Dato, Beskrivelse, Inn, Ut — semikolon-CSV. Konto leses fra filens egen Konto-kolonne når den finnes.",
  dnb: "DNB Mastercard: eksporter som CSV. Konto settes til MC.",
  annet: "Prøver vanlige kolonnenavn automatisk.",
};

const fmtD = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short" }) : "";
const fmtB = (n: number) => new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n);

export interface ImportPanelProps {
  transaksjoner: TransaksjonRecord[];
  rules: RegelRecord[];
  liquidityPosts: LiquidityPost[];
  onUtfor: (endring: Beslutningsendring) => Promise<void>;
  onFerdig: () => void;
}

/** Statusmerket i forhåndsvisningen (legacy ~7960): dup, auto, flerbruk eller ny. */
function merke(t: PreviewRad, rules: RegelRecord[], kilde: string): [string, string | undefined] {
  if (t.erDuplikat) return ["dup", styles.merkeVent];
  const treff = findMatchingRule(
    { normalizedText: normaliserTransaksjonstekst(t.tekst), konto: t.konto, importkilde: kilde },
    rules,
  );
  if (treff.rule && treff.confidence >= 60) {
    return treff.rule.multiUse ? ["flerbruk", styles.merkeVent] : ["auto", styles.merkeFerdig];
  }
  return ["ny", styles.merkeNoytral];
}

/**
 * Bankfil-import (§Issue #34 R3b-2), portert fra legacy `BankimportScreen`
 * (`index.html` ~7884–8030): kilde, fil, forhåndsvisning med duplikater og
 * manglende konto, og «Importer». Vises bare når forsoningsporten er på.
 *
 * Avvik: kun CSV/TXT. Legacy leser også Excel med SheetJS fra CDN; det
 * krever en avhengighetsbeslutning (åpent valg i `r3b-cutover.md` §7).
 */
export function ImportPanel({
  transaksjoner,
  rules,
  liquidityPosts,
  onUtfor,
  onFerdig,
}: ImportPanelProps) {
  const [kilde, setKilde] = useState("sparebank1");
  const [preview, setPreview] = useState<PreviewRad[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [lagrer, setLagrer] = useState(false);

  const lesFil = async (fil: File | undefined) => {
    if (!fil) return;
    setFeil(null);
    const ext = fil.name.split(".").pop()?.toLowerCase();
    if (ext !== "csv" && ext !== "txt") {
      setFeil("Støtter foreløpig kun CSV og TXT. Eksporter Excel-filen som CSV.");
      return;
    }
    setPreview(byggImportPreview(await fil.text(), kilde, transaksjoner));
  };

  const nye = preview ? preview.filter((t) => !t.erDuplikat) : [];
  const manglerKonto = preview ? preview.filter((t) => !t.konto) : [];
  const kanImportere = nye.length > 0 && !preview!.some((t) => !t.erDuplikat && !t.konto);

  const importer = async () => {
    if (!preview) return;
    setLagrer(true);
    setFeil(null);
    try {
      await onUtfor(
        gjorImport(
          preview,
          { rules, liquidityPosts, kilde },
          { newId: () => crypto.randomUUID(), naa: new Date().toISOString() },
        ),
      );
      setPreview(null);
      onFerdig();
    } catch (err) {
      console.error("[Import] Feilet:", err);
      setFeil("Noe gikk galt. Ingenting er importert — se konsollen for detaljer.");
    } finally {
      setLagrer(false);
    }
  };

  return (
    <div className={styles.panel} role="group" aria-label="Importer bankfil">
      <div className={styles.chips} role="group" aria-label="Bank">
        {KILDER.map((k) => (
          <button
            key={k.id}
            type="button"
            aria-pressed={kilde === k.id}
            className={kilde === k.id ? styles.chipAktiv : styles.chip}
            onClick={() => {
              setKilde(k.id);
              setPreview(null);
            }}
          >
            {k.label}
          </button>
        ))}
      </div>
      <label className={styles.filvalg}>
        📂 Velg CSV-fil
        <input
          type="file"
          accept=".csv,.txt"
          aria-label="Bankfil"
          onChange={(e) => void lesFil(e.target.files?.[0])}
        />
      </label>
      <div className={styles.radInfo}>{KILDE_HINT[kilde]}</div>
      {feil && <div className={styles.toneAvvik}>⚠ {feil}</div>}

      {preview && (
        <div className={styles.panelSeksjon}>
          <div className={styles.radInfo}>
            <span className={styles.toneFerdig}>{nye.length} nye</span> ·{" "}
            {preview.length - nye.length} duplikater hoppes over
          </div>
          {manglerKonto.length > 0 && (
            <div className={styles.utvid} role="note">
              <div>
                Konto kunne ikke fastslås automatisk for {manglerKonto.length} rad
                {manglerKonto.length !== 1 ? "er" : ""}. Velg hvilken konto denne importen gjelder:
              </div>
              <div className={styles.chips} role="group" aria-label="Konto for importen">
                {KONTOER.filter((k) => k.id !== "alle").map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    className={styles.chip}
                    onClick={() => setPreview(velgManuellKonto(preview, k.id, transaksjoner))}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <ul className={styles.previewListe} aria-label="Forhåndsvisning">
            {preview.slice(0, 40).map((t, i) => {
              const [tekst, klasse] = merke(t, rules, kilde);
              return (
                <li key={i} className={t.erDuplikat ? styles.previewDup : styles.previewRad}>
                  <span className={styles.valgTekst}>
                    <span className={styles.valgNavn}>{t.tekst}</span>
                    <span className={styles.radInfo}>
                      {fmtD(t.dato)} ·{" "}
                      {t.konto ? (
                        normaliserKonto(t)
                      ) : (
                        <span className={styles.toneVent}>mangler konto</span>
                      )}
                    </span>
                  </span>
                  <span className={t.retning === "inn" ? styles.belopInn : styles.belopUt}>
                    {t.retning === "inn" ? "+" : "-"}
                    {fmtB(t.belop)}
                  </span>
                  <span className={klasse}>{tekst}</span>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className={styles.primar}
            disabled={!kanImportere || lagrer}
            onClick={() => void importer()}
          >
            {lagrer ? "Importerer…" : `Importer ${nye.length} transaksjoner`}
          </button>
        </div>
      )}
    </div>
  );
}
