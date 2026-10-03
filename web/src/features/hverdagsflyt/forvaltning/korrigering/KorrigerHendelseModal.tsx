import { useEffect, useMemo, useState } from "react";
import { Modal } from "@components/Modal";
import { BUDGET_EIER } from "@domain/budsjettfamilie/budsjettfamilie";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import { jevnFordelEiere } from "@domain/forsoning/fordeling";
import {
  type Korrigering,
  byttPostPaaLinje,
  fjernKorrigeringslinje,
  kanLagreKorrigering,
  korrigeringsPoster,
  korrigeringsRetning,
  korrigeringsTotal,
  lagreKorrigering,
  leggTilKorrigeringslinje,
  observasjonForKorrigering,
  settKorrigeringsBelop,
  settKorrigeringsEiere,
  sokKorrigeringsPoster,
  startKorrigering,
} from "@domain/forsoning/korrigering";
import { type PostGrupper, UKLAR_AARSAK_LABEL } from "@domain/forsoning/transaksjonsoversikt";
import type {
  Eierandel,
  HendelseRecord,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import styles from "./KorrigerHendelseModal.module.css";

export interface KorrigerHendelseModalProps extends PostGrupper {
  hendelse: HendelseRecord;
  transaksjoner: TransaksjonRecord[];
  rules: RegelRecord[];
  onUtfor: (endring: Beslutningsendring) => Promise<void>;
  /** Etter vellykket lagring (legacy lukker også drilldown fra postdetalj). */
  onLagret: () => void;
  onClose: () => void;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(n);
const fmtD = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short" }) : "";
const fmtHel = (n: number) =>
  new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n || 0);

/** Legacy `BelopFelt`: lokal tekst, lagres ved blur/Enter (komma godtas). */
function BelopFelt({
  verdi,
  onSave,
  label,
}: {
  verdi: number;
  onSave: (v: number) => void;
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
      onBlur={() => onSave(parseFloat(String(utkast).replace(",", ".")) || 0)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

/** Legacy `AnsvarChips`. */
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

/**
 * Korriger en eksisterende hendelse (§Issue #34 R3b-4), portert fra legacy
 * `KorrigerHendelseModal` (`index.html` ~10998): plassering (bytt post, del
 * opp, beløp med rest på siste linje, ansvar, «Lær denne koblingen») eller
 * «Sett på vent» med årsak. Oppretter aldri en ny hendelse. Brukes fra
 * «Korriger kobling» i transaksjonsoversikten og fra drilldown i
 * Budsjett/Inntekter/Sparing — bare når forsoningsporten er på.
 */
export function KorrigerHendelseModal({
  hendelse,
  transaksjoner,
  rules,
  budgetGroups,
  incomeGroups,
  sparingGroups,
  onUtfor,
  onLagret,
  onClose,
}: KorrigerHendelseModalProps) {
  const grupper = useMemo(
    () => ({ budgetGroups, incomeGroups, sparingGroups }),
    [budgetGroups, incomeGroups, sparingGroups],
  );
  const obs = observasjonForKorrigering(hendelse, transaksjoner);
  const total = korrigeringsTotal(obs);
  const retning = korrigeringsRetning(obs);
  const [k, setK] = useState<Korrigering>(() =>
    startKorrigering(hendelse, grupper, () => crypto.randomUUID()),
  );
  const [redigerLinje, setRedigerLinje] = useState<number | null>(null);
  const [visLeggTil, setVisLeggTil] = useState(false);
  const [sok, setSok] = useState("");
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState(false);

  const poster = useMemo(() => korrigeringsPoster(grupper), [grupper]);
  const treff = sokKorrigeringsPoster(poster, sok, k.linjer, redigerLinje);
  const settLinjer = (linjer: Korrigering["linjer"]) => setK((prev) => ({ ...prev, linjer }));
  const avsluttSok = () => {
    setVisLeggTil(false);
    setRedigerLinje(null);
    setSok("");
  };

  const lagre = async () => {
    setLagrer(true);
    setFeil(false);
    try {
      await onUtfor(
        lagreKorrigering(hendelse, obs, k, rules, {
          newId: () => crypto.randomUUID(),
          naa: new Date().toISOString(),
        }),
      );
      onLagret();
    } catch (err) {
      console.error("[Korrigering] Lagring feilet:", err);
      setFeil(true);
    } finally {
      setLagrer(false);
    }
  };

  const tittel = `Korriger — ${obs ? obs.tekst || "(ukjent)" : "(observasjon mangler)"}`;
  return (
    <Modal title={tittel} onClose={onClose}>
      <div className={styles.innhold}>
        {obs && obs.id && (
          <div className={styles.dempet}>
            {fmtD(obs.dato)} · {obs.konto || "?"} · {fmt(obs.belop || 0)}
          </div>
        )}

        <div className={styles.chips} role="group" aria-label="Type">
          <button
            type="button"
            aria-pressed={k.type !== "uklar"}
            className={k.type !== "uklar" ? styles.chipAktiv : styles.chip}
            onClick={() => setK((p) => ({ ...p, type: null }))}
          >
            Plassering
          </button>
          <button
            type="button"
            aria-pressed={k.type === "uklar"}
            className={k.type === "uklar" ? styles.chipAktiv : styles.chip}
            onClick={() => setK((p) => ({ ...p, type: "uklar" }))}
          >
            Sett på vent
          </button>
        </div>

        {k.type === "uklar" ? (
          <div className={styles.seksjon} role="group" aria-label="Årsak">
            <div className={styles.dempet}>Årsak</div>
            {Object.entries(UKLAR_AARSAK_LABEL).map(([id, tekst]) => (
              <button
                key={id}
                type="button"
                aria-pressed={k.uklar === id}
                className={k.uklar === id ? styles.valgAktiv : styles.valg}
                onClick={() => setK((p) => ({ ...p, uklar: id }))}
              >
                {tekst}
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.seksjon}>
            <ul className={styles.linjer} aria-label="Fordeling">
              {k.linjer.map((f, idx) => {
                const erSiste = idx === k.linjer.length - 1;
                const navn = `${f.post.name}${f.post.gruppe ? ` (${f.post.gruppe})` : ""}`;
                return (
                  <li key={f.id} className={styles.linje}>
                    <span className={styles.linjeTopp}>
                      <button
                        type="button"
                        className={styles.postKnapp}
                        aria-label={`Bytt post ${f.post.name}`}
                        onClick={() => {
                          setRedigerLinje(idx);
                          setVisLeggTil(false);
                          setSok("");
                        }}
                      >
                        {navn}
                      </button>
                      {erSiste ? (
                        <span className={styles.belop} aria-label={`Beløp ${f.post.name}`}>
                          {fmtHel(f.belop)}
                        </span>
                      ) : (
                        <BelopFelt
                          label={`Beløp ${f.post.name}`}
                          verdi={f.belop}
                          onSave={(v) => settLinjer(settKorrigeringsBelop(k.linjer, idx, v, total))}
                        />
                      )}
                      {k.linjer.length > 1 && (
                        <button
                          type="button"
                          className={styles.lenkeKnapp}
                          aria-label={`Fjern ${f.post.name}`}
                          onClick={() => settLinjer(fjernKorrigeringslinje(k.linjer, idx, total))}
                        >
                          ✕
                        </button>
                      )}
                    </span>
                    <EierChips
                      label={`Ansvar ${f.post.name}`}
                      eiere={f.eiere}
                      onChange={(e) => settLinjer(settKorrigeringsEiere(k.linjer, idx, e))}
                    />
                  </li>
                );
              })}
            </ul>

            {(redigerLinje !== null || visLeggTil || k.linjer.length === 0) && (
              <div className={styles.sokBoks}>
                <input
                  type="search"
                  aria-label="Søk etter post"
                  className={styles.felt}
                  placeholder={redigerLinje !== null ? "Søk ny post…" : "Søk etter post…"}
                  value={sok}
                  onChange={(e) => setSok(e.target.value)}
                />
                {sok.trim().length > 0 && (
                  <div className={styles.treff}>
                    {treff.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={styles.treffRad}
                        onClick={() => {
                          settLinjer(
                            redigerLinje !== null
                              ? byttPostPaaLinje(k.linjer, redigerLinje, p, retning)
                              : leggTilKorrigeringslinje(k.linjer, p, total, () =>
                                  crypto.randomUUID(),
                                ),
                          );
                          avsluttSok();
                        }}
                      >
                        {p.name} <span className={styles.dempet}>({p.gruppe})</span>
                      </button>
                    ))}
                    {treff.length === 0 && <div className={styles.dempet}>Ingen treff.</div>}
                  </div>
                )}
                <button type="button" className={styles.lenkeKnapp} onClick={avsluttSok}>
                  Avbryt søk
                </button>
              </div>
            )}

            {k.linjer.length > 0 && redigerLinje === null && !visLeggTil && (
              <button type="button" className={styles.leggTil} onClick={() => setVisLeggTil(true)}>
                + Del opp i flere
              </button>
            )}

            {k.linjer.length === 1 && (
              <label className={styles.laer}>
                <input
                  type="checkbox"
                  checked={k.laer}
                  onChange={(e) => setK((p) => ({ ...p, laer: e.target.checked }))}
                />
                Lær denne koblingen
              </label>
            )}
          </div>
        )}

        {feil && (
          <div className={styles.feil} role="alert">
            ⚠ Noe gikk galt. Se konsollen for detaljer.
          </div>
        )}
        <div className={styles.knapper}>
          <button type="button" className={styles.sekundar} onClick={onClose} disabled={lagrer}>
            Avbryt
          </button>
          <button
            type="button"
            className={styles.primar}
            disabled={!kanLagreKorrigering(k) || lagrer}
            onClick={() => void lagre()}
          >
            {lagrer ? "Lagrer…" : "Lagre korrigering"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
