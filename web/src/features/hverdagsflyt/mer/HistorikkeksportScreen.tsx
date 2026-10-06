import { byggHistorikkCsv } from "@domain/forsoning/historikkeksport";
import { useHistorikkeksport } from "@hooks/useHistorikkeksport";
import { HistorikkeksportView } from "./HistorikkeksportView";
import styles from "./MerScreen.module.css";

/** Laster ned en tekstfil i nettleseren. */
function lastNed(innhold: string, filnavn: string) {
  const blob = new Blob([innhold], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filnavn;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** `/verktoy/historikkeksport` — se `HistorikkeksportView`. */
export function HistorikkeksportScreen() {
  const data = useHistorikkeksport();
  if (data.status !== "loaded") return <div className={styles.laster}>Laster…</div>;
  return (
    <HistorikkeksportView
      sammendrag={data.data.sammendrag}
      onEksporter={() =>
        lastNed(
          byggHistorikkCsv(data.data.rader),
          `Hverdagsflyt_historikk_${new Date().toISOString().slice(0, 10)}.csv`,
        )
      }
    />
  );
}
