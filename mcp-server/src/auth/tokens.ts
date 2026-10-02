/**
 * Validering av OAuth 2.1 access tokens utstedt av den eksterne IdP-en
 * (Auth0 er første kandidat, ikke låst — Issue #27 kommentar 5937138669).
 * MCP-serveren er KUN resource server: den validerer, utsteder aldri.
 *
 * Full validering (OpenAI/MCP-krav): signatur mot IdP-ens JWKS, `iss`,
 * `aud` (= vår resource-URL, RFC 8707), `exp`/`nbf`, og en eksplisitt
 * algoritme-allowlist. Ingen hemmelighet trengs her — kun offentlige
 * nøkler.
 */
import { errors, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface TokenValidationConfig {
  issuer: string;
  audience: string;
  getKey: JWTVerifyGetKey;
  algorithms?: string[];
  clockToleranceSec?: number;
}

export interface VerifiedToken {
  sub: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
}

export class TokenError extends Error {
  readonly code = "invalid_token" as const;

  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

/**
 * Scopes leses fra standard `scope` (mellomromsseparert, RFC 8693/9068)
 * og — for Auth0 med RBAC — `permissions`-arrayen. Ukjente scopes ignoreres
 * ikke her; autorisasjonen ser kun etter de den krever.
 */
export function extractScopes(payload: Record<string, unknown>): string[] {
  const fromScope = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
  const fromPermissions = Array.isArray(payload.permissions)
    ? payload.permissions.filter((p): p is string => typeof p === "string")
    : [];
  return [...new Set([...fromScope, ...fromPermissions].filter(Boolean))];
}

export async function verifyAccessToken(
  token: string,
  config: TokenValidationConfig,
): Promise<VerifiedToken> {
  try {
    const { payload } = await jwtVerify(token, config.getKey, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: config.algorithms ?? ["RS256"],
      clockTolerance: config.clockToleranceSec ?? 30,
      requiredClaims: ["sub", "exp"],
    });
    if (typeof payload.sub !== "string" || !payload.sub) {
      throw new TokenError("Token mangler sub");
    }
    const clientId =
      typeof payload.azp === "string"
        ? payload.azp
        : typeof payload.client_id === "string"
          ? payload.client_id
          : "";
    return {
      sub: payload.sub,
      clientId,
      scopes: extractScopes(payload),
      expiresAt: payload.exp as number,
    };
  } catch (err) {
    if (err instanceof TokenError) throw err;
    if (err instanceof errors.JOSEError) {
      throw new TokenError(`Ugyldig token (${err.code})`);
    }
    throw err;
  }
}
