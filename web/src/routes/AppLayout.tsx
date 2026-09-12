import { Outlet, useLocation } from "react-router-dom";
import { BottomNav } from "@components/BottomNav";
import styles from "./AppLayout.module.css";

const isPreview = import.meta.env.VITE_DEPLOY_TARGET === "preview";

/** Hverdagsflyt-rom (Gangen + Kjøkken) — LegacyBridge/admin-rutene (Forvaltning/Familie/Mer) eier fortsatt sitt eget uttrykk, se §AppLayout.module.css sin `.room`-kommentar. */
function isHverdagsflytRoom(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/mat");
}

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
 *
 * **Kontinuerlig rombakgrunn** (§Kontrolltårn-review, PR #26, design-
 * review runde 2, §1): `.root` får `--g-bg` på Gangen (`/`) og hele
 * Kjøkken-treet (`/mat/*`) slik at rommet er én sammenhengende varm
 * flate fra toppen av arbeidsområdet til `BottomNav` — `.main` har
 * bevisst ingen egen bakgrunn, så `.root`s farge skinner gjennom både
 * dens padding og en eventuell letterboxing utenfor `max-width`. Løst
 * her (skallnivå) i stedet for i `MatLayout` alene fordi Gangen trenger
 * nøyaktig samme fiks og ikke går via `MatLayout`. LegacyBridge/admin-
 * rutene (Forvaltning/Familie/Mer) er bevisst UTENFOR — de beholder sin
 * nøytrale kjernepalett-bakgrunn.
 */
export function AppLayout() {
  const { pathname } = useLocation();
  const isRoom = isHverdagsflytRoom(pathname);

  return (
    <div className={isRoom ? `${styles.root} ${styles.room}` : styles.root}>
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
