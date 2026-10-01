/**
 * MCP-verktøyflaten (Issue #27, 5936936743 §2 — godkjent i 5937138669):
 *
 * | Verktøy                   | Nivå | Scope          | Annotasjoner                         |
 * |---------------------------|------|----------------|--------------------------------------|
 * | `shopping_list_get`       | 0    | shopping:read  | readOnly                             |
 * | `items_search`            | 0    | shopping:read  | readOnly                             |
 * | `shopping_list_add_items` | 1    | shopping:write | ikke readOnly, ikke destructive      |
 *
 * Nivå 1: en eksplisitt brukerkommando («legg melk på handlelisten») ER
 * autorisasjonen for denne reversible handlingen — ingen egen draft →
 * confirm-runde i backend (5937138669 pkt. 3). ChatGPT kan fortsatt vise
 * sin egen bekreftelses-UI; serveren gjør ingenting for å omgå den
 * (annotasjonene sier ærlig at verktøyet skriver).
 *
 * Annotasjonene er HINT til klienten og erstatter aldri serverens egen
 * autorisasjon — hvert kall går gjennom `authorizeToolCall`.
 *
 * Én fersk `McpServer` per HTTP-forespørsel (stateless Streamable HTTP).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AuthorizationError, authorizeToolCall, type FamilyContext } from "../auth/authorize";
import {
  SCOPES,
  type ResourceConfig,
  type Scope,
  wwwAuthenticate,
} from "../auth/protectedResource";
import type { VerifiedToken } from "../auth/tokens";
import { ToolError } from "../handleliste/errors";
import {
  itemsSearchInput,
  itemsSearchOutput,
  shoppingListAddItemsInput,
  shoppingListAddItemsOutput,
  shoppingListGetInput,
  shoppingListOutput,
} from "../handleliste/schemas";
import { type AuditLog, type HandlelisteService, safeAudit } from "../handleliste/service";
import type { HverdagsflytStore } from "../store/types";

export interface McpDeps {
  store: HverdagsflytStore;
  service: HandlelisteService;
  resource: ResourceConfig;
  audit: AuditLog;
}

export const SERVER_INFO = { name: "hverdagsflyt", version: "0.1.0" } as const;

/** `extra.authInfo` settes av HTTP-laget etter full tokenvalidering (`http/app.ts`). */
export function tokenFromAuthInfo(authInfo: AuthInfo | undefined): VerifiedToken | null {
  const sub = authInfo?.extra?.sub;
  if (!authInfo || typeof sub !== "string") return null;
  return {
    sub,
    clientId: authInfo.clientId,
    scopes: authInfo.scopes,
    expiresAt: authInfo.expiresAt ?? 0,
  };
}

/**
 * OpenAI Apps SDK leser per-verktøy auth-krav fra `securitySchemes`; vi
 * speiler det i `_meta` slik at det følger med i `tools/list`. Eksakt
 * plassering verifiseres i den kommende ChatGPT ↔ IdP ↔ MCP auth-proben —
 * serverens håndheving avhenger ikke av at klienten leser det.
 */
const securitySchemes = (scope: Scope) => ({
  securitySchemes: [{ type: "oauth2", scopes: [scope] }],
});

export function buildMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(SERVER_INFO);
  const audit = safeAudit(deps.audit);

  const run = async <T extends Record<string, unknown>>(
    tool: string,
    scope: Scope,
    authInfo: AuthInfo | undefined,
    action: (ctx: FamilyContext) => Promise<T>,
  ): Promise<CallToolResult> => {
    const token = tokenFromAuthInfo(authInfo);
    try {
      if (!token) throw new AuthorizationError("not_linked", "Mangler autentisering.");
      const ctx = await authorizeToolCall(deps.store, token, scope);
      const result = await action(ctx);
      audit.event("tool_call", { tool, ok: true, sub: token.sub, familyId: ctx.familyId });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (err) {
      const code = errorCode(err);
      audit.event("tool_call", {
        tool,
        ok: false,
        sub: token?.sub,
        error: code,
        // Detaljer kun i serverloggen, aldri i svaret til klienten.
        ...(code === "internal_error" ? { detail: String(err) } : {}),
      });
      return toolErrorResult(err, deps.resource);
    }
  };

  server.registerTool(
    "shopping_list_get",
    {
      title: "Vis handlelisten",
      description:
        "Henter familiens handleliste i Hverdagsflyt, sortert etter kategori. Som standard kun varer som ikke er krysset av.",
      inputSchema: shoppingListGetInput,
      outputSchema: shoppingListOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: securitySchemes(SCOPES.shoppingRead),
    },
    (input, extra) =>
      run("shopping_list_get", SCOPES.shoppingRead, extra.authInfo, (ctx) =>
        deps.service.getShoppingList(ctx, input),
      ),
  );

  server.registerTool(
    "items_search",
    {
      title: "Søk i varebasen",
      description:
        "Søker i familiens varebase (varer som er brukt før) på navn. Nyttig for å finne riktig skrivemåte før noe legges på handlelisten.",
      inputSchema: itemsSearchInput,
      outputSchema: itemsSearchOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: securitySchemes(SCOPES.shoppingRead),
    },
    (input, extra) =>
      run("items_search", SCOPES.shoppingRead, extra.authInfo, (ctx) =>
        deps.service.searchItems(ctx, input),
      ),
  );

  server.registerTool(
    "shopping_list_add_items",
    {
      title: "Legg varer på handlelisten",
      description:
        "Legger én eller flere varer på familiens handleliste i Hverdagsflyt. Finnes varen allerede (ikke avkrysset), summeres tallmengder; ellers blir den stående som den er. Bruk kun når brukeren eksplisitt ber om det. Returnerer utfall per vare og listen etterpå.",
      inputSchema: shoppingListAddItemsInput,
      outputSchema: shoppingListAddItemsOutput,
      // idempotentHint er bevisst UTELATT (= false): idempotensen bæres av
      // requestId, ikke av argumentene alene — se handleliste/service.ts.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: securitySchemes(SCOPES.shoppingWrite),
    },
    (input, extra) =>
      run("shopping_list_add_items", SCOPES.shoppingWrite, extra.authInfo, async (ctx) => ({
        ...(await deps.service.addItems(ctx, input)),
      })),
  );

  return server;
}

function errorCode(err: unknown): string {
  if (err instanceof AuthorizationError || err instanceof ToolError) return err.code;
  return "internal_error";
}

/**
 * Feil som verktøyresultat (`isError`), aldri som kastet protokollfeil —
 * slik at modellen kan forklare brukeren hva som skjedde. Manglende scope
 * får i tillegg en `WWW-Authenticate`-utfordring i `_meta`
 * (`mcp/www_authenticate`), som ChatGPT bruker til å be om ny/utvidet
 * tilgang. Interne feil lekker aldri detaljer.
 */
export function toolErrorResult(err: unknown, resource: ResourceConfig): CallToolResult {
  let payload: { error: string; message: string; retryable: boolean };
  let meta: Record<string, unknown> | undefined;

  if (err instanceof AuthorizationError) {
    payload = { error: err.code, message: err.message, retryable: false };
    if (err.code === "insufficient_scope" && err.requiredScope) {
      meta = {
        "mcp/www_authenticate": [
          wwwAuthenticate(resource, {
            error: "insufficient_scope",
            scope: err.requiredScope,
            description: err.message,
          }),
        ],
      };
    }
  } else if (err instanceof ToolError) {
    payload = { error: err.code, message: err.message, retryable: err.retryable };
  } else {
    payload = {
      error: "internal_error",
      message:
        "Noe gikk galt i Hverdagsflyt. Forespørselen kan trygt prøves igjen (skrivinger med samme requestId).",
      retryable: true,
    };
  }

  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload) }],
    ...(meta ? { _meta: meta } : {}),
  };
}
