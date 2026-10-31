import { useEffect, useMemo, useState } from "react";
import {
  type BildeAvvisning,
  filnavnForKvitteringsbilde,
  tolkKvitteringsbilde,
} from "@domain/forsoning/kvitteringsbilde";
import type { KvitteringRecord } from "@app-types/forsoning";
import styles from "./KvitteringsinnboksScreen.module.css";

const AVVIST_TEKST: Record<BildeAvvisning, string> = {
  for_stort: "Det lagrede kvitteringsbildet er for stort til å vises her.",
  ugyldig_format: "Det lagrede kvitteringsbildet har et format som ikke kan vises.",
  ikke_tillatt_type: "Det lagrede kvitteringsbildet har et format som ikke kan vises.",
  ugyldig_base64: "Det lagrede kvitteringsbildet er skadet og kan ikke vises.",
  signatur_avvik: "Det lagrede kvitteringsbildet er skadet og kan ikke vises.",
};

const storrelse = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} kB`
    : `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;

/**
 * Kvitteringens vedlegg (#59, skive A), felles for lesedetaljen og
 * redigeringspanelet: lenken til Google Drive når den finnes (uendret), og
 * det lagrede bildet i `imageUrl` når det er et trygt rasterbilde.
 *
 * Bildet vises og lastes ned fra de SAMME dekodede bytene via én object-URL,
 * som frigis når kvitteringen byttes, panelet lukkes eller komponenten
 * fjernes. Ingenting skrives, ingenting åpnes eller lastes ned automatisk,
 * og bildet logges aldri.
 */
export function KvitteringVedlegg({ r }: { r: KvitteringRecord }) {
  const bilde = useMemo(() => tolkKvitteringsbilde(r.imageUrl), [r.imageUrl]);
  const [url, setUrl] = useState<string | null>(null);
  const [feiletFor, setFeiletFor] = useState<string | null>(null);

  useEffect(() => {
    if (bilde.status !== "ok") return;
    const u = URL.createObjectURL(new Blob([bilde.bytes as BlobPart], { type: bilde.type }));
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [bilde]);

  const drive = r.driveWebViewLink ? (
    <a
      href={r.driveWebViewLink}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.driveLenke}
    >
      Åpne bilde i Google Drive
    </a>
  ) : null;

  if (bilde.status === "mangler") return drive;
  if (bilde.status === "avvist") {
    return (
      <>
        {drive}
        <p className={`${styles.vedlegg} ${styles.dempet}`}>{AVVIST_TEKST[bilde.grunn]}</p>
      </>
    );
  }

  const filnavn = filnavnForKvitteringsbilde(r, bilde.filendelse);
  const visningFeilet = url !== null && feiletFor === url;
  return (
    <>
      {drive}
      <figure className={styles.vedlegg} aria-label="Lagret kvitteringsbilde">
        {url && !visningFeilet && (
          <img
            src={url}
            alt={`Kvitteringsbilde${r.merchant ? ` fra ${r.merchant}` : ""}`}
            className={styles.vedleggBilde}
            onError={() => setFeiletFor(url)}
          />
        )}
        {visningFeilet && (
          <p className={styles.dempet}>Nettleseren kunne ikke vise kvitteringsbildet.</p>
        )}
        {url && (
          <figcaption>
            <a href={url} download={filnavn} className={styles.driveLenke}>
              Last ned kvitteringsbilde ({bilde.filendelse.toUpperCase()},{" "}
              {storrelse(bilde.bytes.length)})
            </a>
          </figcaption>
        )}
      </figure>
    </>
  );
}
