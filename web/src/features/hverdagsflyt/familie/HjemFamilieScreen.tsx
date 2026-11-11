import { Link } from "react-router-dom";
import { Card } from "@components/Card";
import styles from "./gaver/Gaver.module.css";

/**
 * `/hjem-familie`: inngangen til Gaver og juleplanlegging (S1). Resten av
 * rommet er fortsatt parkert; lenken til dagens app er fjernet etter
 * brukerfunn (#128 punkt 1, #20).
 */
export function HjemFamilieScreen() {
  return (
    <div className={styles.side}>
      <Card>
        <Link to="/hjem-familie/gaver" className={styles.lenkekort}>
          <strong className={styles.kortTittel}>Gaver og juleplanlegging →</strong>
          <span className={styles.dempet}>Personer, ideer, budsjett og status for årets jul.</span>
        </Link>
      </Card>
    </div>
  );
}
