/**
 * Skrivevakt for full lesing (`data_nokler` / `data_les`). Pakker en
 * RTDB-`Database` (eller `Reference`/`Query`) slik at enhver skrivemetode
 * avvises FØR noe sendes til databasen. Referanser og spørringer som hentes
 * ut av den pakkede verdien (`ref()`, `child()`, `root`, `parent`,
 * `orderByKey()`, `query.ref` …), pakkes på nytt, så vakten ikke kan
 * omgås ved å navigere.
 *
 * Dette er forsvar i dybden i koden. I produksjon er det kjøretidsidentiteten
 * (`roles/firebasedatabase.viewer`, ingen skriverett) som gjør skriving
 * umulig, uansett kode.
 *
 * Ingen import av firebase-admin: vakten er strukturell og virker på alt som
 * har RTDB-ens metode- og egenskapsnavn.
 */
export const SKRIVEMETODER = [
  "set",
  "update",
  "remove",
  "push",
  "transaction",
  "setWithPriority",
  "setPriority",
  "onDisconnect",
] as const;

const SKRIV = new Set<string>(SKRIVEMETODER);

export class SkrivingAvvist extends Error {
  readonly metode: string;

  constructor(metode: string) {
    super(`Skriving er ikke tillatt i full lesing (${metode}).`);
    this.metode = metode;
    this.name = "SkrivingAvvist";
  }
}

/** En `Reference`, `Query` eller `Database`: noe som kan gi nye referanser. */
const kanGiReferanser = (v: unknown): v is object =>
  typeof v === "object" &&
  v !== null &&
  (typeof (v as { orderByKey?: unknown }).orderByKey === "function" ||
    typeof (v as { ref?: unknown }).ref === "function");

export function skrivebeskyttet<T extends object>(mal: T): T {
  return new Proxy(mal, {
    get(target, prop) {
      if (typeof prop === "string" && SKRIV.has(prop)) {
        return () => {
          throw new SkrivingAvvist(prop);
        };
      }
      const v: unknown = Reflect.get(target, prop, target);
      if (typeof v === "function") {
        return (...args: unknown[]) => {
          const r: unknown = (v as (...a: unknown[]) => unknown).apply(target, args);
          return kanGiReferanser(r) ? skrivebeskyttet(r) : r;
        };
      }
      return kanGiReferanser(v) ? skrivebeskyttet(v) : v;
    },
    set() {
      throw new SkrivingAvvist("egenskap");
    },
  });
}
