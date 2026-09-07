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
    // Funn under implementering av Middagsplan-skiven: alle
    // *.integration.test.ts-filer deler ÉN emulator-instans OG én
    // klient-side Firebase-app-singleton (src/data/firebase.ts sin
    // getFirebaseAuth()/getFirebaseDatabase()) — hver fils beforeAll
    // logger et NYTT medlem inn på DENNE delte singletonen, og hver fils
    // afterAll fjerner HELE families/familie1-treet. Med filer kjørt i
    // parallell (Vitest sin standard) kan én fils afterAll rekke å slette
    // treet — inkludert en annen fils nettopp innloggede medlem — mens
    // den andre filen fortsatt kjører, noe som ga sporadiske
    // permission_denied-feil så snart en tredje fil (denne) kom i tillegg
    // til de to fra Fase 0/Kokebok. Filene er uansett billige å kjøre
    // (sekunder), så sekvensiell kjøring er et trygt, presist treffende
    // fiks — ikke en generell ytelses-avveining.
    fileParallelism: false,
  },
});
