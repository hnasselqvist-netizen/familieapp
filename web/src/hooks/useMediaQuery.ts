import { useSyncExternalStore } from "react";

/**
 * Om en CSS media query treffer nå, og oppdatert når den endrer seg (f.eks.
 * når vinduet endrer bredde eller brukeren zoomer). Uten `matchMedia`
 * (eldre testmiljø) er svaret `false` — smal flate, som er standarden.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (varsle) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
      }
      const mql = window.matchMedia(query);
      mql.addEventListener("change", varsle);
      return () => mql.removeEventListener("change", varsle);
    },
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(query).matches
        : false,
    () => false,
  );
}

/**
 * Bred arbeidsflate (#59, PC-1): i `rem`, så grensen følger nettleserens
 * skriftstørrelse — ved høy zoom vises den smale flaten, som er riktig for
 * plassen som faktisk finnes.
 */
export const BRED_FLATE = "(min-width: 64rem)";
