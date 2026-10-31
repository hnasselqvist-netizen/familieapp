/**
 * HTTP-transport for kvitteringsvedlegg (#59, B1). Samme origin som appen
 * via Hosting-rewrite (`/api/vedlegg/**`), så ingen CORS.
 *
 *   POST /api/vedlegg/{familyId}/{receiptId}          rå filbytes i body
 *   GET  /api/vedlegg/{familyId}/{receiptId}/{sha256} filbytes med sikre hoder
 *
 * Body leses som strøm med HARD grense: overskrides grensen, avbrytes
 * lesingen og ingenting lagres. Klientens Content-Type ignoreres; typen
 * bestemmes av signaturen i kjernen.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  VedleggFeil,
  type VedleggPorter,
  autoriser,
  hentVedlegg,
  innholdshoder,
  lagreVedlegg,
} from "./kjerne";

const RUTE = /^\/api\/vedlegg\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/;

export interface VedleggLogg {
  hendelse(navn: string, felt: Record<string, unknown>): void;
}

/**
 * Leser body med grense. Passeres grensen, slutter vi å samle: resten av
 * strømmen forkastes (`resume`) uten å lagres, og forespørselen avvises med
 * 413 — klienten får et ordentlig svar i stedet for en brutt forbindelse.
 */
export function lesMedGrense(req: IncomingMessage, maks: number): Promise<Uint8Array> {
  const lengde = Number(req.headers["content-length"]);
  if (Number.isFinite(lengde) && lengde > maks) {
    req.resume();
    return Promise.reject(new VedleggFeil("for_stor", "Filen er for stor."));
  }
  return new Promise((resolve, reject) => {
    const deler: Buffer[] = [];
    let sum = 0;
    const paData = (del: Buffer) => {
      sum += del.length;
      if (sum > maks) {
        req.off("data", paData);
        deler.length = 0;
        req.resume();
        reject(new VedleggFeil("for_stor", "Filen er for stor."));
        return;
      }
      deler.push(del);
    };
    req.on("data", paData);
    req.on("end", () => {
      if (sum <= maks) resolve(new Uint8Array(Buffer.concat(deler)));
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(status === 413 ? { Connection: "close" } : {}),
  });
  res.end(JSON.stringify(body));
}

export function lagVedleggHandler(porter: VedleggPorter, logg?: VedleggLogg) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://lokal");
    const m = RUTE.exec(url.pathname);
    try {
      if (!m) throw new VedleggFeil("ugyldig_sti", "Ukjent adresse.");
      const familyId = decodeURIComponent(m[1]!);
      const receiptId = decodeURIComponent(m[2]!);
      const sha256 = m[3] ? decodeURIComponent(m[3]) : undefined;
      if (req.method === "POST" && !sha256) {
        // Autoriser FØR body leses: uautoriserte får aldri sende data inn.
        const uid = await autoriser(porter, req.headers.authorization, familyId);
        const bytes = await lesMedGrense(req, porter.maksBytes);
        const lagret = await lagreVedlegg(porter, { familyId, receiptId }, bytes);
        logg?.hendelse("vedlegg_lagret", {
          familyId,
          receiptId,
          uid,
          sha256: lagret.sha256,
          storrelse: lagret.storrelse,
          status: lagret.status,
        });
        json(res, lagret.status === "opprettet" ? 201 : 200, lagret);
        return;
      }
      if (req.method === "GET" && sha256) {
        await autoriser(porter, req.headers.authorization, familyId);
        const funnet = await hentVedlegg(porter, { familyId, receiptId, sha256 });
        res.writeHead(200, {
          ...innholdshoder(funnet.type, sha256),
          "Content-Length": String(funnet.bytes.length),
        });
        res.end(Buffer.from(funnet.bytes));
        return;
      }
      res.writeHead(405, { Allow: "GET, POST" });
      res.end();
    } catch (e) {
      if (e instanceof VedleggFeil) {
        json(res, e.status, { feil: e.kode, melding: e.message });
        return;
      }
      logg?.hendelse("vedlegg_feil", { melding: e instanceof Error ? e.name : "ukjent" });
      json(res, 500, { feil: "intern", melding: "Noe gikk galt. Prøv igjen." });
    }
  };
}
