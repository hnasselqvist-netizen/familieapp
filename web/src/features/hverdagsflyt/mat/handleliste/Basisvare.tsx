import { Icon } from "@components/Icon";
import { BASISVARE_UGYLDIG_TEKST, basisvareNokkel, erBasisvare } from "@domain/shopping/basisvare";
import type { Staples } from "@app-types/shopping";
import type { Loadable } from "@app-types/status";
import styles from "./HandlelisteScreen.module.css";

/**
 * Lagring som venter eller ikke ble bekreftet, per basisvarenøkkel (ikke per
 * rad). Merkingen er versjonsbetinget (Mat #20, ordre 6953147250):
 * - `feil`: ingenting ble lagret (avvist, ikke lest, samtidig endring);
 * - `konflikt`: nøkkelen har en annen verdi, som står urørt. Utfallet vises
 *   selv om abonnementet ennå ikke har sett verdien (review 5944062897);
 * - `konfliktSett`: samme, og abonnementet har siden vist den blokkerende
 *   verdien — forsvinner den, er ordinær merking tilgjengelig igjen;
 * - `ukjent`: svaret på skrivingen uteble — ikke bekreftet.
 */
export type BasisvareLagring = Readonly<
  Record<
    string,
    "lagrer" | "feil" | "byttet" | "konflikt" | "konfliktSett" | "ukjent" | "ukjentByttet"
  >
>;

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
  sperret = false,
  onMerk,
}: {
  navn: string;
  staples: Loadable<Staples>;
  lagring: BasisvareLagring;
  /**
   * Panelet er åpnet for en annen vare enn raden som vises nå (Mat #20,
   * ordre 6936021912): knappen kan ikke brukes før den nye varen er åpnet.
   */
  sperret?: boolean;
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
  // Et ferskt konfliktutfall vises selv om abonnementet ligger etter REST
  // (review 5944062897). Først når abonnementet har vist den blokkerende
  // verdien (`konfliktSett`) og den så er borte, er ordinær merking
  // tilgjengelig igjen (review 5943412313); er den blitt `true`, vises
  // «Basisvare» over. Ingen automatisk skriving: et nytt forsøk er alltid et
  // eksplisitt klikk på den versjonsbetingede skriveveien.
  const blokkert =
    status === "konflikt" || (status === "konfliktSett" && staples.data[n.nokkel] !== undefined);
  const nyttForsok =
    status === "feil" ||
    status === "byttet" ||
    status === "ukjent" ||
    status === "ukjentByttet" ||
    blokkert;
  return (
    <div className={styles.basisvare}>
      {blokkert && (
        <p className={styles.basisvareFeil} role="alert">
          «{navn}» har allerede en annen verdi i basisvarene og er ikke endret.
        </p>
      )}
      {status === "feil" && (
        <p className={styles.basisvareFeil} role="alert">
          Kunne ikke lagre «{navn}» som basisvare. Ingenting er endret.
        </p>
      )}
      {status === "byttet" && (
        <p className={styles.basisvareFeil} role="alert">
          Innloggingen ble endret før «{navn}» ble lagret som basisvare. Ingenting ble sendt i dette
          forsøket.
        </p>
      )}
      {status === "ukjentByttet" && (
        <p className={styles.basisvareFeil} role="alert">
          Fortsatt ikke bekreftet om «{navn}» ble lagret som basisvare: innloggingen ble endret før
          kontrollen ble sendt. Ingenting ble sendt i dette forsøket. «Prøv igjen» sjekker og lagrer
          bare om den mangler.
        </p>
      )}
      {status === "ukjent" && (
        <p className={styles.basisvareFeil} role="alert">
          Fikk ikke bekreftet om «{navn}» ble lagret som basisvare. «Prøv igjen» sjekker og lagrer
          bare om den mangler.
        </p>
      )}
      <button
        type="button"
        className={styles.basisvareKnapp}
        disabled={sperret}
        onClick={(e) => {
          e.stopPropagation();
          if (!sperret) onMerk(navn);
        }}
      >
        {nyttForsok ? "Prøv igjen" : "Merk som basisvare"}
      </button>
      <span className={styles.basisvareHint}>
        Har vanligvis hjemme: avhukes automatisk neste gang den dukker opp i en generert
        handleliste. Varen blir stående på listen nå.
      </span>
    </div>
  );
}
