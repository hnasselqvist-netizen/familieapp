/**
 * Generell skriving til egen families data (`data_skriv`, scope `data:write`,
 * #27 6509067353 / kontrakt 6514058564 + 6514708855). Ren: ingen I/O.
 *
 * ## Kontrakten
 *
 * Et kall er `{ opId, ops }`, og alle operasjonene committes i ÉN RTDB-
 * transaksjon på `families/{f}` — alt eller ingenting, sammen med
 * kvitteringen i `families/{f}/_mcp/ops/{opId}`.
 *
 *  - `set`    — erstatter noden på `sti` med `verdi`. `forventet`: versjonen
 *               av noden.
 *  - `update` — erstatter bare de navngitte direkte barna (`verdi` er et
 *               objekt med ett segment per nøkkel; ingen flersti-nøkler).
 *               Urørte søsken bevares, også om appen endrer dem samtidig.
 *               `forventet`: én versjon per barn.
 *  - `slett`  — fjerner noden. `forventet`: versjonen av noden.
 *
 * Hver posisjon som skrives (`sti`, eller `sti/nøkkel` for `update`), må ha
 * forventet versjon fra `data_hent` (samme snapshot som verdien) eller
 * `"mangler"`. Avviker én, skrives ingenting (`konflikt`). Ingen null, tomme
 * objekter/arrays, ikke-endelige tall eller `-0` i `verdi` — RTDB ville
 * stille slettet eller endret dem; sletting gjøres eksplisitt med `slett`.
 * Nøkler valideres som stisegmenter, og `__proto__`/`constructor`/
 * `prototype` avvises. To posisjoner i samme kall kan ikke overlappe.
 * Er en forelder til en posisjon i dag en enkeltverdi, avvises kallet
 * (`forelder_er_verdi`) i stedet for at verdien stille erstattes.
 *
 * ## Beskyttede felt (eksakt liste: `BESKYTTET`)
 *
 * `_mcp` (kvitteringer), `members` (tilgangsstyring — ikke familiedata),
 * handlelistens `shopping/_skriver` og `shopping/_ops`, og
 * `transaksjonskontroller` («kvalitetssikret», #59). En posisjon på eller
 * under et beskyttet felt avvises. `set`/`slett` på en FORELDER bevarer
 * de beskyttede barna — avvikende fra ren RTDB: «set (bevarer beskyttede
 * barn)». `verdi` kan da ikke inneholde dem, og må være et objekt. Svaret
 * lister `bevart`, og `etter` er versjonen av den faktisk lagrede formen.
 *
 * ## Idempotens og utløp
 *
 * `opId` = `ÅÅÅÅ-MM-DD_<tilfeldig>`: datoen (UTC) er en del av id-en, så et
 * beskåret opId aldri kan bli nytt. Kjent opId → `replay` (samme payload og
 * principal) eller `idempotens_konflikt`; ingen ny skriving. Ukjent opId med
 * dato eldre enn 30 dager, eller ≤ `_mcp/vannmerke` (siste beskårne dato),
 * → `utlopt`. Dato mer enn én dag fram → ugyldig (klokkeavvik). Kvitteringer
 * eldre enn 31 dager beskjæres KUN i en ny, committet skriving.
 */
import { createHash } from "node:crypto";
import { encodeKey } from "../store/paths";
import { parseSti, UgyldigSti } from "./sti";
import { kanoniskJson, lagringsform, MANGLER, MCP_NOKKEL, settEgen, versjonAv } from "./versjon";

export type SkriveType = "set" | "update" | "slett";

export interface SkriveOpInn {
  sti: string;
  type: SkriveType;
  verdi?: unknown;
  forventet: string | Record<string, string>;
}

export interface SkriveInn {
  opId: string;
  ops: SkriveOpInn[];
}

/** Én posisjon som skrives: `update` gir én per barn. */
export interface Posisjon {
  segmenter: string[];
  type: SkriveType;
  /** Lagringsform; `undefined` = slett. */
  ny: unknown;
  forventet: string;
  /** `verdi` var en liste (RTDB lagrer den som indeksobjekt). */
  liste?: boolean;
}

export interface ForberedtSkriving {
  opId: string;
  dato: string;
  fp: string;
  posisjoner: Posisjon[];
}

export interface Principal {
  sub: string;
  uid: string;
  client: string;
}

export interface SkrivingUtfall {
  sti: string;
  type: SkriveType;
  foer: string;
  etter: string;
  /** Beskyttede felt (relativt til familien) som ble bevart under posisjonen. */
  bevart: string[];
}

/** `families/{f}/_mcp/ops/{opId}` — skrevet i samme transaksjon som dataene. */
export interface Kvittering {
  fp: string;
  sub: string;
  uid: string;
  client: string;
  at: number;
  skrivinger: SkrivingUtfall[];
}

export type Avvik = { sti: string; forventet: string; faktisk: string };

export type Beslutning =
  | { kind: "apply"; neste: Record<string, unknown>; kvittering: Kvittering }
  | { kind: "replay"; kvittering: Kvittering }
  | { kind: "idempotens_konflikt" }
  | { kind: "ikke_medlem" }
  | { kind: "utlopt" }
  | { kind: "for_stor"; grunn: "lesing" | "skriving"; bytes: number; grense: number }
  | { kind: "forelder_er_verdi"; sti: string }
  | { kind: "konflikt"; avvik: Avvik[] };

export const BESKYTTET: readonly (readonly string[])[] = [
  [MCP_NOKKEL],
  ["members"],
  ["shopping", "_skriver"],
  ["shopping", "_ops"],
  // «Kvalitetssikret» (#59, 6542594363) settes bare av en innlogget bruker i
  // appen mot grunnlaget hun faktisk så — ikke av ChatGPT. Lesing er lov.
  ["transaksjonskontroller"],
];

export const MAKS_OPERASJONER = 100;
/**
 * Samlet størrelse på `verdi` i ett kall. Samordnet med HTTP-lagets grense
 * for hele forespørselen (256 KiB, `http/app.ts` §maxBodyBytes) med plass
 * til JSON-RPC-konvolutten: et kall over HTTP-grensen får 413 før noe leses
 * eller skrives (#85-review 5710037222). Økes bare sammen med HTTP-grensen,
 * etter en egen beslutning.
 */
export const MAKS_SKRIV_BYTES = 200_000;
/**
 * Skrivebudsjett: Admin SDK-transaksjonen sender HELE familienoden som én
 * write, og Firebase tillater 16 MB per write fra SDK-ene
 * (https://firebase.google.com/docs/database/usage/limits). Den komplette
 * kandidaten — data, kvittering og beskjæring — kontrolleres mot en
 * konservativ grense under det FØR commit. Skrivefritt målt 30.10.2026:
 * ca. 8,1 MB (mest `_fase4_backup` og kvitteringsbilder).
 */
export const MAKS_FAMILIE_SKRIVE_BYTES = 15_000_000;
/**
 * Lesebudsjett: hvor stor familienode serveren laster i transaksjonen
 * (minne). Høyere enn skrivebudsjettet, så en endring som gjør en for stor
 * familie mindre, fortsatt kan gjøres med verktøyet.
 */
export const MAKS_FAMILIE_LESE_BYTES = 64_000_000;
/** Firebase-SDK-ets grense for én tekstverdi (`validateFirebaseData`, verifisert mot emulatoren). */
export const MAKS_TEKST_BYTES = 10_485_760;
/** RTDB tillater 32 nivåer; `families/{f}` bruker to. */
const MAKS_TOTAL_DYBDE = 30;
const FORBUDTE_NOKLER = new Set(["__proto__", "constructor", "prototype"]);
const DAG_MS = 24 * 60 * 60 * 1000;
export const UTLOP_DAGER = 30;
export const BESKJAER_DAGER = 31;

const OPID = /^(\d{4}-\d{2}-\d{2})_[A-Za-z0-9-]{8,80}$/;
const VERSJON = /^v1-[0-9a-f]{32}$/;

export type UgyldigKode = "ugyldig_skriving" | "invalid_path" | "beskyttet";

export class UgyldigSkriving extends Error {
  readonly code: UgyldigKode;
  constructor(code: UgyldigKode, message: string) {
    super(message);
    this.code = code;
    this.name = "UgyldigSkriving";
  }
}

const erObjekt = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const dagAv = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const stiAv = (segmenter: readonly string[]) => segmenter.join("/");

const erPrefiks = (a: readonly string[], b: readonly string[]) =>
  a.length <= b.length && a.every((s, i) => s === b[i]);

// --- Validering (før transaksjonen) -----------------------------------------

function sti(s: string): string[] {
  try {
    return parseSti(s);
  } catch (err) {
    if (err instanceof UgyldigSti) throw new UgyldigSkriving("invalid_path", err.message);
    throw err;
  }
}

function nokkel(k: string, hvor: string): void {
  if (FORBUDTE_NOKLER.has(k)) {
    throw new UgyldigSkriving("ugyldig_skriving", `Nøkkelen «${k}» er ikke tillatt (${hvor}).`);
  }
  if (k === "") {
    throw new UgyldigSkriving("ugyldig_skriving", `Tom nøkkel er ikke tillatt (${hvor}).`);
  }
  if (k.includes("/")) {
    throw new UgyldigSkriving("ugyldig_skriving", `En nøkkel kan ikke inneholde «/» (${hvor}).`);
  }
  try {
    parseSti(k);
  } catch (err) {
    if (err instanceof UgyldigSti) {
      throw new UgyldigSkriving("ugyldig_skriving", `Ugyldig nøkkel (${hvor}): ${err.message}`);
    }
    throw err;
  }
}

/** Returnerer dybden (0 for en enkeltverdi). */
function validerVerdi(v: unknown, hvor: string): number {
  const feil = (m: string) => new UgyldigSkriving("ugyldig_skriving", `${m} (${hvor}).`);
  if (v === null || v === undefined) {
    throw feil("null/tom verdi er ikke tillatt — bruk «slett» for å fjerne noe");
  }
  if (typeof v === "string") {
    if (Buffer.byteLength(v, "utf8") > MAKS_TEKST_BYTES) {
      throw feil(`Tekst over ${MAKS_TEKST_BYTES} byte avvises av Firebase`);
    }
    return 0;
  }
  if (typeof v === "boolean") return 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw feil("Tall må være endelige");
    if (Object.is(v, -0)) throw feil("-0 er ikke tillatt (RTDB lagrer det som 0)");
    return 0;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) throw feil("Tomme lister lagres ikke av RTDB");
    let dybde = 0;
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) throw feil("Lister kan ikke ha hull");
      dybde = Math.max(dybde, validerVerdi(v[i], `${hvor}[${i}]`));
    }
    return dybde + 1;
  }
  if (erObjekt(v)) {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw feil("Bare rene JSON-objekter");
    const nokler = Object.keys(v);
    if (nokler.length === 0) throw feil("Tomme objekter lagres ikke av RTDB");
    let dybde = 0;
    for (const k of nokler) {
      nokkel(k, hvor);
      dybde = Math.max(dybde, validerVerdi(v[k], `${hvor}/${k}`));
    }
    return dybde + 1;
  }
  throw feil("Bare tekst, tall, sann/usann, objekter og lister");
}

function versjon(v: unknown, hvor: string): string {
  if (typeof v !== "string" || (v !== MANGLER && !VERSJON.test(v))) {
    throw new UgyldigSkriving(
      "ugyldig_skriving",
      `«forventet» må være en versjon fra data_hent eller «${MANGLER}» (${hvor}).`,
    );
  }
  return v;
}

/** Finnes det en verdi på `rel` inne i `v` (lagringsform)? */
function harPaa(v: unknown, rel: readonly string[]): boolean {
  let node = v;
  for (const s of rel) {
    if (!erObjekt(node) || !Object.hasOwn(node, s)) return false;
    node = node[s];
  }
  return node !== undefined;
}

function sjekkBeskyttet(p: Posisjon): void {
  for (const b of BESKYTTET) {
    if (erPrefiks(b, p.segmenter)) {
      throw new UgyldigSkriving(
        "beskyttet",
        `«${stiAv(p.segmenter)}» er et beskyttet felt (${stiAv(b)}) og kan ikke skrives med data_skriv.`,
      );
    }
    if (erPrefiks(p.segmenter, b)) {
      // Posisjonen er en forelder til et beskyttet felt.
      if (p.ny !== undefined && (!erObjekt(p.ny) || p.liste)) {
        throw new UgyldigSkriving(
          "beskyttet",
          `«${stiAv(p.segmenter) || "(familieroten)"}» inneholder det beskyttede feltet ${stiAv(b)} og kan bare settes til et objekt.`,
        );
      }
      if (harPaa(p.ny, b.slice(p.segmenter.length))) {
        throw new UgyldigSkriving(
          "beskyttet",
          `«verdi» kan ikke inneholde det beskyttede feltet ${stiAv(b)}.`,
        );
      }
    }
  }
}

/**
 * Validerer hele kallet før noe leses: format, stier, verdier, overlapp,
 * beskyttede felt, grenser og opId-dato. Kaster `UgyldigSkriving`.
 */
export function forberedSkriving(inn: SkriveInn, naa: number): ForberedtSkriving {
  const m = OPID.exec(inn.opId);
  const dato = m?.[1];
  if (!dato || Number.isNaN(Date.parse(`${dato}T00:00:00Z`)) || dagAv(Date.parse(dato)) !== dato) {
    throw new UgyldigSkriving(
      "ugyldig_skriving",
      "opId må være «ÅÅÅÅ-MM-DD_<tilfeldig id>» (UTC-dato, 8–80 tegn A–Z, a–z, 0–9, -). Bruk samme opId ved nye forsøk.",
    );
  }
  if (dato > dagAv(naa + DAG_MS)) {
    throw new UgyldigSkriving("ugyldig_skriving", "opId-datoen ligger fram i tid.");
  }
  if (!Array.isArray(inn.ops) || inn.ops.length === 0 || inn.ops.length > MAKS_OPERASJONER) {
    throw new UgyldigSkriving("ugyldig_skriving", `Mellom 1 og ${MAKS_OPERASJONER} operasjoner.`);
  }

  const posisjoner: Posisjon[] = [];
  let bytes = 0;
  inn.ops.forEach((op, i) => {
    const hvor = `ops[${i}]`;
    const segmenter = sti(op.sti);
    if (op.type === "slett") {
      if (op.verdi !== undefined) {
        throw new UgyldigSkriving("ugyldig_skriving", `«slett» tar ingen verdi (${hvor}).`);
      }
      posisjoner.push({
        segmenter,
        type: "slett",
        ny: undefined,
        forventet: versjon(op.forventet, hvor),
      });
      return;
    }
    if (op.type === "set") {
      const dybde = validerVerdi(op.verdi, hvor);
      if (segmenter.length + dybde > MAKS_TOTAL_DYBDE) {
        throw new UgyldigSkriving("ugyldig_skriving", `For dypt for RTDB (${hvor}).`);
      }
      bytes += Buffer.byteLength(JSON.stringify(op.verdi), "utf8");
      posisjoner.push({
        segmenter,
        type: "set",
        ny: lagringsform(op.verdi),
        liste: Array.isArray(op.verdi),
        forventet: versjon(op.forventet, hvor),
      });
      return;
    }
    if (op.type === "update") {
      if (!erObjekt(op.verdi) || Object.keys(op.verdi).length === 0) {
        throw new UgyldigSkriving(
          "ugyldig_skriving",
          `«update» tar et objekt med minst ett barn (${hvor}).`,
        );
      }
      const forventet = op.forventet;
      if (!erObjekt(forventet)) {
        throw new UgyldigSkriving(
          "ugyldig_skriving",
          `«update» tar «forventet» som { nøkkel: versjon } for hvert barn (${hvor}).`,
        );
      }
      const nokler = Object.keys(op.verdi);
      if (
        Object.keys(forventet).length !== nokler.length ||
        nokler.some((k) => !Object.hasOwn(forventet, k))
      ) {
        throw new UgyldigSkriving(
          "ugyldig_skriving",
          `«forventet» må ha nøyaktig de samme nøklene som «verdi» (${hvor}).`,
        );
      }
      for (const k of nokler) {
        nokkel(k, hvor);
        const barn = (op.verdi as Record<string, unknown>)[k];
        const dybde = validerVerdi(barn, `${hvor}/${k}`);
        if (segmenter.length + 1 + dybde > MAKS_TOTAL_DYBDE) {
          throw new UgyldigSkriving("ugyldig_skriving", `For dypt for RTDB (${hvor}/${k}).`);
        }
        bytes += Buffer.byteLength(JSON.stringify(barn), "utf8");
        posisjoner.push({
          segmenter: [...segmenter, k],
          type: "update",
          ny: lagringsform(barn),
          liste: Array.isArray(barn),
          forventet: versjon(forventet[k], `${hvor}/${k}`),
        });
      }
      return;
    }
    throw new UgyldigSkriving(
      "ugyldig_skriving",
      `Ukjent type (${hvor}): set, update eller slett.`,
    );
  });

  if (bytes > MAKS_SKRIV_BYTES) {
    throw new UgyldigSkriving("ugyldig_skriving", `Kallet er større enn ${MAKS_SKRIV_BYTES} byte.`);
  }
  for (let a = 0; a < posisjoner.length; a++) {
    for (let b = a + 1; b < posisjoner.length; b++) {
      const pa = posisjoner[a]!.segmenter;
      const pb = posisjoner[b]!.segmenter;
      if (erPrefiks(pa, pb) || erPrefiks(pb, pa)) {
        throw new UgyldigSkriving(
          "ugyldig_skriving",
          `Overlappende stier i samme kall: «${stiAv(pa)}» og «${stiAv(pb)}».`,
        );
      }
    }
  }
  for (const p of posisjoner) sjekkBeskyttet(p);

  const fp = createHash("sha256")
    .update(
      kanoniskJson(
        inn.ops.map((o) => ({
          sti: o.sti,
          type: o.type,
          verdi: o.verdi ?? null,
          forventet: o.forventet,
        })),
      ),
    )
    .digest("hex");
  return { opId: inn.opId, dato, fp, posisjoner };
}

// --- Beslutningen (inne i transaksjonen, ren) -------------------------------

function hent(rot: unknown, segmenter: readonly string[]): unknown {
  let node = rot;
  for (const s of segmenter) {
    if (!erObjekt(node) || !Object.hasOwn(node, s)) return undefined;
    node = node[s];
  }
  return node;
}

/** Kopierer stien ned til forelderen og setter/fjerner; tomme foreldre forsvinner. */
function settPaa(
  rot: Record<string, unknown>,
  segmenter: readonly string[],
  ny: unknown,
): Record<string, unknown> {
  if (segmenter.length === 0) return erObjekt(ny) ? ny : {};
  const [forste, ...rest] = segmenter;
  const ut: Record<string, unknown> = {};
  for (const k of Object.keys(rot)) settEgen(ut, k, rot[k]);
  const barn =
    rest.length === 0
      ? ny
      : settPaa(erObjekt(rot[forste!]) ? (rot[forste!] as Record<string, unknown>) : {}, rest, ny);
  if (barn === undefined || (erObjekt(barn) && Object.keys(barn).length === 0)) delete ut[forste!];
  else settEgen(ut, forste!, barn);
  return ut;
}

export function parseKvittering(raw: unknown): Kvittering | null {
  if (!erObjekt(raw)) return null;
  const { fp, sub, uid, client, at } = raw;
  if (typeof fp !== "string" || typeof sub !== "string" || typeof uid !== "string") return null;
  if (typeof client !== "string" || typeof at !== "number") return null;
  const skrivinger = somListe(raw.skrivinger).flatMap((s): SkrivingUtfall[] => {
    if (!erObjekt(s)) return [];
    const { sti, type, foer, etter } = s;
    if (typeof sti !== "string" || typeof foer !== "string" || typeof etter !== "string") return [];
    if (type !== "set" && type !== "update" && type !== "slett") return [];
    return [
      {
        sti,
        type,
        foer,
        etter,
        bevart: somListe(s.bevart).filter((x) => typeof x === "string") as string[],
      },
    ];
  });
  return { fp, sub, uid, client, at, skrivinger };
}

/** RTDB lagrer lister som indeksobjekter; `val()` gir array eller objekt. */
function somListe(v: unknown): unknown[] {
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined);
  if (!erObjekt(v)) return [];
  return Object.keys(v)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => v[k]);
}

/**
 * Hele beslutningen fra ÉN verdi av familienoden (`val()`-form). Kalles av
 * transaksjonens updater (kan kjøres flere ganger — kun siste teller) og,
 * ved avvisning, på nytt mot en fersk serverlesing. Ingen sideeffekter.
 */
export function besluttSkriving(
  raa: unknown,
  forberedt: ForberedtSkriving,
  principal: Principal,
  naa: number,
): Beslutning {
  const rot = lagringsform(raa);
  if (!erObjekt(rot)) return { kind: "ikke_medlem" };
  const medlem = hent(rot, ["members", encodeKey(principal.uid)]);
  if (medlem === undefined || medlem === false) return { kind: "ikke_medlem" };

  const mcp = erObjekt(rot[MCP_NOKKEL]) ? (rot[MCP_NOKKEL] as Record<string, unknown>) : {};
  const ops = erObjekt(mcp.ops) ? mcp.ops : {};
  if (Object.hasOwn(ops, forberedt.opId)) {
    const k = parseKvittering(ops[forberedt.opId]);
    if (!k || k.fp !== forberedt.fp || k.sub !== principal.sub)
      return { kind: "idempotens_konflikt" };
    return { kind: "replay", kvittering: k };
  }
  const vannmerke = typeof mcp.vannmerke === "string" ? mcp.vannmerke : "";
  if (forberedt.dato < dagAv(naa - UTLOP_DAGER * DAG_MS) || forberedt.dato <= vannmerke) {
    return { kind: "utlopt" };
  }
  const bytes = Buffer.byteLength(JSON.stringify(rot), "utf8");
  if (bytes > MAKS_FAMILIE_LESE_BYTES) {
    return { kind: "for_stor", grunn: "lesing", bytes, grense: MAKS_FAMILIE_LESE_BYTES };
  }

  // Ingen forelder kan i dag være en enkeltverdi som stille ville blitt erstattet.
  for (const p of forberedt.posisjoner) {
    for (let i = 0; i < p.segmenter.length; i++) {
      const forelder = hent(rot, p.segmenter.slice(0, i));
      if (forelder !== undefined && !erObjekt(forelder)) {
        return { kind: "forelder_er_verdi", sti: stiAv(p.segmenter.slice(0, i)) };
      }
    }
  }

  const avvik: Avvik[] = [];
  const foer = forberedt.posisjoner.map((p) => {
    const faktisk = versjonAv(hent(rot, p.segmenter), { rot: p.segmenter.length === 0 });
    if (faktisk !== p.forventet)
      avvik.push({ sti: stiAv(p.segmenter), forventet: p.forventet, faktisk });
    return faktisk;
  });
  if (avvik.length > 0) return { kind: "konflikt", avvik };

  let neste = rot;
  const bevart: string[][] = [];
  for (const p of forberedt.posisjoner) {
    let ny = p.ny;
    const behold: string[] = [];
    for (const b of BESKYTTET) {
      if (b.length <= p.segmenter.length || !erPrefiks(p.segmenter, b)) continue;
      const gammel = hent(rot, b);
      if (gammel === undefined) continue;
      ny = settPaa(erObjekt(ny) ? ny : {}, b.slice(p.segmenter.length), gammel);
      behold.push(stiAv(b));
    }
    bevart.push(behold);
    neste = settPaa(neste, p.segmenter, ny);
  }

  const kvittering: Kvittering = {
    fp: forberedt.fp,
    sub: principal.sub,
    uid: principal.uid,
    client: principal.client,
    at: naa,
    skrivinger: forberedt.posisjoner.map((p, i) => ({
      sti: stiAv(p.segmenter),
      type: p.type,
      foer: foer[i]!,
      etter: versjonAv(hent(neste, p.segmenter), { rot: p.segmenter.length === 0 }),
      bevart: bevart[i]!,
    })),
  };

  // Kvitteringen + beskjæring av utløpte kvitteringer, i samme verdi.
  const nesteMcp = erObjekt(neste[MCP_NOKKEL])
    ? (neste[MCP_NOKKEL] as Record<string, unknown>)
    : {};
  const nesteOps: Record<string, unknown> = {};
  const grense = dagAv(naa - BESKJAER_DAGER * DAG_MS);
  let nyttVannmerke = vannmerke;
  const gamle = erObjekt(nesteMcp.ops) ? nesteMcp.ops : {};
  for (const id of Object.keys(gamle)) {
    const d = id.slice(0, 10);
    if (OPID.test(id) && d < grense) {
      if (d > nyttVannmerke) nyttVannmerke = d;
      continue;
    }
    settEgen(nesteOps, id, gamle[id]);
  }
  settEgen(nesteOps, forberedt.opId, kvittering);
  const mcpUt: Record<string, unknown> = { ops: nesteOps };
  if (nyttVannmerke) mcpUt.vannmerke = nyttVannmerke;
  neste = settPaa(neste, [MCP_NOKKEL], lagringsform(mcpUt));

  // Hele kandidaten (data + kvittering + beskjæring) er det som sendes.
  const etterBytes = Buffer.byteLength(JSON.stringify(neste), "utf8");
  if (etterBytes > MAKS_FAMILIE_SKRIVE_BYTES) {
    return {
      kind: "for_stor",
      grunn: "skriving",
      bytes: etterBytes,
      grense: MAKS_FAMILIE_SKRIVE_BYTES,
    };
  }
  return { kind: "apply", neste, kvittering };
}
