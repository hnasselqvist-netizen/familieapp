import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";
import { jsonLineAudit, tryggFeil } from "./audit/log";

const base = {
  MCP_RESOURCE_URL: "https://mcp.example.no/mcp",
  MCP_AUTH_ISSUER: "https://tenant.eu.auth0.com/",
  FIREBASE_DATABASE_URL: "http://127.0.0.1:9000/?ns=demo-familieapp-default-rtdb",
};

describe("loadConfig", () => {
  it("lister alle manglende variabler", () => {
    expect(() => loadConfig({})).toThrow(
      "Mangler miljøvariabler: MCP_RESOURCE_URL, MCP_AUTH_ISSUER, FIREBASE_DATABASE_URL",
    );
  });

  it("nekter ekte Realtime Database uten eksplisitt MCP_ALLOW_PRODUCTION_DATA=true", () => {
    expect(() => loadConfig(base)).toThrow(ConfigError);
    expect(() => loadConfig(base)).toThrow(/Nekter å koble til ekte Realtime Database/);
    expect(loadConfig({ ...base, MCP_ALLOW_PRODUCTION_DATA: "true" }).usesEmulator).toBe(false);
  });

  it("emulator: standardverdier for audience, JWKS og port", () => {
    const config = loadConfig({ ...base, FIREBASE_DATABASE_EMULATOR_HOST: "127.0.0.1:9000" });
    expect(config).toMatchObject({
      port: 8080,
      audience: "https://mcp.example.no/mcp",
      usesEmulator: true,
    });
    expect(config.jwksUrl.href).toBe("https://tenant.eu.auth0.com/.well-known/jwks.json");
  });

  it("krever https for ressursen utenfor emulator", () => {
    expect(() =>
      loadConfig({
        ...base,
        MCP_RESOURCE_URL: "http://mcp.example.no/mcp",
        MCP_ALLOW_PRODUCTION_DATA: "true",
      }),
    ).toThrow(/https/);
  });

  it("skrivesperre: MCP_HANDLELISTE_SKRIVING er av med mindre den er eksplisitt «aktiv»", () => {
    const emu = { ...base, FIREBASE_DATABASE_EMULATOR_HOST: "127.0.0.1:9000" };
    expect(loadConfig(emu).writesEnabled).toBe(false);
    expect(loadConfig({ ...emu, MCP_HANDLELISTE_SKRIVING: "" }).writesEnabled).toBe(false);
    expect(loadConfig({ ...emu, MCP_HANDLELISTE_SKRIVING: "av" }).writesEnabled).toBe(false);
    expect(loadConfig({ ...emu, MCP_HANDLELISTE_SKRIVING: "aktiv" }).writesEnabled).toBe(true);
    for (const ugyldig of ["true", "1", "AKTIV", "ja"]) {
      expect(() => loadConfig({ ...emu, MCP_HANDLELISTE_SKRIVING: ugyldig })).toThrow(ConfigError);
    }
  });
});

describe("tryggFeil", () => {
  it("gir bare feilklasse og en smal kode — aldri meldingen", () => {
    const err = Object.assign(new Error("synthetic-secret-in-sdk-error"), {
      code: "database/disconnected",
    });
    expect(tryggFeil(err)).toEqual({ feilklasse: "Error", feilkode: "database/disconnected" });
    expect(tryggFeil(new TypeError("x"))).toEqual({ feilklasse: "TypeError" });
    const rarKode = Object.assign(new Error("m"), { code: "kode med hemmelig verdi" });
    expect(tryggFeil(rarKode)).toEqual({ feilklasse: "Error" });
    const rartNavn = Object.assign(new Error("m"), { name: "Feil: hemmelig verdi" });
    expect(tryggFeil(rartNavn)).toEqual({ feilklasse: "Error" });
    expect(tryggFeil("synthetic-secret")).toEqual({ feilklasse: "string" });
    expect(tryggFeil(null)).toEqual({ feilklasse: "object" });
  });
});

describe("generell skrivesperre", () => {
  it("MCP_DATA_SKRIVING er av med mindre den er eksplisitt «aktiv», og uavhengig av handlelistens", () => {
    const emu = { ...base, FIREBASE_DATABASE_EMULATOR_HOST: "127.0.0.1:9000" };
    expect(loadConfig(emu).dataWritesEnabled).toBe(false);
    expect(loadConfig({ ...emu, MCP_DATA_SKRIVING: "av" }).dataWritesEnabled).toBe(false);
    const aktiv = loadConfig({ ...emu, MCP_DATA_SKRIVING: "aktiv" });
    expect(aktiv.dataWritesEnabled).toBe(true);
    expect(aktiv.writesEnabled).toBe(false);
    for (const ugyldig of ["true", "1", "AKTIV", "ja"]) {
      expect(() => loadConfig({ ...emu, MCP_DATA_SKRIVING: ugyldig })).toThrow(/MCP_DATA_SKRIVING/);
    }
  });
});

describe("jsonLineAudit", () => {
  it("skriver én JSON-linje per hendelse og kaster aldri", () => {
    const lines: string[] = [];
    jsonLineAudit((l) => lines.push(l)).event("x", { a: 1 });
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "x", a: 1, severity: "INFO" });

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => jsonLineAudit(() => {}).event("y", circular)).not.toThrow();
  });
});
