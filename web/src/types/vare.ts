/**
 * Den delte varebasen (`families/{familyId}/items`) — master-identitet
 * for varer på tvers av Kokebok, Handleliste og Fryser (§designbok.md,
 * "v-mat-varebase-1.1"). Kun feltene Fryser faktisk bruker er tatt med
 * her ennå; utvides når neste modul (som leser flere felt) migreres.
 */
export interface Vare {
  id: string;
  name: string;
  cat: string;
}

/**
 * Varebasens rene navnematch-regler slik datalaget tar dem inn
 * (§domain/shopping/handlelisteRules.ts er eneste implementasjon) — samme
 * injeksjonsbegrunnelse som `ShoppingMergeRules`.
 */
export interface ItemMatchRules {
  findItemByName: (items: readonly Vare[], name: string) => Vare | undefined;
  /** `null` når navnet er tomt etter trimming. */
  newItemFields: (name: string, cat: string) => Omit<Vare, "id"> | null;
}
