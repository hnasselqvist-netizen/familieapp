/**
 * Lagret kvitteringsbilde i `receipts[].imageUrl` (#59, skive A).
 *
 * Legacy Bankimports «Legg til kvittering» (`index.html` ~7258–7284,
 * pensjonert ved R3b-cutover D3) skrev bildet som en base64-data-URL fra
 * `FileReader.readAsDataURL` rett inn i RTDB. Verken legacy eller React har
 * noen gang vist det. Denne modulen avgjør om verdien er et trygt rasterbilde
 * og gir originalbytene tilbake — uten å endre noe.
 *
 * Verdien kommer fra databasen og behandles som upålitelig:
 *  - bare eksplisitt tillatte rastertyper (jpeg/png/webp/gif) — aldri SVG,
 *    HTML, andre URI-skjemaer eller annet innhold;
 *  - lengden avgrenses FØR dekoding, så et for stort felt aldri dekodes;
 *  - base64 må være kanonisk (riktig alfabet, lengde og utfylling);
 *  - de dekodede bytene må ha filsignaturen til den oppgitte typen.
 *
 * Nettleserens egen dekoding (`<img>` `onError`) er siste kontroll i
 * visningen. Bildet logges aldri.
 */

export const TILLATTE_BILDETYPER = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

export type Bildetype = keyof typeof TILLATTE_BILDETYPER;

/** Største bildet som dekodes og vises (originalbytes). */
export const MAKS_BILDE_BYTES = 10 * 1024 * 1024;

/** Største base64-lengde som kan gi høyst `MAKS_BILDE_BYTES`. */
export const MAKS_BASE64_LENGDE = Math.ceil(MAKS_BILDE_BYTES / 3) * 4;

export type BildeAvvisning =
  "ugyldig_format" | "ikke_tillatt_type" | "for_stort" | "ugyldig_base64" | "signatur_avvik";

export type Kvitteringsbilde =
  | { status: "mangler" }
  | { status: "avvist"; grunn: BildeAvvisning }
  | { status: "ok"; type: Bildetype; filendelse: string; bytes: Uint8Array };

const PREFIKS = "data:";
const BASE64_MARKOR = ";base64,";
/** Lengste tillatte overskrift: `data:image/jpeg;base64,`. */
const MAKS_OVERSKRIFT = 40;
const BASE64_TEGN = /^[A-Za-z0-9+/]*={0,2}$/;

const erTillattType = (t: string): t is Bildetype =>
  Object.prototype.hasOwnProperty.call(TILLATTE_BILDETYPER, t);

const starterMed = (b: Uint8Array, signatur: readonly number[], fra = 0) =>
  b.length >= fra + signatur.length && signatur.every((v, i) => b[fra + i] === v);

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Stemmer de første bytene med filsignaturen til typen? */
export function harSignatur(type: Bildetype, b: Uint8Array): boolean {
  switch (type) {
    case "image/jpeg":
      return starterMed(b, [0xff, 0xd8, 0xff]);
    case "image/png":
      return starterMed(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif":
      return starterMed(b, ascii("GIF87a")) || starterMed(b, ascii("GIF89a"));
    case "image/webp":
      return starterMed(b, ascii("RIFF")) && starterMed(b, ascii("WEBP"), 8);
  }
}

/**
 * Tolker `imageUrl`. `mangler` når feltet er tomt/fraværende; ellers `ok`
 * med originalbytene, eller `avvist` med grunnen. Kaster aldri.
 */
export function tolkKvitteringsbilde(imageUrl: unknown): Kvitteringsbilde {
  if (imageUrl === undefined || imageUrl === null || imageUrl === "") {
    return { status: "mangler" };
  }
  if (typeof imageUrl !== "string" || !imageUrl.startsWith(PREFIKS)) {
    return { status: "avvist", grunn: "ugyldig_format" };
  }
  // Søk bare i overskriften: et stort felt uten komma skannes ikke.
  const komma = imageUrl.slice(0, MAKS_OVERSKRIFT + 1).indexOf(",");
  if (komma === -1 || komma > MAKS_OVERSKRIFT) {
    return { status: "avvist", grunn: "ugyldig_format" };
  }
  const overskrift = imageUrl.slice(0, komma + 1);
  if (!overskrift.endsWith(BASE64_MARKOR)) {
    return { status: "avvist", grunn: "ugyldig_format" };
  }
  const type = overskrift.slice(PREFIKS.length, -BASE64_MARKOR.length);
  if (!erTillattType(type)) return { status: "avvist", grunn: "ikke_tillatt_type" };

  const data = imageUrl.slice(komma + 1);
  if (data.length > MAKS_BASE64_LENGDE) return { status: "avvist", grunn: "for_stort" };
  if (data.length === 0 || data.length % 4 !== 0 || !BASE64_TEGN.test(data)) {
    return { status: "avvist", grunn: "ugyldig_base64" };
  }

  let binaer: string;
  try {
    binaer = atob(data);
  } catch {
    return { status: "avvist", grunn: "ugyldig_base64" };
  }
  if (binaer.length > MAKS_BILDE_BYTES) return { status: "avvist", grunn: "for_stort" };
  const bytes = new Uint8Array(binaer.length);
  for (let i = 0; i < binaer.length; i++) bytes[i] = binaer.charCodeAt(i);

  if (!harSignatur(type, bytes)) return { status: "avvist", grunn: "signatur_avvik" };
  return { status: "ok", type, filendelse: TILLATTE_BILDETYPER[type], bytes };
}

/**
 * Trygt generert filnavn for nedlasting. Kvitteringen har ikke noe lagret
 * originalfilnavn for disse bildene, så navnet utgis ikke for å være det.
 */
export function filnavnForKvitteringsbilde(
  r: { id?: unknown; purchaseDate?: unknown },
  filendelse: string,
): string {
  const dato =
    typeof r.purchaseDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.purchaseDate)
      ? r.purchaseDate.slice(0, 10)
      : "uten-dato";
  const id = typeof r.id === "string" ? r.id.replace(/[^A-Za-z0-9-]/g, "").slice(0, 12) : "";
  return `kvittering-${dato}${id ? `-${id}` : ""}.${filendelse}`;
}
