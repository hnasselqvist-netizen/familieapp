/**
 * Skrivefri kontroll av rå `families/{f}/shopping` — grunnlinjen før en
 * eventuell overgang til én aktiv skriver av handlelisten. Den ENE
 * klassifiseringen bak MCP-verktøyet `shopping_cutover_kontroll`; andre
 * verktøy skal gjenbruke den, aldri lage en parallell, forenklet variant.
 * Ren: ingen I/O, ingen Firebase, ingen transport. Returnerer bare
 * tellinger, ja/nei, stoppgrunner og en digest — aldri navn, mengder eller
 * andre verdier fra listen. Se README §«Cutover-kontroll for handlelisten».
 */
import { createHash } from "node:crypto";

export const MARKOR_NOKKEL = "_skriver";

/**
 * Det eneste gyldige formatet for skrivermarkøren `shopping/_skriver`.
 * Vareformet (streng-`name`, `done: true`) fordi legacy leser
 * `Object.values(shopping)`; ingen `id`, så legacy-helnodeskriving aldri bærer
 * den med seg. Alt annet under `_skriver` rapporteres som `markor: "feil"`.
 */
export const HANDLELISTE_MARKOR = Object.freeze({
  versjon: "web-v2",
  name: "Handlelisten redigeres i den nye appen",
  cat: "Diverse",
  amount: "",
  done: true,
});

export type Obj = Record<string, unknown>;
export const erObjekt = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Deterministisk JSON: objektnøkler sortert rekursivt; array-rekkefølge beholdes. */
export function kanonisk(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => kanonisk(x ?? null)).join(",")}]`;
  if (erObjekt(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${kanonisk(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export function erMarkor(v: unknown): boolean {
  if (!erObjekt(v)) return false;
  const nokler = Object.keys(HANDLELISTE_MARKOR);
  return (
    Object.keys(v).length === nokler.length &&
    nokler.every((k) => v[k] === HANDLELISTE_MARKOR[k as keyof typeof HANDLELISTE_MARKOR])
  );
}

type Form = "mangler" | "objekt" | "array" | "ugyldig";
const formAv = (raw: unknown): Form =>
  raw === null || raw === undefined
    ? "mangler"
    : Array.isArray(raw)
      ? "array"
      : erObjekt(raw)
        ? "objekt"
        : "ugyldig";

/** Nøkkel → verdi slik RTDB lagrer noden (array-hull hoppes over). */
export function oppforinger(raw: unknown): [string, unknown][] {
  if (Array.isArray(raw)) {
    return raw.flatMap((v, i) => (v === null || v === undefined ? [] : [[String(i), v]]));
  }
  return erObjekt(raw) ? Object.entries(raw) : [];
}

const erOpsPost = (v: unknown) => erObjekt(v) && v.tool === "shopping_list_add_items";

export type StoppKode = "ugyldig_form" | "markor_avvik" | "historikk_uavklart";

/** Versjon av kontrollens format; økes ved endring i felt eller betydning. */
export const KONTROLL_FORMAT = 2;

export interface Handlelistekontroll {
  form: Form;
  strukturOk: boolean;
  markor: "ok" | "mangler" | "feil";
  antallVarer: number;
  antallFullfort: number;
  antallUtenNavn: number;
  /**
   * Poster under vanlige nøkler (ikke `_`, ikke «undefined») uten ikke-tom
   * streng-`id`. Legacy skriver hele noden nøklet på `i.id`, så alle slike
   * havner under «undefined» og kolliderer: bare én overlever. Ikke stopp før
   * overgangen (serververnet sperrer legacy), men et vilkår før legacy får
   * skrive igjen.
   */
  antallUtenId: number;
  /** Innholdet under nøkkelen «undefined» (legacy-helnode av elementer uten `id`). */
  undefinedForm: "mangler" | "ops" | "markor" | "vare" | "annet";
  antallOps: number;
  /** Poster (av alle slag, også navnløse og «undefined») med gyldig `sammenslaing.opId`. */
  antallSammenslatt: number;
  antallAngremerker: number;
  /** Poster med `sammenslaing`/`sammenslaingAngret` i en form verktøyet ikke kan tolke. */
  antallHistorikkUavklart: number;
  /**
   * Stoppvilkår (tom = OK): ugyldig form, avvikende markør eller uavklart
   * historikk. Manglende markør er forventet før overgangen og er IKKE stopp.
   */
  stopp: string[];
  /** Samme stoppgrunner som maskinlesbare koder, i samme rekkefølge. */
  stoppKoder: StoppKode[];
  /** sha256 av kanonisk JSON av noden uten markøren. */
  digestUtenMarkor: string;
}

/** Skrivefri kontroll av rå `shopping`-node. Returnerer aldri listeinnhold. */
export function kontrollerHandleliste(raw: unknown): Handlelistekontroll {
  const form = formAv(raw);
  let antallVarer = 0;
  let antallFullfort = 0;
  let antallUtenNavn = 0;
  let antallUtenId = 0;
  let antallSammenslatt = 0;
  let antallAngremerker = 0;
  let antallHistorikkUavklart = 0;
  let undefinedForm: Handlelistekontroll["undefinedForm"] = "mangler";
  let markor: Handlelistekontroll["markor"] = "mangler";
  let antallOps = 0;
  const utenMarkor: Obj = {};

  for (const [k, v] of oppforinger(raw)) {
    if (k === MARKOR_NOKKEL) {
      markor = erMarkor(v) ? "ok" : "feil";
      continue;
    }
    utenMarkor[k] = v;
    // Historikk telles på HVER post, før noen klassifisering: en navnløs
    // post eller «undefined» med sammenslåingshistorikk er fortsatt historikk.
    if (k !== "_ops" && erObjekt(v)) {
      if ("sammenslaing" in v) {
        const h = v.sammenslaing;
        if (erObjekt(h) && typeof h.opId === "string" && h.opId !== "") antallSammenslatt += 1;
        else antallHistorikkUavklart += 1;
      }
      if ("sammenslaingAngret" in v) {
        if (erObjekt(v.sammenslaingAngret)) {
          antallAngremerker += Object.keys(v.sammenslaingAngret).length;
        } else {
          antallHistorikkUavklart += 1;
        }
      }
    }
    if (k === "_ops") {
      antallOps = erObjekt(v) ? Object.keys(v).length : 0;
      continue;
    }
    if (k.startsWith("_")) continue;
    if (k === "undefined") {
      undefinedForm = erMarkor(v)
        ? "markor"
        : erObjekt(v) && typeof v.name === "string"
          ? "vare"
          : erObjekt(v) && Object.keys(v).length > 0 && Object.values(v).every(erOpsPost)
            ? "ops"
            : "annet";
      continue;
    }
    if (!erObjekt(v) || typeof v.id !== "string" || v.id === "") antallUtenId += 1;
    if (!erObjekt(v) || typeof v.name !== "string") {
      antallUtenNavn += 1;
      continue;
    }
    antallVarer += 1;
    if (v.done === true) antallFullfort += 1;
  }

  // Array og objekt sammenlignes i samme nøkkelform (RTDB lagrer begge som
  // nøkler), så en array-node som får markøren ikke gir falskt avvik.
  const grunnlag = form === "ugyldig" ? raw : utenMarkor;
  const stopp: string[] = [];
  const stoppKoder: StoppKode[] = [];
  if (form === "ugyldig") {
    stopp.push("Handlelisten har ugyldig form.");
    stoppKoder.push("ugyldig_form");
  }
  if (markor === "feil") {
    stopp.push("Markøren avviker fra det avtalte formatet.");
    stoppKoder.push("markor_avvik");
  }
  if (antallHistorikkUavklart > 0) {
    stopp.push(
      `${antallHistorikkUavklart} post(er) har sammenslåingshistorikk som ikke kan tolkes.`,
    );
    stoppKoder.push("historikk_uavklart");
  }
  return {
    form,
    strukturOk: form !== "ugyldig",
    markor,
    antallVarer,
    antallFullfort,
    antallUtenNavn,
    antallUtenId,
    undefinedForm,
    antallOps,
    antallSammenslatt,
    antallAngremerker,
    antallHistorikkUavklart,
    stopp,
    stoppKoder,
    digestUtenMarkor: createHash("sha256").update(kanonisk(grunnlag)).digest("hex"),
  };
}
