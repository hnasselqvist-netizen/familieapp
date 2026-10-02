import { useRegelsenter } from "@hooks/useRegelsenter";
import styles from "./RegelsenterScreen.module.css";
import { RegelsenterView } from "./RegelsenterView";

/**
 * Regelsenter (§Issue #34 R1) — kobler `useRegelsenter` til
 * `RegelsenterView`. Skriving er stengt til R3b-cutover
 * (`hooks/regelsenterAktivering.ts`); skjermen er derfor ren visning.
 *
 * **Ikke koblet til hovednavigasjonen** — kun nåbar på
 * `/forvaltning/regelsenter`, som de andre delvis migrerte
 * Forvaltning-skjermene. Legacy-RegelSenter i `index.html` er urørt.
 */
export function RegelsenterScreen() {
  const rs = useRegelsenter();
  if (rs.regler.status !== "loaded") {
    return <div className={styles.laster}>Laster…</div>;
  }
  return (
    <RegelsenterView
      regler={rs.regler.data}
      grupper={rs.grupper}
      transaksjoner={rs.transaksjoner}
      skrivingAktiv={rs.skrivingAktiv}
      onOppdater={(id, felt) => void rs.oppdater(id, felt)}
      onSlett={(id) => void rs.slett(id)}
      onSlaSammen={(a, b) => void rs.slaSammen(a, b)}
    />
  );
}
