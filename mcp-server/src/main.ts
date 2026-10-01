/**
 * Kjøretidsinngang. IKKE deployet — deploy (Cloud Run) og IdP-oppsett er
 * egne, senere beslutninger (se mcp-server/README.md §"Senere steg").
 *
 * Lokalt mot emulatoren:
 *   FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 \
 *   FIREBASE_DATABASE_URL="http://127.0.0.1:9000/?ns=demo-familieapp-default-rtdb" \
 *   MCP_RESOURCE_URL=http://localhost:8080/mcp MCP_AUTH_ISSUER=https://idp.example/ \
 *   npm run build && node dist/main.js
 */
import { createServer } from "node:http";
import { initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { createRemoteJWKSet } from "jose";
import { createApp } from "./app";
import { jsonLineAudit } from "./audit/log";
import { loadConfig } from "./config";
import { FirebaseAdminStore } from "./store/firebaseAdminStore";

const config = loadConfig();
const audit = jsonLineAudit();

// Ingen `credential`: Admin SDK-et bruker Application Default Credentials
// (plattformens tjenesteidentitet). Mot emulatoren trengs ingen.
const firebase = initializeApp({
  databaseURL: config.databaseUrl,
  ...(config.usesEmulator ? { projectId: "demo-familieapp" } : {}),
});

const handler = createApp({
  store: new FirebaseAdminStore(getDatabase(firebase)),
  resource: { resourceUrl: config.resourceUrl, issuer: config.issuer },
  audience: config.audience,
  getKey: createRemoteJWKSet(config.jwksUrl),
  audit,
});

createServer((req, res) => void handler(req, res)).listen(config.port, () => {
  audit.event("server_started", {
    port: config.port,
    resource: config.resourceUrl.href,
    emulator: config.usesEmulator,
  });
});
