/**
 * Overgangsverktøy for handlelisten (ADR 0003, FORSLAG — #77 review
 * 6356624432 pkt. 3). To operasjoner på `families/{f}/shopping`:
 *
 *  - `kontrollerHandleliste`: skrivefri kontroll. Bare tellinger, ja/nei og
 *    en digest — aldri navn, mengder eller andre verdier fra listen.
 *  - `planMarkor` + `kjorMarkor`: idempotent markørsteg (`sett`/`fjern`) i én
 *    transaksjon på hele noden. Alle andre rådata bevares byte-likt.
 *
 * Sikkerhetsegenskaper (alle testet, også mot emulatoren):
 *  - Tørrkjøring er standard; bare `apply` skriver.
 *  - En eksisterende markør som avviker fra fixture-formatet overskrives
 *    eller fjernes ALDRI. Ugyldig form (primitiv verdi) gir avslag.
 *  - Med `forventetDigest` (fra en kontroll) skrives ingenting hvis listen
 *    er endret siden: avvik betyr «undersøk», aldri automatisk gjenoppretting.
 *  - Transaksjonen returnerer alltid en konkret verdi (aldri `undefined`),
 *    så en kald cache aldri gir en beslutning tatt mot feil tilstand.
 *  - Etter skriving leses noden på nytt; avvik rapporteres, rettes aldri.
 *
 * Ingen produksjonskjøring er besluttet. CLI-en (`handlelisteOvergangCli.ts`)
 * har samme produksjonsvern som `add-member`.
 */
import { createHash } from "node:crypto";
import { assertSafeFamilyId, shoppingPath } from "../store/paths";

export const MARKOR_NOKKEL = "_skriver";

/** Må være lik `infra/firebase/forslag/handleliste-skrivemarkor.markor.json` (testet). */
export const HANDLELISTE_MARKOR = Object.freeze({
  versjon: "web-v2",
  name: "Handlelisten redigeres i den nye appen",
  cat: "Diverse",
  amount: "",
  done: true,
});

type Obj = Record<string, unknown>;
const erObjekt = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

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
function oppforinger(raw: unknown): [string, unknown][] {
  if (Array.isArray(raw)) {
    return raw.flatMap((v, i) => (v === null || v === undefined ? [] : [[String(i), v]]));
  }
  return erObjekt(raw) ? Object.entries(raw) : [];
}

const erOpsPost = (v: unknown) => erObjekt(v) && v.tool === "shopping_list_add_items";

export interface Handlelistekontroll {
  form: Form;
  strukturOk: boolean;
  markor: "ok" | "mangler" | "feil";
  antallVarer: number;
  antallFullfort: number;
  antallUtenNavn: number;
  /** Innholdet under nøkkelen «undefined» (legacy-helnode av elementer uten `id`). */
  undefinedForm: "mangler" | "ops" | "markor" | "vare" | "annet";
  antallOps: number;
  antallSammenslatt: number;
  antallAngremerker: number;
  /** sha256 av kanonisk JSON av noden uten markøren. */
  digestUtenMarkor: string;
}

/** Skrivefri kontroll av rå `shopping`-node. Returnerer aldri listeinnhold. */
export function kontrollerHandleliste(raw: unknown): Handlelistekontroll {
  const form = formAv(raw);
  let antallVarer = 0;
  let antallFullfort = 0;
  let antallUtenNavn = 0;
  let antallSammenslatt = 0;
  let antallAngremerker = 0;
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
    if (!erObjekt(v) || typeof v.name !== "string") {
      antallUtenNavn += 1;
      continue;
    }
    antallVarer += 1;
    if (v.done === true) antallFullfort += 1;
    const h = v.sammenslaing;
    if (erObjekt(h) && typeof h.opId === "string") antallSammenslatt += 1;
    if (erObjekt(v.sammenslaingAngret))
      antallAngremerker += Object.keys(v.sammenslaingAngret).length;
  }

  // Array og objekt sammenlignes i samme nøkkelform (RTDB lagrer begge som
  // nøkler), så en array-node som får markøren ikke gir falskt avvik.
  const grunnlag = form === "ugyldig" ? raw : utenMarkor;
  return {
    form,
    strukturOk: form !== "ugyldig",
    markor,
    antallVarer,
    antallFullfort,
    antallUtenNavn,
    undefinedForm,
    antallOps,
    antallSammenslatt,
    antallAngremerker,
    digestUtenMarkor: createHash("sha256").update(kanonisk(grunnlag)).digest("hex"),
  };
}

export type MarkorModus = "sett" | "fjern";
export type MarkorPlan =
  { utfall: "skriv"; neste: unknown } | { utfall: "allerede" } | { utfall: "nekt"; grunn: string };

/** Ren beslutning mot DENNE verdien av noden. */
export function planMarkor(raw: unknown, modus: MarkorModus, forventetDigest?: string): MarkorPlan {
  const k = kontrollerHandleliste(raw);
  if (!k.strukturOk) {
    return { utfall: "nekt", grunn: "Handlelisten har ugyldig form. Ingenting skrives." };
  }
  if (forventetDigest !== undefined && k.digestUtenMarkor !== forventetDigest) {
    return {
      utfall: "nekt",
      grunn:
        "Handlelisten er endret siden kontrollen (digest avviker). Undersøk; ingenting skrives eller gjenopprettes.",
    };
  }
  if (k.markor === "feil") {
    return {
      utfall: "nekt",
      grunn: "Det finnes en avvikende markør. Den overskrives eller fjernes ikke.",
    };
  }
  const rest = Object.fromEntries(oppforinger(raw).filter(([key]) => key !== MARKOR_NOKKEL));
  if (modus === "sett") {
    if (k.markor === "ok") return { utfall: "allerede" };
    return { utfall: "skriv", neste: { ...rest, [MARKOR_NOKKEL]: { ...HANDLELISTE_MARKOR } } };
  }
  if (k.markor === "mangler") return { utfall: "allerede" };
  return { utfall: "skriv", neste: Object.keys(rest).length > 0 ? rest : null };
}

/** Kun det utføreren trenger av databasen (admin-SDK i produksjon/emulator). */
export interface OvergangDb {
  read(path: string): Promise<unknown>;
  /** Transaksjon på `path`. `update` returnerer alltid en konkret verdi. */
  transact(path: string, update: (current: unknown) => unknown): Promise<void>;
}

export async function kjorKontroll(db: OvergangDb, familyId: string) {
  const path = shoppingPath(assertSafeFamilyId(familyId));
  return { familyId, path, kontroll: kontrollerHandleliste(await db.read(path)) };
}

export interface MarkorResultat {
  familyId: string;
  modus: MarkorModus;
  dryRun: boolean;
  utfall: MarkorPlan["utfall"];
  grunn?: string;
  foer: Handlelistekontroll;
  etter?: Handlelistekontroll;
  /** Tomt når alt stemmer. Avvik betyr «stopp og undersøk» — aldri gjenopprett. */
  avvik: string[];
}

export async function kjorMarkor(
  db: OvergangDb,
  req: { familyId: string; modus: MarkorModus; apply: boolean; forventetDigest?: string },
): Promise<MarkorResultat> {
  const path = shoppingPath(assertSafeFamilyId(req.familyId));
  const raw = await db.read(path);
  const foer = kontrollerHandleliste(raw);
  const plan = planMarkor(raw, req.modus, req.forventetDigest);
  const base = {
    familyId: req.familyId,
    modus: req.modus,
    foer,
    ...(plan.utfall === "nekt" ? { grunn: plan.grunn } : {}),
  };
  if (!req.apply || plan.utfall !== "skriv") {
    return { ...base, dryRun: !req.apply, utfall: plan.utfall, avvik: [] };
  }

  let siste: { plan: MarkorPlan; digest: string } | undefined;
  await db.transact(path, (current) => {
    const p = planMarkor(current, req.modus, req.forventetDigest);
    siste = { plan: p, digest: kontrollerHandleliste(current).digestUtenMarkor };
    return p.utfall === "skriv" ? p.neste : (current ?? null);
  });
  const etter = kontrollerHandleliste(await db.read(path));
  const avvik: string[] = [];
  const endelig = siste!.plan;
  if (endelig.utfall === "skriv") {
    const forventetMarkor = req.modus === "sett" ? "ok" : "mangler";
    if (etter.markor !== forventetMarkor) avvik.push(`Markør er «${etter.markor}» etter skriving.`);
    if (etter.digestUtenMarkor !== siste!.digest) {
      avvik.push("Resten av handlelisten avviker fra grunnlaget for skrivingen. Undersøk.");
    }
  }
  return {
    familyId: req.familyId,
    modus: req.modus,
    dryRun: false,
    utfall: endelig.utfall,
    ...(endelig.utfall === "nekt" ? { grunn: endelig.grunn } : {}),
    foer,
    etter,
    avvik,
  };
}
