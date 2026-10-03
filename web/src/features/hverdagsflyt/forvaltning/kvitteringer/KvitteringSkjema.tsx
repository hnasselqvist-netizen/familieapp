import { type ReactNode, useEffect, useState } from "react";
import { BUDGET_EIER } from "@domain/budsjettfamilie/budsjettfamilie";
import { jevnFordelEiere } from "@domain/forsoning/fordeling";
import { calculateSplitTotal } from "@domain/forsoning/kvittering";
import {
  byttSplitMaal,
  fjernSplit,
  leggTilSplit,
  oppdaterSplit,
  settSplitEiere,
  type KvitteringUtkast,
  sokMalPoster,
  utkastTotal,
} from "@domain/forsoning/kvitteringUtkast";
import { getDisplayDescription } from "@domain/forsoning/kvitteringsinnboks";
import type { Eierandel, KvitteringSplit, MalPost } from "@app-types/forsoning";
import styles from "./KvitteringsinnboksScreen.module.css";

const fmt = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 2,
  }).format(n);
const fmtHel = (n: number) =>
  new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n || 0);

/** Legacy `BelopFelt`: lokal tekst mens man skriver, lagres ved blur/Enter. */
function BelopFelt({
  verdi,
  onSave,
  label,
}: {
  verdi: number;
  onSave: (v: string) => void;
  label: string;
}) {
  const [utkast, setUtkast] = useState(String(verdi ?? 0));
  useEffect(() => setUtkast(String(verdi ?? 0)), [verdi]);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      className={styles.belopFelt}
      value={utkast}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setUtkast(e.target.value)}
      onBlur={() => onSave(utkast)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

/** Legacy `AnsvarChips`: minst én eier, jevn fordeling. */
function EierChips({
  eiere,
  onChange,
  label,
}: {
  eiere: Eierandel[];
  onChange: (e: Eierandel[]) => void;
  label: string;
}) {
  return (
    <div className={styles.chips} role="group" aria-label={label}>
      {BUDGET_EIER.map((person) => {
        const valgt = eiere.find((e) => e.person === person);
        return (
          <button
            key={person}
            type="button"
            aria-pressed={!!valgt}
            className={valgt ? styles.chipAktiv : styles.chip}
            onClick={() => {
              const naa = eiere.map((e) => e.person);
              const erValgt = naa.includes(person);
              if (erValgt && naa.length === 1) return;
              onChange(
                jevnFordelEiere(erValgt ? naa.filter((p) => p !== person) : [...naa, person]),
              );
            }}
          >
            {person}
            {valgt && eiere.length > 1 ? ` ${valgt.prosent}%` : ""}
          </button>
        );
      })}
    </div>
  );
}

function PostSok({
  poster,
  placeholder,
  onVelg,
  ekstra,
}: {
  poster: MalPost[];
  placeholder: string;
  onVelg: (p: MalPost) => void;
  ekstra?: ReactNode;
}) {
  const [sok, setSok] = useState("");
  const treff = sokMalPoster(poster, sok);
  return (
    <div>
      <div className={styles.sokRad}>
        <input
          type="search"
          aria-label="Søk etter post"
          placeholder={placeholder}
          className={styles.felt}
          value={sok}
          onChange={(e) => setSok(e.target.value)}
          autoComplete="off"
        />
        {ekstra}
      </div>
      {treff.length > 0 && (
        <div className={styles.valgListe}>
          {treff.map((p) => (
            <button
              key={`${p.targetType}-${p.id}`}
              type="button"
              className={styles.valgRad}
              onClick={() => {
                onVelg(p);
                setSok("");
              }}
            >
              <span className={styles.valgNavn}>{p.name}</span>
              <span className={styles.dempet}>{p.gruppe}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface KvitteringSkjemaProps {
  /** `ny` = legacy registreringsskjema, `rediger` = legacy `KvitteringDetalj`. */
  variant: "ny" | "rediger";
  utkast: KvitteringUtkast;
  onChange: (u: KvitteringUtkast) => void;
  poster: MalPost[];
}

/**
 * Felles skjema for ny kvittering og redigering (§Issue #34 R3b-3), med
 * legacy sine regler fra `kvitteringUtkast.ts`. Forskjellene mellom de to
 * legacy-skjemaene er bevart: i et nytt skjema nullstiller et nytt
 * behandlingsvalg splittene og «Endre» tømmer posten, og ansvar velges
 * ikke; ved redigering beholdes splittene, «Endre» bytter bare målet, og
 * ansvar kan endres per linje.
 */
export function KvitteringSkjema({ variant, utkast, onChange, poster }: KvitteringSkjemaProps) {
  const [byttMaal, setByttMaal] = useState(false);
  const total = utkastTotal(utkast, variant);
  const splits = utkast.splits;
  const sett = (endring: Partial<KvitteringUtkast>) => onChange({ ...utkast, ...endring });
  const settSplits = (s: KvitteringSplit[]) => sett({ splits: s });
  const splitTotal = calculateSplitTotal({ splits });
  const diff = total - splitTotal;
  const rediger = variant === "rediger";

  const velgModus = (mode: "single" | "split") => {
    setByttMaal(false);
    sett(rediger ? { allocationMode: mode } : { allocationMode: mode, splits: [] });
  };

  return (
    <div className={styles.skjema}>
      <div className={styles.feltGrid}>
        <label className={styles.feltEtikett}>
          Leverandør
          <input
            className={styles.felt}
            value={utkast.merchant}
            placeholder="F.eks. Rema 1000"
            autoComplete="off"
            onChange={(e) => sett({ merchant: e.target.value })}
          />
        </label>
        <label className={styles.feltEtikett}>
          Dato
          <input
            type="date"
            className={styles.felt}
            value={utkast.purchaseDate}
            onChange={(e) => sett({ purchaseDate: e.target.value })}
          />
        </label>
        <label className={styles.feltEtikett}>
          Totalbeløp
          <input
            type={rediger ? "text" : "number"}
            inputMode="decimal"
            className={styles.felt}
            value={utkast.total}
            placeholder="0"
            onFocus={(e) => e.target.select()}
            onChange={(e) => sett({ total: e.target.value })}
          />
        </label>
      </div>

      <div className={styles.seksjonTittel}>Hvordan skal kvitteringen behandles?</div>
      <div className={styles.chips} role="group" aria-label="Behandling">
        {(
          [
            ["single", "Én post for hele kvitteringen"],
            ["split", "Må splittes på flere poster"],
          ] as const
        ).map(([mode, tekst]) => (
          <button
            key={mode}
            type="button"
            aria-pressed={utkast.allocationMode === mode}
            className={utkast.allocationMode === mode ? styles.chipAktiv : styles.chip}
            onClick={() => velgModus(mode)}
          >
            {tekst}
          </button>
        ))}
      </div>

      {utkast.allocationMode === "single" &&
        (splits.length > 0 && !byttMaal ? (
          <div className={styles.valgtPost}>
            <div className={styles.splittTopp}>
              <span className={styles.valgNavn}>{splits[0]!.targetName}</span>
              <span className={styles.belop}>{fmtHel(splits[0]!.amount)}</span>
              <button
                type="button"
                className={styles.lenkeKnapp}
                onClick={() => (rediger ? setByttMaal(true) : settSplits([]))}
              >
                Endre
              </button>
            </div>
            <input
              aria-label="Beskrivelse"
              placeholder="Beskrivelse"
              className={styles.felt}
              value={getDisplayDescription(splits[0]!)}
              onChange={(e) =>
                settSplits(oppdaterSplit(splits, 0, "description", e.target.value, total))
              }
            />
            {rediger && (
              <EierChips
                label="Ansvar"
                eiere={splits[0]!.eiere || jevnFordelEiere(["Felles"])}
                onChange={(e) => settSplits(settSplitEiere(splits, 0, e))}
              />
            )}
          </div>
        ) : (
          <PostSok
            poster={poster}
            placeholder="Søk budsjett-/inntektspost…"
            onVelg={(p) => {
              if (splits.length > 0) {
                settSplits(byttSplitMaal(splits, 0, p));
                setByttMaal(false);
              } else settSplits(leggTilSplit(splits, p, total));
            }}
            ekstra={
              rediger && splits.length > 0 ? (
                <button
                  type="button"
                  className={styles.lenkeKnapp}
                  onClick={() => setByttMaal(false)}
                >
                  Avbryt
                </button>
              ) : undefined
            }
          />
        ))}

      {utkast.allocationMode === "split" && (
        <div className={styles.panelSeksjon}>
          <ul className={styles.splitter} aria-label="Splitter">
            {splits.map((sp, idx) => {
              const erSiste = idx === splits.length - 1 && splits.length > 1;
              return (
                <li key={idx} className={styles.splitt}>
                  <span className={styles.splittTopp}>
                    <span className={styles.valgNavn}>{sp.targetName}</span>
                    {erSiste ? (
                      <span className={styles.belop} aria-label={`Rest ${sp.targetName}`}>
                        {fmtHel(sp.amount)}
                      </span>
                    ) : (
                      <BelopFelt
                        label={`Beløp ${sp.targetName}`}
                        verdi={sp.amount}
                        onSave={(v) => settSplits(oppdaterSplit(splits, idx, "amount", v, total))}
                      />
                    )}
                    <button
                      type="button"
                      className={styles.lenkeKnapp}
                      aria-label={`Fjern ${sp.targetName}`}
                      onClick={() => settSplits(fjernSplit(splits, idx, total))}
                    >
                      Fjern
                    </button>
                  </span>
                  <input
                    aria-label={`Beskrivelse ${sp.targetName}`}
                    placeholder="Beskrivelse"
                    className={styles.felt}
                    value={getDisplayDescription(sp)}
                    onChange={(e) =>
                      settSplits(oppdaterSplit(splits, idx, "description", e.target.value, total))
                    }
                  />
                  {rediger && (
                    <EierChips
                      label={`Ansvar ${sp.targetName}`}
                      eiere={sp.eiere || jevnFordelEiere(["Felles"])}
                      onChange={(e) => settSplits(settSplitEiere(splits, idx, e))}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          <div className={diff === 0 ? styles.toneFerdig : styles.toneAvvik}>
            Splittsum: {fmt(splitTotal)} {diff !== 0 && `· gjenstår ${fmt(diff)}`}
          </div>
          <PostSok
            poster={poster}
            placeholder="Søk budsjett-/inntektspost for å legge til splitt…"
            onVelg={(p) => settSplits(leggTilSplit(splits, p, total))}
          />
        </div>
      )}
    </div>
  );
}
