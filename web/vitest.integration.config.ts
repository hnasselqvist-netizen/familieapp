/// <reference types="vitest/config" />
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = import.meta.dirname;

// Egen, frittstående konfigurasjon for datalag-/integrasjonstester som
// faktisk snakker med Firebase Emulator Suite (RTDB + Auth) — aldri med
// produksjon eller preview. Kjøres via `npm run test:integration`, som
// starter emulatoren rundt denne kommandoen. Bevisst IKKE en `mergeConfig`
// av vite.config.ts — Vitest/Vite slår sammen array-felt (som `exclude`)
// additivt, noe som ville filtrert bort nettopp *.integration.test.ts
// igjen via basiskonfigurasjonens eksklusjon av samme mønster.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@domain": path.resolve(root, "src/domain"),
      "@generators": path.resolve(root, "src/generators"),
      "@data": path.resolve(root, "src/data"),
      "@hooks": path.resolve(root, "src/hooks"),
      "@features": path.resolve(root, "src/features"),
      "@components": path.resolve(root, "src/components"),
      "@styles": path.resolve(root, "src/styles"),
      "@app-types": path.resolve(root, "src/types"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 15_000,
  },
});
