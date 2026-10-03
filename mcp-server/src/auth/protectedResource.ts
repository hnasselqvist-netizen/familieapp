/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) og `WWW-Authenticate`-
 * utfordringer (RFC 6750). Det er disse ChatGPT/MCP-klienten bruker for å
 * oppdage IdP-en og starte authorization code + PKCE-flyten.
 */
export const SCOPES = {
  shoppingRead: "shopping:read",
  shoppingWrite: "shopping:write",
  /** Skrivefri cutover-kontroll av forsoningsnodene (Issue #34). Ingen skrive-scope finnes. */
  forvaltningRead: "forvaltning:read",
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

export interface ResourceConfig {
  /** Kanonisk URL til MCP-endepunktet, f.eks. `https://mcp.example.no/mcp`. */
  resourceUrl: URL;
  /** IdP-ens issuer (authorization server), f.eks. `https://tenant.eu.auth0.com/`. */
  issuer: string;
}

export function protectedResourceMetadata(config: ResourceConfig) {
  return {
    resource: config.resourceUrl.href,
    authorization_servers: [config.issuer],
    scopes_supported: [SCOPES.shoppingRead, SCOPES.shoppingWrite, SCOPES.forvaltningRead],
    bearer_methods_supported: ["header"],
    resource_name: "Hverdagsflyt",
  };
}

/**
 * Stiene metadata-dokumentet serveres på. RFC 9728 §3.1 setter
 * `/.well-known/oauth-protected-resource` FORAN ressursens sti
 * (`/mcp` → `/.well-known/oauth-protected-resource/mcp`); rot-varianten
 * serveres i tillegg for klienter som kun prøver den.
 */
export function metadataPaths(config: ResourceConfig): string[] {
  const base = "/.well-known/oauth-protected-resource";
  const resourcePath = config.resourceUrl.pathname.replace(/\/$/, "");
  return resourcePath ? [`${base}${resourcePath}`, base] : [base];
}

export function metadataUrl(config: ResourceConfig): string {
  const [primary] = metadataPaths(config);
  return new URL(primary ?? "/.well-known/oauth-protected-resource", config.resourceUrl).href;
}

export interface Challenge {
  error?: "invalid_token" | "insufficient_scope" | "invalid_request";
  description?: string;
  scope?: string;
}

/** Bygger `WWW-Authenticate: Bearer resource_metadata="…", …`. */
export function wwwAuthenticate(config: ResourceConfig, challenge: Challenge = {}): string {
  const params: [string, string][] = [["resource_metadata", metadataUrl(config)]];
  if (challenge.error) params.push(["error", challenge.error]);
  if (challenge.description) params.push(["error_description", challenge.description]);
  if (challenge.scope) params.push(["scope", challenge.scope]);
  return `Bearer ${params.map(([k, v]) => `${k}="${v.replace(/["\\]/g, "")}"`).join(", ")}`;
}
