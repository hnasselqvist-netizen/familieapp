// Kjøres som en egen node-prosess (ikke lastet via Playwright sin egen
// TS-transform) — firebase-admin sin avhengighetsgraf (jwks-rsa/jose)
// laster ikke pålitelig gjennom Playwright sin interne modul-loader i
// dette miljøet ("module not been linked"), men fungerer feilfritt under
// vanlig node eller Vitest (verifisert separat). Ren .mjs unngår problemet
// helt i stedet for å jage det.
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { E2E_USER, FAMILY_ID, PROJECT_ID, DATABASE_URL } from "./seed-config.mjs";

const app = initializeApp({ projectId: PROJECT_ID, databaseURL: DATABASE_URL }, "e2e-seed");
const auth = getAuth(app);

const existing = await auth.getUserByEmail(E2E_USER.email).catch(() => null);
const uid = existing?.uid ?? (await auth.createUser({ ...E2E_USER })).uid;

await getDatabase(app).ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
await deleteApp(app);
