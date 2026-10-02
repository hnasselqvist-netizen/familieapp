/**
 * HTTP-laget: én Node-`request`-handler, ingen rammeverk.
 *
 *   GET  /health                                    → 200 (ikke `/healthz`: Cloud Run
 *                                                      reserverer stier som slutter på «z»)
 *   GET  /.well-known/oauth-protected-resource[/mcp] → RFC 9728-metadata (offentlig)
 *   POST /mcp                                       → MCP Streamable HTTP (stateless, JSON-svar)
 *   *    /mcp (andre metoder)                       → 405
 *
 * Alle MCP-forespørsler krever et gyldig Bearer-token. Mangler det eller
 * er det ugyldig, svares 401 med `WWW-Authenticate: Bearer
 * resource_metadata="…"` — signalet ChatGPT bruker til å starte OAuth-
 * flyten mot IdP-en. Token-strengen logges aldri.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  metadataPaths,
  protectedResourceMetadata,
  type ResourceConfig,
  wwwAuthenticate,
} from "../auth/protectedResource";
import { TokenError, type VerifiedToken } from "../auth/tokens";
import { type AuditLog, safeAudit } from "../handleliste/service";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface HttpDeps {
  resource: ResourceConfig;
  verifyToken: (token: string) => Promise<VerifiedToken>;
  buildServer: () => McpServer;
  audit: AuditLog;
  maxBodyBytes?: number;
}

export function createRequestHandler(deps: HttpDeps) {
  const mcpPath = deps.resource.resourceUrl.pathname.replace(/\/$/, "") || "/";
  const wellKnown = new Set(metadataPaths(deps.resource));
  const maxBody = deps.maxBodyBytes ?? 256 * 1024;
  const audit = safeAudit(deps.audit);

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname.replace(/\/$/, "") || "/";

    try {
      if (path === "/health" && req.method === "GET") {
        return send(res, 200, { ok: true });
      }

      if (wellKnown.has(path)) {
        if (req.method === "OPTIONS") return sendCorsPreflight(res);
        if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=300");
        return send(res, 200, protectedResourceMetadata(deps.resource));
      }

      if (path !== mcpPath) return send(res, 404, { error: "not_found" });

      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return send(res, 405, jsonRpcError(-32000, "Kun POST støttes (stateless server)."));
      }

      const token = bearerToken(req);
      if (!token) {
        res.setHeader("WWW-Authenticate", wwwAuthenticate(deps.resource));
        return send(res, 401, { error: "unauthorized" });
      }

      let verified: VerifiedToken;
      try {
        verified = await deps.verifyToken(token);
      } catch (err) {
        if (!(err instanceof TokenError)) throw err;
        audit.event("token_rejected", { reason: err.message });
        res.setHeader(
          "WWW-Authenticate",
          wwwAuthenticate(deps.resource, { error: "invalid_token", description: err.message }),
        );
        return send(res, 401, { error: "invalid_token" });
      }

      const body = await readJsonBody(req, maxBody);
      if (body.kind === "too_large")
        return send(res, 413, jsonRpcError(-32600, "For stor forespørsel."));
      if (body.kind === "invalid") return send(res, 400, jsonRpcError(-32700, "Ugyldig JSON."));

      const authInfo: AuthInfo = {
        token,
        clientId: verified.clientId,
        scopes: verified.scopes,
        expiresAt: verified.expiresAt,
        resource: deps.resource.resourceUrl,
        extra: { sub: verified.sub },
      };

      const server = deps.buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(
        Object.assign(req, { auth: authInfo }) as IncomingMessage & { auth: AuthInfo },
        res,
        body.value,
      );
    } catch (err) {
      audit.event("http_error", { path, detail: String(err) });
      if (!res.headersSent) send(res, 500, jsonRpcError(-32603, "Intern feil."));
      else res.end();
    }
  };
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+([A-Za-z0-9\-._~+/]+=*)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

type BodyResult = { kind: "ok"; value: unknown } | { kind: "invalid" } | { kind: "too_large" };

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<BodyResult> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > maxBytes) return { kind: "too_large" };
    chunks.push(buf);
  }
  try {
    return { kind: "ok", value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { kind: "invalid" };
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function sendCorsPreflight(res: ServerResponse): void {
  res.statusCode = 204;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");
  res.end();
}

const jsonRpcError = (code: number, message: string) => ({
  jsonrpc: "2.0",
  error: { code, message },
  id: null,
});
