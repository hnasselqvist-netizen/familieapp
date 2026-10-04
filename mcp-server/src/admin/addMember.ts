/**
 * Operatør-CLI: opprett ETT familiemedlemskap. Tørrkjøring som standard.
 *
 *   npm run build:admin
 *   node dist/add-member.js --email <e-post> --family familie1 [--expect-uid <uid>] [--apply]
 *   node dist/add-member.js --uid <uid>      --family familie1 [--apply]
 *
 * Svaret viser Firebase-brukerens identitet (e-post, navn, leverandører,
 * opprettet og sist innlogget), så operatøren kan bekrefte at det er riktig
 * person før `--apply`. Se `memberAdd.ts` for alle sikkerhetsegenskapene.
 *
 * Produksjonsvern, samme nivå som `link-principal` + Auth:
 *  - uten emulator kreves MCP_ALLOW_PRODUCTION_DATA=true, også for tørrkjøring;
 *  - database og Auth må peke samme vei: enten begge emulatorer
 *    (FIREBASE_DATABASE_EMULATOR_HOST + FIREBASE_AUTH_EMULATOR_HOST) eller
 *    ingen. En blanding (f.eks. ekte Auth mot emulert database) nektes;
 *  - mot ekte prosjekt må prosjekt-ID (GOOGLE_CLOUD_PROJECT) stemme med
 *    databasens URL, så Auth-oppslaget aldri går mot et annet prosjekt;
 *  - ingenting skrives uten --apply.
 *
 * Admin SDK-et bruker ADC. Operatøren trenger lesetilgang til Firebase Auth
 * (e-postoppslag) og skrivetilgang til RTDB (kun for --apply).
 */
import { parseArgs } from "node:util";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { resolveProjectId, runAddMember } from "./memberAdd";
import { authDirectory, memberDb } from "./memberAdapters";

const { values } = parseArgs({
  options: {
    family: { type: "string" },
    email: { type: "string" },
    uid: { type: "string" },
    "expect-uid": { type: "string" },
    apply: { type: "boolean", default: false },
  },
  strict: true,
});

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

if (!values.family) die("Påkrevd: --family og enten --email eller --uid.");
const databaseURL = process.env.FIREBASE_DATABASE_URL;
if (!databaseURL) die("Mangler FIREBASE_DATABASE_URL.");

const dbEmulator = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST);
const authEmulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
if (dbEmulator !== authEmulator) {
  die(
    "Database og Auth må peke samme vei: sett enten BÅDE FIREBASE_DATABASE_EMULATOR_HOST og " +
      "FIREBASE_AUTH_EMULATOR_HOST (emulator), eller ingen av dem (produksjon).",
  );
}
const usesEmulator = dbEmulator;
if (!usesEmulator && process.env.MCP_ALLOW_PRODUCTION_DATA !== "true") {
  die(
    "Nekter å koble til ekte Realtime Database og Firebase Auth: sett " +
      "FIREBASE_DATABASE_EMULATOR_HOST og FIREBASE_AUTH_EMULATOR_HOST, " +
      "eller MCP_ALLOW_PRODUCTION_DATA=true etter eksplisitt beslutning.",
  );
}

let projectId: string;
if (usesEmulator) {
  projectId = "demo-familieapp";
} else {
  const resolved = resolveProjectId(
    databaseURL,
    process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT,
  );
  if ("error" in resolved) die(resolved.error);
  projectId = resolved.projectId;
}

const app = initializeApp({ databaseURL, projectId });
try {
  const result = await runAddMember(
    memberDb(getDatabase(app)),
    authDirectory(getAuth(app)),
    {
      familyId: values.family,
      uid: values.uid,
      email: values.email,
      expectUid: values["expect-uid"],
    },
    values.apply,
  );
  console.log(
    JSON.stringify(
      {
        target: usesEmulator ? "emulator" : "PRODUKSJON",
        project: projectId,
        dryRun: !values.apply,
        ...result,
      },
      null,
      2,
    ),
  );
  if (result.action === "refuse") process.exitCode = 1;
  else if (!values.apply && result.action === "create") {
    console.log(
      "Tørrkjøring — ingenting skrevet. Bekreft at brukeren over er riktig, og kjør på nytt " +
        "med --apply for å skrive medlemskapet.",
    );
  }
} catch (err) {
  console.error(`Feilet: ${err instanceof Error ? err.message : String(err)}`);
  console.error(
    "Er operatøren innlogget med tilgang til Firebase Auth (lesing) og Realtime Database?",
  );
  process.exitCode = 3;
} finally {
  await deleteApp(app);
}
