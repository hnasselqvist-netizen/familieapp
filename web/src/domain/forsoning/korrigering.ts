/**
 * Korrigering av en eksisterende hendelse (§Issue #34 R3b-4), portert fra
 * legacy `KorrigerHendelseModal` (`index.html` ~10998) og dens to kallere:
 * «Korriger kobling» i Bankimport (~8289) og drilldown fra postdetalj i
 * Budsjett/Inntekter/Sparing (~11686, ~12119, ~12465). Alle tre skriver
 * likt: hendelsen erstattes (filter + legg til), og ved læring oppdateres
 * `rules` med `oppdaterReglerVedLaering(…, false)`.
 *
 * Rene funksjoner på modalens utkast. `lagreKorrigering` gir en
 * `Beslutningsendring` til den felles skriveren bak forsoningsporten.
 */
import { budsjettpostMatcherId } from "@domain/budsjettfamilie/budsjettfamilie";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  Eierandel,
  Fordeling,
  HendelseRecord,
  MalPost,
  MotorDeps,
  RegelRecord,
  Retning,
  TransaksjonRecord,
} from "@app-types/forsoning";
import type { Beslutningsendring } from "./beslutning";
import {
  beregnRestPaaSisteLinje,
  byggAlleSparingPoster,
  byggFordelingFraPost,
  byggKorrigertHendelse,
  jevnFordelEiere,
} from "./fordeling";
import { finnLaertRegel, oppdaterReglerVedLaering } from "./regler";
import { normaliserTransaksjonstekst } from "./tekst";
import type { PostGrupper } from "./transaksjonsoversikt";

export interface KorrigeringsLinje {
  id: string;
  post: MalPost;
  belop: number;
  eiere: Eierandel[];
  /** Ny post i denne økten → beløpet er rått og tolkes ved lagring. */
  postErEndret: boolean;
}

export interface Korrigering {
  type: "uklar" | null;
  linjer: KorrigeringsLinje[];
  uklar: string | null;
  /** Alltid av som standard — en historisk korrigering endrer aldri regler stille. */
  laer: boolean;
  /** Kontovilkår for læringen (kanonisk kontonøkkel), eller `null`/mangler = alle kontoer. */
  laerKonto?: string | null;
}

/** Observasjonen hendelsen korrigeres mot (en ekte transaksjon, eller bare retningen). */
export type KorrigeringsObservasjon = Partial<TransaksjonRecord> & { retning: Retning };

/**
 * Legacy-kallernes `transaksjonForKorrigering`: transaksjonen, eller for en
 * manuell hendelse en syntetisk observasjon med retning fra første
 * fordeling (inntekt → «inn»), ellers null.
 */
export function observasjonForKorrigering(
  hendelse: HendelseRecord,
  transaksjoner: readonly TransaksjonRecord[],
): KorrigeringsObservasjon | null {
  if (hendelse.transaksjonId) {
    return transaksjoner.find((t) => t.id === hendelse.transaksjonId) ?? null;
  }
  if (hendelse.kilde === "manuell") {
    const forste = hendelse.fordelinger && hendelse.fordelinger[0];
    return { retning: forste && forste.plasseringType === "income" ? "inn" : "ut" };
  }
  return null;
}

/** Legacy `finnPost`: dagens post (også via `legacyIds`, også arkivert), ellers historisk navn. */
export function postForFordeling(f: Fordeling, grupper: PostGrupper): MalPost {
  const groups =
    f.plasseringType === "income"
      ? grupper.incomeGroups
      : f.plasseringType === "sparing"
        ? grupper.sparingGroups
        : grupper.budgetGroups;
  for (const g of groups || []) {
    const item = (g.items || []).find((it) => budsjettpostMatcherId(it, f.plasseringId));
    if (item) {
      return {
        id: item.id,
        name: item.name,
        retning: f.plasseringType === "income" ? "inn" : "ut",
        gruppe: g.label,
        eier: (item.meta && item.meta.eier) || "Felles",
        plasseringType: f.plasseringType === "sparing" ? "sparing" : undefined,
      };
    }
  }
  return {
    id: f.plasseringId,
    name: f.plasseringNavn || "(post ikke lenger tilgjengelig)",
    retning: f.plasseringType === "income" ? "inn" : "ut",
    gruppe: null as unknown as string,
    eier: "Felles",
    plasseringType: f.plasseringType === "sparing" ? "sparing" : undefined,
  };
}

/** Modalens startutkast: på vent → «uklar», ellers hendelsens fordelinger uendret. */
export function startKorrigering(
  hendelse: HendelseRecord,
  grupper: PostGrupper,
  newId: () => string,
): Korrigering {
  return {
    type: hendelse.status === "pa_vent" ? "uklar" : null,
    linjer: (hendelse.fordelinger || []).map((f) => ({
      id: newId(),
      post: postForFordeling(f, grupper),
      belop: f.belop,
      eiere: f.eiere && f.eiere.length > 0 ? f.eiere : [{ person: "Felles", prosent: 100 }],
      postErEndret: false,
    })),
    uklar: hendelse.paaVentAarsak || null,
    laer: false,
  };
}

/** Søkbare mål: aktive kostnads- og inntektsposter pluss spareposter (legacy `allePoster`). */
export function korrigeringsPoster(grupper: PostGrupper): MalPost[] {
  const aktive = <T extends { meta?: { arkivert?: boolean } | null }>(items: T[]) =>
    items.filter((it) => !(it.meta && it.meta.arkivert));
  return [
    ...(grupper.budgetGroups || []).flatMap((g) =>
      aktive(g.items).map((it) => ({
        id: it.id,
        name: it.name,
        gruppe: g.label,
        retning: "ut" as const,
        eier: (it.meta && it.meta.eier) || "Felles",
      })),
    ),
    ...(grupper.incomeGroups || []).flatMap((g) =>
      aktive(g.items).map((it) => ({
        id: it.id,
        name: it.name,
        gruppe: g.label,
        retning: "inn" as const,
        eier: (it.meta && it.meta.eier) || "Felles",
      })),
    ),
    ...byggAlleSparingPoster(grupper.sparingGroups as BudsjettGruppe[]),
  ];
}

/** Legacy `sokTreff`: allerede valgte poster skjules, unntatt når en linje får ny post. */
export function sokKorrigeringsPoster(
  poster: readonly MalPost[],
  sok: string,
  linjer: readonly KorrigeringsLinje[],
  redigerLinje: number | null,
): MalPost[] {
  const s = sok.trim().toLowerCase();
  if (!s) return [];
  const valgte = new Set(linjer.map((f) => f.post.id));
  return poster.filter(
    (p) => p.name.toLowerCase().includes(s) && (redigerLinje !== null || !valgte.has(p.id)),
  );
}

const medRest = (linjer: KorrigeringsLinje[], total: number) =>
  beregnRestPaaSisteLinje(
    linjer as unknown as Record<string, unknown>[],
    total,
    "belop",
  ) as unknown as KorrigeringsLinje[];

/** Beløpet linjene fordeler (legacy `transBelop`). */
export const korrigeringsTotal = (o: KorrigeringsObservasjon | null) =>
  Math.abs(o ? o.belop || 0 : 0);
/** Retningen fortegn tolkes mot (legacy `transRetning`). */
export const korrigeringsRetning = (o: KorrigeringsObservasjon | null): Retning =>
  o ? o.retning : "ut";

/** Legacy `leggTilFordeling`: ny linje (rått beløp), rest på siste. */
export function leggTilKorrigeringslinje(
  linjer: readonly KorrigeringsLinje[],
  post: MalPost,
  total: number,
  newId: () => string,
): KorrigeringsLinje[] {
  return medRest(
    [
      ...linjer,
      {
        id: newId(),
        post,
        belop: 0,
        eiere: jevnFordelEiere([post.eier || "Felles"]),
        postErEndret: true,
      },
    ],
    total,
  );
}

/**
 * Legacy `velgPostForLinje` med valgt linje: bytt post. Et lagret (signert)
 * beløp gjøres rått igjen første gang posten byttes, så ny post får riktig
 * fortegn ved lagring.
 */
export function byttPostPaaLinje(
  linjer: readonly KorrigeringsLinje[],
  idx: number,
  post: MalPost,
  retning: Retning,
): KorrigeringsLinje[] {
  return linjer.map((f, i) => {
    if (i !== idx) return f;
    const raattBelop = f.postErEndret
      ? f.belop
      : byggFordelingFraPost(f.post, f.belop, f.eiere, retning).belop;
    return { ...f, post, belop: raattBelop, postErEndret: true };
  });
}

/** Legacy `oppdaterBelop`. */
export function settKorrigeringsBelop(
  linjer: readonly KorrigeringsLinje[],
  idx: number,
  belop: number,
  total: number,
): KorrigeringsLinje[] {
  return medRest(
    linjer.map((f, i) => (i !== idx ? f : { ...f, belop })),
    total,
  );
}

/** Legacy `oppdaterEiere`. */
export function settKorrigeringsEiere(
  linjer: readonly KorrigeringsLinje[],
  idx: number,
  eiere: Eierandel[],
): KorrigeringsLinje[] {
  return linjer.map((f, i) => (i !== idx ? f : { ...f, eiere }));
}

/** Legacy `fjernFordeling`. */
export function fjernKorrigeringslinje(
  linjer: readonly KorrigeringsLinje[],
  idx: number,
  total: number,
): KorrigeringsLinje[] {
  const nye = linjer.filter((_, i) => i !== idx);
  return nye.length > 0 ? medRest(nye, total) : nye;
}

/** Legacy `kanLagre`. */
export const kanLagreKorrigering = (k: Korrigering) => k.type === "uklar" || k.linjer.length > 0;

/**
 * Legacy `lagre` + kallerens `onLagre`: hendelsen erstattes; læring (kun én
 * linje og en observasjon) oppdaterer `rules` mot fersk liste.
 */
export function lagreKorrigering(
  hendelse: HendelseRecord,
  observasjon: KorrigeringsObservasjon | null,
  k: Korrigering,
  rules: readonly RegelRecord[],
  deps: MotorDeps,
): Beslutningsendring {
  const retning = korrigeringsRetning(observasjon);
  let oppdatert: HendelseRecord;
  let laer: { transaksjon: KorrigeringsObservasjon; post: MalPost; eiere: Eierandel[] } | null =
    null;
  if (k.type === "uklar") {
    oppdatert = byggKorrigertHendelse(
      hendelse,
      retning,
      { type: "uklar", uklarValg: k.uklar },
      deps.naa,
    );
  } else {
    let regelId = hendelse.regelId || null;
    if (k.laer && k.linjer.length === 1 && observasjon) {
      const forste = k.linjer[0]!;
      const normPattern = normaliserTransaksjonstekst(observasjon.tekst);
      const eksisterende = finnLaertRegel(rules, normPattern, forste.post.id, k.laerKonto);
      regelId = eksisterende ? eksisterende.id : null;
      laer = { transaksjon: observasjon, post: forste.post, eiere: forste.eiere };
    }
    oppdatert = byggKorrigertHendelse(
      hendelse,
      retning,
      { type: "plassert", fordelinger: k.linjer, regelId },
      deps.naa,
    );
  }
  return {
    hendelser: (prev) => [...prev.filter((h) => h.id !== oppdatert.id), oppdatert],
    ...(laer
      ? {
          rules: (prev: RegelRecord[]) =>
            oppdaterReglerVedLaering(
              prev,
              laer.transaksjon as Pick<TransaksjonRecord, "tekst">,
              laer.post,
              false,
              deps,
              { kontoVilkar: k.laerKonto || null, eiere: laer.eiere },
            ),
        }
      : {}),
  };
}
