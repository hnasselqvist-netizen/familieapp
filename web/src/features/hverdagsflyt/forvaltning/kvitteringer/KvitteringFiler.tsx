import { useEffect, useRef, useState } from "react";
import type { KvitteringFil, KvitteringRecord } from "@app-types/forsoning";
import { FILTYPE_ACCEPT, filstorrelseTekst } from "@domain/forsoning/kvitteringsfil";
import { useKvitteringsfiler } from "@hooks/useKvitteringsfiler";
import styles from "./KvitteringsinnboksScreen.module.css";

const TYPE_TEKST: Record<KvitteringFil["type"], string> = {
  "image/jpeg": "Bilde",
  "image/png": "Bilde",
  "image/webp": "Bilde",
  "application/pdf": "PDF",
};

const erKjentFeil = (e: unknown): e is Error =>
  e instanceof Error && (e.name === "KvitteringsfilAvvist" || e.name === "KvitteringsfilFeil");

/** Hentefeil (Vis/Last ned). */
const hentefeil = (e: unknown): string =>
  erKjentFeil(e) ? e.message : "Kunne ikke hente filen. Prøv igjen.";

/**
 * Opplastingsfeil. Er en annen fil valgt i mellomtiden, navngis filen som
 * feilet, så meldingen aldri ser ut til å gjelde det nye valget.
 */
const opplastingsfeil = (e: unknown, fil: File, fortsattValgt: boolean): string => {
  if (fortsattValgt) {
    return erKjentFeil(e) ? e.message : "Kunne ikke lagre. Prøv igjen — filen er fortsatt valgt.";
  }
  return erKjentFeil(e)
    ? `«${fil.name}»: ${e.message}`
    : `Kunne ikke lagre «${fil.name}». Velg den på nytt for å prøve igjen.`;
};

/**
 * Originalfiler i vedleggstjenesten (#59, B1). Vises bare når tjenesten er
 * slått på. Filer hentes først når brukeren ber om det (ingen automatisk
 * åpning eller nedlasting), som object-URL-er som frigis ved bytte,
 * lukking og unmount. Opplasting viser «lagret» først når metadataen er
 * bekreftet; ved feil beholdes valgt fil og meldingen vises.
 *
 * Levetidsvern (review 5725492565): svar som kommer etter bytte av
 * kvittering eller unmount, oppretter ingen object-URL, endrer ingen
 * tilstand og starter ingen nedlasting. Bare den siste «Vis» får sette
 * visningen, og en erstattet visning frigis med en gang. Filvelgeren er
 * sperret under lagring, og et nyere valg nullstilles aldri av at en
 * tidligere opplasting fullføres.
 */
export function KvitteringFiler({ r }: { r: KvitteringRecord }) {
  const filer = useKvitteringsfiler();
  const [valgt, setValgt] = useState<File | null>(null);
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [lagret, setLagret] = useState<string | null>(null);
  const [visning, setVisning] = useState<{ sha256: string; url: string; type: string } | null>(
    null,
  );
  const [henter, setHenter] = useState<string | null>(null);
  const urler = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Økes ved bytte av kvittering og unmount; eldre svar forkastes. */
  const levetid = useRef(0);
  /** Siste «Vis»-forespørsel; bare den får sette visningen. */
  const sisteVisning = useRef(0);
  const visningUrl = useRef<string | null>(null);
  const valgtRef = useRef<File | null>(null);

  // Frigi alle object-URL-er og forkast ventende svar når kvitteringen
  // byttes eller komponenten fjernes.
  useEffect(() => {
    const liste = urler.current;
    const input = inputRef.current;
    return () => {
      levetid.current += 1;
      liste.forEach((u) => URL.revokeObjectURL(u));
      liste.length = 0;
      visningUrl.current = null;
      valgtRef.current = null;
      setVisning(null);
      setValgt(null);
      setLagrer(false);
      setHenter(null);
      setFeil(null);
      setLagret(null);
      if (input) input.value = "";
    };
  }, [r.id]);

  if (!filer.aktiv) return null;
  const lagrede = r.vedlegg ?? [];

  const frigi = (url: string) => {
    URL.revokeObjectURL(url);
    urler.current = urler.current.filter((u) => u !== url);
  };

  const hent = async (f: KvitteringFil, last: boolean) => {
    const g = levetid.current;
    const nr = last ? 0 : ++sisteVisning.current;
    setHenter(f.sha256);
    setFeil(null);
    try {
      const blob = await filer.hent(r, f);
      // Utdatert svar: kvitteringen er byttet/lukket, eller en nyere «Vis»
      // har tatt over. Ingen URL, ingen visning, ingen nedlasting.
      if (g !== levetid.current) return;
      if (!last && nr !== sisteVisning.current) return;
      const url = URL.createObjectURL(new Blob([blob], { type: f.type }));
      urler.current.push(url);
      if (last) {
        const a = document.createElement("a");
        a.href = url;
        a.download = f.filnavn || `kvittering.${f.type === "application/pdf" ? "pdf" : "bilde"}`;
        a.click();
      } else {
        if (visningUrl.current) frigi(visningUrl.current);
        visningUrl.current = url;
        setVisning({ sha256: f.sha256, url, type: f.type });
      }
    } catch (e) {
      if (g === levetid.current) setFeil(hentefeil(e));
    } finally {
      if (g === levetid.current) setHenter((h) => (h === f.sha256 ? null : h));
    }
  };

  const lastOpp = async () => {
    const fil = valgt;
    if (!fil) return;
    const g = levetid.current;
    setLagrer(true);
    setFeil(null);
    setLagret(null);
    try {
      await filer.lastOpp(r, fil);
      if (g !== levetid.current) return;
      setLagret(`«${fil.name}» er lagret.`);
      // Nullstill bare hvis brukeren ikke har valgt en annen fil i mellomtiden.
      if (valgtRef.current === fil) {
        valgtRef.current = null;
        setValgt(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    } catch (e) {
      if (g === levetid.current) setFeil(opplastingsfeil(e, fil, valgtRef.current === fil));
    } finally {
      if (g === levetid.current) setLagrer(false);
    }
  };

  return (
    <div className={styles.vedlegg} aria-label="Kvitteringsfiler">
      {lagrede.length > 0 && (
        <ul className={styles.filListe}>
          {lagrede.map((f) => (
            <li key={f.sha256}>
              <span>
                {TYPE_TEKST[f.type]} · {f.filnavn} · {filstorrelseTekst(f.storrelse)}
              </span>
              {f.type !== "application/pdf" && (
                <button
                  type="button"
                  className={styles.lenkeKnapp}
                  disabled={henter === f.sha256}
                  onClick={() => void hent(f, false)}
                >
                  Vis
                </button>
              )}
              <button
                type="button"
                className={styles.lenkeKnapp}
                disabled={henter === f.sha256}
                onClick={() => void hent(f, true)}
              >
                Last ned
              </button>
              {visning?.sha256 === f.sha256 && (
                <img
                  src={visning.url}
                  alt={`Kvittering ${f.filnavn}`}
                  className={styles.vedleggBilde}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {filer.kanLasteOpp && (
        <div className={styles.filOpplasting}>
          <input
            ref={inputRef}
            type="file"
            accept={FILTYPE_ACCEPT}
            aria-label="Velg kvitteringsfil"
            disabled={lagrer}
            onChange={(e) => {
              const ny = e.target.files?.[0] ?? null;
              valgtRef.current = ny;
              setValgt(ny);
              setFeil(null);
              setLagret(null);
            }}
          />
          <button
            type="button"
            className={styles.lenkeKnapp}
            disabled={!valgt || lagrer}
            onClick={() => void lastOpp()}
          >
            {lagrer ? "Lagrer…" : "Last opp fil"}
          </button>
        </div>
      )}
      {lagret && !feil && <p role="status">{lagret}</p>}
      {feil && (
        <p className={styles.toneAvvik} role="alert">
          {feil}
        </p>
      )}
    </div>
  );
}
