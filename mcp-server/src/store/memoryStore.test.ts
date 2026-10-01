import { MemoryStore } from "./memoryStore";
import { runStoreContract } from "./storeContract";

let counter = 0;

runStoreContract("MemoryStore", () => {
  const store = new MemoryStore();
  return {
    store,
    newFamilyId: () => `fam-${++counter}`,
    seed: {
      member: async (f, uid) => void store.family(f).members.add(uid),
      principal: async (sub, link) => void store.principals.set(sub, link),
      // Faken lagrer kun appens fem felt — samme som det Admin-adapteren leser tilbake.
      shoppingRaw: async (f, id, raw) => {
        if (typeof raw.name !== "string") return;
        store.family(f).shopping.set(id, {
          itemId: (raw.itemId as string | undefined) ?? null,
          name: raw.name,
          amount: (raw.amount as string | undefined) ?? "",
          cat: (raw.cat as string | undefined) ?? "Diverse",
          done: (raw.done as boolean | undefined) ?? false,
        });
      },
      item: async (f, id, fields) => void store.family(f).items.set(id, fields),
    },
  };
});
