/**
 * Offline kontrakttest for GcsObjektlager (#59 B, U5; review 5726398273).
 *
 * Bruker det EKTE `@google-cloud/storage`-SDK-et (samme kopi som
 * firebase-admin bruker) mot en lokal, falsk JSON-API-server og sjekker de
 * faktiske HTTP-kallene: opprett-bare-betingelsen `ifGenerationMatch=0` på
 * opplastingen, 412 → «fantes», 404 → null, typen fra bytene og ikke fra
 * lagret metadata, og at andre feil ikke svelges.
 *
 * Dette er IKKE ekte bøtteskriving og erstatter ikke uavhengig
 * runtimeverifikasjon mot en ekte bøtte (U5 i docs/drift/kvitteringsvedlegg.md).
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { CRC32C, Storage } from "@google-cloud/storage";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GcsObjektlager } from "./firebaseAdaptere";

const BUCKET = "test-kvitteringer";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = Buffer.from("%PDF-1.7\n%%EOF");
const STI = "families/f1/kvitteringer/r1/" + "a".repeat(64);

interface Kall {
  method: string;
  path: string;
  query: URLSearchParams;
  metadata?: Record<string, unknown>;
}

/** Lagrede objekter i den falske bøtta: navn → bytes + lagret contentType. */
const objekter = new Map<string, { bytes: Buffer; contentType: string }>();
const kall: Kall[] = [];
/** Tvungen status for neste kall (feilinjeksjon). */
let tvungen: number | null = null;

const lesBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const deler: Buffer[] = [];
    req.on("data", (d: Buffer) => deler.push(d));
    req.on("end", () => resolve(Buffer.concat(deler)));
  });

/** multipart/related fra SDK-ets enkle opplasting → [metadata-JSON, media]. */
function multipart(body: Buffer, contentType: string): [Record<string, unknown>, Buffer] {
  const grense = /boundary=("?)([^";]+)\1/.exec(contentType)![2]!;
  const skille = Buffer.from(`--${grense}`);
  const deler: Buffer[] = [];
  let fra = body.indexOf(skille) + skille.length;
  for (;;) {
    const til = body.indexOf(skille, fra);
    if (til < 0) break;
    deler.push(body.subarray(fra, til));
    fra = til + skille.length;
  }
  const innhold = deler.map((d) => {
    const start = d.indexOf("\r\n\r\n") + 4;
    return d.subarray(start, d.length - 2); // fjern avsluttende CRLF
  });
  return [JSON.parse(innhold[0]!.toString("utf8")) as Record<string, unknown>, innhold[1]!];
}

/** Objektressurs slik GCS svarer, med sjekksummene SDK-et validerer opplastingen mot. */
function objektsvar(navn: string, media: Buffer) {
  const crc = new CRC32C();
  crc.update(media);
  return {
    bucket: BUCKET,
    name: navn,
    generation: "1",
    size: String(media.length),
    md5Hash: createHash("md5").update(media).digest("base64"),
    crc32c: crc.toString(),
  };
}

const feil = (code: number) =>
  JSON.stringify({ error: { code, message: `falsk ${code}`, errors: [{ reason: "x" }] } });

let server: Server;
let lager: GcsObjektlager;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://lokal");
    const body = await lesBody(req);
    const k: Kall = { method: req.method ?? "", path: url.pathname, query: url.searchParams };
    kall.push(k);
    if (tvungen !== null) {
      const s = tvungen;
      tvungen = null;
      res.writeHead(s, { "Content-Type": "application/json" }).end(feil(s));
      return;
    }
    // Enkel opplasting: POST /upload/storage/v1/b/{bucket}/o?name=…&uploadType=multipart
    if (req.method === "POST" && url.pathname === `/upload/storage/v1/b/${BUCKET}/o`) {
      const [metadata, media] = multipart(body, req.headers["content-type"] ?? "");
      k.metadata = metadata;
      const navn = url.searchParams.get("name")!;
      if (url.searchParams.get("ifGenerationMatch") === "0" && objekter.has(navn)) {
        res.writeHead(412, { "Content-Type": "application/json" }).end(feil(412));
        return;
      }
      objekter.set(navn, { bytes: media, contentType: String(metadata.contentType) });
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(objektsvar(navn, media)));
      return;
    }
    // Nedlasting: GET /storage/v1/b/{bucket}/o/{navn}?alt=media
    const prefiks = `/storage/v1/b/${BUCKET}/o/`;
    if (req.method === "GET" && url.pathname.startsWith(prefiks)) {
      const navn = decodeURIComponent(url.pathname.slice(prefiks.length));
      const obj = objekter.get(navn);
      if (!obj) {
        res.writeHead(404, { "Content-Type": "application/json" }).end(feil(404));
        return;
      }
      res.writeHead(200, { "Content-Type": obj.contentType }).end(obj.bytes);
      return;
    }
    res.writeHead(400, { "Content-Type": "application/json" }).end(feil(400));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const storage = new Storage({
    apiEndpoint: base,
    projectId: "test",
    useAuthWithCustomEndpoint: false,
    retryOptions: { autoRetry: false },
  });
  lager = new GcsObjektlager(storage.bucket(BUCKET));
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  objekter.clear();
  kall.length = 0;
  tvungen = null;
});

describe("GcsObjektlager mot SDK-ets faktiske HTTP-kall (falsk server)", () => {
  it("oppretter med ifGenerationMatch=0, enkel opplasting, riktig navn, type og cache-hode", async () => {
    expect(await lager.opprettHvisLedig(STI, PNG, "image/png")).toBe("opprettet");
    expect(kall).toHaveLength(1);
    const k = kall[0]!;
    expect(k.method).toBe("POST");
    expect(k.path).toBe(`/upload/storage/v1/b/${BUCKET}/o`);
    expect(k.query.get("name")).toBe(STI);
    expect(k.query.get("ifGenerationMatch")).toBe("0");
    expect(k.query.get("uploadType")).toBe("multipart");
    expect(k.metadata).toMatchObject({
      contentType: "image/png",
      cacheControl: "private, no-store",
    });
    expect(objekter.get(STI)!.bytes.equals(PNG)).toBe(true);
  });

  it("finnes stien allerede: 412 → «fantes», og objektet overskrives ikke", async () => {
    await lager.opprettHvisLedig(STI, PNG, "image/png");
    expect(await lager.opprettHvisLedig(STI, PDF, "application/pdf")).toBe("fantes");
    expect(kall.map((k) => k.query.get("ifGenerationMatch"))).toEqual(["0", "0"]);
    expect(objekter.get(STI)!.bytes.equals(PNG)).toBe(true);
  });

  it("les: originalbytes, og typen bestemmes av bytene, ikke av lagret contentType", async () => {
    objekter.set(STI, { bytes: PNG, contentType: "text/html" });
    const funnet = await lager.les(STI);
    expect(funnet).not.toBeNull();
    expect(Buffer.from(funnet!.bytes).equals(PNG)).toBe(true);
    expect(funnet!.type).toBe("image/png");
    expect(kall[0]).toMatchObject({
      method: "GET",
      path: `/storage/v1/b/${BUCKET}/o/${encodeURIComponent(STI)}`,
    });
    expect(kall[0]!.query.get("alt")).toBe("media");
  });

  it("les: 404 → null; ukjent signatur i lagret objekt → null", async () => {
    expect(await lager.les(STI)).toBeNull();
    objekter.set(STI, { bytes: Buffer.from("<svg/>"), contentType: "image/png" });
    expect(await lager.les(STI)).toBeNull();
  });

  it("andre feil svelges ikke: 403 ved opplasting og nedlasting kastes videre", async () => {
    tvungen = 403;
    await expect(lager.opprettHvisLedig(STI, PNG, "image/png")).rejects.toMatchObject({
      code: 403,
    });
    expect(objekter.has(STI)).toBe(false);
    objekter.set(STI, { bytes: PNG, contentType: "image/png" });
    tvungen = 403;
    await expect(lager.les(STI)).rejects.toMatchObject({ code: 403 });
  });
});
