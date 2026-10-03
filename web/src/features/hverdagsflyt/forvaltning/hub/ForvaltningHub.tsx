import { Link } from "react-router-dom";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import type { IconName } from "@components/icons";
import { RoomHeader } from "@components/RoomHeader";
import { forsoningSkrivingAktiv } from "@hooks/forsoningAktivering";
import { LegacyBridge } from "@features/LegacyBridge";
import styles from "./ForvaltningHub.module.css";

interface Omrade {
  til: string;
  tittel: string;
  beskrivelse: string;
  ikon: IconName;
}

/**
 * Legacy `ForvaltningScreen` sine faner (`index.html` ~5265: Spillerom,
 * Inntekter, Kostnader, Sparing, Import, Kvitteringer) pluss RegelSenter og
 * Årsbudsjett, som i legacy ligger under Verktøy.
 */
const OMRADER: Omrade[] = [
  {
    til: "oversikt",
    tittel: "Spillerom",
    beskrivelse: "Disponibelt, bundet og fordeling",
    ikon: "chart-column",
  },
  {
    til: "inntekter",
    tittel: "Inntekter",
    beskrivelse: "Inntekter per måned",
    ikon: "badge-dollar-sign",
  },
  {
    til: "budsjett",
    tittel: "Kostnader",
    beskrivelse: "Budsjett per måned",
    ikon: "shopping-cart",
  },
  { til: "sparing", tittel: "Sparing", beskrivelse: "Sparing per måned", ikon: "piggy-bank" },
  {
    til: "transaksjoner",
    tittel: "Transaksjoner",
    beskrivelse: "Import, behandling og korrigering",
    ikon: "landmark",
  },
  {
    til: "kvitteringer",
    tittel: "Kvitteringer",
    beskrivelse: "Innboks og kobling",
    ikon: "receipt-text",
  },
  { til: "regelsenter", tittel: "Regelsenter", beskrivelse: "Lærte koblinger", ikon: "list-todo" },
  { til: "arsbudsjett", tittel: "Årsbudsjett", beskrivelse: "Plan for året", ikon: "calendar" },
];

/**
 * Inngangen til Forvaltning (§Issue #34, R3b-cutover). Til cutover er
 * `/forvaltning` fortsatt broen til legacy, så ingen ikke-migrerte områder
 * skjules. Når forsoningsporten slås på, blir legacy-setterne sperret
 * samtidig, og da må Forvaltning åpnes her: navigasjon og skriving byttes i
 * samme steg, i ett flagg.
 */
export function ForvaltningHub() {
  if (!forsoningSkrivingAktiv()) return <LegacyBridge label="Forvaltning" />;
  return (
    <div>
      <RoomHeader eyebrow="FORVALTNING" title="Forvaltning" description="Økonomien i familien" />
      <Card>
        <nav aria-label="Forvaltning">
          {OMRADER.map((o) => (
            <Link key={o.til} to={`/forvaltning/${o.til}`} className={styles.rad}>
              <span className={styles.ikon} aria-hidden>
                <Icon name={o.ikon} size={18} />
              </span>
              <span className={styles.tekst}>
                <span className={styles.tittel}>{o.tittel}</span>
                <span className={styles.beskrivelse}>{o.beskrivelse}</span>
              </span>
              <Icon name="chevron-right" size={16} />
            </Link>
          ))}
        </nav>
      </Card>
    </div>
  );
}
