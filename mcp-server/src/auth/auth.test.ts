import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memoryStore";
import { createTestIdp, TEST_ISSUER, TEST_RESOURCE } from "../testing/tokens";
import { AuthorizationError, authorizeToolCall } from "./authorize";
import {
  metadataPaths,
  metadataUrl,
  protectedResourceMetadata,
  SCOPES,
  wwwAuthenticate,
} from "./protectedResource";
import { extractScopes, TokenError, verifyAccessToken, type VerifiedToken } from "./tokens";

const resource = { resourceUrl: TEST_RESOURCE, issuer: TEST_ISSUER };

describe("verifyAccessToken", async () => {
  const idp = await createTestIdp();
  const config = { issuer: TEST_ISSUER, audience: TEST_RESOURCE.href, getKey: idp.getKey };

  it("godtar et gyldig token og trekker ut sub, klient og scopes", async () => {
    const verified = await verifyAccessToken(await idp.sign(), config);
    expect(verified).toMatchObject({
      sub: "google-oauth2|123",
      clientId: "chatgpt-client",
      scopes: ["shopping:read", "shopping:write"],
    });
  });

  it.each([
    ["feil issuer", { issuer: "https://annen-idp.invalid/" }],
    ["feil audience (token til en annen ressurs)", { audience: "https://annen.invalid/mcp" }],
    ["utløpt", { expiresIn: Math.floor(Date.now() / 1000) - 120 }],
  ])("avviser %s", async (_label, options) => {
    await expect(verifyAccessToken(await idp.sign({}, options), config)).rejects.toBeInstanceOf(
      TokenError,
    );
  });

  it("avviser et token signert med en nøkkel som ikke er i JWKS", async () => {
    const other = await createTestIdp("test-key");
    await expect(verifyAccessToken(await other.sign(), config)).rejects.toBeInstanceOf(TokenError);
  });

  it("avviser algoritmer utenfor allowlisten (her ES256)", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "ec", alg: "ES256" };
    const { createLocalJWKSet } = await import("jose");
    const token = await new SignJWT({ scope: "shopping:read" })
      .setProtectedHeader({ alg: "ES256", kid: "ec" })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_RESOURCE.href)
      .setSubject("x")
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(
      verifyAccessToken(token, { ...config, getKey: createLocalJWKSet({ keys: [jwk] }) }),
    ).rejects.toBeInstanceOf(TokenError);
  });

  it("avviser søppel", async () => {
    await expect(verifyAccessToken("ikke.et.jwt", config)).rejects.toBeInstanceOf(TokenError);
  });
});

describe("extractScopes", () => {
  it("leser både `scope` og Auth0 RBAC `permissions`, uten duplikater", () => {
    expect(
      extractScopes({ scope: "openid shopping:read", permissions: ["shopping:read", "x", 3] }),
    ).toEqual(["openid", "shopping:read", "x"]);
    expect(extractScopes({})).toEqual([]);
  });

  it("leverandørnøytralt: `scp` som streng (Entra ID) og som array (Okta)", () => {
    expect(extractScopes({ scp: "shopping:read shopping:write" })).toEqual([
      "shopping:read",
      "shopping:write",
    ]);
    expect(extractScopes({ scp: ["shopping:read", 7] })).toEqual(["shopping:read"]);
    expect(extractScopes({ scope: "", scp: null, permissions: "shopping:write" })).toEqual([
      "shopping:write",
    ]);
  });
});

describe("authorizeToolCall — per kall: scope → kobling → medlemskap", () => {
  const token = (scopes: string[] = [SCOPES.shoppingRead]): VerifiedToken => ({
    sub: "google-oauth2|123",
    clientId: "chatgpt",
    scopes,
    expiresAt: 0,
  });
  const setup = () => {
    const store = new MemoryStore();
    store.principals.set("google-oauth2|123", { firebaseUid: "uid-1", familyId: "familie1" });
    store.addMember("familie1", "uid-1");
    return store;
  };
  const code = async (p: Promise<unknown>) =>
    p.then(
      () => "ok",
      (e: unknown) => (e instanceof AuthorizationError ? e.code : String(e)),
    );

  it("gir FamilyContext med familyId fra koblingen", async () => {
    expect(await authorizeToolCall(setup(), token(), SCOPES.shoppingRead)).toEqual({
      familyId: "familie1",
      firebaseUid: "uid-1",
      idpSub: "google-oauth2|123",
      clientId: "chatgpt",
    });
  });

  it("manglende scope → insufficient_scope (før noe data leses)", async () => {
    const store = setup();
    store.principals.clear();
    expect(await code(authorizeToolCall(store, token(), SCOPES.shoppingWrite))).toBe(
      "insufficient_scope",
    );
  });

  it("ingen kobling → not_linked (ingen e-postbasert fallback)", async () => {
    const store = setup();
    store.principals.clear();
    expect(await code(authorizeToolCall(store, token(), SCOPES.shoppingRead))).toBe("not_linked");
  });

  it("deaktivert kobling → link_disabled", async () => {
    const store = setup();
    store.principals.set("google-oauth2|123", {
      firebaseUid: "uid-1",
      familyId: "familie1",
      disabled: true,
    });
    expect(await code(authorizeToolCall(store, token(), SCOPES.shoppingRead))).toBe(
      "link_disabled",
    );
  });

  it("fjernet medlemskap → not_member, selv med gyldig kobling", async () => {
    const store = setup();
    store.removeMember("familie1", "uid-1");
    expect(await code(authorizeToolCall(store, token(), SCOPES.shoppingRead))).toBe("not_member");
  });

  it("en kobling med ugyldig familyId brukes aldri i en databasesti", async () => {
    const store = setup();
    store.principals.set("google-oauth2|123", { firebaseUid: "uid-1", familyId: "../annen" });
    expect(await code(authorizeToolCall(store, token(), SCOPES.shoppingRead))).toMatch(
      /Ugyldig familyId/,
    );
  });
});

describe("protected resource metadata (RFC 9728)", () => {
  it("peker på IdP-en og lister scopes", () => {
    expect(protectedResourceMetadata(resource)).toEqual({
      resource: "https://mcp.test.invalid/mcp",
      authorization_servers: [TEST_ISSUER],
      scopes_supported: ["shopping:read", "shopping:write"],
      bearer_methods_supported: ["header"],
      resource_name: "Hverdagsflyt",
    });
  });

  it("serveres med ressursstien satt inn etter well-known-prefikset", () => {
    expect(metadataPaths(resource)).toEqual([
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
    ]);
    expect(metadataUrl(resource)).toBe(
      "https://mcp.test.invalid/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("WWW-Authenticate bærer resource_metadata og valgfri feil/scope", () => {
    expect(wwwAuthenticate(resource)).toBe(
      'Bearer resource_metadata="https://mcp.test.invalid/.well-known/oauth-protected-resource/mcp"',
    );
    expect(
      wwwAuthenticate(resource, { error: "insufficient_scope", scope: "shopping:write" }),
    ).toContain('error="insufficient_scope", scope="shopping:write"');
  });
});
