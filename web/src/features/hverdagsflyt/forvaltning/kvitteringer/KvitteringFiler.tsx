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

const feiltekst = (e: unknown): string =>
  e instanceof Error && (e.name === "KvitteringsfilAvvist" || e.name === "KvitteringsfilFeil")
    ? e.message
    : "Kunne ikke lagre. Prøv igjen — filen er fortsatt valgt.";

/**
 * Originalfiler i vedleggstjenesten (#59, B1). Vises bare når tjenesten er
 * slått på. Filer hentes først når brukeren ber om det (ingen automatisk
 * åpning eller nedlasting), som object-URL-er som frigis ved bytte,
 * lukking og unmount. Opplasting viser «Lagret» først når metadataen er
 * bekreftet; ved feil beholdes valgt fil og meldingen vises.
 */
export function KvitteringFiler({ r }: { r: KvitteringRecord }) {
  const filer = useKvitteringsfiler();
  const [valgt, setValgt] = useState<File | null>(null);
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [visning, setVisning] = useState<{ sha256: string; url: string; type: string } | null>(
    null,
  );
  const [henter, setHenter] = useState<string | null>(null);
  const urler = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Frigi alle object-URL-er når kvitteringen byttes eller komponenten fjernes.
  useEffect(() => {
    const liste = urler.current;
    return () => {
      liste.forEach((u) => URL.revokeObjectURL(u));
      liste.length = 0;
      setVisning(null);
    };
  }, [r.id]);

  if (!filer.aktiv) return null;
  const lagrede = r.vedlegg ?? [];

  const hent = async (f: KvitteringFil, last: boolean) => {
    setHenter(f.sha256);
    setFeil(null);
    try {
      const blob = await filer.hent(r, f);
      const url = URL.createObjectURL(new Blob([blob], { type: f.type }));
      urler.current.push(url);
      if (last) {
        const a = document.createElement("a");
        a.href = url;
        a.download = f.filnavn || `kvittering.${f.type === "application/pdf" ? "pdf" : "bilde"}`;
        a.click();
      } else {
        setVisning({ sha256: f.sha256, url, type: f.type });
      }
    } catch (e) {
      setFeil(feiltekst(e));
    } finally {
      setHenter(null);
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
            onChange={(e) => {
              setValgt(e.target.files?.[0] ?? null);
              setFeil(null);
            }}
          />
          <button
            type="button"
            className={styles.lenkeKnapp}
            disabled={!valgt || lagrer}
            onClick={async () => {
              if (!valgt) return;
              setLagrer(true);
              setFeil(null);
              try {
                await filer.lastOpp(r, valgt);
                setValgt(null);
                if (inputRef.current) inputRef.current.value = "";
              } catch (e) {
                setFeil(feiltekst(e));
              } finally {
                setLagrer(false);
              }
            }}
          >
            {lagrer ? "Lagrer…" : "Last opp fil"}
          </button>
        </div>
      )}
      {feil && (
        <p className={styles.toneAvvik} role="alert">
          {feil}
        </p>
      )}
    </div>
  );
}
