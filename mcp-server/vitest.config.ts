import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export const sharedAliases = {
  "@domain": path.resolve(root, "../web/src/domain"),
  "@app-types": path.resolve(root, "../web/src/types"),
  // Kun for paritetstester mot appens rene referanse (§plan.parity.test.ts).
  "@generators": path.resolve(root, "../web/src/generators"),
};

// Raske enhets-/kontrakttester mot in-memory-store og lokalt genererte
// nøkler — ingen nettverk, ingen emulator. *.integration.test.ts krever
// Firebase Emulator og kjøres separat (vitest.integration.config.ts).
export default defineConfig({
  resolve: { alias: sharedAliases },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
  },
});
