/**
 * Transaksjonsoversikt — rene visningsfunksjoner, portert 1:1 fra legacy
 * `BankimportScreen` (`index.html` ~6483–8330), §Issue #34 R3-les.
 *
 * Kun det Bankimport VISER: arbeidskøen «Til behandling» (Krever
 * vurdering / Forslag til match / På vent, med kontofilter) og den
 * skrivebeskyttede kontrolloversikten «Alle transaksjoner» (måned, konto,
 * søk, presis tilstand per transaksjon). Import, plassering, på vent,
 * intern overføring, ignorering, kvitteringsopplasting, korrigering og
 * «Kjør regler» skriver `transaksjoner`/`hendelser`/`receipts`/`rules` og
 * blir i legacy til R3b-cutover (ADR 0002).
 */
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  Fordeling,
  HendelseRecord,
  KvitteringRecord,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { budsjettpostMatcherId } from "@domain/budsjettfamilie/budsjettfamilie";
import { normaliserKonto } from "./bankimportParse";
import { finnHendelseForTransaksjon } from "./fordeling";
import { findReceipt } from "./kvittering";

/** Legacy `KONTOER` (~6524) — kontofilteret i begge modusene. */
export const KONTOER: readonly { id: string; label: string }[] = [
  { id: "alle", label: "Alle" },
  { id: "MC", label: "MC" },
  { id: "regningskonto", label: "Regningskonto" },
  { id: "felleskonto", label: "Felleskonto" },
  { id: "helen", label: "Helen" },
  { id: "eivind", label: "Eivind" },
  { id: "krav", label: "Krav" },
];

/** Legacy global `UKLAR_AARSAK_LABEL` (~6476). */
export const UKLAR_AARSAK_LABEL: Record<string, string> = {
  venter_paa_kvittering: "Venter på kvittering",
  maa_splittes: "Må splittes",
  maa_avklares: "Må avklares",
  annet: "Annet",
};

const MAANED_NAVN = [
  "januar",
  "februar",
  "mars",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "desember",
];

export interface EffektivStatus {
  harHendelse: boolean;
  erPlassert: boolean;
  erPaaVent: boolean;
  paaVentAarsak: string | null;
  fordelinger: Fordeling[];
  visningNavn: string | null;
  erFlerbruk: boolean;
  harLaertRegel: boolean;
}

/** Legacy `loesEffektivStatus` (~6886): hendelsen er sannheten når den finnes. */
export function loesEffektivStatus(
  t: TransaksjonRecord,
  hendelser: readonly HendelseRecord[],
  rules: readonly RegelRecord[],
): EffektivStatus {
  const h = finnHendelseForTransaksjon([...hendelser], t.id);
  if (h) {
    const regel = h.regelId ? (rules || []).find((r) => r.id === h.regelId) : null;
    const f = h.fordelinger || [];
    return {
      harHendelse: true,
      erPlassert: h.status === "ferdig",
      erPaaVent: h.status === "pa_vent",
      paaVentAarsak: h.paaVentAarsak || null,
      fordelinger: f,
      visningNavn:
        f.length > 0
          ? f.length > 1
            ? f[0]!.plasseringNavn + " (+" + (f.length - 1) + " til)"
            : f[0]!.plasseringNavn
          : null,
      erFlerbruk: !!(regel && regel.multiUse),
      harLaertRegel: !!h.regelId,
    };
  }
  return {
    harHendelse: false,
    erPlassert: t.status === "matchet",
    erPaaVent: false,
    paaVentAarsak: null,
    fordelinger: [],
    visningNavn: t.matchetNavn || null,
    erFlerbruk: !!(t.laertKobling && t.laertKobling.flerbruk),
    harLaertRegel: !!t.laertKobling,
  };
}

export interface PostGrupper {
  budgetGroups: readonly BudsjettGruppe[];
  incomeGroups: readonly BudsjettGruppe[];
  sparingGroups: readonly BudsjettGruppe[];
}

const TYPE_LABEL_AT: Record<string, string> = {
  budget: "Kostnad",
  income: "Inntekt",
  sparing: "Sparing",
};

/**
 * Legacy `fordelingTekst` (~6929): «Kostnad → Gruppe / Post». Gruppen slås
 * opp via `legacyIds`; som i legacy vinner SISTE gruppe med treff, og
 * navnet er det denormaliserte `plasseringNavn` (historisk, ikke dagens).
 */
export function fordelingTekst(f: Fordeling, grupper: PostGrupper): string {
  const grupper2 =
    f.plasseringType === "income"
      ? grupper.incomeGroups
      : f.plasseringType === "sparing"
        ? grupper.sparingGroups
        : grupper.budgetGroups;
  let gruppeLabel: string | null = null;
  (grupper2 || []).forEach((g) => {
    if ((g.items || []).some((it) => budsjettpostMatcherId(it, f.plasseringId))) {
      gruppeLabel = g.label;
    }
  });
  const typeLabel = TYPE_LABEL_AT[f.plasseringType] || "Kostnad";
  return typeLabel + " → " + (gruppeLabel ? gruppeLabel + " / " : "") + f.plasseringNavn;
}

export type TilstandKategori =
  | "ignorert"
  | "intern"
  | "ferdig"
  | "pa_vent"
  | "matchet_uten_hendelse"
  | "forslag"
  | "krever_vurdering"
  | "uferdig";

export interface Tilstand {
  kategori: TilstandKategori;
  tekst: string;
  detaljer: string[];
}

/**
 * Legacy `beskrivTilstand` (~6941): presis tilstand for kontrolloversikten.
 * «Matchet uten hendelse» vises bevisst som økonomisk UFERDIG.
 */
export function beskrivTilstand(
  t: TransaksjonRecord,
  hendelser: readonly HendelseRecord[],
  rules: readonly RegelRecord[],
  grupper: PostGrupper,
): Tilstand {
  const s = loesEffektivStatus(t, hendelser, rules);
  if (t.status === "ignorert") return { kategori: "ignorert", tekst: "Ignorert", detaljer: [] };
  if (t.behandlingstype === "intern_overforing") {
    return { kategori: "intern", tekst: "Intern overføring", detaljer: [] };
  }
  if (s.harHendelse && s.erPlassert) {
    return {
      kategori: "ferdig",
      tekst: "Ferdig",
      detaljer: (s.fordelinger || []).map((f) => fordelingTekst(f, grupper)),
    };
  }
  if (s.harHendelse && s.erPaaVent) {
    return {
      kategori: "pa_vent",
      tekst: "På vent – " + (UKLAR_AARSAK_LABEL[s.paaVentAarsak ?? ""] || "venter"),
      detaljer: [],
    };
  }
  if (!s.harHendelse && t.status === "matchet") {
    return {
      kategori: "matchet_uten_hendelse",
      tekst: "Matchet uten ferdig hendelse – ingen økonomisk effekt",
      detaljer: [],
    };
  }
  if (t.status === "foresoatt_match") {
    return { kategori: "forslag", tekst: "Forslag – ikke ferdig økonomisk effekt", detaljer: [] };
  }
  if (t.status === "krever_vurdering") {
    return { kategori: "krever_vurdering", tekst: "Krever vurdering", detaljer: [] };
  }
  return { kategori: "uferdig", tekst: "Uferdig – ikke behandlet", detaljer: [] };
}

export interface Arbeidsko {
  vurdering: TransaksjonRecord[];
  forslag: TransaksjonRecord[];
  paavent: TransaksjonRecord[];
}

export type Seksjon = keyof Arbeidsko;

export const SEKSJON_LABEL: Record<Seksjon, string> = {
  vurdering: "Krever vurdering",
  forslag: "Forslag til match",
  paavent: "På vent",
};

/**
 * Har transaksjonen en hendelse som verken er ferdig eller på vent
 * (`uplassert`)? Oppstår når en kvittering kobles uten å kunne lukke
 * (splittavvik, beløpsavvik, ikke fordelt).
 */
export function erUplassert(s: EffektivStatus): boolean {
  return s.harHendelse && !s.erPlassert && !s.erPaaVent;
}

/**
 * Legacy `grupper` (~6970): arbeidskøens tre faner, i lagret rekkefølge.
 * «Krever vurdering» = aldri sett (ingen hendelse, ikke plassert, ikke
 * ignorert/intern).
 *
 * **Bevisst avvik (pre-cutover 2):** en `uplassert` hendelse havner også i
 * «Krever vurdering». I legacy faller den utenfor alle tre fanene og er
 * bare synlig i «Alle transaksjoner». Dataformen er uendret.
 *
 * **Bevisst avvik (Forvaltning produktfase 1, #34 6000282907): fanene er
 * disjunkte.** En transaksjon med status `foresoatt_match` står bare i
 * «Forslag til match». Legacy viser den i BÅDE «Krever vurdering» og
 * «Forslag til match», så fanetallene ble dobbelttelt (f.eks. «Krever
 * vurdering 21» mens bare 7 hadde status `krever_vurdering`). Ett
 * handlingssignal per transaksjon.
 */
export function arbeidsko(
  transaksjoner: readonly TransaksjonRecord[],
  hendelser: readonly HendelseRecord[],
  rules: readonly RegelRecord[],
): Arbeidsko {
  const alle = transaksjoner || [];
  return {
    vurdering: alle.filter((t) => {
      if (t.status === "ignorert" || t.behandlingstype === "intern_overforing") return false;
      if (t.status === "foresoatt_match") return false;
      const s = loesEffektivStatus(t, hendelser, rules);
      if (!s.harHendelse && !s.erPlassert) return true;
      return erUplassert(s);
    }),
    forslag: alle.filter((t) => t.status === "foresoatt_match"),
    paavent: alle.filter((t) => {
      const s = loesEffektivStatus(t, hendelser, rules);
      return s.harHendelse && s.erPaaVent;
    }),
  };
}

/** Legacy `kontoFilter` (~6990). */
export function filtrerPaKonto(
  liste: readonly TransaksjonRecord[],
  konto: string,
): TransaksjonRecord[] {
  return konto === "alle" ? [...liste] : liste.filter((t) => normaliserKonto(t) === konto);
}

const maanedNokkel = (dato: string) => {
  const d = new Date(dato);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
};

/** Legacy `atMaanedNokler`/`atMaanedAlternativer` (~6997): fra faktiske datoer, nyest først. */
export function maanedAlternativer(
  transaksjoner: readonly TransaksjonRecord[],
): { id: string; label: string }[] {
  const nokler = [
    ...new Set((transaksjoner || []).filter((t) => t.dato).map((t) => maanedNokkel(t.dato))),
  ]
    .sort()
    .reverse();
  return [
    { id: "alle", label: "Alle måneder" },
    ...nokler.map((nokkel) => {
      const [aar, mnd] = nokkel.split("-");
      return { id: nokkel, label: MAANED_NAVN[parseInt(mnd!, 10) - 1] + " " + aar };
    }),
  ];
}

export interface OversiktFilter {
  maaned: string;
  konto: string;
  sok: string;
}

/** Legacy `alleTransaksjonerFiltrert` (~7010): filtrert, nyest først, uten å mutere. */
export function filtrerAlleTransaksjoner(
  transaksjoner: readonly TransaksjonRecord[],
  { maaned, konto, sok }: OversiktFilter,
): TransaksjonRecord[] {
  return (transaksjoner || [])
    .filter((t) => maaned === "alle" || (!!t.dato && maanedNokkel(t.dato) === maaned))
    .filter((t) => konto === "alle" || normaliserKonto(t) === konto)
    .filter((t) => !sok.trim() || (t.tekst || "").toLowerCase().includes(sok.trim().toLowerCase()))
    .slice()
    .sort((a, b) => new Date(b.dato || 0).getTime() - new Date(a.dato || 0).getTime());
}

export interface RadKvittering {
  /** Eldre direkte opplasting (`receipt.transactionId`). */
  lagtTil: KvitteringRecord | null;
  /** Koblet via hendelsen (`hendelse.receiptId`). */
  koblet: KvitteringRecord | null;
  /** Hendelsen er ferdig og lukket via en kvittering. */
  lukketViaKvittering: boolean;
}

/** Legacy `VisRad` (~7220–7231): kvitteringsmerkene på en rad i arbeidskøen. */
export function radKvittering(
  t: TransaksjonRecord,
  hendelser: readonly HendelseRecord[],
  receipts: readonly KvitteringRecord[],
): RadKvittering {
  const lagtTil = findReceipt(t.id, [...receipts]) ?? null;
  const h = finnHendelseForTransaksjon([...hendelser], t.id);
  const koblet = h && h.receiptId ? (receipts || []).find((r) => r.id === h.receiptId) : null;
  return {
    lagtTil,
    koblet: koblet ?? null,
    lukketViaKvittering: !!(h && h.status === "ferdig" && h.receiptId),
  };
}
