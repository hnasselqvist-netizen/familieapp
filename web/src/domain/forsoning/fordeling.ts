/**
 * Fordeling og plassering — hvordan et beløp legges på én eller flere
 * poster. Rene funksjoner, portert 1:1 fra `index.html` (§Issue #34, R0).
 */
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  Eierandel,
  Fordeling,
  HendelseRecord,
  MalPost,
  MotorDeps,
  Retning,
} from "@app-types/forsoning";

/** 100 % ved én person, jevnt delt (rest på de første) ved flere. Legacy: `jevnFordelEiere`. */
export function jevnFordelEiere(personer: string[] | null | undefined): Eierandel[] {
  if (!personer || personer.length === 0) return [];
  const grunn = Math.floor(100 / personer.length);
  const rest = 100 - grunn * personer.length;
  return personer.map((p, i) => ({ person: p, prosent: grunn + (i < rest ? 1 : 0) }));
}

/** Siste linje får alltid restbeløpet. Legacy: `beregnRestPaaSisteLinje`. */
export function beregnRestPaaSisteLinje<T extends Record<string, unknown>>(
  linjer: T[] | null | undefined,
  totalBelop: number | null | undefined,
  felt: keyof T & string,
): T[] {
  if (!linjer || linjer.length === 0) return linjer || [];
  const sumUtenSiste = linjer
    .slice(0, -1)
    .reduce((s, l) => s + ((l[felt] as number | undefined) || 0), 0);
  const rest = (totalBelop || 0) - sumUtenSiste;
  return linjer.map((l, i) => (i === linjer.length - 1 ? { ...l, [felt]: rest } : l));
}

const aktive = (g: BudsjettGruppe) => g.items.filter((it) => !(it.meta && it.meta.arkivert));

/** Kvitteringens plasserbare poster (kostnad + inntekt, ikke sparing). Legacy: `byggAlleMalPoster`. */
export function byggAlleMalPoster(
  budgetGroups: BudsjettGruppe[] | null | undefined,
  incomeGroups: BudsjettGruppe[] | null | undefined,
): MalPost[] {
  return [
    ...(budgetGroups || []).flatMap((g) =>
      aktive(g).map((it) => ({
        id: it.id,
        name: it.name,
        gruppe: g.label,
        targetType: "budget" as const,
        eier: (it.meta && it.meta.eier) || "Felles",
      })),
    ),
    ...(incomeGroups || []).flatMap((g) =>
      aktive(g).map((it) => ({
        id: it.id,
        name: it.name,
        gruppe: g.label,
        targetType: "income" as const,
        eier: (it.meta && it.meta.eier) || "Felles",
      })),
    ),
  ];
}

/** Spareposter med eksplisitt `plasseringType:"sparing"`. Legacy: `byggAlleSparingPoster`. */
export function byggAlleSparingPoster(
  sparingGroups: BudsjettGruppe[] | null | undefined,
): MalPost[] {
  return (sparingGroups || []).flatMap((g) =>
    aktive(g).map((it) => ({
      id: it.id,
      name: it.name,
      gruppe: g.label,
      retning: "ut" as const,
      plasseringType: "sparing" as const,
      eier: (it.meta && it.meta.eier) || "Felles",
    })),
  );
}

/**
 * Én fordelingslinje fra en post. Motsatt retning av observasjonen gir
 * negativt beløp (refusjon). `plasseringType` overstyrer retningsavledningen
 * (sparing har `retning:"ut"` som kostnad). Legacy: `byggFordelingFraPost`.
 */
export function byggFordelingFraPost(
  post: MalPost,
  belop: number | null | undefined,
  eiere: Eierandel[] | null | undefined,
  observasjonRetning: Retning | undefined,
): Fordeling {
  const motsattRetning = post.retning !== observasjonRetning;
  return {
    plasseringId: post.id,
    plasseringType: post.plasseringType || (post.retning === "inn" ? "income" : "budget"),
    plasseringNavn: post.name,
    belop: motsattRetning ? -(belop || 0) : belop || 0,
    eiere: eiere || [],
  };
}

/** Økonomisk hendelse uten bank (f.eks. gavekort). Legacy: `byggManuellHendelse`. */
export function byggManuellHendelse(
  dato: string,
  post: MalPost,
  belop: number,
  kommentar: string | null | undefined,
  eiere: Eierandel[] | null | undefined,
  deps: MotorDeps,
): HendelseRecord {
  return {
    id: deps.newId(),
    status: "ferdig",
    paaVentAarsak: null,
    transaksjonId: null,
    receiptId: null,
    fordelinger: [
      byggFordelingFraPost(
        post,
        belop,
        eiere && eiere.length > 0 ? eiere : [{ person: "Felles", prosent: 100 }],
        post.retning,
      ),
    ],
    dato,
    regelId: null,
    kilde: "manuell",
    kommentar: kommentar || null,
    opprettet: deps.naa,
    oppdatert: deps.naa,
  };
}

export interface KorrigeringsUtkast {
  type: "uklar" | "plassert";
  fordelinger?: { post: MalPost; belop: number; eiere?: Eierandel[]; postErEndret?: boolean }[];
  uklarValg?: string | null;
  regelId?: string | null;
}

/**
 * Korrigert versjon av en eksisterende hendelse. Uendrede linjer beholder
 * sitt lagrede fortegn; kun linjer med ny post bygges på nytt.
 * Legacy: `byggKorrigertHendelse`.
 */
export function byggKorrigertHendelse(
  eksisterende: HendelseRecord,
  transaksjonRetning: Retning | undefined,
  utkast: KorrigeringsUtkast,
  naa: string,
): HendelseRecord {
  const { type, fordelinger, uklarValg, regelId } = utkast;
  if (type === "uklar") {
    return {
      ...eksisterende,
      status: "pa_vent",
      paaVentAarsak: uklarValg || null,
      fordelinger: [],
      oppdatert: naa,
    };
  }
  const bygget: Fordeling[] = (fordelinger || []).map((f) =>
    f.postErEndret
      ? byggFordelingFraPost(f.post, f.belop, f.eiere, transaksjonRetning)
      : {
          plasseringId: f.post.id,
          plasseringType: f.post.plasseringType || (f.post.retning === "inn" ? "income" : "budget"),
          plasseringNavn: f.post.name,
          belop: f.belop || 0,
          eiere: f.eiere || [],
        },
  );
  return {
    ...eksisterende,
    status: "ferdig",
    paaVentAarsak: null,
    fordelinger: bygget,
    regelId: regelId !== undefined ? regelId : eksisterende.regelId || null,
    oppdatert: naa,
  };
}

/** Legacy: `finnHendelseForTransaksjon` — hendelsen er sannheten, ikke `transaksjon.hendelseId`. */
export function finnHendelseForTransaksjon<H extends { transaksjonId: string | null }>(
  hendelser: H[] | null | undefined,
  transaksjonId: string | null | undefined,
): H | null {
  if (!transaksjonId) return null;
  return (hendelser || []).find((h) => h.transaksjonId === transaksjonId) || null;
}

/** Legacy: `finnHendelseForKvittering`. */
export function finnHendelseForKvittering<H extends { receiptId: string | null }>(
  hendelser: H[] | null | undefined,
  receiptId: string | null | undefined,
): H | null {
  if (!receiptId) return null;
  return (hendelser || []).find((h) => h.receiptId === receiptId) || null;
}
