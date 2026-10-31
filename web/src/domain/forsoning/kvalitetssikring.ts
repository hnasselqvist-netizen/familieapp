/**
 * «Kvalitetssikret» for transaksjoner (#59, Helen 6541424565/6542594363,
 * kontrakt 6541592690). Ren domenelogikk, ingen I/O.
 *
 * Kvalitetssikring er ADSKILT fra behandlingsstatus: «Ferdig» blir aldri
 * automatisk kvalitetssikret, og kontrollen påvirker ingen økonomisummer
 * eller regler. Status lagres ALDRI — den avledes ved å sammenligne
 * grunnlaget brukeren kontrollerte med dagens grunnlag:
 *
 *  - «Ikke kontrollert»: ingen gjeldende kontroll (aldri merket eller opphevet);
 *  - «Kvalitetssikret»: lagret grunnlag = dagens grunnlag;
 *  - «Endret etter kontroll»: grunnlaget er endret siden kontrollen.
 *
 * Grunnlaget er semantisk og deterministisk: bare økonomisk relevante felt
 * (dato, konto, beløp/retning, behandlingstilstand, koblinger og
 * fordelinger med post/type/beløp/eiere). Tidsstempler, læringsmetadata,
 * regel-id og visningsnavn er bevisst utelatt, så de alene ikke gjør en
 * kontroll utdatert — og en regelendring endrer ikke historisk kontroll.
 */
import type { HendelseRecord, TransaksjonRecord } from "@app-types/forsoning";
import type {
  KontrollMerke,
  KontrollSpor,
  Transaksjonskontroll,
} from "@app-types/kvalitetssikring";

export type { KontrollMerke, KontrollSpor, Transaksjonskontroll };
import { normaliserKonto } from "./bankimportParse";
import { finnHendelseForTransaksjon } from "./fordeling";
import { beskrivTilstand } from "./transaksjonsoversikt";

/** Øk bare ved en bevisst endring av hva grunnlaget består av. */
export const GRUNNLAG_VERSJON = 1;

export type Kontrollstatus = "ikke_kontrollert" | "kvalitetssikret" | "endret_etter_kontroll";

export const KONTROLLSTATUS_LABEL: Record<Kontrollstatus, string> = {
  ikke_kontrollert: "Ikke kontrollert",
  kvalitetssikret: "Kvalitetssikret",
  endret_etter_kontroll: "Endret etter kontroll",
};

const ore = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : 0;
const signertOre = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) : 0;

/** JSON med sorterte nøkler, så samme innhold alltid gir samme tekst. */
export function kanoniskJson(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(kanoniskJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${kanoniskJson(o[k])}`)
    .join(",")}}`;
}

/** Det semantiske grunnlaget for én transaksjon, som kanonisk tekst. */
export function kontrollgrunnlagTekst(
  t: TransaksjonRecord,
  hendelser: readonly HendelseRecord[],
): string {
  const h = finnHendelseForTransaksjon([...hendelser], t.id);
  const kategori = beskrivTilstand(t, h ? [h] : [], [], {
    budgetGroups: [],
    incomeGroups: [],
    sparingGroups: [],
  }).kategori;
  const fordelinger = (h?.fordelinger ?? [])
    .map((f) => ({
      post: f.plasseringId ?? "",
      type: f.plasseringType ?? "",
      ore: signertOre(f.belop),
      eiere: (f.eiere ?? [])
        .filter((e) => Number(e.prosent) > 0)
        .map((e) => ({ person: e.person ?? "", prosent: Number(e.prosent) }))
        .sort((a, b) => (a.person < b.person ? -1 : a.person > b.person ? 1 : 0)),
    }))
    .sort((a, b) => {
      const ka = kanoniskJson(a);
      const kb = kanoniskJson(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  return kanoniskJson({
    v: GRUNNLAG_VERSJON,
    id: t.id,
    dato: typeof t.dato === "string" ? t.dato.slice(0, 10) : "",
    konto: normaliserKonto(t),
    ore: ore(t.belop),
    retning: t.retning ?? "",
    tilstand: kategori,
    ignorertSom: t.ignorertSom ?? null,
    motpart: t.motpartTransaksjonId ?? null,
    hendelse: h
      ? {
          status: h.status,
          paaVentAarsak: h.paaVentAarsak ?? null,
          kvittering: h.receiptId ?? null,
          fordelinger,
        }
      : null,
  });
}

export function kontrollgrunnlag(
  t: TransaksjonRecord,
  hendelser: readonly HendelseRecord[],
): string {
  return sha256Hex(kontrollgrunnlagTekst(t, hendelser));
}

export function kontrollstatus(
  kontroll: Transaksjonskontroll | null | undefined,
  dagensGrunnlag: string,
): Kontrollstatus {
  const g = kontroll?.gjeldende;
  if (!g) return "ikke_kontrollert";
  return g.versjon === GRUNNLAG_VERSJON && g.grunnlag === dagensGrunnlag
    ? "kvalitetssikret"
    : "endret_etter_kontroll";
}

export interface Kontrollhandling {
  /** Grunnlaget brukeren faktisk så (fra `kontrollgrunnlag`). */
  grunnlag: string;
  tid: string;
  av: string;
  avNavn: string;
  /** Unik nøkkel for sporposten. */
  sporId: string;
}

/** Ny tilstand etter «Merk som kvalitetssikret»; tidligere spor bevares. */
export function medKvalitetssikring(
  forrige: Transaksjonskontroll | null,
  transaksjonId: string,
  h: Kontrollhandling,
): Transaksjonskontroll {
  const merke: KontrollMerke = {
    grunnlag: h.grunnlag,
    versjon: GRUNNLAG_VERSJON,
    tid: h.tid,
    av: h.av,
    avNavn: h.avNavn,
  };
  return {
    transaksjonId,
    gjeldende: merke,
    spor: { ...(forrige?.spor ?? {}), [h.sporId]: { ...merke, handling: "kvalitetssikret" } },
  };
}

/** Ny tilstand etter «Opphev»; tidligere spor bevares. */
export function utenKvalitetssikring(
  forrige: Transaksjonskontroll | null,
  transaksjonId: string,
  h: Kontrollhandling,
): Transaksjonskontroll {
  return {
    transaksjonId,
    gjeldende: null,
    spor: {
      ...(forrige?.spor ?? {}),
      [h.sporId]: {
        grunnlag: h.grunnlag,
        versjon: GRUNNLAG_VERSJON,
        tid: h.tid,
        av: h.av,
        avNavn: h.avNavn,
        handling: "opphevet",
      },
    },
  };
}

/** Er den gjeldende kontrollen den samme som brukeren så (samtidighetsvakt)? */
export function sammeGjeldende(a: KontrollMerke | null, b: KontrollMerke | null): boolean {
  if (!a || !b) return !a && !b;
  return a.grunnlag === b.grunnlag && a.tid === b.tid && a.av === b.av;
}

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4), synkron, for UTF-8-tekst. Synkron fordi statusen
// avledes for hver rad ved rendering; WebCrypto er bare asynkron.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(tekst: string): string {
  const data = new TextEncoder().encode(tekst);
  const bitLengde = data.length * 8;
  const lengde = (((data.length + 9 + 63) >> 6) << 6) >>> 0;
  const buf = new Uint8Array(lengde);
  buf.set(data);
  buf[data.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(lengde - 8, Math.floor(bitLengde / 0x100000000));
  dv.setUint32(lengde - 4, bitLengde >>> 0);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < lengde; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15]!;
      const w2 = W[i - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = [H[0]!, H[1]!, H[2]!, H[3]!, H[4]!, H[5]!, H[6]!, H[7]!];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + W[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]! + a) >>> 0;
    H[1] = (H[1]! + b) >>> 0;
    H[2] = (H[2]! + c) >>> 0;
    H[3] = (H[3]! + d) >>> 0;
    H[4] = (H[4]! + e) >>> 0;
    H[5] = (H[5]! + f) >>> 0;
    H[6] = (H[6]! + g) >>> 0;
    H[7] = (H[7]! + h) >>> 0;
  }
  return [...H].map((x) => x.toString(16).padStart(8, "0")).join("");
}
