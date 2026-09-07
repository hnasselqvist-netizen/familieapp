// Delt mellom seed.mjs (ren node, seeder emulatoren) og freezer.spec.ts
// (Playwright, logger inn med samme bruker). Kun emulator-konstanter —
// ingen hemmeligheter.
export const E2E_USER = { email: "e2e@hverdagsflyt.test", password: "test-passord-123" };
export const FAMILY_ID = "familie1";
export const PROJECT_ID = "demo-familieapp";
export const DATABASE_URL = "http://127.0.0.1:9000/?ns=demo-familieapp";
