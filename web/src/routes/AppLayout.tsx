import { Outlet } from "react-router-dom";
import { BottomNav } from "@components/BottomNav";
import styles from "./AppLayout.module.css";

const isPreview = import.meta.env.VITE_DEPLOY_TARGET === "preview";

/**
 * Rute-skallet for hele Hverdagsflyt (§Kontrolltårn-handoff, Issue #20,
 * "hovedløft: Hverdagsflyt-skall + Gangen + Kjøkken som faktisk rom").
 * Erstatter den forrige, generiske toppheaderen (`🏡 Hverdagsflyt` +
 * tekstlenker) med produksjonens faste `BottomNav`-mønster — samme fem
 * faner/ikoner/aktivfarge, se `BottomNav.tsx` for paritetsdetaljer.
 *
 * PREVIEW-banneret er bevisst UAVHENGIG av selve navigasjonen (§oppdrag,
 * punkt 7) — det er en miljømarkør på toppen, ikke en del av
 * produktnavigasjonen BottomNav representerer.
 */
export function AppLayout() {
  return (
    <div className={styles.root}>
      {isPreview && (
        <div className={styles.previewBanner} role="status">
          PREVIEW — ekte produksjonsdata, ikke en sandkasse
        </div>
      )}
      <main className={styles.main}>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
