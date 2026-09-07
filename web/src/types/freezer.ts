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
