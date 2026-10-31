import { forsoningSkrivingAktiv } from "@hooks/forsoningAktivering";
import { useMellomvaerende } from "@hooks/useMellomvaerende";
import { MellomvaerendeView } from "./MellomvaerendeView";
import styles from "./Mellomvaerende.module.css";

const nyId = () => `mv${Date.now().toString(36)}${crypto.randomUUID().slice(0, 6)}`;

/** `/forvaltning/mellomvaerende` (#95). */
export function MellomvaerendeScreen() {
  const mv = useMellomvaerende();
  if (mv.status !== "loaded") return <div className={styles.laster}>Laster…</div>;
  return (
    <MellomvaerendeView
      {...mv.data}
      handlinger={mv.handlinger}
      skrivingAktiv={forsoningSkrivingAktiv()}
      nyId={nyId}
    />
  );
}
