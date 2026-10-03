/**
 * Bankimport-beslutninger (§Issue #34 R3b-1), portert fra legacy
 * `BankimportScreen` (`index.html` ~6569–7135 og VisRad ~7316–7870):
 * plassering/splitt, på vent, regel-læring med propagering, ignorer, merk
 * flerbruk, «bruk og utvid regel» og intern overføring.
 *
 * Hver handling returnerer en `Beslutningsendring`: én updater per node
 * som skal endres. Updaterne kjøres av den felles helnode-skriveren
 * (`data/forsoningSkriving.repository.ts`) mot fersk verdi, bak porten
 * `hooks/forsoningAktivering.ts`. Selve beregningen er legacy sin, linje
 * for linje — også der legacy leser fra komponentens øyeblikksbilde
 * (`snapshot`) og ikke fra den ferske listen (f.eks. propageringens
 * «har ingen hendelse»-sjekk), slik at resultatet er identisk med legacy
 * når ingen andre skriver samtidig.
 */
import type {
  Eierandel,
  HendelseRecord,
  KvitteringRecord,
  MalPost,
  MotorDeps,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { byggFordelingFraPost, finnHendelseForTransaksjon } from "./fordeling";
import { bekreftInternOverforing } from "./internOverforing";
import { oppdaterReglerVedLaering, regelMatcherTekst } from "./regler";
import { fellesPrefiks, normaliserTransaksjonstekst } from "./tekst";

export interface UtkastFordeling {
  /** UI-nøkkel (legacy `uid()`); brukes ikke ved lagring. */
  id?: string;
  post: MalPost;
  belop: number;
  eiere: Eierandel[];
}

/** Legacy-utkastet som `lagreBehandling` får fra VisRad. */
export interface BeslutningUtkast {
  type: "uklar" | "plassert";
  fordelinger: UtkastFordeling[];
  laer: boolean;
  uklarValg: string | null;
}

export interface ForsoningSnapshot {
  transaksjoner: TransaksjonRecord[];
  hendelser: HendelseRecord[];
  rules: RegelRecord[];
}

/**
 * Én updater per node som endres. Skriverekkefølgen er fast i
 * `hooks/useForsoningSkriver.ts`: hendelser → transaksjoner → receipts →
 * rules (hendelsen er sannheten; regel-læring sist).
 */
export interface Beslutningsendring {
  hendelser?: (prev: HendelseRecord[]) => HendelseRecord[];
  transaksjoner?: (prev: TransaksjonRecord[]) => TransaksjonRecord[];
  receipts?: (prev: KvitteringRecord[]) => KvitteringRecord[];
  rules?: (prev: RegelRecord[]) => RegelRecord[];
}

/** Legacy `lagreBehandling` (~7032): på vent, eller plassering med valgfri læring. */
export function lagreBehandling(
  snapshot: ForsoningSnapshot,
  tranId: string,
  utkast: BeslutningUtkast,
  deps: MotorDeps,
): Beslutningsendring {
  const t = snapshot.transaksjoner.find((x) => x.id === tranId);
  if (!t) return {};
  const { type, fordelinger, laer, uklarValg } = utkast;

  const eksisterendeHendelse = finnHendelseForTransaksjon(snapshot.hendelser, tranId);
  const hendelseId = eksisterendeHendelse ? eksisterendeHendelse.id : deps.newId();
  const naa = deps.naa;
  const settPeker = (prev: TransaksjonRecord[]) =>
    prev.map((x) => (x.id !== tranId ? x : { ...x, hendelseId }));
  const felles = {
    id: hendelseId,
    transaksjonId: tranId,
    receiptId: eksisterendeHendelse ? eksisterendeHendelse.receiptId || null : null,
    dato: t.dato,
    opprettet: eksisterendeHendelse ? eksisterendeHendelse.opprettet : naa,
    oppdatert: naa,
  };

  if (type === "uklar") {
    const hendelse: HendelseRecord = {
      ...felles,
      status: "pa_vent",
      paaVentAarsak: uklarValg || null,
      fordelinger: [],
      regelId: null,
    };
    return {
      hendelser: (prev) => [...prev.filter((h) => h.id !== hendelseId), hendelse],
      transaksjoner: settPeker,
    };
  }

  if (fordelinger && fordelinger.length > 0) {
    const forste = fordelinger[0]!;
    let regelId: string | null = null;
    let rules: Beslutningsendring["rules"];
    if (laer) {
      const normPattern2 = normaliserTransaksjonstekst(t.tekst);
      const eksisterendeRegel = snapshot.rules.find(
        (r) => r.targetId === forste.post.id && regelMatcherTekst(r, normPattern2),
      );
      regelId = eksisterendeRegel ? eksisterendeRegel.id : null;
      rules = (prev) => oppdaterReglerVedLaering(prev, t, forste.post, false, deps);
    }
    const hendelse: HendelseRecord = {
      ...felles,
      status: "ferdig",
      paaVentAarsak: null,
      fordelinger: fordelinger.map((f) =>
        byggFordelingFraPost(f.post, f.belop, f.eiere, t.retning),
      ),
      regelId,
    };
    const normPattern = normaliserTransaksjonstekst(t.tekst);
    return {
      hendelser: (prev) => [...prev.filter((h) => h.id !== hendelseId), hendelse],
      transaksjoner: (prev) =>
        prev.map((x) => {
          if (x.id === tranId) return { ...x, hendelseId };
          if (
            laer &&
            fordelinger.length === 1 &&
            !finnHendelseForTransaksjon(snapshot.hendelser, x.id) &&
            normaliserTransaksjonstekst(x.tekst) === normPattern
          ) {
            return {
              ...x,
              status: "foresoatt_match",
              matchetMot: forste.post.id,
              matchetNavn: forste.post.name,
              laertKobling: {
                budgetItemId: forste.post.id,
                navn: forste.post.name,
                gruppe: forste.post.gruppe,
                flerbruk: false,
              },
            };
          }
          return x;
        }),
      ...(rules ? { rules } : {}),
    };
  }

  // Verken på vent eller fordeling (defensivt i legacy).
  return {
    transaksjoner: (prev) =>
      prev.map((x) => (x.id !== tranId ? x : { ...x, status: "foresoatt_match" })),
  };
}

/** Legacy `settStatus` (~6569), brukt av «Ignorer». */
export function settStatus(
  tranId: string,
  status: string,
  extra?: Partial<TransaksjonRecord>,
): Beslutningsendring {
  return {
    transaksjoner: (prev) =>
      prev.map((t) => (t.id !== tranId ? t : { ...t, status, ...(extra || {}) })),
  };
}

/** Legacy `merkFlerbruk` + `merkRegelFlerbruk` (~6857–6871). */
export function merkFlerbruk(normalizedPattern: string, naa: string): Beslutningsendring {
  return {
    rules: (prev) =>
      prev.map((r) =>
        r.normalizedPattern !== normalizedPattern
          ? r
          : { ...r, multiUse: true, mode: "review", updatedAt: naa },
      ),
    transaksjoner: (prev) =>
      prev.map((t) => {
        if (normaliserTransaksjonstekst(t.tekst) !== normalizedPattern) return t;
        // Legacy lager også `{flerbruk: true}` uten `budgetItemId` når koblingen mangler.
        const lk = {
          ...(t.laertKobling || {}),
          flerbruk: true,
        } as TransaksjonRecord["laertKobling"];
        return { ...t, laertKobling: lk, status: "krever_vurdering" };
      }),
  };
}

export interface UtvidRegelForslag {
  regel: RegelRecord;
  utvidetMonster: string;
  /** Hvor mange transaksjoner det utvidede mønsteret ville truffet. */
  brukAntall: number;
}

/**
 * Legacy VisRad sin «bruk og utvid»-sjekk (~7320–7330): finnes en aktiv
 * regel for SAMME plassering som ikke allerede matcher teksten, tilbys et
 * felles prefiks i stedet for en ny regel. Kun ved én fordeling.
 */
export function utvidRegelForslag(
  rules: readonly RegelRecord[],
  t: TransaksjonRecord,
  fordelinger: readonly UtkastFordeling[],
  alle: readonly TransaksjonRecord[],
): UtvidRegelForslag | null {
  if (fordelinger.length !== 1) return null;
  const tekst = normaliserTransaksjonstekst(t.tekst);
  const regel = rules.find(
    (r) =>
      r.active !== false && r.targetId === fordelinger[0]!.post.id && !regelMatcherTekst(r, tekst),
  );
  if (!regel) return null;
  const utvidetMonster = fellesPrefiks(
    (regel.normalizedPattern || regel.pattern || "").toLowerCase(),
    tekst,
  );
  if (!utvidetMonster) return { regel, utvidetMonster, brukAntall: 0 };
  return {
    regel,
    utvidetMonster,
    brukAntall: alle.filter((x) => normaliserTransaksjonstekst(x.tekst).includes(utvidetMonster))
      .length,
  };
}

/** Legacy `brukOgUtvidRegel` (~7331). */
export function brukOgUtvidRegel(forslag: UtvidRegelForslag, naa: string): Beslutningsendring {
  if (!forslag.utvidetMonster) return {};
  return {
    rules: (prev) =>
      prev.map((r) =>
        r.id !== forslag.regel.id
          ? r
          : {
              ...r,
              pattern: forslag.utvidetMonster,
              normalizedPattern: forslag.utvidetMonster,
              matchType: "starter_med",
              updatedAt: naa,
            },
      ),
  };
}

/** VisRad sin «Lagre» med intern overføring valgt (~7856). */
export function lagreInternOverforing(
  tranId: string,
  motpartId: string,
  naa: string,
): Beslutningsendring {
  return { transaksjoner: (prev) => bekreftInternOverforing(prev, tranId, motpartId, naa) };
}
