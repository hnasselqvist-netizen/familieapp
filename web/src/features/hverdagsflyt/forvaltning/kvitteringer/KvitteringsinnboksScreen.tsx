import { useSearchParams } from "react-router-dom";
import { FRA_PARAM } from "@components/fraLenke";
import { Retur } from "@components/Retur";
import { erKvitteringKlarForKobling } from "@domain/gangen/gangen";
import { useKvitteringsinnboks } from "@hooks/useKvitteringsinnboks";
import type { Kvittering } from "@app-types/gangen";
import styles from "./KvitteringsinnboksScreen.module.css";
import { KvitteringsinnboksView } from "./KvitteringsinnboksView";

/**
 * Kvitteringsinnboks (§Issue #34 R2, skrivende handlinger R3b-3 bak
 * forsoningsporten). Ikke koblet til hovednavigasjonen; nåbar på
 * `/forvaltning/kvitteringer`. Til R3b-cutover er porten av og legacy-
 * innboksen i `index.html` eneste skriver.
 */
export function KvitteringsinnboksScreen() {
  const inn = useKvitteringsinnboks();
  const [params] = useSearchParams();
  if (inn.kvitteringer.status !== "loaded") {
    return <div className={styles.laster}>Laster…</div>;
  }
  // Gangen sender hit for kvitteringer klare for kobling (samme regel som
  // Gangens telling), så «ferdig» er når ingen av dem gjenstår. Verdiene
  // sendes uendret videre, slik at regelen ser nøyaktig det Gangen ser.
  const klare = inn.kvitteringer.data.filter((r) =>
    erKvitteringKlarForKobling({
      id: r.id,
      forkastet: r.forkastet,
      matchingStatus: r.matchingStatus as Kvittering["matchingStatus"],
      suggestedTransactionId: r.suggestedTransactionId as string | null,
    }),
  );
  // Fra Lønnsdagsrunden er steget hele innboksen; fra Gangen bare de som er
  // klare for kobling (Gangens egen telling).
  const fraRunde = params.get(FRA_PARAM) === "runde";
  const ferdig = fraRunde ? inn.aktive.length === 0 : klare.length === 0;
  return (
    <>
      <Retur
        ferdig={ferdig}
        ferdigTekst={fraRunde ? "Kvitteringsinnboksen er tom." : "Kvitteringene er koblet."}
      />
      <KvitteringsinnboksView
        alle={inn.kvitteringer.data}
        aktive={inn.aktive}
        transaksjoner={inn.transaksjoner}
        hendelser={inn.hendelser}
        poster={inn.poster}
        skrivingAktiv={inn.skrivingAktiv}
        onUtfor={inn.utfor}
      />
    </>
  );
}
