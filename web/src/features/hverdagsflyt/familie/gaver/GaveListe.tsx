import { useId, useState } from "react";
import { Button } from "@components/Button";
import type { Gave, GaveStatus } from "@app-types/gaver";
import { STATUS_TEKST, belopFelt, belopTekst, tolkPlanBelop } from "@domain/gaver/gaver";
import type { GaverHandlinger } from "@hooks/useGaver";
import { useLagring } from "./lagring";
import { Lagringsmelding } from "./Skjemadeler";
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
  const [redigerer, setRedigerer] = useState(false);
  const l = useLagring();
  const id = useId();

  if (redigerer) {
    return (
      <li className={styles.rad}>
        <div style={{ flexBasis: "100%" }}>
          <GaveSkjema
            id={gave.id}
            grunn={gave}
            gjeldende={gave}
            personId={gave.personId}
            anledningId={gave.anledningId}
            handlinger={handlinger}
            onFerdig={() => setRedigerer(false)}
          />
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
            onClick={() => setRedigerer(true)}
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

/** Ny gave/idé (`grunn = null`) eller redigering. */
export function GaveSkjema({
  id: startId,
  grunn: startGrunn,
  gjeldende,
  personId,
  anledningId,
  handlinger,
  onFerdig,
}: {
  id: string;
  grunn: Gave | null;
  gjeldende: Gave | null;
  personId: string;
  anledningId?: string;
  handlinger: GaverHandlinger;
  onFerdig: () => void;
}) {
  const feltId = useId();
  const fra = (g: Gave | null) => ({
    tekst: g?.tekst ?? "",
    status: g?.status ?? ("ide" as GaveStatus),
    valgt: g?.valgt ?? false,
    belop: belopFelt(g?.planlagtOre),
  });
  const [utkast, setUtkast] = useState(() => fra(startGrunn));
  const [grunn, setGrunn] = useState<Gave | null>(startGrunn);
  const [ugyldig, setUgyldig] = useState<string | null>(null);
  const l = useLagring();

  const lagre = async (mot: Gave | null) => {
    if (!utkast.tekst.trim()) return setUgyldig("Skriv hva gaven eller ideen er.");
    const ore = tolkPlanBelop(utkast.belop);
    if (ore === null)
      return setUgyldig("Skriv beløpet i kroner, for eksempel 350, eller la feltet stå tomt.");
    setUgyldig(null);
    const ok = await l.kjor(() =>
      handlinger.lagreGave(
        startId,
        {
          personId,
          anledningId: mot?.anledningId ?? anledningId,
          tekst: utkast.tekst,
          status: utkast.status,
          valgt: utkast.valgt,
          planlagtOre: ore,
        },
        mot,
      ),
    );
    if (ok) onFerdig();
  };

  return (
    <form
      className={styles.skjema}
      aria-label={startGrunn ? "Rediger gave" : "Ny idé eller gave"}
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
            onChange={(e) => setUtkast((u) => ({ ...u, tekst: e.target.value }))}
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
            onChange={(e) => setUtkast((u) => ({ ...u, belop: e.target.value }))}
          />
        </div>
        <div className={styles.felt}>
          <label htmlFor={`${feltId}-status`}>Status</label>
          <select
            id={`${feltId}-status`}
            className={styles.select}
            value={utkast.status}
            onChange={(e) => setUtkast((u) => ({ ...u, status: e.target.value as GaveStatus }))}
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
              onChange={(e) => setUtkast((u) => ({ ...u, valgt: e.target.checked }))}
            />
            Valgt som gaven (telles i planlagt sum)
          </label>
        )}
      </div>
      {ugyldig && <p className={styles.feil}>{ugyldig}</p>}
      <Lagringsmelding
        {...l}
        onLagreLikevel={
          gjeldende
            ? () => {
                setGrunn(gjeldende);
                void lagre(gjeldende);
              }
            : undefined
        }
        onForkast={
          gjeldende
            ? () => {
                setUtkast(fra(gjeldende));
                setGrunn(gjeldende);
                l.nullstill();
              }
            : undefined
        }
      />
      <div className={styles.handlinger}>
        <Button size="compact" loading={l.lagrer} onClick={() => void lagre(grunn)}>
          Lagre
        </Button>
        <button type="button" className={styles.tekstKnapp} onClick={onFerdig}>
          Avbryt
        </button>
      </div>
    </form>
  );
}
