import { useState } from "react";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { RoomHeader } from "@components/RoomHeader";
import type { HistorikkSammendrag } from "@domain/forsoning/historikkeksport";
import styles from "./MerScreen.module.css";

export interface HistorikkeksportViewProps {
  sammendrag: HistorikkSammendrag;
  /** Lager og laster ned CSV-filen. Kaster ved feil. */
  onEksporter: () => void;
}

/**
 * Historikkeksport (#59, «Mer» over på React) — samme innhold som legacy
 * `HistorikkEksportScreen` (index.html ~15307) i Hverdagsflyt-uttrykk:
 * sammendrag, rolige merknader om uavklarte/tvetydige plasseringer, og
 * én eksportknapp. Ren lesing; ingenting skrives.
 */
export function HistorikkeksportView({ sammendrag: s, onEksporter }: HistorikkeksportViewProps) {
  const [status, setStatus] = useState<"klar" | "ferdig" | "feilet">("klar");

  const eksporter = () => {
    try {
      onEksporter();
      setStatus("ferdig");
    } catch (err) {
      console.error("[Historikkeksport] Feilet:", err);
      setStatus("feilet");
    }
  };

  return (
    <div className={styles.side}>
      <RoomHeader
        eyebrow="MER"
        title="Historikkeksport"
        description="Eksporter kvalitetssikret økonomihistorikk fra ferdige hendelser."
      />

      <Card>
        <dl className={styles.sammendrag} aria-label="Sammendrag">
          <dt>Ferdige økonomiske hendelser</dt>
          <dd>{s.antallHendelser}</dd>
          <dt>Fordelingsrader i eksporten</dt>
          <dd>{s.antallRader}</dd>
          <dt>Første dato</dt>
          <dd>{s.forsteDato ?? "—"}</dd>
          <dt>Siste dato</dt>
          <dd>{s.sisteDato ?? "—"}</dd>
          <dt>Uavklarte plasseringer</dt>
          <dd className={s.antallUavklart > 0 ? styles.merk : undefined}>{s.antallUavklart}</dd>
          <dt>Tvetydige plasseringer</dt>
          <dd className={s.antallTvetydig > 0 ? styles.merk : undefined}>{s.antallTvetydig}</dd>
        </dl>
      </Card>

      {s.antallTvetydig > 0 && (
        <p className={styles.notis}>
          {s.antallTvetydig} rad(er) har en historisk plassering som matcher flere aktive poster på
          tvers av Kostnad/Inntekt/Sparing. De eksporteres likevel, tydelig merket «Tvetydig
          plassering» — ingen gjetting.
        </p>
      )}
      {s.antallUavklart > 0 && (
        <p className={styles.notis}>
          {s.antallUavklart} rad(er) har en historisk plassering som ikke finnes i dagens struktur.
          De eksporteres likevel, tydelig merket «Uavklart plassering» — ingen data skjules.
        </p>
      )}

      <Button onClick={eksporter} disabled={s.antallRader === 0}>
        Eksporter historikk (.csv)
      </Button>
      {status === "ferdig" && <p className={styles.forklaring}>Filen er lastet ned.</p>}
      {status === "feilet" && (
        <p className={styles.notis} role="alert">
          Noe gikk galt med eksporten. Prøv igjen.
        </p>
      )}
    </div>
  );
}
