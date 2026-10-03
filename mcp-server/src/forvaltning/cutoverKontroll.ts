/**
 * Skrivefri cutover-kontroll av forsoningsnodene (Issue #34, Kontrolltårn-
 * beslutning 5971770332 pkt. 1): `families/{f}/transaksjoner|hendelser|
 * receipts|rules`. Ren funksjon over RÅ RTDB-verdier — ingen I/O, ingen
 * skriving, ingen retting.
 *
 * Rapporten svarer på det cutover-planen trenger før og etter overgangen:
 *
 *  - **Struktur per node:** legacy-array med nøkler 0..n-1, `id` i hvert
 *    element, ingen dupliserte id-er (ADR 0002 — én aktiv skriver, samme
 *    array-form).
 *  - **Antall og fordeling:** statusfordeling per node, kvitteringsbilder
 *    (Drive / base64 — base64 skal verken slettes eller migreres).
 *  - **Referanser:** id-felt som peker på elementer som ikke finnes.
 *  - **Fortegn:** status for de to kjente feil-signerte hendelsene
 *    (`fortegn.ts`), i stedet for at Helen kjører legacy-forhåndsvisningen.
 *  - **Sammenligningsgrunnlag:** digest per node og per bøtte (16 bøtter
 *    etter id), så et senere kall med `forrige` viser NØYAKTIG hvilke
 *    deler som er endret — uten at innhold forlater serveren.
 *
 * Ingen beløp, tekster, datoer eller navn returneres — kun antall, opake
 * id-er (som eksempler på avvik) og hasher. Unntaket er de to kjente
 * fortegnshendelsenes beløp, som Kontrolltårnet eksplisitt har bedt om.
 */
import { createHash } from "node:crypto";
import { type FortegnStatus, klassifiserFortegn } from "./fortegn";

export const FORSONINGSNODER = ["transaksjoner", "hendelser", "receipts", "rules"] as const;
export type Forsoningsnode = (typeof FORSONINGSNODER)[number];
export type RaaForsoningsnoder = Record<Forsoningsnode, unknown>;

/** Antall bøtter elementene fordeles i (første heks-tegn av sha256(id)). */
export const ANTALL_BOTTER = 16;
const BOTTER = Array.from({ length: ANTALL_BOTTER }, (_, i) => i.toString(16));
/** Maks antall eksempel-id-er per avvik/liste — holder svaret lite. */
export const MAKS_EKSEMPLER = 20;

/**
 * Formen noden ble lest i. RTDB/Admin SDK gir en JS-array for tette
 * heltallsnøkler, og et objekt for glisne eller ikke-numeriske nøkler.
 */
export type NodeForm = "tom" | "array" | "array_med_hull" | "objekt" | "ugyldig";

export interface NodeRapport {
  form: NodeForm;
  antall: number;
  /** Indekser uten verdi i en array (hull) — aldri forventet i legacy-form. */
  hull: number[];
  /** Nøkler som ikke er 0..n-1 (bare for `objekt`). */
  ikkeArrayNokler: string[];
  /** Elementer som ikke er objekter. */
  ugyldigeElementer: number;
  utenId: { antall: number; nokler: string[] };
  dupliserteIder: { id: string; antall: number }[];
  /** Fordeling på nodens statusfelt (se `STATUSFELT`). */
  fordeling: Record<string, number>;
  digest: string;
}

export interface KvitteringsbildeTelling {
  /** `driveFileId` eller `driveWebViewLink` satt. */
  drive: number;
  /** `imageUrl` er en `data:`-URL (Bankimport «Legg til kvittering»). */
  base64: number;
  /** `imageUrl` satt, men ikke `data:` (ikke forventet). */
  annenImageUrl: number;
  forkastet: number;
}

export interface Referansebrudd {
  /** F.eks. `hendelser.receiptId→receipts`. */
  type: string;
  antall: number;
  /** Id-ene til elementene som peker feil (maks `MAKS_EKSEMPLER`). */
  eksempler: string[];
}

/** Det et senere kall trenger for å sammenligne — send det tilbake som `forrige`. */
export interface Sammenligningsgrunnlag {
  lest: string;
  noder: Record<Forsoningsnode, { antall: number; digest: string; botter: string[] }>;
  referansebrudd: Record<string, number>;
}

export interface NodeEndring {
  antallFor: number;
  antallEtter: number;
  endret: boolean;
  endredeBotter: string[];
  /**
   * Kun med `endretEtter`: endrede bøtter uten noe element som er endret
   * etter tidspunktet (direkte eller via referanse).
   */
  uforklarteBotter?: string[];
}

export interface Sammenligning {
  forrigeLest: string;
  noder: Record<Forsoningsnode, NodeEndring>;
  /** Referansetyper der antall brudd har endret seg. */
  referansebrudd: { type: string; for: number; etter: number }[];
}

export interface EndretEtter {
  tidspunkt: string;
  noder: Record<
    Forsoningsnode,
    {
      /** Elementer med eget tidsstempel ≥ `tidspunkt`. */
      antall: number;
      ider: string[];
      /** Elementer uten slikt tidsstempel, men koblet til et som har det. */
      viaReferanse: { antall: number; ider: string[] };
    }
  >;
}

export interface KontrollRapport {
  /** Versjon av utdataformatet — økes ved brytende endring. */
  format: 1;
  lest: string;
  vurdering: { strukturOk: boolean; merknader: string[] };
  noder: Record<Forsoningsnode, NodeRapport>;
  kvitteringsbilder: KvitteringsbildeTelling;
  referansebrudd: Referansebrudd[];
  fortegn: FortegnStatus[];
  sammenligningsgrunnlag: Sammenligningsgrunnlag;
  sammenligning?: Sammenligning;
  endretEtter?: EndretEtter;
}

export interface KontrollValg {
  /** ISO-tidspunkt for lesingen (injisert klokke). */
  lest: string;
  /** `sammenligningsgrunnlag` fra et tidligere kall. */
  forrige?: Sammenligningsgrunnlag;
  /** ISO-tidspunkt: list elementer med tidsstempel ≥ dette. */
  endretEtter?: string;
}

/** Statusfeltet som telles per node. */
const STATUSFELT: Record<Forsoningsnode, string> = {
  transaksjoner: "status",
  hendelser: "status",
  receipts: "matchingStatus",
  rules: "mode",
};

/** Tidsstempelfelt per node (ISO-strenger). Ikke alle skriveveier setter dem. */
const TIDSFELT: Record<Forsoningsnode, string[]> = {
  transaksjoner: ["updatedAt"],
  hendelser: ["oppdatert", "opprettet"],
  receipts: ["updatedAt", "matchingUpdatedAt", "createdAt"],
  rules: ["updatedAt", "createdAt", "lastMatched"],
};

/** Id-felt som skal peke på et element i en (annen) forsoningsnode. */
const REFERANSER: { fra: Forsoningsnode; felt: string; til: Forsoningsnode }[] = [
  { fra: "transaksjoner", felt: "hendelseId", til: "hendelser" },
  { fra: "transaksjoner", felt: "motpartTransaksjonId", til: "transaksjoner" },
  { fra: "hendelser", felt: "transaksjonId", til: "transaksjoner" },
  { fra: "hendelser", felt: "receiptId", til: "receipts" },
  { fra: "hendelser", felt: "regelId", til: "rules" },
  { fra: "receipts", felt: "hendelseId", til: "hendelser" },
  { fra: "receipts", felt: "transactionId", til: "transaksjoner" },
  { fra: "receipts", felt: "suggestedTransactionId", til: "transaksjoner" },
];

type Rad = Record<string, unknown>;
const erObjekt = (v: unknown): v is Rad => typeof v === "object" && v !== null && !Array.isArray(v);

interface Element {
  nokkel: string;
  verdi: unknown;
  /** `id` hvis gyldig, ellers `#nøkkel` — brukes som identitet i digestene. */
  identitet: string;
  id: string | null;
}

interface LestNode {
  form: NodeForm;
  elementer: Element[];
  hull: number[];
  ikkeArrayNokler: string[];
}

function lesNode(raa: unknown): LestNode {
  const tom: LestNode = { form: "tom", elementer: [], hull: [], ikkeArrayNokler: [] };
  if (raa === null || raa === undefined) return tom;

  const element = (nokkel: string, verdi: unknown): Element => {
    const id = erObjekt(verdi) && typeof verdi.id === "string" && verdi.id ? verdi.id : null;
    return { nokkel, verdi, id, identitet: id ?? `#${nokkel}` };
  };

  if (Array.isArray(raa)) {
    const hull: number[] = [];
    const elementer: Element[] = [];
    for (let i = 0; i < raa.length; i++) {
      const verdi: unknown = raa[i];
      if (verdi === undefined || verdi === null) hull.push(i);
      else elementer.push(element(String(i), verdi));
    }
    return { form: hull.length ? "array_med_hull" : "array", elementer, hull, ikkeArrayNokler: [] };
  }

  if (erObjekt(raa)) {
    const nokler = Object.keys(raa);
    const ikkeArrayNokler = nokler.filter((k, i) => k !== String(i));
    return {
      form: "objekt",
      elementer: nokler.map((k) => element(k, raa[k])),
      hull: [],
      ikkeArrayNokler: ikkeArrayNokler.slice(0, MAKS_EKSEMPLER),
    };
  }

  return { ...tom, form: "ugyldig" };
}

/** Deterministisk JSON (sorterte nøkler) — samme innhold gir samme hash. */
export function stabilJson(verdi: unknown): string {
  if (Array.isArray(verdi)) return `[${verdi.map((v) => stabilJson(v ?? null)).join(",")}]`;
  if (erObjekt(verdi)) {
    return `{${Object.keys(verdi)
      .sort()
      .filter((k) => verdi[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stabilJson(verdi[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(verdi ?? null);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const botte = (identitet: string) => sha256(identitet)[0]!;
const digestAv = (linjer: string[]) => sha256([...linjer].sort().join("\n")).slice(0, 16);
const linje = (e: Element) => `${e.identitet}:${sha256(stabilJson(e.verdi)).slice(0, 16)}`;

function nodeRapport(node: Forsoningsnode, lest: LestNode): NodeRapport {
  const ugyldigeElementer = lest.elementer.filter((e) => !erObjekt(e.verdi)).length;
  const utenId = lest.elementer.filter((e) => e.id === null);

  const perId = new Map<string, number>();
  for (const e of lest.elementer) if (e.id) perId.set(e.id, (perId.get(e.id) ?? 0) + 1);
  const dupliserteIder = [...perId]
    .filter(([, n]) => n > 1)
    .map(([id, antall]) => ({ id, antall }))
    .slice(0, MAKS_EKSEMPLER);

  const fordeling: Record<string, number> = {};
  for (const e of lest.elementer) {
    if (!erObjekt(e.verdi)) continue;
    const v = e.verdi[STATUSFELT[node]];
    const n =
      typeof v === "string" && v ? v : v === undefined || v === null ? "(mangler)" : String(v);
    fordeling[n] = (fordeling[n] ?? 0) + 1;
  }

  return {
    form: lest.form,
    antall: lest.elementer.length,
    hull: lest.hull.slice(0, MAKS_EKSEMPLER),
    ikkeArrayNokler: lest.ikkeArrayNokler,
    ugyldigeElementer,
    utenId: { antall: utenId.length, nokler: utenId.slice(0, MAKS_EKSEMPLER).map((e) => e.nokkel) },
    dupliserteIder,
    fordeling: Object.fromEntries(Object.entries(fordeling).sort(([a], [b]) => a.localeCompare(b))),
    digest: digestAv(lest.elementer.map(linje)),
  };
}

function botteDigester(lest: LestNode): string[] {
  const perBotte = new Map<string, string[]>(BOTTER.map((b) => [b, []]));
  for (const e of lest.elementer) perBotte.get(botte(e.identitet))!.push(linje(e));
  return BOTTER.map((b) => digestAv(perBotte.get(b)!));
}

function kvitteringsbilder(lest: LestNode): KvitteringsbildeTelling {
  const t: KvitteringsbildeTelling = { drive: 0, base64: 0, annenImageUrl: 0, forkastet: 0 };
  for (const { verdi: r } of lest.elementer) {
    if (!erObjekt(r)) continue;
    if (r.driveFileId || r.driveWebViewLink) t.drive += 1;
    if (typeof r.imageUrl === "string" && r.imageUrl) {
      if (r.imageUrl.startsWith("data:")) t.base64 += 1;
      else t.annenImageUrl += 1;
    }
    if (r.forkastet === true) t.forkastet += 1;
  }
  return t;
}

function referansebrudd(lest: Record<Forsoningsnode, LestNode>): Referansebrudd[] {
  const ider = Object.fromEntries(
    FORSONINGSNODER.map((n) => [
      n,
      new Set(lest[n].elementer.flatMap((e) => (e.id ? [e.id] : []))),
    ]),
  ) as Record<Forsoningsnode, Set<string>>;

  return REFERANSER.map(({ fra, felt, til }) => {
    const brudd = lest[fra].elementer.filter((e) => {
      if (!erObjekt(e.verdi)) return false;
      const ref = e.verdi[felt];
      return typeof ref === "string" && ref !== "" && !ider[til].has(ref);
    });
    return {
      type: `${fra}.${felt}→${til}`,
      antall: brudd.length,
      eksempler: brudd.slice(0, MAKS_EKSEMPLER).map((e) => e.identitet),
    };
  });
}

/**
 * Elementer med tidsstempel ≥ `tidspunkt` (direkte), pluss elementer som
 * henger sammen med dem via en referanse (`viaReferanse`). Det siste
 * trengs fordi ikke alle skriveveier setter tidsstempel — en Bankimport-
 * beslutning endrer f.eks. transaksjonen (`status`, `hendelseId`) uten
 * `updatedAt`, men hendelsen den kobles til har `oppdatert`.
 */
function endretEtter(
  lest: Record<Forsoningsnode, LestNode>,
  tidspunkt: string,
): { rapport: EndretEtter; botter: Record<Forsoningsnode, Set<string>> } {
  const direkte = {} as Record<Forsoningsnode, Element[]>;
  for (const node of FORSONINGSNODER) {
    direkte[node] = lest[node].elementer.filter(
      (e) =>
        erObjekt(e.verdi) &&
        TIDSFELT[node].some((f) => {
          const t = (e.verdi as Rad)[f];
          return typeof t === "string" && t >= tidspunkt;
        }),
    );
  }

  const direkteIder = Object.fromEntries(
    FORSONINGSNODER.map((n) => [n, new Set(direkte[n].flatMap((e) => (e.id ? [e.id] : [])))]),
  ) as Record<Forsoningsnode, Set<string>>;
  // Id-er et direkte endret element peker på (fra → til), og elementer som
  // peker på et direkte endret element (til ← fra).
  const pekt = Object.fromEntries(FORSONINGSNODER.map((n) => [n, new Set<string>()])) as Record<
    Forsoningsnode,
    Set<string>
  >;
  for (const { fra, felt, til } of REFERANSER) {
    for (const e of direkte[fra]) {
      const ref = (e.verdi as Rad)[felt];
      if (typeof ref === "string" && ref) pekt[til].add(ref);
    }
    for (const e of lest[fra].elementer) {
      if (!erObjekt(e.verdi) || !e.id) continue;
      const ref = e.verdi[felt];
      if (typeof ref === "string" && direkteIder[til].has(ref)) pekt[fra].add(e.id);
    }
  }

  const noder = {} as EndretEtter["noder"];
  const botter = {} as Record<Forsoningsnode, Set<string>>;
  for (const node of FORSONINGSNODER) {
    const via = lest[node].elementer.filter(
      (e) => e.id !== null && pekt[node].has(e.id) && !direkteIder[node].has(e.id),
    );
    noder[node] = {
      antall: direkte[node].length,
      ider: direkte[node].slice(0, 50).map((e) => e.identitet),
      viaReferanse: { antall: via.length, ider: via.slice(0, 50).map((e) => e.identitet) },
    };
    botter[node] = new Set([...direkte[node], ...via].map((e) => botte(e.identitet)));
  }
  return { rapport: { tidspunkt, noder }, botter };
}

export function byggKontroll(raa: RaaForsoningsnoder, valg: KontrollValg): KontrollRapport {
  const lest = Object.fromEntries(FORSONINGSNODER.map((n) => [n, lesNode(raa[n])])) as Record<
    Forsoningsnode,
    LestNode
  >;
  const noder = Object.fromEntries(
    FORSONINGSNODER.map((n) => [n, nodeRapport(n, lest[n])]),
  ) as Record<Forsoningsnode, NodeRapport>;
  const brudd = referansebrudd(lest);

  const grunnlag: Sammenligningsgrunnlag = {
    lest: valg.lest,
    noder: Object.fromEntries(
      FORSONINGSNODER.map((n) => [
        n,
        { antall: noder[n].antall, digest: noder[n].digest, botter: botteDigester(lest[n]) },
      ]),
    ) as Sammenligningsgrunnlag["noder"],
    referansebrudd: Object.fromEntries(brudd.map((b) => [b.type, b.antall])),
  };

  const etter = valg.endretEtter ? endretEtter(lest, valg.endretEtter) : undefined;
  const sammenligning = valg.forrige
    ? sammenlign(valg.forrige, grunnlag, etter?.botter)
    : undefined;

  const merknader: string[] = [];
  for (const n of FORSONINGSNODER) {
    const r = noder[n];
    if (r.form === "objekt" || r.form === "ugyldig")
      merknader.push(`${n}: lest som ${r.form}, ikke array`);
    if (r.hull.length) merknader.push(`${n}: ${lest[n].hull.length} hull i arrayen`);
    if (r.ugyldigeElementer)
      merknader.push(`${n}: ${r.ugyldigeElementer} elementer er ikke objekter`);
    if (r.utenId.antall) merknader.push(`${n}: ${r.utenId.antall} elementer uten id`);
    if (r.dupliserteIder.length)
      merknader.push(`${n}: ${r.dupliserteIder.length} dupliserte id-er`);
  }
  const strukturOk = merknader.length === 0;
  if (sammenligning) {
    for (const b of sammenligning.referansebrudd) {
      if (b.etter > b.for)
        merknader.push(`Referansebrudd økt for ${b.type}: ${b.for} → ${b.etter}`);
    }
    for (const n of FORSONINGSNODER) {
      const u = sammenligning.noder[n].uforklarteBotter;
      if (u?.length) merknader.push(`${n}: endringer uten tidsstempel i bøtte ${u.join(", ")}`);
    }
  }

  return {
    format: 1,
    lest: valg.lest,
    vurdering: { strukturOk, merknader },
    noder,
    kvitteringsbilder: kvitteringsbilder(lest.receipts),
    referansebrudd: brudd,
    fortegn: klassifiserFortegn(lest.hendelser.elementer.map((e) => e.verdi)),
    sammenligningsgrunnlag: grunnlag,
    ...(sammenligning ? { sammenligning } : {}),
    ...(etter ? { endretEtter: etter.rapport } : {}),
  };
}

function sammenlign(
  forrige: Sammenligningsgrunnlag,
  naa: Sammenligningsgrunnlag,
  forklart?: Record<Forsoningsnode, Set<string>>,
): Sammenligning {
  const noder = {} as Sammenligning["noder"];
  for (const n of FORSONINGSNODER) {
    const f = forrige.noder[n];
    const e = naa.noder[n];
    const endredeBotter = BOTTER.filter((_, i) => f.botter[i] !== e.botter[i]);
    noder[n] = {
      antallFor: f.antall,
      antallEtter: e.antall,
      endret: f.digest !== e.digest,
      endredeBotter,
      ...(forklart ? { uforklarteBotter: endredeBotter.filter((b) => !forklart[n].has(b)) } : {}),
    };
  }
  const typer = new Set([
    ...Object.keys(forrige.referansebrudd),
    ...Object.keys(naa.referansebrudd),
  ]);
  const referansebrudd = [...typer]
    .map((type) => ({
      type,
      for: forrige.referansebrudd[type] ?? 0,
      etter: naa.referansebrudd[type] ?? 0,
    }))
    .filter((b) => b.for !== b.etter);
  return { forrigeLest: forrige.lest, noder, referansebrudd };
}
