/**
 * Skrivefri preflight for legacy-identitet (ADR 0003, #77 review 5654569092
 * pkt. 1): ville en legacy-skriving av handlelisten beholde hver post under
 * sin egen rånøkkel?
 *
 * Legacy (`index.html`) leser `Object.values(shopping)` og skriver hele noden
 * tilbake som `Object.fromEntries(next.map(i => [i.id, i]))`. En post havner
 * altså under `String(i.id)`. Uten `id` blir det «undefined»; med `id` ulik
 * nøkkelen flyttes posten; flere poster med samme mål kolliderer, og bare den
 * siste overlever. Det gjelder også metadata (`_ops`, markøren) og en
 * eksisterende «undefined»-post.
 *
 * Ren og skrivefri: ingen I/O, ingen reparasjon. Returnerer bare tellinger og
 * koder — aldri navn, mengder, nøkler eller id-er. Vurderes på noden UTEN
 * skrivermarkøren, fordi tilbakeføringen fjerner markøren før legacy kan
 * skrive igjen. Uavhengig av `antallUtenId` i `kontrollerHandleliste`.
 */
import { MARKOR_NOKKEL, erObjekt, oppforinger } from "./overgangKontroll";

export type LegacyIdentitetAvvik = "uten_id" | "id_ulik_nokkel" | "delt_id";

export interface LegacyIdentitet {
  /** Alle oppføringer utenom markøren, også `_`-nøkler og «undefined». */
  antallOppforinger: number;
  /** Uten ikke-tom streng-`id` (også metadata og primitive verdier). */
  antallUtenGyldigId: number;
  /** Gyldig `id`, men ulik rånøkkelen. */
  antallIdUlikNokkel: number;
  /** Gyldig `id` som minst én annen oppføring også har. */
  antallDeltId: number;
  /** Ville fått en annen nøkkel ved en legacy-skriving. */
  antallFlyttes: number;
  /** Ville blitt overskrevet av en annen oppføring med samme mål (tapt). */
  antallTapes: number;
  /** `_`-nøkler og «undefined» som ville blitt flyttet eller overskrevet. */
  antallMetadataBerort: number;
  /** Sann bare når hver oppføring har gyldig `id` lik sin rånøkkel. */
  ok: boolean;
  avvik: LegacyIdentitetAvvik[];
}

const gyldigId = (v: unknown): v is { id: string } =>
  erObjekt(v) && typeof v.id === "string" && v.id !== "";

/** Nøkkelen legacy ville skrevet posten under: `String(i.id)`. */
const legacyMal = (v: unknown) => String(erObjekt(v) ? v.id : undefined);

export function kontrollerLegacyIdentitet(raw: unknown): LegacyIdentitet {
  const poster = oppforinger(raw).filter(([k]) => k !== MARKOR_NOKKEL);
  const idTelling = new Map<string, number>();
  for (const [, v] of poster) if (gyldigId(v)) idTelling.set(v.id, (idTelling.get(v.id) ?? 0) + 1);
  const malTelling = new Map<string, number>();
  for (const [, v] of poster) malTelling.set(legacyMal(v), (malTelling.get(legacyMal(v)) ?? 0) + 1);

  let antallUtenGyldigId = 0;
  let antallIdUlikNokkel = 0;
  let antallDeltId = 0;
  let antallFlyttes = 0;
  let antallMetadataBerort = 0;
  for (const [k, v] of poster) {
    if (!gyldigId(v)) antallUtenGyldigId += 1;
    else {
      if (v.id !== k) antallIdUlikNokkel += 1;
      if (idTelling.get(v.id)! > 1) antallDeltId += 1;
    }
    const berort = legacyMal(v) !== k || malTelling.get(legacyMal(v))! > 1;
    if (legacyMal(v) !== k) antallFlyttes += 1;
    if (berort && (k.startsWith("_") || k === "undefined")) antallMetadataBerort += 1;
  }
  const antallTapes = [...malTelling.values()].reduce((sum, n) => sum + n - 1, 0);

  const avvik: LegacyIdentitetAvvik[] = [];
  if (antallUtenGyldigId > 0) avvik.push("uten_id");
  if (antallIdUlikNokkel > 0) avvik.push("id_ulik_nokkel");
  if (antallDeltId > 0) avvik.push("delt_id");
  return {
    antallOppforinger: poster.length,
    antallUtenGyldigId,
    antallIdUlikNokkel,
    antallDeltId,
    antallFlyttes,
    antallTapes,
    antallMetadataBerort,
    ok: avvik.length === 0,
    avvik,
  };
}
