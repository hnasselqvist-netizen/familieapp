import { describe, expect, it } from "vitest";
import { SKRIVEMETODER, SkrivingAvvist, skrivebeskyttet } from "./skrivebeskyttet";

/** En liten etterligning av RTDB-ens Database/Reference/Query-form. */
function falskDb() {
  const skrevet: string[] = [];
  const ref = (path: string): Record<string, unknown> => {
    const r: Record<string, unknown> = {
      key: path.split("/").pop(),
      get: async () => ({ val: () => `verdi:${path}` }),
      child: (p: string) => ref(`${path}/${p}`),
      orderByKey: () => ({ ...r, ref: r, limitToFirst: () => r }),
    };
    for (const m of SKRIVEMETODER) r[m] = () => skrevet.push(`${m}:${path}`);
    Object.defineProperty(r, "root", { get: () => ref("") });
    Object.defineProperty(r, "parent", { get: () => ref(path.split("/").slice(0, -1).join("/")) });
    return r;
  };
  return { db: { ref, goOffline: () => {} }, skrevet };
}

describe("skrivebeskyttet", () => {
  it("lesing går gjennom; alle skrivemetoder avvises — også via child/root/parent/spørring", async () => {
    const { db, skrevet } = falskDb();
    const vakt = skrivebeskyttet(db) as unknown as {
      ref(p: string): Record<string, (...a: unknown[]) => unknown> & {
        root: Record<string, (...a: unknown[]) => unknown>;
        parent: Record<string, (...a: unknown[]) => unknown>;
      };
    };
    const ref = vakt.ref("families/f/a");
    expect(((await ref.get!()) as { val(): unknown }).val()).toBe("verdi:families/f/a");

    const veier = [
      ref,
      ref.child!("b") as typeof ref,
      ref.root,
      ref.parent,
      (ref.orderByKey!() as Record<string, unknown>).ref as typeof ref,
      (ref.orderByKey!() as Record<string, (...a: unknown[]) => unknown>).limitToFirst!(
        1,
      ) as typeof ref,
    ];
    for (const r of veier) {
      for (const m of SKRIVEMETODER) {
        expect(() => r[m]!({ x: 1 })).toThrow(SkrivingAvvist);
      }
    }
    expect(skrevet).toEqual([]);
  });

  it("egenskaper kan ikke settes på den pakkede verdien", () => {
    const { db } = falskDb();
    const vakt = skrivebeskyttet(db) as unknown as Record<string, unknown>;
    expect(() => {
      vakt.ref = () => null;
    }).toThrow(SkrivingAvvist);
  });
});
