/**
 * Testhjelper: en lokal "IdP" — genererer et RS256-nøkkelpar, publiserer
 * den offentlige nøkkelen som et lokalt JWKS, og signerer tokens. Ingen
 * nettverk, ingen ekte IdP-hemmelighet.
 */
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";

export const TEST_ISSUER = "https://idp.test.invalid/";
export const TEST_RESOURCE = new URL("https://mcp.test.invalid/mcp");

export async function createTestIdp(kid = "test-key") {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  const getKey = createLocalJWKSet({ keys: [jwk] });

  async function sign(
    claims: JWTPayload & { scope?: string; permissions?: string[] } = {},
    options: { expiresIn?: string | number; issuer?: string; audience?: string; sub?: string } = {},
  ): Promise<string> {
    return new SignJWT({ scope: "shopping:read shopping:write", azp: "chatgpt-client", ...claims })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(options.issuer ?? TEST_ISSUER)
      .setAudience(options.audience ?? TEST_RESOURCE.href)
      .setSubject(options.sub ?? "google-oauth2|123")
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "5m")
      .sign(privateKey);
  }

  return { getKey, sign };
}
