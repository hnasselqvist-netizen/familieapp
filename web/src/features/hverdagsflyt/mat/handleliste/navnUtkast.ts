import type { FeltPlan } from "@domain/shopping/handlelisteFelt";

/**
 * Navneutkast (Mat #20, ordre 6921967679): holdes lokalt til Helen lagrer,
 * bundet til varekoblingen og navnet hun så da hun begynte å redigere.
 */
export interface NavnUtkast {
  /** Varekoblingen da redigeringen begynte (identitet). */
  itemId: string | null;
  /** Navnet da redigeringen begynte (identitet og førverdi). */
  foer: string;
  verdi: string;
}

export const feltNokkel = (felt: FeltPlan["felt"], id: string) => `${felt}:${id}`;

/**
 * Utkastet hører ikke lenger til raden som vises: varekoblingen er byttet,
 * eller raden mangler varekobling og navnet er endret (kan være en annen
 * vare). Et slikt utkast vises aldri i, eller lagres fra, denne radens felt.
 */
export const erFremmedNavneutkast = (u: NavnUtkast, navn: string, itemId: string | null) =>
  u.itemId !== itemId || (u.itemId === null && u.foer !== navn);
