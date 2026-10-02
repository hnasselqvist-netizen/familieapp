/**
 * All konfigurasjon kommer fra miljøet — ingen hemmeligheter i koden eller
 * repoet (som er offentlig). Resource serveren trenger heller ingen
 * hemmelighet: tokens valideres mot IdP-ens OFFENTLIGE JWKS, og Firebase
 * Admin SDK-et bruker plattformens tjenesteidentitet (Application Default
 * Credentials) — aldri en nøkkelfil.
 *
 * | Variabel                     | Påkrevd | Eksempel                                   |
 * |------------------------------|---------|--------------------------------------------|
 * | `MCP_RESOURCE_URL`           | ja      | `https://mcp.example.no/mcp`               |
 * | `MCP_AUTH_ISSUER`            | ja      | `https://tenant.eu.auth0.com/`             |
 * | `MCP_AUTH_AUDIENCE`          | nei     | standard: `MCP_RESOURCE_URL`               |
 * | `MCP_AUTH_JWKS_URL`          | nei     | standard: `{issuer}.well-known/jwks.json`  |
 * | `FIREBASE_DATABASE_URL`      | ja      | emulator: `http://127.0.0.1:9000/?ns=…`    |
 * | `FIREBASE_DATABASE_EMULATOR_HOST` | —  | settes for emulator                        |
 * | `MCP_ALLOW_PRODUCTION_DATA`  | nei     | må være `true` for å koble til ekte RTDB   |
 * | `MCP_HANDLELISTE_SKRIVING`   | nei     | `aktiv` slår på `shopping_list_add_items`  |
 * | `PORT`                       | nei     | standard `8080` (Cloud Run-konvensjon)      |
 */
export interface ServerConfig {
  port: number;
  resourceUrl: URL;
  issuer: string;
  audience: string;
  jwksUrl: URL;
  databaseUrl: string;
  usesEmulator: boolean;
  /**
   * Skriveverktøyet (`shopping_list_add_items`) registreres KUN når
   * `MCP_HANDLELISTE_SKRIVING=aktiv`. Av som standard: legacy-cutover
   * (én aktiv Handleliste-skriver, se README §Cutover) er en forutsetning
   * før MCP-skriving kan aktiveres mot ekte data. Lesing (`shopping_list_get`,
   * `items_search`) virker uansett.
   */
  writesEnabled: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const missing = ["MCP_RESOURCE_URL", "MCP_AUTH_ISSUER", "FIREBASE_DATABASE_URL"].filter(
    (k) => !env[k],
  );
  if (missing.length) throw new ConfigError(`Mangler miljøvariabler: ${missing.join(", ")}`);

  const resourceUrl = parseUrl("MCP_RESOURCE_URL", env.MCP_RESOURCE_URL!);
  const issuer = env.MCP_AUTH_ISSUER!;
  const issuerUrl = parseUrl("MCP_AUTH_ISSUER", issuer);
  const usesEmulator = Boolean(env.FIREBASE_DATABASE_EMULATOR_HOST);

  if (!usesEmulator && resourceUrl.protocol !== "https:") {
    throw new ConfigError("MCP_RESOURCE_URL må være https utenfor emulator.");
  }
  if (!usesEmulator && env.MCP_ALLOW_PRODUCTION_DATA !== "true") {
    // Sikkerhetssperre for foundation-fasen: ingen kobling mot ekte
    // Firebase-data før det er en eksplisitt, reviewet beslutning
    // (Issue #27, 5937138669 — "ingen Firebase prod-write").
    throw new ConfigError(
      "Nekter å koble til ekte Realtime Database: sett FIREBASE_DATABASE_EMULATOR_HOST, " +
        "eller MCP_ALLOW_PRODUCTION_DATA=true etter eksplisitt beslutning.",
    );
  }

  return {
    port: Number(env.PORT ?? 8080),
    resourceUrl,
    issuer,
    audience: env.MCP_AUTH_AUDIENCE || resourceUrl.href,
    jwksUrl: env.MCP_AUTH_JWKS_URL
      ? parseUrl("MCP_AUTH_JWKS_URL", env.MCP_AUTH_JWKS_URL)
      : new URL(".well-known/jwks.json", issuerUrl.href.endsWith("/") ? issuerUrl : `${issuer}/`),
    databaseUrl: env.FIREBASE_DATABASE_URL!,
    usesEmulator,
    writesEnabled: parseWriteSwitch(env.MCP_HANDLELISTE_SKRIVING),
  };
}

/** Kun den eksakte verdien `aktiv` slår på skriving; alt annet enn tom/`av` er en feil. */
function parseWriteSwitch(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "av") return false;
  if (value === "aktiv") return true;
  throw new ConfigError("MCP_HANDLELISTE_SKRIVING må være «aktiv» eller «av».");
}

function parseUrl(name: string, value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new ConfigError(`${name} er ikke en gyldig URL.`);
  }
}
