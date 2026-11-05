/**
 * URL-kontrakt for Transaksjoner (#59, PC-2, ordre 6647608110): visning,
 * kombinerte filtre (også kontrollstatus), sortering og valgt transaksjon
 * ligger i URL-en, så reload, dyplenke og tilbake/frem gir samme utvalg og
 * samme valg.
 *
 * - Bare nøklene i `STYRTE_NOKLER` eies her. Alle andre parametre (`ko`,
 *   `verktoy`, `fra`, …) bevares uendret.
 * - Ukjente eller ugyldige verdier normaliseres til standard. Standarder
 *   skrives ikke, så en tom URL er standardvisningen.
 * - Valgt transaksjon er en stabil transaksjons-ID — aldri en indeks — så
 *   en endring i arrayet kan aldri åpne en annen rad.
 * - Ingen beløp eller andre økonomiske detaljer skrives til URL-en; bare
 *   visningsparametre og det brukeren selv har skrevet i søket.
 *
 * Ren modul.
 */
import type { Kontrollstatus } from "./kvalitetssikring";
import {
  type KontrollFilter,
  STANDARD_SORTERING,
  type SorterKolonne,
  type Sortering,
  TOMT_FILTER,
} from "./kontrollrader";
import type { TilstandKategori } from "./transaksjonsoversikt";

export type Visning = "behandling" | "alle";

export interface OversiktTilstand {
  visning: Visning;
  filter: KontrollFilter;
  sortering: Sortering;
  /** Valgt transaksjons-ID i «Alle transaksjoner», eller `null`. */
  valgt: string | null;
}

export const STANDARD_TILSTAND: OversiktTilstand = {
  visning: "behandling",
  filter: TOMT_FILTER,
  sortering: STANDARD_SORTERING,
  valgt: null,
};

export const STYRTE_NOKLER = [
  "visning",
  "maaned",
  "konto",
  "sok",
  "eier",
  "post",
  "status",
  "kontroll",
  "sorter",
  "rekkefolge",
  "valgt",
] as const;

const KATEGORIER: readonly TilstandKategori[] = [
  "ignorert",
  "intern",
  "ferdig",
  "pa_vent",
  "matchet_uten_hendelse",
  "forslag",
  "krever_vurdering",
  "uferdig",
];
const KONTROLLSTATUSER: readonly Kontrollstatus[] = [
  "ikke_kontrollert",
  "kvalitetssikret",
  "endret_etter_kontroll",
];
const KOLONNER: readonly SorterKolonne[] = [
  "dato",
  "tekst",
  "konto",
  "belop",
  "post",
  "eier",
  "status",
];

const MAKS_SOK = 100;
/** Fjerner kontrolltegn (U+0000–U+001F, U+007F) uten regex med kontrolltegn. */
const utenKontrolltegn = (s: string) =>
  [...s].filter((c) => c.charCodeAt(0) > 0x1f && c.charCodeAt(0) !== 0x7f).join("");
/** Fritt valg (konto, eier, post): ingen kontrolltegn, rimelig lengde. */
const fri = (v: string | null, maks = 80): string | null => {
  const raa = v ?? "";
  if (utenKontrolltegn(raa) !== raa) return null;
  const s = raa.trim();
  return s && s.length <= maks ? s : null;
};
const blant = <T extends string>(v: string | null, lov: readonly T[]): T | null =>
  v !== null && (lov as readonly string[]).includes(v) ? (v as T) : null;
/** Stabil transaksjons-ID: samme tegnsett som appens ID-er (UUID, Firebase-push, legacy). */
export const gyldigId = (v: string | null): string | null =>
  v && /^[A-Za-z0-9_\-:.]{1,128}$/.test(v) ? v : null;

/** Standardretning når bare kolonnen er gitt: nyeste dato først, ellers stigende. */
const standardSynkende = (k: SorterKolonne) => k === "dato";

export function lesOversiktTilstand(p: URLSearchParams): OversiktTilstand {
  const visning: Visning = p.get("visning") === "alle" ? "alle" : "behandling";
  const maaned = p.get("maaned");
  const filter: KontrollFilter = {
    maaned: maaned && /^\d{4}-(0[1-9]|1[0-2])$/.test(maaned) ? maaned : "alle",
    konto: fri(p.get("konto")) ?? "alle",
    sok: utenKontrolltegn(p.get("sok") ?? "").slice(0, MAKS_SOK),
    eier: fri(p.get("eier")) ?? "alle",
    post: fri(p.get("post"), 128) ?? "alle",
    status: blant(p.get("status"), KATEGORIER) ?? "alle",
    kontroll: blant(p.get("kontroll"), KONTROLLSTATUSER) ?? "alle",
  };
  const kolonne = blant(p.get("sorter"), KOLONNER);
  const rekkefolge = p.get("rekkefolge");
  const sortering: Sortering = kolonne
    ? {
        kolonne,
        synkende:
          rekkefolge === "synkende"
            ? true
            : rekkefolge === "stigende"
              ? false
              : standardSynkende(kolonne),
      }
    : STANDARD_SORTERING;
  // Valg finnes bare i «Alle transaksjoner».
  const valgt = visning === "alle" ? gyldigId(p.get("valgt")) : null;
  return { visning, filter, sortering, valgt };
}

/**
 * Ny `URLSearchParams` med tilstanden skrevet inn: styrte nøkler erstattes
 * (standarder utelatt), alle andre parametre bevares i sin rekkefølge.
 */
export function skrivOversiktTilstand(
  forrige: URLSearchParams,
  t: OversiktTilstand,
): URLSearchParams {
  const p = new URLSearchParams();
  forrige.forEach((v, k) => {
    if (!(STYRTE_NOKLER as readonly string[]).includes(k)) p.append(k, v);
  });
  if (t.visning === "alle") p.set("visning", "alle");
  const f = t.filter;
  for (const nokkel of ["maaned", "konto", "eier", "post", "status", "kontroll"] as const) {
    if (f[nokkel] !== "alle") p.set(nokkel, f[nokkel]);
  }
  if (f.sok) p.set("sok", f.sok);
  const s = t.sortering;
  if (s.kolonne !== STANDARD_SORTERING.kolonne || s.synkende !== STANDARD_SORTERING.synkende) {
    p.set("sorter", s.kolonne);
    p.set("rekkefolge", s.synkende ? "synkende" : "stigende");
  }
  if (t.visning === "alle" && t.valgt) p.set("valgt", t.valgt);
  return p;
}

/**
 * Bare søketeksten er endret: oppdater URL-en på stedet (`replace`), så
 * hvert tastetrykk ikke blir en ny historikkoppføring.
 */
export function bareSokEndret(a: OversiktTilstand, b: OversiktTilstand): boolean {
  return (
    a.visning === b.visning &&
    a.valgt === b.valgt &&
    a.sortering.kolonne === b.sortering.kolonne &&
    a.sortering.synkende === b.sortering.synkende &&
    (Object.keys(a.filter) as (keyof KontrollFilter)[]).every(
      (k) => k === "sok" || a.filter[k] === b.filter[k],
    ) &&
    a.filter.sok !== b.filter.sok
  );
}

/**
 * Skal endringen erstatte gjeldende historikkoppføring? Bare når et søk
 * som allerede er i gang fortsetter. Første tegn i et nytt søk lager én
 * oppføring, så «tilbake» går til visningen før søket.
 */
export function erstatterHistorikk(a: OversiktTilstand, b: OversiktTilstand): boolean {
  return a.filter.sok !== "" && bareSokEndret(a, b);
}
