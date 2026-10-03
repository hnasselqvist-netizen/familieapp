import { useMemo, useState } from "react";
import { BUDGET_EIER } from "@domain/budsjettfamilie/budsjettfamilie";
import { type ManuellType, lagreManuellRegistrering } from "@domain/forsoning/bankimport";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import { jevnFordelEiere } from "@domain/forsoning/fordeling";
import { type PlasseringsPost, allePoster } from "@domain/forsoning/plasseringsvalg";
import type { PostGrupper } from "@domain/forsoning/transaksjonsoversikt";
import type { Eierandel } from "@app-types/forsoning";
import styles from "./TransaksjonsoversiktScreen.module.css";

export interface ManuellRegistreringPanelProps extends PostGrupper {
  onUtfor: (endring: Beslutningsendring) => Promise<void>;
  onLukk: () => void;
}

const TYPER: [ManuellType, string][] = [
  ["kostnad", "Kostnad"],
  ["inntekt", "Inntekt"],
  ["sparing", "Sparing"],
];
const SOK_PLASSHOLDER: Record<ManuellType, string> = {
  kostnad: "Søk etter kostnadspost…",
  inntekt: "Søk etter inntektspost…",
  sparing: "Søk etter sparepost…",
};

/**
 * Manuell registrering (§Issue #34 R3b-2), portert fra legacy
 * `BankimportScreen` (`index.html` ~8033–8160): en økonomisk hendelse uten
 * bankrad (f.eks. gavekort). Skriver kun `hendelser`. Vises bare når
 * forsoningsporten er på.
 */
export function ManuellRegistreringPanel({
  budgetGroups,
  incomeGroups,
  sparingGroups,
  onUtfor,
  onLukk,
}: ManuellRegistreringPanelProps) {
  const grupper = useMemo(
    () => ({ budgetGroups, incomeGroups, sparingGroups }),
    [budgetGroups, incomeGroups, sparingGroups],
  );
  const [type, setType] = useState<ManuellType>("kostnad");
  const [dato, setDato] = useState(() => new Date().toISOString().slice(0, 10));
  const [belop, setBelop] = useState("");
  const [post, setPost] = useState<PlasseringsPost | null>(null);
  const [sok, setSok] = useState("");
  const [kommentar, setKommentar] = useState("");
  const [eiere, setEiere] = useState<Eierandel[]>([{ person: "Felles", prosent: 100 }]);
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState(false);

  const poster = useMemo(() => allePoster(grupper, new Date().getMonth()), [grupper]);
  const alternativer = poster.filter((p) =>
    type === "inntekt"
      ? p.retning === "inn"
      : type === "sparing"
        ? p.plasseringType === "sparing"
        : p.retning === "ut" && !p.plasseringType,
  );
  const sokNorm = sok.trim().toLowerCase();
  const treff = sokNorm
    ? alternativer.filter(
        (p) =>
          p.name.toLowerCase().includes(sokNorm) ||
          (p.gruppe || "").toLowerCase().includes(sokNorm),
      )
    : [];
  const belopTall = parseFloat(belop);
  const kanLagre = !!post && !!dato && !isNaN(belopTall) && belopTall !== 0;

  const lagre = async () => {
    if (!post) return;
    const endring = lagreManuellRegistrering(
      { type, postId: post.id, dato, belop, kommentar, eiere },
      grupper,
      { newId: () => crypto.randomUUID(), naa: new Date().toISOString() },
    );
    if (!endring) return;
    setLagrer(true);
    setFeil(false);
    try {
      await onUtfor(endring);
      onLukk();
    } catch (err) {
      console.error("[Manuell registrering] Feilet:", err);
      setFeil(true);
    } finally {
      setLagrer(false);
    }
  };

  return (
    <div className={styles.panel} role="group" aria-label="Registrer manuelt">
      <div className={styles.seksjonTittel}>Registrer manuelt</div>
      <div className={styles.radInfo}>
        For økonomiske hendelser som ikke finnes i bankimporten, f.eks. gavekort.
      </div>
      <div className={styles.panelSeksjon}>
        <div className={styles.chips} role="group" aria-label="Type">
          {TYPER.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={type === id}
              className={type === id ? styles.chipAktiv : styles.chip}
              onClick={() => {
                setType(id);
                setPost(null);
                setSok("");
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="date"
          aria-label="Dato"
          className={styles.sok}
          value={dato}
          onChange={(e) => setDato(e.target.value)}
        />
        <input
          type="number"
          inputMode="decimal"
          aria-label="Beløp"
          placeholder="Beløp (kr)"
          className={styles.sok}
          value={belop}
          onChange={(e) => setBelop(e.target.value)}
        />
        <div className={styles.radInfo}>Bruk minus for å redusere faktisk beløp på posten.</div>
        {post ? (
          <button type="button" className={styles.valgRad} onClick={() => setPost(null)}>
            <span className={styles.valgTekst}>
              <span className={styles.fordelingNavn}>
                {post.gruppe} / {post.name}
              </span>
            </span>
            <span className={styles.valgHandling}>Endre</span>
          </button>
        ) : (
          <>
            <input
              type="search"
              aria-label="Søk etter post"
              placeholder={SOK_PLASSHOLDER[type]}
              className={styles.sok}
              value={sok}
              onChange={(e) => setSok(e.target.value)}
            />
            {sokNorm && (
              <div className={styles.valgListe}>
                {treff.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={styles.valgRad}
                    onClick={() => {
                      setPost(p);
                      setSok("");
                    }}
                  >
                    <span className={styles.valgTekst}>
                      <span className={styles.valgNavn}>{p.name}</span>
                      <span className={styles.radInfo}>{p.gruppe}</span>
                    </span>
                  </button>
                ))}
                {treff.length === 0 && <div className={styles.radInfo}>Ingen treff.</div>}
              </div>
            )}
          </>
        )}
        <div className={styles.radInfo}>Eier</div>
        <div className={styles.chips} role="group" aria-label="Eier">
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
                  setEiere(
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
        <input
          aria-label="Kommentar"
          placeholder="Kommentar (valgfritt)"
          className={styles.sok}
          value={kommentar}
          onChange={(e) => setKommentar(e.target.value)}
        />
      </div>
      {feil && <div className={styles.toneAvvik}>⚠ Noe gikk galt. Se konsollen for detaljer.</div>}
      <div className={styles.handlinger}>
        <button type="button" className={styles.sekundar} onClick={onLukk} disabled={lagrer}>
          Avbryt
        </button>
        <button
          type="button"
          className={styles.primar}
          disabled={!kanLagre || lagrer}
          onClick={() => void lagre()}
        >
          {lagrer ? "Lagrer…" : "Lagre"}
        </button>
      </div>
    </div>
  );
}
