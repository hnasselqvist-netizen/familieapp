import { useState } from "react";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import { Modal } from "@components/Modal";
import { RoomHeader } from "@components/RoomHeader";
import { calculateSplitTotal } from "@domain/forsoning/kvittering";
import {
  foreslattTransaksjon,
  getDisplayDescription,
  type KvitteringStatusTone,
  kvitteringStatus,
} from "@domain/forsoning/kvitteringsinnboks";
import type {
  Eierandel,
  HendelseRecord,
  KvitteringRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import styles from "./KvitteringsinnboksScreen.module.css";

export interface KvitteringsinnboksViewProps {
  /** Alle kvitteringer (også forkastede og ferdige) — kun til «N registrert». */
  alle: KvitteringRecord[];
  /** Kvitteringene som krever en beslutning, med forslag beregnet i minnet. */
  aktive: KvitteringRecord[];
  transaksjoner: TransaksjonRecord[];
  hendelser: HendelseRecord[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 2,
  }).format(n);
const fmtD = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" })
    : "—";
const eiereTekst = (eiere: Eierandel[] | undefined) =>
  (eiere && eiere.length > 0 ? eiere : [{ person: "Felles", prosent: 100 }])
    .map((e) => e.person + (e.prosent < 100 ? ` ${e.prosent}%` : ""))
    .join(", ");

const TONE_CLASS: Record<KvitteringStatusTone, string | undefined> = {
  ferdig: styles.toneFerdig,
  koblet: styles.toneVent,
  foreslatt: styles.toneVent,
  ikke_koblet: styles.toneDempet,
};

/**
 * Kvitteringsinnboks — ren visning (§Issue #34 R2), portert fra legacy
 * `KvitteringInnboksScreen`/`KvitteringDetalj` (`index.html` ~5528–6471):
 * samme utvalg (ikke forkastet, uten ferdig hendelse), samme sortering,
 * statustekst og forslag. Ingen registrering, redigering, kobling,
 * bildeopplasting eller forkasting — de skriver `receipts`/`hendelser`/
 * `transaksjoner` og blir i legacy til R3-cutover (ADR 0002).
 */
export function KvitteringsinnboksView({
  alle,
  aktive,
  transaksjoner,
  hendelser,
}: KvitteringsinnboksViewProps) {
  const [apenId, setApenId] = useState<string | null>(null);
  const apen = apenId ? aktive.find((r) => r.id === apenId) : undefined;

  return (
    <div>
      <RoomHeader
        eyebrow="FORVALTNING"
        title="Kvitteringer"
        description={`${alle.length} registrert`}
      />

      <div className={styles.notis} role="note">
        Kun visning. Kvitteringer registreres, redigeres, kobles og forkastes fortsatt i den gamle
        appen.
      </div>

      {aktive.length === 0 && (
        <div className={styles.tom}>
          {alle.length === 0
            ? "Ingen kvitteringer registrert ennå."
            : "Ingen kvitteringer krever oppmerksomhet nå."}
        </div>
      )}

      {aktive.length > 0 && (
        <Card>
          {aktive.map((r) => {
            const status = kvitteringStatus(r, hendelser);
            const forslag = foreslattTransaksjon(r, transaksjoner);
            const antallSplitter = (r.splits || []).length;
            return (
              <div key={r.id} className={styles.radBoks}>
                <button type="button" className={styles.rad} onClick={() => setApenId(r.id)}>
                  <span className={styles.ikon} aria-hidden>
                    <Icon name="receipt-text" size={18} />
                  </span>
                  <span className={styles.radTekst}>
                    <span className={styles.leverandor}>{r.merchant || "(ukjent leverandør)"}</span>
                    <span className={styles.radInfo}>
                      {fmtD(r.purchaseDate)} · {antallSplitter} splitt
                      {antallSplitter !== 1 ? "er" : ""} ·{" "}
                      <span className={TONE_CLASS[status.tone]}>{status.tekst}</span>
                    </span>
                  </span>
                  <span className={styles.belop}>{fmt(r.total || 0)}</span>
                  <Icon name="chevron-right" size={16} />
                </button>
                {forslag && (
                  <div className={styles.forslag}>
                    <span className={styles.forslagTittel}>Foreslått match</span>
                    <span>
                      {fmtD(forslag.dato)} · {forslag.tekst} · {fmt(forslag.belop || 0)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {apen && (
        <Modal title={apen.merchant || "(ukjent leverandør)"} onClose={() => setApenId(null)}>
          <KvitteringDetalj r={apen} />
          <div className={styles.handlinger}>
            <Button variant="secondary" onClick={() => setApenId(null)}>
              Lukk
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function KvitteringDetalj({ r }: { r: KvitteringRecord }) {
  const splitter = r.splits || [];
  const splitTotal = calculateSplitTotal(r);
  const diff = (r.total || 0) - splitTotal;
  return (
    <div>
      {r.driveWebViewLink && (
        <a
          href={r.driveWebViewLink}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.driveLenke}
        >
          Åpne bilde i Google Drive
        </a>
      )}
      <dl className={styles.felter}>
        <div>
          <dt>Leverandør</dt>
          <dd>{r.merchant || "—"}</dd>
        </div>
        <div>
          <dt>Dato</dt>
          <dd>{fmtD(r.purchaseDate)}</dd>
        </div>
        <div>
          <dt>Totalbeløp</dt>
          <dd>{fmt(r.total || 0)}</dd>
        </div>
        <div>
          <dt>Behandling</dt>
          <dd>
            {r.allocationMode === "single"
              ? "Én post for hele kvitteringen"
              : r.allocationMode === "split"
                ? "Splittet på flere poster"
                : "Ikke valgt"}
          </dd>
        </div>
      </dl>

      {(r.allocationMode === "single" || r.allocationMode === "split") && splitter.length > 0 && (
        <ul className={styles.splitter} aria-label="Fordeling">
          {(r.allocationMode === "single" ? splitter.slice(0, 1) : splitter).map((sp, idx) => (
            <li key={idx} className={styles.splitt}>
              <span className={styles.splittTopp}>
                <span>{sp.targetName}</span>
                <span className={styles.belop}>{fmt(sp.amount || 0)}</span>
              </span>
              {getDisplayDescription(sp) && (
                <span className={styles.dempet}>{getDisplayDescription(sp)}</span>
              )}
              <span className={styles.dempet}>{eiereTekst(sp.eiere)}</span>
            </li>
          ))}
        </ul>
      )}

      {r.allocationMode === "split" && (
        <div className={diff === 0 ? styles.toneFerdig : styles.toneAvvik}>
          Splittsum: {fmt(splitTotal)} {diff !== 0 && `· gjenstår ${fmt(diff)}`}
        </div>
      )}
    </div>
  );
}
