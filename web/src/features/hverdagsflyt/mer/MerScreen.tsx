import { Link } from "react-router-dom";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import type { IconName } from "@components/icons";
import { RoomHeader } from "@components/RoomHeader";
import { LEGACY_APP_URL } from "@features/legacyUrl";
import styles from "./MerScreen.module.css";

interface Rad {
  ikon: IconName;
  tittel: string;
  hint: string;
}

const I_APPEN: (Rad & { til: string })[] = [
  {
    til: "/forvaltning/regelsenter",
    ikon: "list-todo",
    tittel: "Regelsenter",
    hint: "Lærte koblinger og matchregler for bankimport.",
  },
  {
    til: "/forvaltning/arsbudsjett",
    ikon: "calendar-days",
    tittel: "Årsbudsjett",
    hint: "Planlegg budsjettet måned for måned gjennom året.",
  },
];

/** Legacy «Mer» (`MerScreen`, index.html ~15609) som ikke er flyttet ennå. */
const I_DAGENS_APP: Rad[] = [
  {
    ikon: "sparkles",
    tittel: "Generator",
    hint: "Kontrollpanel for automatiske prognoseposter.",
  },
  { ikon: "landmark", tittel: "Kontoer", hint: "Kontoer brukt i bankimport." },
  {
    ikon: "chart-column",
    tittel: "Historikkeksport",
    hint: "Eksporter ferdige hendelser som CSV.",
  },
];

/**
 * «Mer» i den nye appen (#59 6001954968). Erstatter broen til legacy på
 * `/verktoy`, så hovednavigasjonen ikke lenger sender brukeren rett tilbake
 * til dagens app.
 *
 * Kartlegging av legacy «Mer» (index.html ~15609):
 *  - Regler og Årsbudsjett finnes i React → direkte lenker.
 *  - Generator, Kontoer og Historikkeksport er ikke flyttet → tydelig
 *    merket vei til dagens app, til de migreres som egne skiver.
 *  - Engangsverktøyene for flytting/retting av data (Sparing — flytt
 *    poster, Kostnadsstruktur v2, Fortegnsrecovery) og «Metadata» (aldri
 *    bygget) flyttes ikke; om de skal pensjoneres er et produktvalg.
 */
export function MerScreen() {
  return (
    <div className={styles.side}>
      <RoomHeader
        eyebrow="MER"
        title="Mer"
        description="Oppsett og vedlikehold. Vanlige oppgaver gjøres i rommene."
      />

      <section aria-label="Oppsett">
        <h2 className={styles.seksjonTittel}>Oppsett</h2>
        <Card>
          {I_APPEN.map((r) => (
            <Link key={r.til} to={r.til} className={styles.rad}>
              <RadInnhold {...r} />
              <Icon name="chevron-right" size={16} />
            </Link>
          ))}
        </Card>
      </section>

      <section aria-label="I dagens app">
        <h2 className={styles.seksjonTittel}>I dagens app</h2>
        <p className={styles.forklaring}>
          Disse er ikke flyttet til den nye appen ennå, og åpnes i dagens app.
        </p>
        <Card>
          {I_DAGENS_APP.map((r) => (
            <a key={r.tittel} href={LEGACY_APP_URL} className={styles.rad}>
              <RadInnhold {...r} />
              <Icon name="external-link" size={14} />
            </a>
          ))}
        </Card>
        <p className={styles.forklaring}>
          Engangsverktøyene for flytting og retting av data ligger også der.
        </p>
      </section>
    </div>
  );
}

function RadInnhold({ ikon, tittel, hint }: Rad) {
  return (
    <>
      <span className={styles.ikon} aria-hidden>
        <Icon name={ikon} size={18} />
      </span>
      <span className={styles.tekst}>
        <span className={styles.tittel}>{tittel}</span>
        <span className={styles.hint}>{hint}</span>
      </span>
    </>
  );
}
