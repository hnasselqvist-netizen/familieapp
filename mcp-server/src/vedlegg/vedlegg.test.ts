/**
 * Vedleggstjenesten (#59, B1) mot falske porter: signatur/originalbytes,
 * størrelsesgrense i strøm, autorisasjon per forespørsel, idempotens,
 * samtidighet og sikre innholdshoder — gjennom ekte HTTP.
 */
import { createHash } from "node:crypto";
import { type AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lastVedleggConfig } from "./config";
import { type VedleggPorter, gjenkjennType, innholdshoder, objektsti } from "./kjerne";
import { lagVedleggHandler } from "./http";
import { MinneObjektlager } from "./minneObjektlager";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);
const PDF = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n1 0 obj");
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let server: Server;
let base: string;
let lager: MinneObjektlager;
let medlemmer: Set<string>;
const tokens: Record<string, string> = { "tok-helen": "helen", "tok-ukjent": "ukjent" };

beforeEach(async () => {
  lager = new MinneObjektlager();
  medlemmer = new Set(["familie1/helen"]);
  const porter: VedleggPorter = {
    token: {
      uid: async (t) => {
        const uid = tokens[t];
        if (!uid) throw new Error("ugyldig");
        return uid;
      },
    },
    medlemskap: { erMedlem: async (f, uid) => medlemmer.has(`${f}/${uid}`) },
    lager,
    maksBytes: 64,
  };
  server = createServer((req, res) => void lagVedleggHandler(porter)(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

const post = (sti: string, body: Uint8Array, token = "tok-helen", type = "image/png") =>
  fetch(`${base}${sti}`, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": type },
    body,
  });
const hent = (sti: string, token = "tok-helen") =>
  fetch(`${base}${sti}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe("signatur", () => {
  it("gjenkjenner JPEG/PNG/WebP/PDF fra bytene, aldri SVG/HTML/tomt", () => {
    expect(gjenkjennType(JPEG)).toBe("image/jpeg");
    expect(gjenkjennType(PNG)).toBe("image/png");
    expect(gjenkjennType(WEBP)).toBe("image/webp");
    expect(gjenkjennType(PDF)).toBe("application/pdf");
    expect(gjenkjennType(SVG)).toBeNull();
    expect(gjenkjennType(HTML)).toBeNull();
    expect(gjenkjennType(new Uint8Array())).toBeNull();
    expect(
      gjenkjennType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])),
    ).toBeNull();
  });
});

describe("opplasting", () => {
  it("lagrer originalbytes innholdsadressert; typen fra signatur, ikke klientens MIME", async () => {
    const r = await post("/api/vedlegg/familie1/r1", PDF, "tok-helen", "image/png");
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({
      sha256: sha(PDF),
      type: "application/pdf",
      storrelse: PDF.length,
      status: "opprettet",
    });
    expect(lager.objekter.get(objektsti("familie1", "r1", sha(PDF)))?.bytes).toEqual(PDF);
  });

  it("identisk retry og samtidige opplastinger gir én skriving, aldri overskriving", async () => {
    const svar = await Promise.all([1, 2, 3].map(() => post("/api/vedlegg/familie1/r1", JPEG)));
    expect(svar.map((s) => s.status).sort()).toEqual([200, 200, 201]);
    expect(lager.skrivinger).toBe(1);
    const igjen = await post("/api/vedlegg/familie1/r1", JPEG);
    expect(await igjen.json()).toMatchObject({ status: "fantes", sha256: sha(JPEG) });
    expect(lager.skrivinger).toBe(1);
  });

  it("avviser SVG/HTML/ukjent (415), tom (400) og for stor (413) uten å lagre", async () => {
    for (const body of [SVG, HTML, new Uint8Array([1, 2, 3])]) {
      const r = await post("/api/vedlegg/familie1/r1", body, "tok-helen", "image/svg+xml");
      expect(r.status).toBe(415);
    }
    expect((await post("/api/vedlegg/familie1/r1", new Uint8Array())).status).toBe(400);
    const stor = new Uint8Array(65);
    stor.set(PNG);
    expect((await post("/api/vedlegg/familie1/r1", stor)).status).toBe(413);
    expect(lager.objekter.size).toBe(0);
  });

  it("for stor uten Content-Length (chunket strøm) avbrytes også", async () => {
    const stor = new Uint8Array(200);
    stor.set(PNG);
    const strom = new ReadableStream({
      start(c) {
        c.enqueue(stor.slice(0, 50));
        c.enqueue(stor.slice(50));
        c.close();
      },
    });
    const r = await fetch(`${base}/api/vedlegg/familie1/r1`, {
      method: "POST",
      headers: { Authorization: "Bearer tok-helen" },
      body: strom,
      duplex: "half",
    } as RequestInit);
    expect(r.status).toBe(413);
    expect(lager.objekter.size).toBe(0);
  });
});

describe("autorisasjon per forespørsel", () => {
  it("mangler/ugyldig token → 401; annen familie og fjernet medlem → 403; ingenting lagres eller leses", async () => {
    expect((await post("/api/vedlegg/familie1/r1", PNG, "")).status).toBe(401);
    expect((await post("/api/vedlegg/familie1/r1", PNG, "tok-tull")).status).toBe(401);
    expect((await post("/api/vedlegg/familie2/r1", PNG)).status).toBe(403);
    expect((await post("/api/vedlegg/familie1/r1", PNG, "tok-ukjent")).status).toBe(403);
    expect(lager.objekter.size).toBe(0);

    expect((await post("/api/vedlegg/familie1/r1", PNG)).status).toBe(201);
    const sti = `/api/vedlegg/familie1/r1/${sha(PNG)}`;
    expect((await hent(sti)).status).toBe(200);
    medlemmer.delete("familie1/helen");
    expect((await hent(sti)).status).toBe(403);
    expect((await hent(sti, "")).status).toBe(401);
  });

  it("ugyldige ID-er og stier avvises (400/404), også traversering", async () => {
    expect((await post("/api/vedlegg/familie1/r..1", PNG)).status).toBe(400);
    expect((await post("/api/vedlegg/familie1/%2e%2e", PNG)).status).toBe(400);
    expect((await hent("/api/vedlegg/familie1/r1/ikke-sha")).status).toBe(400);
    expect((await hent(`/api/vedlegg/familie1/r1/${"a".repeat(64)}`)).status).toBe(404);
    expect((await hent("/api/annet")).status).toBe(400);
  });
});

describe("nedlasting", () => {
  it("leverer originalbytes med sikre hoder; PDF som nedlasting, bilder inline", async () => {
    await post("/api/vedlegg/familie1/r1", PDF);
    await post("/api/vedlegg/familie1/r1", WEBP);
    const pdf = await hent(`/api/vedlegg/familie1/r1/${sha(PDF)}`);
    expect(new Uint8Array(await pdf.arrayBuffer())).toEqual(PDF);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toMatch(/^attachment; filename="kvittering-/);
    expect(pdf.headers.get("x-content-type-options")).toBe("nosniff");
    expect(pdf.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(pdf.headers.get("cache-control")).toBe("private, no-store");
    const webp = await hent(`/api/vedlegg/familie1/r1/${sha(WEBP)}`);
    expect(webp.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(innholdshoder("image/jpeg", sha(JPEG))["Content-Disposition"]).toMatch(/\.jpg"$/);
  });
});

describe("konfigurasjon", () => {
  it("nekter ekte Firebase uten eksplisitt beslutning, og minnelager utenfor emulator", () => {
    expect(() => lastVedleggConfig({ FIREBASE_DATABASE_URL: "https://x" })).toThrow(/Nekter/);
    expect(() =>
      lastVedleggConfig({ FIREBASE_DATABASE_URL: "https://x", VEDLEGG_ALLOW_PRODUCTION: "true" }),
    ).toThrow(/Minnelager/);
    expect(() =>
      lastVedleggConfig({
        FIREBASE_DATABASE_URL: "https://x",
        VEDLEGG_ALLOW_PRODUCTION: "true",
        VEDLEGG_LAGER: "gcs",
      }),
    ).toThrow(/VEDLEGG_BUCKET/);
    expect(
      lastVedleggConfig({
        FIREBASE_DATABASE_URL: "http://127.0.0.1:9000",
        FIREBASE_DATABASE_EMULATOR_HOST: "127.0.0.1:9000",
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      }),
    ).toMatchObject({ usesEmulator: true, lager: "minne", maksBytes: 10 * 1024 * 1024 });
  });

  // Review 5725492565 P1: emulatorbanen skal aldri kunne velge ekte lager ved en glipp.
  const EMU = {
    FIREBASE_DATABASE_URL: "http://127.0.0.1:9000",
    FIREBASE_DATABASE_EMULATOR_HOST: "127.0.0.1:9000",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  };
  it("nekter ekte GCS sammen med emulator, også med produksjons-opt-in", () => {
    expect(() =>
      lastVedleggConfig({ ...EMU, VEDLEGG_LAGER: "gcs", VEDLEGG_BUCKET: "a-real-bucket" }),
    ).toThrow(/emulator/i);
    expect(() =>
      lastVedleggConfig({
        ...EMU,
        VEDLEGG_LAGER: "gcs",
        VEDLEGG_BUCKET: "a-real-bucket",
        VEDLEGG_ALLOW_PRODUCTION: "true",
      }),
    ).toThrow(/emulator/i);
  });

  it("nekter halv emulator (bare RTDB eller bare Auth), også med produksjons-opt-in", () => {
    for (const halv of [
      { FIREBASE_DATABASE_EMULATOR_HOST: "127.0.0.1:9000" },
      { FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" },
    ]) {
      for (const lager of [{}, { VEDLEGG_LAGER: "gcs", VEDLEGG_BUCKET: "b" }]) {
        expect(() =>
          lastVedleggConfig({
            FIREBASE_DATABASE_URL: "https://x",
            VEDLEGG_ALLOW_PRODUCTION: "true",
            ...halv,
            ...lager,
          }),
        ).toThrow(/emulator/i);
      }
    }
  });

  it("ekte GCS bare med eksplisitt produksjons-opt-in og uten emulator", () => {
    expect(() =>
      lastVedleggConfig({
        FIREBASE_DATABASE_URL: "https://x",
        VEDLEGG_LAGER: "gcs",
        VEDLEGG_BUCKET: "b",
      }),
    ).toThrow(/Nekter/);
    expect(
      lastVedleggConfig({
        FIREBASE_DATABASE_URL: "https://x",
        VEDLEGG_ALLOW_PRODUCTION: "true",
        VEDLEGG_LAGER: "gcs",
        VEDLEGG_BUCKET: "b",
      }),
    ).toMatchObject({ usesEmulator: false, lager: "gcs", bucket: "b" });
    expect(lastVedleggConfig({ ...EMU, VEDLEGG_LAGER: "minne" })).toMatchObject({
      usesEmulator: true,
      lager: "minne",
    });
  });
});
