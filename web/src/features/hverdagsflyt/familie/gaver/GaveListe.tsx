import { useId, useState } from "react";
import { Button } from "@components/Button";
import type { Gave, GaveStatus } from "@app-types/gaver";
import { STATUS_TEKST, belopTekst, tolkPlanBelop } from "@domain/gaver/gaver";
import type { GaverHandlinger } from "@hooks/useGaver";
import { useLagring } from "./lagring";
import { Lagringsmelding } from "./Skjemadeler";
import { apneGave, gaveFelt } from "./apne";
import { type GaveFelt, nokkel, useUtkastLager, useVert } from "./utkast";
import styles from "./Gaver.module.css";

const STATUSER: GaveStatus[] = ["ide", "kjopt", "gitt"];

/** Én gave eller idé med status, valgt-markering, beløp og redigering. */
export function GaveRad({
  gave,
  handlinger,
  kunLesing,
  ekstra,
}: {
  gave: Gave;
  handlinger: GaverHandlinger;
  kunLesing?: boolean;
  /** Ekstra handling, f.eks. «Bruk til jul 2026» for en løpende idé. */
  ekstra?: { tekst: string; utfor: () => Promise<void> };
}) {
  const lager = useUtkastLager();
  const n = nokkel.gave(gave.id);
  // Skrivebeskyttede rader viser aldri skjema og er ikke vert for utkast.
  useVert(kunLesing ? "" : n);
  const l = useLagring();
  const id = useId();

  if (!kunLesing && lager.poster.has(n)) {
    return (
      <li className={styles.rad}>
        <div style={{ flexBasis: "100%" }}>
          <GaveSkjema nokkel={n} gjeldende={gave} handlinger={handlinger} />
        </div>
      </li>
    );
  }

  return (
    <li className={styles.rad}>
      <div className={styles.radTekst}>
        <span className={styles.tekst}>{gave.tekst || "(uten tekst)"}</span>
        <span className={styles.dempet}>
          {gave.planlagtOre !== undefined
            ? `Planlagt ${belopTekst(gave.planlagtOre)}`
            : "Uten beløp"}
          {gave.status === "ide" && (gave.valgt ? " · valgt som gaven" : " · alternativ")}
          {kunLesing && ` · ${STATUS_TEKST[gave.status]}`}
        </span>
      </div>
      {!kunLesing && (
        <div className={styles.handlinger}>
          <select
            id={`${id}-status`}
            className={styles.select}
            value={gave.status}
            disabled={l.lagrer}
            aria-label={`Status for ${gave.tekst}`}
            onChange={(e) =>
              void l.kjor(() => handlinger.settGaveStatus(gave, e.target.value as GaveStatus))
            }
          >
            {STATUSER.map((s) => (
              <option key={s} value={s}>
                {STATUS_TEKST[s]}
              </option>
            ))}
          </select>
          {gave.status === "ide" && (
            <label className={styles.avkrysning} htmlFor={`${id}-valgt`}>
              <input
                id={`${id}-valgt`}
                type="checkbox"
                checked={gave.valgt === true}
                disabled={l.lagrer}
                onChange={(e) => void l.kjor(() => handlinger.settValgt(gave, e.target.checked))}
              />
              Valgt
            </label>
          )}
          {ekstra && (
            <button
              type="button"
              className={styles.tekstKnapp}
              disabled={l.lagrer}
              onClick={() => void l.kjor(ekstra.utfor)}
            >
              {ekstra.tekst}
            </button>
          )}
          <button
            type="button"
            className={styles.tekstKnapp}
            onClick={() => apneGave(lager, n, gave, gave.personId, gave.anledningId)}
            aria-label={`Rediger ${gave.tekst}`}
          >
            Rediger
          </button>
        </div>
      )}
      <Lagringsmelding {...l} />
    </li>
  );
}

/**
 * Ny gave/idé (`grunn = null`) eller redigering. Utkastet og grunnlaget
 * ligger i utkastlageret under `nokkel`; `gjeldende` er siste lagrede
 * versjon av gaven (fra abonnementet), brukt til «lagre likevel».
 */
export function GaveSkjema({
  nokkel: n,
  gjeldende,
  handlinger,
}: {
  nokkel: string;
  gjeldende: Gave | null;
  handlinger: GaverHandlinger;
}) {
  const feltId = useId();
  const lager = useUtkastLager();
  const l = useLagring();
  const [visFeil, setVisFeil] = useState(false);
  const post = lager.poster.get(n);
  if (!post || post.art !== "gave") return null;
  const { felt: utkast, grunn } = post;
  const settFelt = (endring: Partial<GaveFelt>) =>
    lager.oppdater(n, (p) => (p.art === "gave" ? { ...p, felt: { ...p.felt, ...endring } } : p));
  const settGrunn = (g: Gave | null) =>
    lager.oppdater(n, (p) => (p.art === "gave" ? { ...p, grunn: g } : p));
  const lukk = () => lager.fjern(n);

  const lagre = async (mot: Gave | null) => {
    const ore = tolkPlanBelop(utkast.belop);
    setVisFeil(true);
    if (!utkast.tekst.trim() || ore === null) return;
    const ok = await l.kjor(() =>
      handlinger.lagreGave(
        post.id,
        {
          personId: post.personId,
          anledningId: mot?.anledningId ?? post.anledningId,
          tekst: utkast.tekst,
          status: utkast.status,
          valgt: utkast.valgt,
          planlagtOre: ore,
        },
        mot,
      ),
    );
    if (ok) lukk();
  };
  const ugyldig = !utkast.tekst.trim()
    ? "Skriv hva gaven eller ideen er."
    : tolkPlanBelop(utkast.belop) === null
      ? "Skriv beløpet i kroner, for eksempel 350, eller la feltet stå tomt."
      : null;
  const visUgyldig = visFeil && ugyldig;

  return (
    <form
      className={styles.skjema}
      aria-label={grunn ? "Rediger gave" : "Ny idé eller gave"}
      onSubmit={(e) => {
        e.preventDefault();
        void lagre(grunn);
      }}
    >
      <div className={styles.rutenett}>
        <div className={styles.felt}>
          <label htmlFor={`${feltId}-tekst`}>Idé eller gave</label>
          <input
            id={`${feltId}-tekst`}
            className={styles.input}
            value={utkast.tekst}
            onChange={(e) => settFelt({ tekst: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div className={styles.felt}>
          <label htmlFor={`${feltId}-belop`}>Planlagt beløp (valgfritt)</label>
          <input
            id={`${feltId}-belop`}
            className={`${styles.input} ${styles.belopInput}`}
            inputMode="decimal"
            placeholder="kr"
            value={utkast.belop}
            onChange={(e) => settFelt({ belop: e.target.value })}
          />
        </div>
        <div className={styles.felt}>
          <label htmlFor={`${feltId}-status`}>Status</label>
          <select
            id={`${feltId}-status`}
            className={styles.select}
            value={utkast.status}
            onChange={(e) => settFelt({ status: e.target.value as GaveStatus })}
          >
            {STATUSER.map((s) => (
              <option key={s} value={s}>
                {STATUS_TEKST[s]}
              </option>
            ))}
          </select>
        </div>
        {utkast.status === "ide" && (
          <label className={styles.avkrysning} htmlFor={`${feltId}-valgt`}>
            <input
              id={`${feltId}-valgt`}
              type="checkbox"
              checked={utkast.valgt}
              onChange={(e) => settFelt({ valgt: e.target.checked })}
            />
            Valgt som gaven (telles i planlagt sum)
          </label>
        )}
      </div>
      {visUgyldig && <p className={styles.feil}>{ugyldig}</p>}
      <Lagringsmelding
        {...l}
        onLagreLikevel={
          gjeldende
            ? () => {
                settGrunn(gjeldende);
                void lagre(gjeldende);
              }
            : undefined
        }
        onForkast={
          gjeldende
            ? () => {
                lager.sett(n, { ...post, grunn: gjeldende, felt: gaveFelt(gjeldende) });
                l.nullstill();
              }
            : undefined
        }
      />
      <div className={styles.handlinger}>
        <Button size="compact" loading={l.lagrer} onClick={() => void lagre(grunn)}>
          Lagre
        </Button>
        <button type="button" className={styles.tekstKnapp} onClick={lukk}>
          Avbryt
        </button>
      </div>
    </form>
  );
}
