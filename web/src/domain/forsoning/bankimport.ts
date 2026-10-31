/**
 * Bankfil-import og manuell registrering (§Issue #34 R3b-2), portert fra
 * legacy `BankimportScreen` (`index.html` ~6543–6845 og ~7128–7175):
 * forhåndsvisning med duplikatkontroll, manuell konto, match mot
 * likviditetsprognosen, selve importen (med automatisk ferdig hendelse når
 * en sikker regel treffer) og manuell registrering uten bankrad.
 *
 * Rene funksjoner. Skrivende handlinger returnerer en `Beslutningsendring`
 * for den felles helnode-skriveren bak forsoningsporten.
 */
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  Eierandel,
  HendelseRecord,
  MalPost,
  MotorDeps,
  RegelRecord,
  Retning,
  TransaksjonRecord,
} from "@app-types/forsoning";
import type { LiquidityPost } from "@app-types/liquidity";
import { type BankKilde, dupKey, mapRad, parseCSV } from "./bankimportParse";
import type { Beslutningsendring } from "./beslutning";
import { byggFordelingFraPost, byggManuellHendelse } from "./fordeling";
import { findMatchingRule, regelEiere } from "./regler";
import { normaliserTransaksjonstekst } from "./tekst";

/** En rad i importens forhåndsvisning (legacy `prosesserTekst`). */
export interface PreviewRad {
  dato: string;
  tekst: string;
  belop: number;
  retning: Retning;
  konto: string | null;
  originalRad: string;
  laeringsKey: string;
  _dupKey: string;
  erDuplikat: boolean;
  status: "ny";
}

/** Legacy `laeringsKey` (~6552). */
export const laeringsKey = (tekst: string | null | undefined) => normaliserTransaksjonstekst(tekst);

/**
 * Ren informasjonslinje på kortutskriften, ikke en bevegelse: «Skyldig beløp
 * pr. …» (saldoen på MC-kontoen). Filtreres bort ved import uansett kilde.
 * Historiske rader som allerede er importert, røres ikke.
 */
export function erSkyldigBelopLinje(tekst: string | null | undefined): boolean {
  return /^skyldig bel(ø|o)p\b/i.test((tekst || "").trim());
}

/**
 * Legacy `prosesserTekst` (~6717): parse, filtrer, konto, duplikatflagg.
 *
 * **Bevisst avvik (MC-import, #66, Kontrolltårnet 2026-10-07):** legacy
 * kastet ALLE rader med teksten «Innbetaling». På DNB/Mastercard-filen er
 * det innbetalingen til kortet, en reell bevegelse som skal kunne kobles
 * som intern overføring mot betalingen fra brukskontoen. Den beholdes nå for
 * DNB. Linjen «Skyldig beløp …» er ren informasjon og filtreres bort. For
 * andre kilder er «Innbetaling»-filteret uendret.
 */
export function byggImportPreview(
  tekst: string,
  kilde: BankKilde | string,
  eksisterende: readonly TransaksjonRecord[],
): PreviewRad[] {
  const eksKeys = new Set(eksisterende.map((t) => dupKey(t)));
  return parseCSV(tekst)
    .map((rad) => {
      const mapped = mapRad(rad, kilde);
      if (!mapped.dato || !mapped.belop) return null;
      if (erSkyldigBelopLinje(mapped.tekst)) return null;
      if (kilde !== "dnb" && mapped.tekst && mapped.tekst.trim().toLowerCase() === "innbetaling") {
        return null;
      }
      const konto = kilde === "dnb" ? "MC" : mapped.konto || null;
      const t = {
        dato: mapped.dato,
        tekst: mapped.tekst,
        belop: mapped.belop,
        retning: mapped.retning,
        konto,
        originalRad: JSON.stringify(rad),
        laeringsKey: laeringsKey(mapped.tekst),
      };
      const key = dupKey(t);
      return { ...t, _dupKey: key, erDuplikat: eksKeys.has(key), status: "ny" as const };
    })
    .filter((r): r is PreviewRad => r !== null);
}

/** Legacy `velgManuellKonto` (~6745): bare rader uten konto får den, med ny duplikatnøkkel. */
export function velgManuellKonto(
  preview: readonly PreviewRad[],
  kontoId: string,
  eksisterende: readonly TransaksjonRecord[],
): PreviewRad[] {
  const eksKeys = new Set(eksisterende.map((t) => dupKey(t)));
  return preview.map((t) => {
    if (t.konto) return t;
    const nyT = { ...t, konto: kontoId };
    const key = dupKey(nyT);
    return { ...nyT, _dupKey: key, erDuplikat: eksKeys.has(key) };
  });
}

/** Legacy `finnMatchForPreview` (~6774): prognosepost innen 3 dager, samme beløp, lignende navn eller samme dag. */
export function finnMatchForPreview(
  t: Pick<PreviewRad, "dato" | "tekst" | "belop">,
  liquidityPosts: readonly LiquidityPost[],
): LiquidityPost | null {
  const tDato = t.dato ? new Date(t.dato) : null;
  return (
    liquidityPosts.find((p) => {
      if (!p.date || !p.amount) return false;
      const dagDiff = tDato
        ? Math.abs((tDato.getTime() - new Date(p.date).getTime()) / (1000 * 60 * 60 * 24))
        : 99;
      if (dagDiff > 3) return false;
      const belopLikt = Math.abs(p.amount - t.belop) < 1;
      const navnLigner =
        t.tekst &&
        p.name &&
        (t.tekst.toLowerCase().includes(p.name.toLowerCase().slice(0, 6)) ||
          p.name.toLowerCase().includes(t.tekst.toLowerCase().slice(0, 6)));
      return belopLikt && (navnLigner || dagDiff === 0);
    }) || null
  );
}

export interface ImportKontekst {
  rules: readonly RegelRecord[];
  liquidityPosts: readonly LiquidityPost[];
  kilde: string;
}

/**
 * Legacy `gjorImport` (~6788). Rader som ikke er duplikater blir nye
 * transaksjoner. En sikker regel (≥ 60 %, ikke flerbruk) gir en FERDIG
 * hendelse med én fordeling og hele beløpet; flerbruk gir «krever
 * vurdering»; ellers forslag mot en likviditetspost eller «ny».
 */
export function gjorImport(
  preview: readonly PreviewRad[],
  ctx: ImportKontekst,
  deps: MotorDeps,
): Beslutningsendring {
  const nyeHendelser: HendelseRecord[] = [];
  const nyeTrans: TransaksjonRecord[] = preview
    .filter((t) => !t.erDuplikat)
    .map((t) => {
      const match = finnMatchForPreview(t, ctx.liquidityPosts);
      const treff = findMatchingRule(
        {
          normalizedText: normaliserTransaksjonstekst(t.tekst),
          konto: t.konto,
          importkilde: ctx.kilde,
        },
        [...ctx.rules],
      );
      const lk =
        treff.rule && treff.confidence >= 60
          ? {
              budgetItemId: treff.rule.targetId,
              navn: treff.rule.targetName,
              gruppe: treff.rule.targetGruppe,
              flerbruk: !!treff.rule.multiUse,
            }
          : null;
      const nyId = deps.newId();
      const erAutomatiskPlassert = !!lk && !lk.flerbruk;
      let hendelseId: string | null = null;
      if (erAutomatiskPlassert) {
        const regel = treff.rule!;
        hendelseId = deps.newId();
        const post: MalPost = {
          id: regel.targetId,
          name: regel.targetName,
          retning: regel.targetType === "income" ? "inn" : "ut",
          plasseringType: regel.targetType === "sparing" ? "sparing" : undefined,
        };
        nyeHendelser.push({
          id: hendelseId,
          status: "ferdig",
          paaVentAarsak: null,
          transaksjonId: nyId,
          receiptId: null,
          fordelinger: [byggFordelingFraPost(post, t.belop, regelEiere(regel), t.retning)],
          dato: t.dato,
          regelId: regel.id,
          opprettet: deps.naa,
          oppdatert: deps.naa,
        });
      }
      const status = lk
        ? lk.flerbruk
          ? "krever_vurdering"
          : null
        : match
          ? "foresoatt_match"
          : "ny";
      return {
        ...t,
        id: nyId,
        status,
        hendelseId,
        matchetMot: !erAutomatiskPlassert && match ? match.id : null,
        matchetNavn: null,
        laeringsKey: laeringsKey(t.tekst),
        importkilde: ctx.kilde,
        importertDato: deps.naa.slice(0, 10),
      } as unknown as TransaksjonRecord;
    });
  return {
    transaksjoner: (prev) => [...prev, ...nyeTrans],
    ...(nyeHendelser.length > 0 ? { hendelser: (prev) => [...prev, ...nyeHendelser] } : {}),
  };
}

export type ManuellType = "kostnad" | "inntekt" | "sparing";

export interface ManuellRegistrering {
  type: ManuellType;
  postId: string;
  dato: string;
  /** Rå verdi fra `type=number`-feltet (som legacy). Positivt øker, negativt reduserer posten. */
  belop: string;
  kommentar: string;
  eiere: Eierandel[];
}

/**
 * Legacy `lagreManuellRegistrering` (~7128): en selvstendig hendelse uten
 * bankrad. Skriver KUN `hendelser`. `null` = ugyldig (mangler post/dato,
 * beløp 0 eller ikke et tall, eller posten finnes ikke) — da skrives
 * ingenting, som i legacy.
 */
export function lagreManuellRegistrering(
  r: ManuellRegistrering,
  grupper: {
    budgetGroups: readonly BudsjettGruppe[];
    incomeGroups: readonly BudsjettGruppe[];
    sparingGroups: readonly BudsjettGruppe[];
  },
  deps: MotorDeps,
): Beslutningsendring | null {
  const belopTall = parseFloat(r.belop);
  if (!r.postId || !r.dato || isNaN(belopTall) || belopTall === 0) return null;
  const kildeGrupper =
    r.type === "inntekt"
      ? grupper.incomeGroups
      : r.type === "sparing"
        ? grupper.sparingGroups
        : grupper.budgetGroups;
  let post: MalPost | null = null;
  kildeGrupper.forEach((g) => {
    const item = (g.items || []).find((it) => it.id === r.postId);
    if (item) {
      post = {
        id: item.id,
        name: item.name,
        retning: r.type === "inntekt" ? "inn" : "ut",
        plasseringType: r.type === "sparing" ? "sparing" : undefined,
      };
    }
  });
  if (!post) return null;
  const hendelse = byggManuellHendelse(
    r.dato,
    post,
    belopTall,
    r.kommentar.trim() || null,
    r.eiere,
    deps,
  );
  return { hendelser: (prev) => [...prev, hendelse] };
}
