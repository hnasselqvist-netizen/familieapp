/**
 * Kvitteringsvedlegg (#59, skive B1) — transportuavhengig kjerne for den
 * separate filtjenesten (S2(b), 6546642665). Ingen I/O her: tokenverifisering,
 * medlemskap og objektlager kommer inn som porter, så samme kjerne testes mot
 * falske porter og mot emulatoren.
 *
 * Tilgang avgjøres PER FORESPØRSEL fra ÉN kilde: et verifisert Firebase
 * ID-token (med tilbakekallingssjekk) og dagens `families/{f}/members/{uid}`.
 * Familien i stien stoles ikke på alene — den må være en familie brukeren er
 * medlem av akkurat nå.
 *
 * Innholdet avgjøres av BYTENE, aldri av klientens MIME: kun JPEG, PNG,
 * WebP og PDF med gyldig signatur. Objektstien er innholdsadressert
 * (`families/{f}/kvitteringer/{receiptId}/{sha256}`) og skrives med
 * opprett-bare-betingelse: identisk retry gir samme sti og overskriver aldri.
 * Ingenting slettes, heller ikke foreldreløse objekter.
 */
import { createHash } from "node:crypto";

export type VedleggType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

/** Signatur fra de første bytene; `null` = ikke støttet (SVG, HTML, ukjent …). */
export function gjenkjennType(b: Uint8Array): VedleggType | null {
  const s = (i: number, ...v: number[]) => v.every((x, j) => b[i + j] === x);
  if (b.length >= 3 && s(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (b.length >= 8 && s(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (b.length >= 12 && s(0, 0x52, 0x49, 0x46, 0x46) && s(8, 0x57, 0x45, 0x42, 0x50)) {
    return "image/webp";
  }
  if (b.length >= 5 && s(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  return null;
}

const TRYGG_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export const erTryggId = (s: string): boolean => TRYGG_ID.test(s);
export const erSha256 = (s: string): boolean => SHA256.test(s);

export const objektsti = (familyId: string, receiptId: string, sha256: string): string =>
  `families/${familyId}/kvitteringer/${receiptId}/${sha256}`;

/** Standard øvre grense (byte). Kan settes lavere/høyere i config; se aktiveringsvedlegget. */
export const STANDARD_MAKS_BYTES = 10 * 1024 * 1024;

// ── Porter ──────────────────────────────────────────────────────────
export interface TokenVerifiserer {
  /** Verifiserer et Firebase ID-token (inkl. tilbakekalling) → uid. Kaster ved ugyldig. */
  uid(idToken: string): Promise<string>;
}
export interface Medlemskap {
  erMedlem(familyId: string, uid: string): Promise<boolean>;
}
export interface Objektlager {
  /** Oppretter objektet bare hvis stien er ledig. */
  opprettHvisLedig(
    sti: string,
    bytes: Uint8Array,
    type: VedleggType,
  ): Promise<"opprettet" | "fantes">;
  les(sti: string): Promise<{ bytes: Uint8Array; type: VedleggType } | null>;
}
export interface VedleggPorter {
  token: TokenVerifiserer;
  medlemskap: Medlemskap;
  lager: Objektlager;
  maksBytes: number;
}

// ── Feil ────────────────────────────────────────────────────────────
export type VedleggFeilKode =
  | "mangler_token"
  | "ugyldig_token"
  | "ikke_medlem"
  | "ugyldig_sti"
  | "for_stor"
  | "tom"
  | "ikke_stottet"
  | "finnes_ikke";

const STATUS: Record<VedleggFeilKode, number> = {
  mangler_token: 401,
  ugyldig_token: 401,
  ikke_medlem: 403,
  ugyldig_sti: 400,
  for_stor: 413,
  tom: 400,
  ikke_stottet: 415,
  finnes_ikke: 404,
};

export class VedleggFeil extends Error {
  readonly kode: VedleggFeilKode;
  readonly status: number;
  constructor(kode: VedleggFeilKode, melding: string) {
    super(melding);
    this.name = "VedleggFeil";
    this.kode = kode;
    this.status = STATUS[kode];
  }
}

// ── Autorisasjon ────────────────────────────────────────────────────
/** Bearer-token → uid → dagens medlemskap i NETTOPP denne familien. */
export async function autoriser(
  porter: VedleggPorter,
  authorization: string | undefined,
  familyId: string,
): Promise<string> {
  const m = /^Bearer (\S+)$/.exec(authorization ?? "");
  if (!m) throw new VedleggFeil("mangler_token", "Mangler innlogging.");
  let uid: string;
  try {
    uid = await porter.token.uid(m[1]!);
  } catch {
    throw new VedleggFeil("ugyldig_token", "Innloggingen er ugyldig eller utløpt.");
  }
  if (!erTryggId(familyId)) throw new VedleggFeil("ugyldig_sti", "Ugyldig familie.");
  if (!(await porter.medlemskap.erMedlem(familyId, uid))) {
    throw new VedleggFeil("ikke_medlem", "Ingen tilgang til denne familien.");
  }
  return uid;
}

// ── Opplasting / nedlasting ─────────────────────────────────────────
export interface LagretVedlegg {
  sha256: string;
  type: VedleggType;
  storrelse: number;
  status: "opprettet" | "fantes";
}

/**
 * Lagrer originalbytene etter at størrelse og signatur er sjekket.
 * `bytes` er allerede lest med grense av transportlaget; grensen sjekkes
 * likevel her (forsvar i dybden).
 */
export async function lagreVedlegg(
  porter: VedleggPorter,
  ref: { familyId: string; receiptId: string },
  bytes: Uint8Array,
): Promise<LagretVedlegg> {
  if (!erTryggId(ref.receiptId)) throw new VedleggFeil("ugyldig_sti", "Ugyldig kvittering.");
  if (bytes.length === 0) throw new VedleggFeil("tom", "Filen er tom.");
  if (bytes.length > porter.maksBytes) {
    throw new VedleggFeil("for_stor", "Filen er for stor.");
  }
  const type = gjenkjennType(bytes);
  if (!type) {
    throw new VedleggFeil(
      "ikke_stottet",
      "Bare JPEG, PNG, WebP og PDF kan lagres. Filen ble ikke lagret.",
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const status = await porter.lager.opprettHvisLedig(
    objektsti(ref.familyId, ref.receiptId, sha256),
    bytes,
    type,
  );
  return { sha256, type, storrelse: bytes.length, status };
}

export async function hentVedlegg(
  porter: VedleggPorter,
  ref: { familyId: string; receiptId: string; sha256: string },
): Promise<{ bytes: Uint8Array; type: VedleggType }> {
  if (!erTryggId(ref.receiptId) || !erSha256(ref.sha256)) {
    throw new VedleggFeil("ugyldig_sti", "Ugyldig vedlegg.");
  }
  const funnet = await porter.lager.les(objektsti(ref.familyId, ref.receiptId, ref.sha256));
  if (!funnet) throw new VedleggFeil("finnes_ikke", "Vedlegget finnes ikke.");
  return funnet;
}

/**
 * Sikre innholdshoder: aldri tolket som annet enn det signaturen sier, aldri
 * kjørbart innhold, ikke mellomlagret i delte cacher. PDF leveres som
 * nedlasting; bilder kan vises.
 */
export function innholdshoder(type: VedleggType, sha256: string): Record<string, string> {
  const filnavn = `kvittering-${sha256.slice(0, 12)}.${
    { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[
      type
    ]
  }`;
  return {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Disposition":
      type === "application/pdf"
        ? `attachment; filename="${filnavn}"`
        : `inline; filename="${filnavn}"`,
  };
}
