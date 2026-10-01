import { defineConfig } from "vitest/config";
import { sharedAliases } from "./vitest.config.ts";

// Kjøres KUN via `npm run test:integration`, som starter RTDB-emulatoren
// (demo-familieapp) rundt kommandoen — aldri mot produksjon eller en
// Hosting-forhåndsvisning (§CLAUDE.md, "Sikkerhet: preview vs. produksjonsdata").
export default defineConfig({
  resolve: { alias: sharedAliases },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 15_000,
    fileParallelism: false,
  },
});
