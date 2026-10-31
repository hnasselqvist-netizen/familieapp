/**
 * Regelmotoren (RegelSenter + Bankimport-læring) — rene funksjoner,
 * portert 1:1 fra `index.html` ~9121–9420 (§Issue #34, R0). Skriver
 * ingenting selv; kalleren orkestrerer.
 *
 * Kjente, UENDREDE særegenheter (dokumentert i kartleggingen 5938206324,
 * ikke rettet i en ren port):
 *  - `regelMatcherTekst` med `inneholder` matcher også når MØNSTERET
 *    inneholder teksten (`rPattern.includes(t)`), ikke bare omvendt.
 *  - Automatisk plassering bruker `Felles 100 %` for regler uten eget ansvar.
 *
 * Bevisst utvidelse (#59, avanserte regler): en regel kan i tillegg ha et
 * kontovilkår (`kontoVilkar`). Da må BÅDE teksten og kontoen betalingen er
 * gjort fra stemme (AND). Regler uten kontovilkår oppfører seg nøyaktig som
 * legacy — de treffer på alle kontoer og rangeres som før.
 *
 * Og (#59): en regel kan bære sitt eget RESULTAT for eierskap (`eiere`).
 * Treffvilkår (tekst, konto) og resultat (post, ansvar) er atskilt: kontoen
 * bestemmer aldri eier. Regler uten `eiere` plasserer `Felles 100 %` som før.
 */
import type { BudsjettGruppe, BudsjettPost } from "@app-types/budsjettfamilie";
import type {
  Eierandel,
  Fordeling,
  HendelseRecord,
  MalPost,
  MotorDeps,
  PlasseringType,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { normaliserKonto } from "./bankimportParse";
import { byggFordelingFraPost, finnHendelseForTransaksjon } from "./fordeling";
import { normaliserTransaksjonstekst } from "./tekst";

/** Legacy: `regelMatcherTekst`. */
export function regelMatcherTekst(
  rule: Pick<RegelRecord, "normalizedPattern" | "pattern" | "matchType">,
  tekst: string | null | undefined,
): boolean {
  const rPattern = (rule.normalizedPattern || rule.pattern || "").toLowerCase();
  const t = (tekst || "").toLowerCase();
  if (!rPattern || !t) return false;
  const type = rule.matchType || "inneholder";
  if (type === "er_lik") return t === rPattern;
  if (type === "starter_med") return t.startsWith(rPattern);
  return t.includes(rPattern) || rPattern.includes(t);
}

/** Kontoen en betaling er gjort fra, slik `normaliserKonto` leser den. */
export interface KontoKilde {
  konto?: string | null;
  importkilde?: string | null;
}

/**
 * Kontovilkåret: uten vilkår treffer regelen alle kontoer; med vilkår bare
 * betalinger fra den kanoniske kontoen. En betaling uten kjent konto
 * (`normaliserKonto` → `"?"`) treffer aldri en kontoregel.
 */
export function regelMatcherKonto(
  rule: Pick<RegelRecord, "kontoVilkar">,
  t: KontoKilde | null | undefined,
): boolean {
  if (!rule.kontoVilkar) return true;
  return normaliserKonto(t || {}) === rule.kontoVilkar;
}

/** Normalisert kontovilkår: tom streng og manglende felt betyr begge «alle kontoer». */
export const kontoVilkarFor = (rule: Pick<RegelRecord, "kontoVilkar">): string | null =>
  rule.kontoVilkar || null;

/** Ansvaret regler uten eget resultat plasserer med — uendret fra legacy. */
export const STANDARD_REGEL_EIERE: readonly Eierandel[] = [{ person: "Felles", prosent: 100 }];

/** Ansvaret en regel plasserer med: regelens eget, ellers `Felles 100 %`. */
export function regelEiere(rule: Pick<RegelRecord, "eiere">): Eierandel[] {
  return rule.eiere && rule.eiere.length > 0
    ? rule.eiere.map((e) => ({ ...e }))
    : STANDARD_REGEL_EIERE.map((e) => ({ ...e }));
}

export interface RegelTreff {
  rule: RegelRecord | null;
  confidence: number;
  begrunnelse: string;
}

/**
 * Beste aktive regel for en transaksjon. Legacy: `findMatchingRule`.
 *
 * Utvidelse: en regel med kontovilkår teller bare når kontoen stemmer, og
 * den mer spesifikke regelen (tekst + konto) vinner alltid over en ren
 * tekstregel — ellers ville «REMA 1000 → Mat» overstyre «REMA 1000 · bare
 * Helen → …» bare fordi den hadde høyere tillit. Mellom like spesifikke
 * regler avgjør poengsummen som i legacy.
 */
export function findMatchingRule(
  transaction: ({ normalizedText?: string; tekst?: string } & KontoKilde) | null | undefined,
  rules: RegelRecord[] | null | undefined,
): RegelTreff {
  if (!transaction || !rules || !rules.length) {
    return { rule: null, confidence: 0, begrunnelse: "Ingen regler tilgjengelig" };
  }
  const aktiveRegler = rules.filter((r) => r.active !== false && r.mode !== "disabled");
  if (!aktiveRegler.length)
    return { rule: null, confidence: 0, begrunnelse: "Ingen aktive regler" };

  const tTekst = (transaction.normalizedText || transaction.tekst || "").toLowerCase();
  const scored = aktiveRegler
    .map((r) => {
      const spesifikk = kontoVilkarFor(r) ? 1 : 0;
      if (!regelMatcherTekst(r, tTekst))
        return { rule: r, score: 0, spesifikk, begrunnelse: "Ingen tekstlikhet" };
      if (!regelMatcherKonto(r, transaction))
        return { rule: r, score: 0, spesifikk, begrunnelse: "Annen konto" };
      const type = r.matchType || "inneholder";
      const grunnscore = type === "er_lik" ? 100 : type === "starter_med" ? 85 : 70;
      const tekstBegrunnelse =
        type === "er_lik"
          ? "Eksakt treff pa normalisert tekst"
          : type === "starter_med"
            ? "Starter med monsteret"
            : "Monsteret inngar i teksten";
      const begrunnelse = spesifikk ? tekstBegrunnelse + " og kontoen stemmer" : tekstBegrunnelse;
      const vektet = Math.round(
        grunnscore * ((r.confidence !== undefined ? r.confidence : 100) / 100),
      );
      return { rule: r, score: vektet, spesifikk, begrunnelse };
    })
    .filter((s) => s.score > 0);

  if (!scored.length) {
    return { rule: null, confidence: 0, begrunnelse: "Ingen regel matcher denne transaksjonen" };
  }
  // Stabil sortering: uten kontoregler er rekkefølgen identisk med legacy.
  scored.sort((a, b) => b.spesifikk - a.spesifikk || b.score - a.score);
  const best = scored[0]!;
  return { rule: best.rule, confidence: best.score, begrunnelse: best.begrunnelse };
}

export interface MalpostTreff {
  item: BudsjettPost;
  kildeType: PlasseringType;
  gruppeId: string;
}

/** Regelens målpost; søker budget → income → sparing. Legacy: `finnMalpostForRegel`. */
export function finnMalpostForRegel(
  regel: Pick<RegelRecord, "targetId">,
  budgetGroups: BudsjettGruppe[] | null | undefined,
  incomeGroups: BudsjettGruppe[] | null | undefined,
  sparingGroups: BudsjettGruppe[] | null | undefined,
): MalpostTreff | null {
  const kilder: [BudsjettGruppe[] | null | undefined, PlasseringType][] = [
    [budgetGroups, "budget"],
    [incomeGroups, "income"],
    [sparingGroups, "sparing"],
  ];
  for (const [grupper, kildeType] of kilder) {
    for (const g of grupper || []) {
      const it = (g.items || []).find((x) => x.id === regel.targetId);
      if (it) return { item: it, kildeType, gruppeId: g.id };
    }
  }
  return null;
}

export type EvalUtfall = "ingen_treff" | "mal_mangler" | "forslag" | "auto";

export interface EvalResultat {
  transaksjonId: string;
  utfall: EvalUtfall;
  regel: RegelRecord | null;
  target: MalpostTreff | null;
  aarsak: string | null;
}

export interface RegelEvaluering {
  vurdert: number;
  ingenTreff: EvalResultat[];
  auto: EvalResultat[];
  forslag: EvalResultat[];
  malMangler: EvalResultat[];
  alle: EvalResultat[];
}

/**
 * Vurderer aktive regler mot transaksjoner uten FERDIG hendelse
 * (ignorert og intern overføring utelatt). På-vent overskrives aldri —
 * blir alltid et forslag. Legacy: `evaluerReglerMotUavklarteTransaksjoner`.
 */
export function evaluerReglerMotUavklarteTransaksjoner(
  transaksjoner: TransaksjonRecord[] | null | undefined,
  hendelser: HendelseRecord[] | null | undefined,
  rules: RegelRecord[] | null | undefined,
  budgetGroups: BudsjettGruppe[] | null | undefined,
  incomeGroups: BudsjettGruppe[] | null | undefined,
  sparingGroups: BudsjettGruppe[] | null | undefined,
): RegelEvaluering {
  const kandidater = (transaksjoner || []).filter((t) => {
    if (t.status === "ignorert") return false;
    if (t.behandlingstype === "intern_overforing") return false;
    const h = finnHendelseForTransaksjon(hendelser, t.id);
    if (h && h.status === "ferdig") return false;
    return true;
  });

  const resultater: EvalResultat[] = kandidater.map((t) => {
    const h = finnHendelseForTransaksjon(hendelser, t.id);
    const erPaaVent = !!(h && h.status === "pa_vent");
    const tTekst = t.normalizedText || normaliserTransaksjonstekst(t.tekst || "");
    const treff = findMatchingRule(
      { normalizedText: tTekst, konto: t.konto, importkilde: t.importkilde },
      rules || [],
    );
    if (!treff.rule) {
      return {
        transaksjonId: t.id,
        utfall: "ingen_treff",
        regel: null,
        target: null,
        aarsak: null,
      };
    }
    const regel = treff.rule;
    const target = finnMalpostForRegel(regel, budgetGroups, incomeGroups, sparingGroups);
    if (!target) {
      return { transaksjonId: t.id, utfall: "mal_mangler", regel, target: null, aarsak: null };
    }
    if (erPaaVent)
      return { transaksjonId: t.id, utfall: "forslag", regel, target, aarsak: "pa_vent" };
    if (regel.mode === "auto")
      return { transaksjonId: t.id, utfall: "auto", regel, target, aarsak: null };
    return { transaksjonId: t.id, utfall: "forslag", regel, target, aarsak: regel.mode };
  });

  return {
    vurdert: resultater.length,
    ingenTreff: resultater.filter((r) => r.utfall === "ingen_treff"),
    auto: resultater.filter((r) => r.utfall === "auto"),
    forslag: resultater.filter((r) => r.utfall === "forslag"),
    malMangler: resultater.filter((r) => r.utfall === "mal_mangler"),
    alle: resultater,
  };
}

export interface EndringsplanLinje {
  transaksjonId: string;
  handling: "auto" | "forslag" | "forslag_pa_vent" | "mal_mangler";
  skalSkrives: boolean;
  regel: RegelRecord | null;
  target: MalpostTreff | null;
  transaksjon: TransaksjonRecord | null;
  fordeling: Fordeling | null;
  hendelseId: string | null;
}

/**
 * ÉN deterministisk plan brukt til både forhåndsvisning og skriving.
 * `newId` erstatter legacy sin `uid()` (eneste ikke-deterministiske ledd).
 * Legacy: `byggKjorReglerEndringsplan`.
 */
export function byggKjorReglerEndringsplan(
  evaluering: RegelEvaluering,
  transaksjoner: TransaksjonRecord[] | null | undefined,
  newId: () => string,
): EndringsplanLinje[] {
  const linjer: EndringsplanLinje[] = [];
  const finn = (id: string) => (transaksjoner || []).find((x) => x.id === id) || null;

  evaluering.auto.forEach((r) => {
    const t = finn(r.transaksjonId);
    if (!t) {
      linjer.push({
        transaksjonId: r.transaksjonId,
        handling: "auto",
        skalSkrives: false,
        regel: r.regel,
        target: r.target,
        transaksjon: null,
        fordeling: null,
        hendelseId: null,
      });
      return;
    }
    const regel = r.regel!;
    const post: MalPost = {
      id: regel.targetId,
      name: regel.targetName,
      retning: r.target!.kildeType === "income" ? "inn" : "ut",
      plasseringType: r.target!.kildeType === "sparing" ? "sparing" : undefined,
    };
    const fordeling = byggFordelingFraPost(post, t.belop, regelEiere(regel), t.retning);
    linjer.push({
      transaksjonId: t.id,
      handling: "auto",
      skalSkrives: true,
      regel: r.regel,
      target: r.target,
      transaksjon: t,
      fordeling,
      hendelseId: newId(),
    });
  });

  evaluering.forslag.forEach((r) => {
    const t = finn(r.transaksjonId);
    if (r.aarsak === "pa_vent") {
      linjer.push({
        transaksjonId: r.transaksjonId,
        handling: "forslag_pa_vent",
        skalSkrives: false,
        regel: r.regel,
        target: r.target,
        transaksjon: t,
        fordeling: null,
        hendelseId: null,
      });
      return;
    }
    linjer.push({
      transaksjonId: r.transaksjonId,
      handling: "forslag",
      skalSkrives: true,
      regel: r.regel,
      target: r.target,
      transaksjon: t,
      fordeling: null,
      hendelseId: null,
    });
  });

  evaluering.malMangler.forEach((r) => {
    linjer.push({
      transaksjonId: r.transaksjonId,
      handling: "mal_mangler",
      skalSkrives: false,
      regel: r.regel,
      target: null,
      transaksjon: finn(r.transaksjonId),
      fordeling: null,
      hendelseId: null,
    });
  });

  return linjer;
}

/** Semantisk sammenligning — ignorerer `hendelseId` og tidsstempler. Legacy: `erEndringsplanUendret`. */
export function erEndringsplanUendret(
  planA: EndringsplanLinje[],
  planB: EndringsplanLinje[],
): boolean {
  if (planA.length !== planB.length) return false;
  const noekkel = (l: EndringsplanLinje) =>
    JSON.stringify({
      transaksjonId: l.transaksjonId,
      handling: l.handling,
      skalSkrives: l.skalSkrives,
      regelId: l.regel ? l.regel.id : null,
      targetId: l.target && l.target.item ? l.target.item.id : null,
      fordeling: l.fordeling
        ? {
            plasseringId: l.fordeling.plasseringId,
            plasseringType: l.fordeling.plasseringType,
            belop: l.fordeling.belop,
            // Ansvaret er en del av det som skrives — en endret regel-eier må
            // gi ny forhåndsvisning. Uten regel-eiere er dette alltid Felles 100 %.
            eiere: l.fordeling.eiere,
          }
        : null,
    });
  const a = planA.map(noekkel).sort();
  const b = planB.map(noekkel).sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Skriver en godkjent plan byte-for-byte (bygger aldri noe på nytt).
 * Returnerer NYE arrays; kalleren skriver. Legacy: `skrivEndringsplan`.
 */
export function skrivEndringsplan(
  plan: EndringsplanLinje[],
  transaksjoner: TransaksjonRecord[] | null | undefined,
  naa: string,
): { nyeTransaksjoner: TransaksjonRecord[]; nyeHendelser: HendelseRecord[] } {
  const nyeHendelser: HendelseRecord[] = [];
  const oppdateringer = new Map<string, Partial<TransaksjonRecord>>();

  plan.forEach((l) => {
    if (!l.skalSkrives) return;
    if (l.handling === "auto") {
      nyeHendelser.push({
        id: l.hendelseId!,
        status: "ferdig",
        paaVentAarsak: null,
        transaksjonId: l.transaksjonId,
        receiptId: null,
        fordelinger: [l.fordeling!],
        dato: l.transaksjon!.dato,
        regelId: l.regel!.id,
        opprettet: naa,
        oppdatert: naa,
      });
      oppdateringer.set(l.transaksjonId, { hendelseId: l.hendelseId });
    } else if (l.handling === "forslag") {
      oppdateringer.set(l.transaksjonId, {
        status: "krever_vurdering",
        matchetMot: l.target!.item.id,
        matchetNavn: l.regel!.targetName,
        laertKobling: {
          budgetItemId: l.target!.item.id,
          navn: l.regel!.targetName,
          gruppe: l.target!.gruppeId,
          flerbruk: true,
          ...(l.regel!.eiere && l.regel!.eiere.length > 0 ? { eiere: regelEiere(l.regel!) } : {}),
        },
      });
    }
  });

  const nyeTransaksjoner = (transaksjoner || []).map((t) => {
    const oppdatering = oppdateringer.get(t.id);
    return oppdatering ? { ...t, ...oppdatering } : t;
  });
  return { nyeTransaksjoner, nyeHendelser };
}

/**
 * Regelen en læring gjenbruker: samme målpost, teksten treffer, og SAMME
 * kontovilkår. En læring for «alle kontoer» gjenbruker aldri en kontoregel
 * og omvendt, så ingen eksisterende regel skrives stille om til en annen
 * type. Uten kontoregler er dette legacy sitt oppslag.
 */
export function finnLaertRegel(
  rules: readonly RegelRecord[] | null | undefined,
  normTekst: string,
  postId: string,
  kontoVilkar?: string | null,
): RegelRecord | undefined {
  const k = kontoVilkar || null;
  return (rules || []).find(
    (r) => r.targetId === postId && kontoVilkarFor(r) === k && regelMatcherTekst(r, normTekst),
  );
}

/** Utvidelsene en læring kan bære (#59): treffvilkår og resultat utover legacy. */
export interface LaeringsValg {
  /** Treffvilkår: bare betalinger fra denne kontoen (kanonisk nøkkel). */
  kontoVilkar?: string | null;
  /** Resultat: ansvaret Helen valgte ved plasseringen. */
  eiere?: Eierandel[] | null;
}

/**
 * Lærer (oppretter eller oppdaterer) en regel fra en plassering.
 * Returnerer den NYE regellisten. Legacy: `oppdaterReglerVedLaering`.
 *
 * Utvidelser (#59): `kontoVilkar` lærer en sammensatt regel (tekst + konto);
 * `eiere` lagrer ansvaret som regelens resultat. En gjenlæring er Helens
 * eksplisitte valg, så den oppdaterer også ansvaret på regelen den treffer.
 */
export function oppdaterReglerVedLaering(
  rules: RegelRecord[] | null | undefined,
  transaksjon: Pick<TransaksjonRecord, "tekst">,
  post: MalPost,
  multiUse: boolean | undefined,
  deps: MotorDeps,
  valg: LaeringsValg = {},
): RegelRecord[] {
  const { kontoVilkar } = valg;
  const eiere = valg.eiere && valg.eiere.length > 0 ? valg.eiere.map((e) => ({ ...e })) : null;
  const normPattern = normaliserTransaksjonstekst(transaksjon.tekst);
  const eksisterende = finnLaertRegel(rules, normPattern, post.id, kontoVilkar);
  const naa = deps.naa;
  if (eksisterende) {
    return (rules || []).map((r) => {
      if (r.id !== eksisterende.id) return r;
      const nyMulti = multiUse !== undefined ? !!multiUse : r.multiUse;
      return {
        ...r,
        timesUsed: (r.timesUsed || 0) + 1,
        lastMatched: naa,
        updatedAt: naa,
        multiUse: nyMulti,
        mode: nyMulti ? "review" : "auto",
        ...(eiere ? { eiere } : {}),
      };
    });
  }
  const nyRegel: RegelRecord = {
    id: deps.newId(),
    pattern: transaksjon.tekst,
    normalizedPattern: normPattern,
    matchType: "inneholder",
    targetType: post.plasseringType || (post.retning === "inn" ? "income" : "budget"),
    targetId: post.id,
    targetName: post.name,
    targetGruppe: post.gruppe,
    mode: multiUse ? "review" : "auto",
    confidence: 100,
    timesUsed: 1,
    lastMatched: naa,
    multiUse: !!multiUse,
    active: true,
    ...(kontoVilkar ? { kontoVilkar } : {}),
    ...(eiere ? { eiere } : {}),
    createdAt: naa,
    updatedAt: naa,
  };
  return [...(rules || []), nyRegel];
}
