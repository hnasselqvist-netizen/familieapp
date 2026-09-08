import type { DayKey } from "@app-types/meal";

/** Speiler `DAY_S`/`DAY_FULL` (index.html linje ~375–376). Delt mellom PlanScreen og ShoppingGeneratorModal. */
export const DAY_SHORT: Record<DayKey, string> = {
  Mon: "Ma",
  Tue: "Ti",
  Wed: "On",
  Thu: "To",
  Fri: "Fr",
  Sat: "Lø",
  Sun: "Sø",
};

export const DAY_FULL: Record<DayKey, string> = {
  Mon: "Mandag",
  Tue: "Tirsdag",
  Wed: "Onsdag",
  Thu: "Torsdag",
  Fri: "Fredag",
  Sat: "Lørdag",
  Sun: "Søndag",
};
