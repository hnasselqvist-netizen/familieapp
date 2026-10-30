/**
 * Filtrert transaksjonssøk (`transaksjon_sok`, #27/#59 — Helens bestilling
 * 30.10.2026): finn presise transaksjoner uten å hente hele listen eller rå
 * bankrader til samtalen. Skrivefritt.
 *
 * Semantikken er appens egen, delt via `@domain/forsoning` (ingen kopi):
 *  - **konto** = `normaliserKonto` (konto, ellers importkilde) — samme
 *    nøkler som kontofilteret i Transaksjoner (`MC`, `regningskonto`, …).
 *  - **ansvar** (felles/privat) bor på HENDELSEN, ikke på transaksjonen:
 *    eierne i fordelingene til hendelsen `finnHendelseForTransaksjon` gir.
 *    Uten hendelse har transaksjonen ikke noe plassert ansvar.
 *  - **status** = `beskrivTilstand(...).kategori` — kategorien
 *    kontrolloversikten viser («ferdig», «pa_vent», «intern», …).
 *  - **tekst** = samme delstrengsøk som kontrolloversikten (store/små
 *    bokstaver likt).
 *
 * Rekkefølgen er nyest først (som appen), med nøkkelen som entydig
 * tie-break; markøren er (dato, nøkkel). Hver side leses på nytt med to
 * separate `get()` — ikke et atomisk øyeblikksbilde. Markøren hindrer
 * forskyvning når nye transaksjoner kommer til, men en endret dato,
 * filterverdi eller fordeling kan flytte eller fjerne et treff mellom
 * sidene, og `antallTreff` kan endre seg. Hvert treff har stien og
 * versjonen `data_hent` gir, så en endring alltid bygger på fersk lesing.
 */
import type { Eierandel, HendelseRecord, TransaksjonRecord } from "@app-types/forsoning";
import { normaliserKonto } from "@domain/forsoning/bankimportParse";
import { finnHendelseForTransaksjon } from "@domain/forsoning/fordeling";
import { beskrivTilstand, type TilstandKategori } from "@domain/forsoning/transaksjonsoversikt";
import type { FamilyContext } from "../auth/authorize";
import { rtdbNokkelOrden } from "../data/sti";
import { versjonAv } from "../data/versjon";
import { ToolError } from "../handleliste/errors";
import type { HverdagsflytStore } from "../store/types";

export const TILSTANDER = [
  "ferdig",
  "pa_vent",
  "intern",
  "ignorert",
  "forslag",
  "krever_vurdering",
  "matchet_uten_hendelse",
  "uferdig",
] as const satisfies readonly TilstandKategori[];

export const STANDARD_ANTALL = 25;
export const MAKS_ANTALL = 100;

export interface SokFilter {
  konto?: string;
  ansvar?: string;
  tekst?: string;
  fraDato?: string;
  tilDato?: string;
  status?: TilstandKategori[];
  antall?: number;
  etter?: string;
}

export interface Treff {
  /** Sti for `data_hent`/`data_skriv`, relativt til familien. */
  sti: string;
  versjon: string;
  id: string | null;
  dato: string | null;
  tekst: string | null;
  belop: number | null;
  retning: string | null;
  konto: string;
  status: TilstandKategori;
  /** Hendelsen som bærer plasseringen og ansvaret, når den finnes. */
  hendelse: { sti: string; versjon: string } | null;
  fordelinger: { post: string; belop: number; eiere: Eierandel[] }[];
}

export interface SokSvar {
  treff: Treff[];
  antallTreff: number;
  neste: string | null;
}

export class UgyldigSok extends Error {}

/** Elementene i en RTDB-node med nøkkel: legacy-array (indekser) eller objekt. */
function elementer(node: unknown): [string, Record<string, unknown>][] {
  if (!node || typeof node !== "object") return [];
  const par: [string, unknown][] = Array.isArray(node)
    ? node.map((v, i) => [String(i), v])
    : Object.entries(node);
  return par.filter((p): p is [string, Record<string, unknown>] => {
    const v = p[1];
    return !!v && typeof v === "object" && !Array.isArray(v);
  });
}

const DATO = /^\d{4}-\d{2}-\d{2}$/;
const dag = (dato: unknown) => (typeof dato === "string" ? dato.slice(0, 10) : "");

/**
 * Nyest først; lik dato → RTDB-nøkkelorden (`rtdbNokkelOrden`: 32-biters
 * heltall først numerisk, så tekst), med ren strengsammenligning som siste
 * skille. Ordenen er total, og den samme brukes for sortering og markør.
 */
function sammenlign(a: { d: string; k: string }, b: { d: string; k: string }): number {
  if (a.d !== b.d) return a.d < b.d ? 1 : -1;
  return rtdbNokkelOrden(a.k, b.k) || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0);
}

function lesMarkor(etter: string): { d: string; k: string } {
  try {
    const m = JSON.parse(Buffer.from(etter, "base64url").toString("utf8")) as unknown;
    if (
      m &&
      typeof m === "object" &&
      typeof (m as { d?: unknown }).d === "string" &&
      typeof (m as { k?: unknown }).k === "string"
    ) {
      return { d: (m as { d: string }).d, k: (m as { k: string }).k };
    }
  } catch {
    // faller gjennom
  }
  throw new UgyldigSok("Ugyldig markør `etter`: bruk `neste` fra forrige svar.");
}

const lagMarkor = (d: string, k: string) =>
  Buffer.from(JSON.stringify({ d, k }), "utf8").toString("base64url");

const harAnsvar = (eiere: readonly Eierandel[], person: string) =>
  eiere.some((e) => (e.person || "").toLowerCase() === person && Number(e.prosent) > 0);

/**
 * Ren søkefunksjon over RÅ `transaksjoner` og `hendelser`. Ingen I/O.
 */
export function sokTransaksjoner(
  raa: { transaksjoner: unknown; hendelser: unknown },
  filter: SokFilter,
): SokSvar {
  for (const [navn, v] of [
    ["fraDato", filter.fraDato],
    ["tilDato", filter.tilDato],
  ] as const) {
    if (v !== undefined && !DATO.test(v)) throw new UgyldigSok(`${navn} må være ÅÅÅÅ-MM-DD.`);
  }
  const antall = Math.min(Math.max(filter.antall ?? STANDARD_ANTALL, 1), MAKS_ANTALL);
  const markor = filter.etter ? lesMarkor(filter.etter) : null;
  const tekst = (filter.tekst ?? "").trim().toLowerCase();
  const ansvar = (filter.ansvar ?? "").trim().toLowerCase();
  const konto = (filter.konto ?? "").trim().toLowerCase();
  const status = filter.status && filter.status.length > 0 ? new Set(filter.status) : null;

  // Nøkkelen per hendelse-OBJEKT (ikke per id): to hendelser med samme id
  // kan ikke gi feil sti.
  const hendelseNokkel = new Map<HendelseRecord, string>();
  for (const [k, h] of elementer(raa.hendelser)) {
    hendelseNokkel.set(h as unknown as HendelseRecord, k);
  }
  const hendelser = [...hendelseNokkel.keys()];

  const kandidater: { d: string; k: string; t: TransaksjonRecord; h: HendelseRecord | null }[] = [];
  for (const [k, verdi] of elementer(raa.transaksjoner)) {
    const t = verdi as unknown as TransaksjonRecord;
    const d = dag(t.dato);
    if (filter.fraDato && (!d || d < filter.fraDato)) continue;
    if (filter.tilDato && (!d || d > filter.tilDato)) continue;
    if (konto && normaliserKonto(t).toLowerCase() !== konto) continue;
    if (
      tekst &&
      !String(t.tekst ?? "")
        .toLowerCase()
        .includes(tekst)
    )
      continue;
    const h = finnHendelseForTransaksjon(hendelser, t.id ?? null);
    if (ansvar && !(h?.fordelinger ?? []).some((f) => harAnsvar(f.eiere ?? [], ansvar))) continue;
    if (status && !status.has(kategori(t, h))) continue;
    kandidater.push({ d, k, t, h });
  }
  kandidater.sort(sammenlign);

  const fra = markor ? kandidater.findIndex((c) => sammenlign(c, markor) > 0) : 0;
  const start = fra === -1 ? kandidater.length : fra;
  const side = kandidater.slice(start, start + antall);
  const siste = side[side.length - 1];
  const harMer = start + side.length < kandidater.length;

  return {
    antallTreff: kandidater.length,
    neste: harMer && siste ? lagMarkor(siste.d, siste.k) : null,
    treff: side.map(({ k, t, h }) => {
      const hNokkel = h ? hendelseNokkel.get(h) : undefined;
      return {
        sti: `transaksjoner/${k}`,
        versjon: versjonAv(t),
        id: typeof t.id === "string" ? t.id : null,
        dato: typeof t.dato === "string" ? t.dato : null,
        tekst: typeof t.tekst === "string" ? t.tekst : null,
        belop: typeof t.belop === "number" ? t.belop : null,
        retning: typeof t.retning === "string" ? t.retning : null,
        konto: normaliserKonto(t),
        status: kategori(t, h),
        hendelse:
          hNokkel !== undefined ? { sti: `hendelser/${hNokkel}`, versjon: versjonAv(h) } : null,
        fordelinger: (h?.fordelinger ?? []).map((f) => ({
          post: f.plasseringNavn,
          belop: f.belop,
          eiere: f.eiere ?? [],
        })),
      };
    }),
  };
}

/**
 * Kategorien bruker verken regler eller budsjettgrupper (de gir bare
 * detaljtekst), så de sendes tomme — kategorien er lik appens.
 */
function kategori(t: TransaksjonRecord, h: HendelseRecord | null): TilstandKategori {
  return beskrivTilstand(t, h ? [h] : [], [], {
    budgetGroups: [],
    incomeGroups: [],
    sparingGroups: [],
  }).kategori;
}

/** Leser de to nodene (skrivevaktet `lesNode`) og søker. */
export async function hentOgSok(
  store: HverdagsflytStore,
  ctx: FamilyContext,
  filter: SokFilter,
): Promise<SokSvar> {
  const [transaksjoner, hendelser] = await Promise.all([
    store.lesNode(ctx.familyId, ["transaksjoner"]),
    store.lesNode(ctx.familyId, ["hendelser"]),
  ]);
  try {
    return sokTransaksjoner({ transaksjoner, hendelser }, filter);
  } catch (err) {
    if (err instanceof UgyldigSok) throw new ToolError("ugyldig_sok", err.message, false);
    throw err;
  }
}
