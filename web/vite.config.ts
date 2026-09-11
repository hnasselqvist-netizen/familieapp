/// <reference types="vitest/config" />
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = import.meta.dirname;

// https://vite.dev/config/
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
  server: {
    fs: {
      // `src/components/icons.ts` importerer SVG-ikoner direkte fra
      // repo-rotens `assets/icons/` (ÉN kilde til sannhet, delt med
      // dagens `index.html` — ingen kopi i `web/`). Uten denne utvidelsen
      // nekter dev-serveren å levere filer utenfor `web/` selv (Vites
      // standard fs.allow stopper ved prosjektroten siden det ikke finnes
      // noen repo-rot `package.json`/lockfile å utlede et videre
      // arbeidsområde fra).
      allow: [root, path.resolve(root, "..")],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    // Playwright-spec-filer (e2e/) eies av egen test-runner, ikke Vitest.
    // *.integration.test.ts krever Firebase Emulator og kjøres separat via
    // `npm run test:integration` (se vitest.integration.config.ts) — aldri
    // som del av den vanlige, raske `npm test`.
    exclude: ["**/node_modules/**", "**/e2e/**", "**/*.integration.test.ts"],
  },
});
