/**
 * Plasseringsvalget i Bankimport-beslutningen (§Issue #34 R3b-1),
 * portert fra legacy `BankimportScreen` (`index.html` ~6572–6641) og
 * VisRad sin start-tilstand (~7201–7214): postlisten, kandidatforslag,
 * oppslag av en gammel matchet post, og forhåndsvalg av fordeling.
 * Rene funksjoner — ingen skriving.
 */
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { MalPost, TransaksjonRecord } from "@app-types/forsoning";
import { budsjettpostMatcherId } from "@domain/budsjettfamilie/budsjettfamilie";
import type { UtkastFordeling } from "./beslutning";
import { beregnRestPaaSisteLinje, byggAlleSparingPoster, jevnFordelEiere } from "./fordeling";

export interface PostGrupperInput {
  budgetGroups: readonly BudsjettGruppe[];
  incomeGroups: readonly BudsjettGruppe[];
  sparingGroups: readonly BudsjettGruppe[];
}

/** En valgbar post med månedens budsjett (for beløpsheuristikken). */
export type PlasseringsPost = MalPost & { belop: number };

export type Kandidat = PlasseringsPost & {
  _score: number;
  _tekstMatch: boolean;
  _belopMatch: boolean;
};

const aktiv = (it: { meta?: { arkivert?: boolean } | null }) => !(it.meta && it.meta.arkivert);
const eierAv = (it: { meta?: { eier?: string } | null }) => (it.meta && it.meta.eier) || "Felles";
const mndBelop = (it: { months?: { budget?: number }[] }, mnd: number) =>
  (it.months && it.months[mnd] ? it.months[mnd]!.budget : 0) || 0;

/** Legacy `allePoster` (~6574): aktive kostnads-, inntekts- og spareposter, med månedens budsjett. */
export function allePoster(g: PostGrupperInput, mnd: number): PlasseringsPost[] {
  return [
    ...g.budgetGroups.flatMap((gr) =>
      gr.items.filter(aktiv).map((it) => ({
        id: it.id,
        name: it.name,
        gruppe: gr.label,
        retning: "ut" as const,
        belop: mndBelop(it, mnd),
        eier: eierAv(it),
      })),
    ),
    ...g.incomeGroups.flatMap((gr) =>
      gr.items.filter(aktiv).map((it) => ({
        id: it.id,
        name: it.name,
        gruppe: gr.label,
        retning: "inn" as const,
        belop: mndBelop(it, mnd),
        eier: eierAv(it),
      })),
    ),
    ...byggAlleSparingPoster([...g.sparingGroups]).map((p) => {
      const gruppeObj = g.sparingGroups.find((gr) => gr.items.some((it) => it.id === p.id));
      const item = gruppeObj && gruppeObj.items.find((it) => it.id === p.id);
      return { ...p, belop: item ? mndBelop(item, mnd) : 0 };
    }),
  ];
}

/** Legacy `finnAktivPostFraGammelId` (~6606): gammel id (også `legacyIds`) → dagens aktive post, ellers null. */
export function finnAktivPostFraGammelId(
  gammelId: string | null | undefined,
  g: PostGrupperInput,
): MalPost | null {
  if (!gammelId) return null;
  for (const gr of g.budgetGroups) {
    const it = gr.items.find((x) => aktiv(x) && budsjettpostMatcherId(x, gammelId));
    if (it) return { id: it.id, name: it.name, gruppe: gr.label, retning: "ut", eier: eierAv(it) };
  }
  for (const gr of g.incomeGroups) {
    const it = gr.items.find((x) => aktiv(x) && budsjettpostMatcherId(x, gammelId));
    if (it) return { id: it.id, name: it.name, gruppe: gr.label, retning: "inn", eier: eierAv(it) };
  }
  for (const gr of g.sparingGroups) {
    const it = gr.items.find((x) => aktiv(x) && budsjettpostMatcherId(x, gammelId));
    if (it) {
      return {
        id: it.id,
        name: it.name,
        gruppe: gr.label,
        retning: "ut",
        plasseringType: "sparing",
        eier: eierAv(it),
      };
    }
  }
  return null;
}

const ord = (s: string | null | undefined) =>
  (s || "")
    .toLowerCase()
    .split(/[,\s]+/)
    .filter((w) => w.length > 3);

/** Legacy `finnKandidater` (~6623): tekst-treff gir 2, beløp innen 15 % gir 1; minst ett treff. */
export function finnKandidater(
  t: Pick<TransaksjonRecord, "tekst" | "belop">,
  poster: readonly PlasseringsPost[],
): Kandidat[] {
  const a = ord(t.tekst);
  return poster
    .map((p) => {
      const b = ord(p.name);
      const tekstMatch = a.some((w) => b.some((x) => x.includes(w) || w.includes(x)));
      const belopMatch = p.belop > 0 && Math.abs(p.belop - t.belop) <= t.belop * 0.15;
      let score = 0;
      if (tekstMatch) score += 2;
      if (belopMatch) score += 1;
      return { ...p, _score: score, _tekstMatch: tekstMatch, _belopMatch: belopMatch };
    })
    .filter((p) => p._score > 0)
    .sort((x, y) => y._score - x._score);
}

/** En utkastlinje med stabil nøkkel for UI-et. */
export type UtkastLinje = UtkastFordeling & { id: string };

/** `beregnRestPaaSisteLinje` for utkastlinjer: siste linje er alltid restbeløpet. */
export function restPaaSisteLinje(linjer: UtkastLinje[], total: number): UtkastLinje[] {
  return beregnRestPaaSisteLinje(
    linjer as unknown as Record<string, unknown>[],
    total,
    "belop",
  ) as unknown as UtkastLinje[];
}

/**
 * VisRad sin start-tilstand for `utkastFordelinger` (~7201): en tidligere
 * propagert match UTEN hendelse forhåndsvelger den gamle posten som forslag
 * (hele beløpet). Kan posten ikke slås opp, gjettes ingenting.
 */
export function startFordelinger(
  t: TransaksjonRecord,
  harHendelse: boolean,
  g: PostGrupperInput,
  newId: () => string,
): UtkastLinje[] {
  if (!harHendelse && (t.status === "matchet" || t.status === "foresoatt_match")) {
    const gammelId = (t.laertKobling && t.laertKobling.budgetItemId) || t.matchetMot;
    const gammelPost = finnAktivPostFraGammelId(gammelId, g);
    if (gammelPost) {
      return restPaaSisteLinje(
        [
          {
            id: newId(),
            post: gammelPost,
            belop: 0,
            // Regelens ansvar (#59) når forslaget kom fra en regel med eget resultat.
            eiere:
              t.laertKobling && t.laertKobling.eiere && t.laertKobling.eiere.length > 0
                ? t.laertKobling.eiere.map((e) => ({ ...e }))
                : jevnFordelEiere([gammelPost.eier || "Felles"]),
          },
        ],
        t.belop || 0,
      );
    }
  }
  return [];
}
