/**
 * Operatør-CLI for principal-koblinger. Tørrkjøring som standard.
 *
 *   npm run build:admin
 *   node dist/link-principal.js --sub 'google-oauth2|123' --uid <firebaseUid> --family <familyId>
 *        [--disable] [--replace] [--apply]
 *
 * Samme sperre som serveren (src/config.ts): uten
 * FIREBASE_DATABASE_EMULATOR_HOST kreves MCP_ALLOW_PRODUCTION_DATA=true,
 * og ingenting skrives uten --apply. Admin SDK-et bruker ADC.
 */
import { parseArgs } from "node:util";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { runPrincipalLink } from "./principalLink";

const { values } = parseArgs({
  options: {
    sub: { type: "string" },
    uid: { type: "string" },
    family: { type: "string" },
    disable: { type: "boolean", default: false },
    replace: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
  },
  strict: true,
});

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

if (!values.sub || !values.uid || !values.family) die("Påkrevd: --sub, --uid og --family.");
const databaseURL = process.env.FIREBASE_DATABASE_URL;
if (!databaseURL) die("Mangler FIREBASE_DATABASE_URL.");
const usesEmulator = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST);
if (!usesEmulator && process.env.MCP_ALLOW_PRODUCTION_DATA !== "true") {
  die(
    "Nekter å koble til ekte Realtime Database: sett FIREBASE_DATABASE_EMULATOR_HOST, " +
      "eller MCP_ALLOW_PRODUCTION_DATA=true etter eksplisitt beslutning.",
  );
}

const app = initializeApp({
  databaseURL,
  ...(usesEmulator ? { projectId: "demo-familieapp" } : {}),
});
const db = getDatabase(app);
try {
  const result = await runPrincipalLink(
    {
      get: async (path) => (await db.ref(path).get()).val() as unknown,
      set: (path, value) => db.ref(path).set(value),
    },
    {
      idpSub: values.sub,
      firebaseUid: values.uid,
      familyId: values.family,
      disable: values.disable,
      replace: values.replace,
    },
    values.apply,
  );
  console.log(
    JSON.stringify(
      { target: usesEmulator ? "emulator" : "PRODUKSJON", dryRun: !values.apply, ...result },
      null,
      2,
    ),
  );
  if (result.action === "refuse") process.exitCode = 1;
  else if (!values.apply && result.action !== "unchanged") {
    console.log("Tørrkjøring — ingenting skrevet. Kjør på nytt med --apply for å skrive.");
  }
} finally {
  await deleteApp(app);
}
