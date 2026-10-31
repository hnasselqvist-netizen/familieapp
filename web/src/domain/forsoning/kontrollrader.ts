/**
 * Kontrollrader for «Alle transaksjoner» (#59, PC-1): ÉN radmodell som både
 * PC-tabellen og mobilkortene viser, så de tolker dataene likt.
 *
 * Ren avledning, ingen ny datakontrakt:
 *  - **beløp** i øre med fortegn fra `retning` (`belop` er alltid absolutt);
 *  - **konto** = `normaliserKonto` — hvor pengene gikk, IKKE hvem som eier
 *    kostnaden;
 *  - **kostnadseier** = eierne i fordelingene til hendelsen
 *    `finnHendelseForTransaksjon` gir (andel > 0), per fordeling;
 *  - **status** = `beskrivTilstand` (behandling, ikke kvalitetssikring).
 */
import type {
  Eierandel,
  HendelseRecord,
  KvitteringRecord,
  PlasseringType,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { normaliserKonto } from "./bankimportParse";
import { finnHendelseForTransaksjon } from "./fordeling";
import {
  type PostGrupper,
  type TilstandKategori,
  beskrivTilstand,
  fordelingTekst,
  maanedNokkel,
  radKvittering,
} from "./transaksjonsoversikt";
import {
  type KontrollMerke,
  type Kontrollstatus,
  type Transaksjonskontroll,
  kontrollgrunnlag,
  kontrollstatus,
} from "./kvalitetssikring";

export interface KontrollFordeling {
  plasseringId: string;
  plasseringType: PlasseringType;
  /** «Kostnad → Gruppe / Post» (historisk postnavn). */
  postTekst: string;
  /** Fortegn = effekt på posten, i øre. */
  belopOre: number;
  /** Bare andeler > 0. */
  eiere: Eierandel[];
}

export interface KontrollRad {
  id: string;
  dato: string;
  tekst: string;
  konto: string;
  /** Inn = positiv, ut = negativ, i øre. */
  belopOre: number;
  kategori: TilstandKategori;
  statusTekst: string;
  hendelseId: string | null;
  fordelinger: KontrollFordeling[];
  /** Kostnadseierne på tvers av fordelingene, i første rekkefølge. */
  eiere: string[];
  kvittering: "koblet" | "lagt_til" | null;
  /** «Korriger kobling» finnes for ferdige og ventende hendelser. */
  kanKorrigeres: boolean;
  /** «Kvalitetssikret» (#59, 6542594363) — adskilt fra behandlingsstatus. */
  kontroll: {
    status: Kontrollstatus;
    /** Grunnlaget raden viser nå; det som lagres ved «Merk som kvalitetssikret». */
    grunnlag: string;
    /** Den gjeldende kontrollen brukeren ser (samtidighetsvakt ved skriving). */
    gjeldende: KontrollMerke | null;
  };
}

export const tilOre = (kroner: unknown): number =>
  typeof kroner === "number" && Number.isFinite(kroner) ? Math.round(kroner * 100) : 0;

export function kontrollrader(
  transaksjoner: readonly TransaksjonRecord[],
  hendelser: readonly HendelseRecord[],
  receipts: readonly KvitteringRecord[],
  rules: readonly RegelRecord[],
  grupper: PostGrupper,
  kontroller: ReadonlyMap<string, Transaksjonskontroll> = new Map(),
): KontrollRad[] {
  const hListe = [...(hendelser || [])];
  return (transaksjoner || []).map((t) => {
    const h = finnHendelseForTransaksjon(hListe, t.id);
    const tilstand = beskrivTilstand(t, hListe, rules, grupper);
    const fordelinger: KontrollFordeling[] = (h?.fordelinger ?? []).map((f) => ({
      plasseringId: f.plasseringId,
      plasseringType: f.plasseringType,
      postTekst: fordelingTekst(f, grupper),
      belopOre: tilOre(f.belop),
      eiere: (f.eiere ?? []).filter((e) => Number(e.prosent) > 0),
    }));
    const eiere: string[] = [];
    for (const f of fordelinger) {
      for (const e of f.eiere) if (e.person && !eiere.includes(e.person)) eiere.push(e.person);
    }
    const kv = radKvittering(t, hListe, [...(receipts || [])]);
    const absOre = Math.abs(tilOre(t.belop));
    return {
      id: t.id,
      dato: typeof t.dato === "string" ? t.dato : "",
      tekst: t.tekst || "",
      konto: normaliserKonto(t),
      belopOre: t.retning === "inn" ? absOre : -absOre,
      kategori: tilstand.kategori,
      statusTekst: tilstand.tekst,
      hendelseId: h?.id ?? null,
      fordelinger,
      eiere,
      kvittering: kv.koblet ? "koblet" : kv.lagtTil ? "lagt_til" : null,
      kanKorrigeres: !!h && (tilstand.kategori === "ferdig" || tilstand.kategori === "pa_vent"),
      kontroll: (() => {
        const grunnlag = kontrollgrunnlag(t, hListe);
        const k = kontroller.get(t.id);
        return { status: kontrollstatus(k, grunnlag), grunnlag, gjeldende: k?.gjeldende ?? null };
      })(),
    };
  });
}

/** Eierfilterets verdi for rader uten fordeling med eier. */
export const UTEN_EIER = "__uten_eier__";

export interface KontrollFilter {
  maaned: string;
  konto: string;
  sok: string;
  /** `"alle"`, en person, eller `UTEN_EIER`. */
  eier: string;
  /** `"alle"` eller en `plasseringId`. */
  post: string;
  /** `"alle"` eller en tilstandskategori. */
  status: string;
  /** `"alle"` eller en kontrollstatus. */
  kontroll: string;
}

export const TOMT_FILTER: KontrollFilter = {
  maaned: "alle",
  konto: "alle",
  sok: "",
  eier: "alle",
  post: "alle",
  status: "alle",
  kontroll: "alle",
};

export function filtrerKontrollrader(
  rader: readonly KontrollRad[],
  f: KontrollFilter,
): KontrollRad[] {
  const sok = f.sok.trim().toLowerCase();
  const eier = f.eier.toLowerCase();
  return rader.filter(
    (r) =>
      (f.maaned === "alle" || (!!r.dato && maanedNokkel(r.dato) === f.maaned)) &&
      (f.konto === "alle" || r.konto === f.konto) &&
      (!sok || r.tekst.toLowerCase().includes(sok)) &&
      (f.eier === "alle" ||
        (f.eier === UTEN_EIER
          ? r.eiere.length === 0
          : r.eiere.some((p) => p.toLowerCase() === eier))) &&
      (f.post === "alle" || r.fordelinger.some((x) => x.plasseringId === f.post)) &&
      (f.status === "alle" || r.kategori === f.status) &&
      (f.kontroll === "alle" || r.kontroll.status === f.kontroll),
  );
}

export type SorterKolonne = "dato" | "tekst" | "konto" | "belop" | "post" | "eier" | "status";
export interface Sortering {
  kolonne: SorterKolonne;
  synkende: boolean;
}
export const STANDARD_SORTERING: Sortering = { kolonne: "dato", synkende: true };

const nokkel = (r: KontrollRad, k: SorterKolonne): string | number => {
  switch (k) {
    case "dato":
      return r.dato;
    case "tekst":
      return r.tekst.toLowerCase();
    case "konto":
      return r.konto.toLowerCase();
    case "belop":
      return r.belopOre;
    case "post":
      return (r.fordelinger[0]?.postTekst ?? "").toLowerCase();
    case "eier":
      return r.eiere.join(", ").toLowerCase();
    case "status":
      return r.statusTekst.toLowerCase();
  }
};

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Stabil, total orden: valgt kolonne, så nyeste dato, så id. Rader uten
 * verdi (tom tekst/post) havner sist uansett retning.
 */
export function sorterKontrollrader(rader: readonly KontrollRad[], s: Sortering): KontrollRad[] {
  return [...rader].sort((a, b) => {
    const ka = nokkel(a, s.kolonne);
    const kb = nokkel(b, s.kolonne);
    const tomA = ka === "";
    const tomB = kb === "";
    if (tomA !== tomB) return tomA ? 1 : -1;
    const hoved = s.synkende ? cmp(kb, ka) : cmp(ka, kb);
    return hoved || cmp(b.dato, a.dato) || cmp(a.id, b.id);
  });
}

export interface Utvalgssum {
  antall: number;
  /** Inn − ut, i øre. */
  nettoOre: number;
  innOre: number;
  utOre: number;
}

export function summerUtvalg(rader: readonly KontrollRad[]): Utvalgssum {
  let innOre = 0;
  let utOre = 0;
  for (const r of rader) {
    if (r.belopOre >= 0) innOre += r.belopOre;
    else utOre += -r.belopOre;
  }
  return { antall: rader.length, nettoOre: innOre - utOre, innOre, utOre };
}

/** Valg for eier- og postfiltrene, fra radene som faktisk finnes. */
export function filterValg(rader: readonly KontrollRad[]): {
  eiere: string[];
  poster: { id: string; navn: string }[];
} {
  const eiere = new Set<string>();
  const poster = new Map<string, string>();
  for (const r of rader) {
    r.eiere.forEach((p) => eiere.add(p));
    for (const f of r.fordelinger)
      if (!poster.has(f.plasseringId)) poster.set(f.plasseringId, f.postTekst);
  }
  return {
    eiere: [...eiere].sort((a, b) => a.localeCompare(b, "nb")),
    poster: [...poster]
      .map(([id, navn]) => ({ id, navn }))
      .sort((a, b) => a.navn.localeCompare(b.navn, "nb")),
  };
}
