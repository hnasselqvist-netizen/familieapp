import styles from "./RoomDate.module.css";

/**
 * Delt Hverdagsflyt-dato — trukket ut av Gangens eksisterende
 * implementasjon (§Kontrolltårn-review, PR #26, design-review runde 3,
 * §4: "Datoen fra Gangen blir et delt Hverdagsflyt-element"). Samme
 * format og uttrykk overalt: `Instrument Sans`, kursiv, 14px, f.eks.
 * "Lørdag 12. september" — dagens dato, alltid, ikke en prop, siden
 * ingen kallested trenger en annen dato enn den faktiske.
 */
export function RoomDate() {
  const datoStr = new Date().toLocaleDateString("nb-NO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const datoStrKapitalisert = datoStr.charAt(0).toUpperCase() + datoStr.slice(1);

  return <div className={styles.date}>{datoStrKapitalisert}</div>;
}
