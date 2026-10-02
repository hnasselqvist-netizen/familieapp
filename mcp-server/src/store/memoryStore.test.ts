import { MemoryStore } from "./memoryStore";
import { runStoreContract } from "./storeContract";

let counter = 0;

runStoreContract("MemoryStore", () => {
  const store = new MemoryStore();
  return {
    store,
    newFamilyId: () => `fam-${++counter}`,
    seed: {
      member: async (f, uid) => store.addMember(f, uid),
      principal: async (sub, link) => void store.principals.set(sub, link),
      raw: async (path, value) => store.set(path, value),
      read: async (path) => store.get(path),
    },
  };
});
