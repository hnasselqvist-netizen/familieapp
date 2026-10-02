/**
 * Kjøretidsinngang (container: mcp-server/Dockerfile). IKKE deployet —
 * deploy (Cloud Run) og IdP-oppsett er egne beslutninger, se
 * mcp-server/README.md §"Runbook".
 *
 * Lokalt mot emulatoren:
 *   FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 \
 *   FIREBASE_DATABASE_URL="http://127.0.0.1:9000/?ns=demo-familieapp-default-rtdb" \
 *   MCP_RESOURCE_URL=http://localhost:8080/mcp MCP_AUTH_ISSUER=https://idp.example/ \
 *   npm run build && node dist/main.js
 */
import { createServer } from "node:http";
import { deleteApp, initializeApp } from "firebase-admin/app";
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
  writesEnabled: config.writesEnabled,
});

const server = createServer((req, res) => void handler(req, res));
server.listen(config.port, () => {
  audit.event("server_started", {
    port: config.port,
    resource: config.resourceUrl.href,
    emulator: config.usesEmulator,
    writesEnabled: config.writesEnabled,
  });
});

// Cloud Run sender SIGTERM og gir ~10 s før SIGKILL. Slutt å ta imot nye
// forbindelser, la pågående kall (inkl. en RTDB-transaksjon) fullføre, og
// lukk Firebase-forbindelsen. Tvungen exit etter 8 s.
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  audit.event("server_stopping", { signal });
  setTimeout(() => {
    audit.event("server_stop_forced", { signal });
    process.exit(1);
  }, 8_000).unref();
  server.closeIdleConnections();
  server.close(() => {
    void deleteApp(firebase).finally(() => {
      audit.event("server_stopped", { signal });
      process.exit(0);
    });
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
