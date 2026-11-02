import { useState } from "react";
import { RoomHeader } from "@components/RoomHeader";
import type { GaverData, GaverHandlinger } from "@hooks/useGaver";
import { JulPlan } from "./JulPlan";
import { Personregister } from "./Personregister";
import styles from "./Gaver.module.css";

export interface GaverViewProps extends GaverData {
  aar: number;
  handlinger: GaverHandlinger;
}

type Fane = "jul" | "personer";

/**
 * `/hjem-familie/gaver` (S1): juleplanleggingen for året og det felles
 * personregisteret. Alle beløp er plan; ingenting skrives til økonomien.
 */
export function GaverView({ aar, handlinger, ...data }: GaverViewProps) {
  const [fane, setFane] = useState<Fane>("jul");
  return (
    <div className={styles.side}>
      <RoomHeader
        eyebrow="HJEM & FAMILIE"
        title="Gaver"
        description="Hvem dere gir til, ideer, budsjett og status — planlegging, ikke regnskap."
      />
      <nav className={styles.faner} aria-label="Gaver">
        {(
          [
            ["jul", `Jul ${aar}`],
            ["personer", "Personer"],
          ] as const
        ).map(([id, tekst]) => (
          <button
            key={id}
            type="button"
            className={fane === id ? styles.faneAktiv : styles.fane}
            aria-pressed={fane === id}
            onClick={() => setFane(id)}
          >
            {tekst}
          </button>
        ))}
      </nav>
      {fane === "jul" ? (
        <JulPlan aar={aar} handlinger={handlinger} {...data} />
      ) : (
        <Personregister
          personer={data.personer}
          grupper={data.grupper}
          gaver={data.gaver}
          anledninger={data.anledninger}
          aar={aar}
          handlinger={handlinger}
        />
      )}
    </div>
  );
}
