import { Link } from "react-router-dom";
import { Card } from "@components/Card";
import { LegacyBridge } from "@features/LegacyBridge";
import styles from "./gaver/Gaver.module.css";

/**
 * `/hjem-familie`: rommet er fortsatt parkert. Bare gavedelen (S1) er
 * åpnet; resten peker som før til dagens app.
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
      <LegacyBridge label="Resten av Hjem & familie" />
    </div>
  );
}
