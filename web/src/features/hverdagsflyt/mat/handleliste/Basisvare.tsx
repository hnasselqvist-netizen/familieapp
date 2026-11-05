import { Icon } from "@components/Icon";
import { BASISVARE_UGYLDIG_TEKST, basisvareNokkel, erBasisvare } from "@domain/shopping/basisvare";
import type { Staples } from "@app-types/shopping";
import type { Loadable } from "@app-types/status";
import styles from "./HandlelisteScreen.module.css";

/** Lagring som venter eller feilet, per basisvarenøkkel (ikke per rad). */
export type BasisvareLagring = Readonly<Record<string, "lagrer" | "feil">>;

/**
 * «Merk som basisvare» i redigeringsraden for en handlelistevare (#20,
 * ordre 6651329875). Samme betydning som «Ja, basisvare» i
 * handlelistegeneratoren: varen har vanligvis hjemme og avhukes
 * automatisk neste gang den dukker opp i en generert liste. Merkingen
 * endrer ikke denne varen på listen. Fjerning skjer i Matlager.
 *
 * Status leses fra basisvarene før handlingen; en vare som allerede er
 * merket vises som «Basisvare» uten ny skriving. «Basisvare» vises først
 * når skrivingen er bekreftet (ikke på den lokale, optimistiske verdien).
 */
export function Basisvare({
  navn,
  staples,
  lagring,
  onMerk,
}: {
  navn: string;
  staples: Loadable<Staples>;
  lagring: BasisvareLagring;
  onMerk: (navn: string) => void;
}) {
  if (staples.status !== "loaded") {
    return (
      <p className={styles.basisvare} role="status">
        Sjekker basisvare…
      </p>
    );
  }
  const n = basisvareNokkel(navn);
  if (!n.ok) {
    return <p className={styles.basisvareHint}>{BASISVARE_UGYLDIG_TEKST[n.grunn]}</p>;
  }
  const status = lagring[n.nokkel];
  if (status === "lagrer") {
    return (
      <div className={styles.basisvare}>
        <button type="button" className={styles.basisvareKnapp} disabled aria-busy="true">
          Lagrer…
        </button>
      </div>
    );
  }
  if (erBasisvare(navn, staples.data)) {
    return (
      <div className={styles.basisvare}>
        <span className={styles.basisvareMerke}>
          <Icon name="check" size={13} />
          Basisvare
        </span>
        <span className={styles.basisvareHint}>Har vanligvis hjemme. Fjernes i Matlager.</span>
      </div>
    );
  }
  return (
    <div className={styles.basisvare}>
      {status === "feil" && (
        <p className={styles.basisvareFeil} role="alert">
          Kunne ikke lagre «{navn}» som basisvare. Ingenting er endret.
        </p>
      )}
      <button
        type="button"
        className={styles.basisvareKnapp}
        onClick={(e) => {
          e.stopPropagation();
          onMerk(navn);
        }}
      >
        {status === "feil" ? "Prøv igjen" : "Merk som basisvare"}
      </button>
      <span className={styles.basisvareHint}>
        Har vanligvis hjemme: avhukes automatisk neste gang den dukker opp i en generert
        handleliste. Varen blir stående på listen nå.
      </span>
    </div>
  );
}
