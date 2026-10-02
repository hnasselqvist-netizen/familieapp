/**
 * Kobler sammen lagene til én request-handler. Brukt av `main.ts` og av
 * HTTP-ende-til-ende-testene (med in-memory-store og lokale nøkler).
 */
import type { JWTVerifyGetKey } from "jose";
import type { ResourceConfig } from "./auth/protectedResource";
import { verifyAccessToken } from "./auth/tokens";
import { HandlelisteService, type AuditLog, type ServiceOptions } from "./handleliste/service";
import { createRequestHandler } from "./http/app";
import { buildMcpServer } from "./mcp/server";
import type { HverdagsflytStore } from "./store/types";

export interface AppDeps {
  store: HverdagsflytStore;
  resource: ResourceConfig;
  audience: string;
  getKey: JWTVerifyGetKey;
  audit: AuditLog;
  serviceOptions?: ServiceOptions;
  /** Skrivesperre — `false` som standard (se `config.ts` §writesEnabled). */
  writesEnabled?: boolean;
}

export function createApp(deps: AppDeps) {
  const service = new HandlelisteService(deps.store, { audit: deps.audit, ...deps.serviceOptions });
  return createRequestHandler({
    resource: deps.resource,
    audit: deps.audit,
    verifyToken: (token) =>
      verifyAccessToken(token, {
        issuer: deps.resource.issuer,
        audience: deps.audience,
        getKey: deps.getKey,
      }),
    buildServer: () =>
      buildMcpServer({
        store: deps.store,
        service,
        resource: deps.resource,
        audit: deps.audit,
        writesEnabled: deps.writesEnabled ?? false,
      }),
  });
}
