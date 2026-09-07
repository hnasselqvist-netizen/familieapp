/**
 * Datamodellen er UENDRET fra dagens `families/familie1/freezer`
 * (§index.html FreezerScreen, linje ~5062–5238) — dette er en
 * karakteriseringstype, ikke et nytt skjema.
 */
export interface FreezerBatch {
  id: string;
  count: number;
  unit: string;
  gramsPerUnit: number | null;
}

export interface FreezerItem {
  id: string;
  /** Peker til den delte varebasen (families/familie1/items). */
  itemId: string;
  name: string;
  batches: FreezerBatch[];
}

/**
 * Formen data faktisk lagres i på én fryserpost-node — id-en er stien,
 * ikke et felt. Delt mellom domain (rene transformasjoner) og data
 * (Firebase-transaksjoner) — se docs/arkitektur/oversikt.md for hvorfor
 * typer, men ikke logikk, kan krysse det skillet.
 */
export type FreezerItemFields = Omit<FreezerItem, "id">;
