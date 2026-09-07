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
