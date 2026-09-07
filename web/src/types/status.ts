/**
 * Den delte lastetilstand-kontrakten fra dagens app (not_loaded/loading/
 * loaded — §designbok.md), nå som én typet form i stedet for at hvert
 * domene i App() fant opp sin egen variant. "not_loaded" skal ALDRI
 * tolkes som "ingen data finnes" — kun at det første Firebase-snapshotet
 * ikke har ankommet ennå.
 */
export type LoadStatus = "not_loaded" | "loading" | "loaded" | "error";

export type Loadable<T> =
  | { status: "not_loaded"; data: undefined; error: undefined }
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "loaded"; data: T; error: undefined }
  | { status: "error"; data: undefined; error: Error };

export const notLoaded: Loadable<never> = {
  status: "not_loaded",
  data: undefined,
  error: undefined,
};

export const loading: Loadable<never> = {
  status: "loading",
  data: undefined,
  error: undefined,
};

export function loaded<T>(data: T): Loadable<T> {
  return { status: "loaded", data, error: undefined };
}

export function loadError(error: Error): Loadable<never> {
  return { status: "error", data: undefined, error };
}
