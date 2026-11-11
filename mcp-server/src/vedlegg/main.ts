/**
 * Kjøretidsinngang for den separate vedleggstjenesten (#59, B1, S2(b)).
 * Egen bundle (`npm run build:vedlegg`) og eget image
 * (`mcp-server/Dockerfile.vedlegg`), egen Cloud Run-tjeneste og egen
 * runtime-SA ved aktivering. IKKE deployet — se docs/drift/kvitteringsvedlegg.md.
 *
 * Lokalt mot emulatoren (minnelager):
 *   FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *   FIREBASE_DATABASE_URL="http://127.0.0.1:9000/?ns=demo-familieapp-default-rtdb" \
 *   npm run build:vedlegg && node dist/vedlegg.js
 */
import { createServer } from "node:http";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getStorage } from "firebase-admin/storage";
import { lastVedleggConfig } from "./config";
import { GcsObjektlager, firebaseToken, rtdbMedlemskap } from "./firebaseAdaptere";
import { lagVedleggHandler } from "./http";
import { MinneObjektlager } from "./minneObjektlager";

const config = lastVedleggConfig();
const app = initializeApp({
  databaseURL: config.databaseUrl,
  ...(config.usesEmulator ? { projectId: "demo-familieapp" } : {}),
});
const logg = {
  hendelse: (navn: string, felt: Record<string, unknown>) =>
    console.log(JSON.stringify({ hendelse: navn, tid: new Date().toISOString(), ...felt })),
};
const handler = lagVedleggHandler(
  {
    token: firebaseToken(getAuth(app)),
    medlemskap: rtdbMedlemskap(getDatabase(app)),
    lager:
      config.lager === "gcs"
        ? new GcsObjektlager(getStorage(app).bucket(config.bucket!))
        : new MinneObjektlager(),
    maksBytes: config.maksBytes,
  },
  logg,
);

createServer((req, res) => void handler(req, res)).listen(config.port, () =>
  logg.hendelse("vedlegg_server_startet", {
    port: config.port,
    emulator: config.usesEmulator,
    lager: config.lager,
    maksBytes: config.maksBytes,
  }),
);
