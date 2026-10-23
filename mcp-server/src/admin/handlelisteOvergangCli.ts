/**
 * Operatør-CLI for handlelistens overgang (ADR 0003, FORSLAG). Tørrkjøring
 * som standard; ingen produksjonskjøring er besluttet.
 *
 *   npm run build:admin
 *   node dist/handleliste-overgang.js kontroll --family familie1
 *   node dist/handleliste-overgang.js markor --family familie1 [--forventet-digest <hex>] [--apply]
 *   node dist/handleliste-overgang.js markor --family familie1 --fjern [--forventet-digest <hex>] [--apply]
 *
 * `kontroll` leser bare. `markor` setter (eller med `--fjern` fjerner)
 * `families/{f}/shopping/_skriver` — se `handlelisteOvergang.ts` for
 * sikkerhetsegenskapene. Exit-kode 1 betyr avslag eller avvik: stopp og
 * undersøk, gjenopprett aldri automatisk.
 *
 * Produksjonsvern som `add-member`: uten emulator kreves
 * MCP_ALLOW_PRODUCTION_DATA=true, også for tørrkjøring og kontroll.
 */
import { parseArgs } from "node:util";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { kjorKontroll, kjorMarkor } from "./handlelisteOvergang";
import { overgangDb } from "./handlelisteOvergangAdapter";
import { resolveProjectId } from "./memberAdd";

const { values, positionals } = parseArgs({
  options: {
    family: { type: "string" },
    fjern: { type: "boolean", default: false },
    "forventet-digest": { type: "string" },
    apply: { type: "boolean", default: false },
  },
  allowPositionals: true,
  strict: true,
});

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

const kommando = positionals[0];
if ((kommando !== "kontroll" && kommando !== "markor") || positionals.length !== 1) {
  die(
    "Bruk: handleliste-overgang.js <kontroll|markor> --family <id> [--fjern] [--forventet-digest <hex>] [--apply]",
  );
}
if (!values.family) die("Påkrevd: --family.");
if (kommando === "kontroll" && (values.apply || values.fjern || values["forventet-digest"])) {
  die("`kontroll` leser bare og tar bare --family.");
}
const databaseURL = process.env.FIREBASE_DATABASE_URL;
if (!databaseURL) die("Mangler FIREBASE_DATABASE_URL.");

const usesEmulator = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST);
if (!usesEmulator && process.env.MCP_ALLOW_PRODUCTION_DATA !== "true") {
  die(
    "Nekter å koble til ekte Realtime Database: sett FIREBASE_DATABASE_EMULATOR_HOST, " +
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
const target = { target: usesEmulator ? "emulator" : "PRODUKSJON", project: projectId };
try {
  const db = overgangDb(getDatabase(app));
  if (kommando === "kontroll") {
    console.log(JSON.stringify({ ...target, ...(await kjorKontroll(db, values.family)) }, null, 2));
  } else {
    const result = await kjorMarkor(db, {
      familyId: values.family,
      modus: values.fjern ? "fjern" : "sett",
      apply: values.apply,
      forventetDigest: values["forventet-digest"],
    });
    console.log(JSON.stringify({ ...target, ...result }, null, 2));
    if (result.utfall === "nekt" || result.avvik.length > 0) process.exitCode = 1;
    else if (!values.apply && result.utfall === "skriv") {
      console.log("Tørrkjøring — ingenting skrevet. Kjør på nytt med --apply for å skrive.");
    }
  }
} catch (err) {
  console.error(`Feilet: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 3;
} finally {
  await deleteApp(app);
}
