import { useState } from "react";
import { RoomHeader } from "@components/RoomHeader";
import type { GaverData, GaverHandlinger } from "@hooks/useGaver";
import { Helaar } from "./Helaar";
import { JulPlan } from "./JulPlan";
import { Personregister } from "./Personregister";
import { UlagredeUtkast } from "./UlagredeUtkast";
import { UtkastLager } from "./UtkastLager";
import styles from "./Gaver.module.css";

export interface GaverViewProps extends GaverData {
  aar: number;
  handlinger: GaverHandlinger;
}

type Fane = "jul" | "aaret" | "personer";

/**
 * `/hjem-familie/gaver` (S1): juleplanleggingen for året, årsoversikten
 * (bursdag og jul per person, etterregistrering) og det felles
 * personregisteret. Alle beløp er plan; ingenting skrives til økonomien.
 */
export function GaverView({ aar, handlinger, ...data }: GaverViewProps) {
  const [fane, setFane] = useState<Fane>("jul");
  return (
    <UtkastLager>
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
              ["aaret", `Året ${aar}`],
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
        <UlagredeUtkast data={data} grupper={data.grupper} handlinger={handlinger} />
        {/* Alle fanene er montert; de skjulte beholder åpne skjemaer og utkast. */}
        <div hidden={fane !== "jul"}>
          <JulPlan aar={aar} handlinger={handlinger} {...data} />
        </div>
        <div hidden={fane !== "aaret"}>
          <Helaar
            aar={aar}
            personer={data.personer}
            grupper={data.grupper}
            anledninger={data.anledninger}
            gaver={data.gaver}
            handlinger={handlinger}
          />
        </div>
        <div hidden={fane !== "personer"}>
          <Personregister
            personer={data.personer}
            grupper={data.grupper}
            gaver={data.gaver}
            anledninger={data.anledninger}
            aar={aar}
            handlinger={handlinger}
          />
        </div>
      </div>
    </UtkastLager>
  );
}
