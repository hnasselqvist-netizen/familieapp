/**
 * Firebase Admin-adapter for `handleliste-overgang` (`handlelisteOvergang.ts`).
 * Deles av CLI-en og emulatortesten. Ren I/O — ingen beslutninger her.
 */
import type { Database } from "firebase-admin/database";
import type { OvergangDb } from "./handlelisteOvergang";

export function overgangDb(db: Database): OvergangDb {
  return {
    read: async (path) => (await db.ref(path).get()).val() as unknown,
    transact: async (path, update) => {
      await db.ref(path).transaction((current: unknown) => update(current), undefined, false);
    },
  };
}
