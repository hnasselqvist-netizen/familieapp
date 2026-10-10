/**
 * Reversible korrigeringer fra saldoavstemmingens avvikshjelp (#59,
 * Kontrolltårnet 6097079190 og 6097180478). Rene funksjoner.
 *
 * - «Marker som dublett» virker også på en transaksjon som allerede er
 *   behandlet som intern overføring. Er den koblet til en motpost, må Helen
 *   velge hva motposten er: ekte (beholdes som intern overføring, men
 *   koblingen fjernes, så det aldri står en kobling mot en dublett) eller
 *   også en dublett (begge merkes).
 * - Tilstanden før korrigeringen lagres i `saldoKorrigering`, og hver
 *   handling legges i `korrigeringslogg`. Ingenting slettes fysisk, og en
 *   reversering gjenoppretter nøyaktig det som var.
 * - Transaksjoner med plassering eller kvitteringsmatch kan ikke merkes her:
 *   det ville endret budsjettet. Interne overføringer og ignorerte har ingen
 *   budsjetteffekt, så korrigeringen endrer bare saldoberegningen.
 *
 * Hver endring valideres mot de FERSKESTE dataene inne i transaksjonen;
 * er den ikke lenger gyldig, returneres dataene uendret.
 */
import type {
  IgnorertSom,
  KorrigeringsHandling,
  SaldoKorrigering,
  TidligereTilstand,
  TransaksjonRecord,
} from "@app-types/forsoning";

export type MotpartValg = "frakoble" | "ogsaDublett";

export type DublettVurdering =
  { kan: true; motpart: TransaksjonRecord | null } | { kan: false; grunn: string };

export type AngreVurdering =
  | { kan: true; motpart: TransaksjonRecord | null; gjenkobles: boolean }
  | { kan: false; grunn: string };

export function erDublett(t: Pick<TransaksjonRecord, "status" | "ignorertSom">): boolean {
  return t.status === "ignorert" && t.ignorertSom === "dublett";
}

export function erInternOverforing(t: Pick<TransaksjonRecord, "behandlingstype">): boolean {
  return t.behandlingstype === "intern_overforing";
}

/** Motposten i en gyldig, gjensidig intern-overføringskobling, ellers `null`. */
export function koblingsMotpart(
  t: TransaksjonRecord,
  alle: readonly TransaksjonRecord[],
): TransaksjonRecord | null {
  if (!t.motpartTransaksjonId) return null;
  const m = alle.find((o) => o.id === t.motpartTransaksjonId);
  return m && m.motpartTransaksjonId === t.id ? m : null;
}

export function vurderDublettMerking(
  t: TransaksjonRecord,
  alle: readonly TransaksjonRecord[],
): DublettVurdering {
  if (erDublett(t)) return { kan: false, grunn: "Transaksjonen er allerede merket som dublett." };
  if (t.hendelseId) {
    return {
      kan: false,
      grunn:
        "Transaksjonen er plassert i budsjettet. Korriger plasseringen i Transaksjoner før den kan merkes som dublett.",
    };
  }
  if (t.matchetMot || t.status === "matchet") {
    return {
      kan: false,
      grunn:
        "Transaksjonen er matchet mot en kvittering. Korriger matchen i Transaksjoner før den kan merkes som dublett.",
    };
  }
  return { kan: true, motpart: koblingsMotpart(t, alle) };
}

function tilstand(t: TransaksjonRecord): TidligereTilstand {
  return {
    status: t.status ?? null,
    behandlingstype: t.behandlingstype ?? null,
    motpartTransaksjonId: t.motpartTransaksjonId ?? null,
    ignorertSom: t.ignorertSom ?? null,
  };
}

/** Lesbar tilstand for loggen og for skjermen. */
export function tilstandTekst(
  t: Pick<TransaksjonRecord, "status" | "behandlingstype" | "ignorertSom" | "hendelseId">,
): string {
  if (t.status === "ignorert") {
    if (t.ignorertSom === "dublett") return "dublett";
    if (t.ignorertSom === "bankbevegelse") return "ignorert, ekte bevegelse";
    return "ignorert, ikke avklart";
  }
  if (t.behandlingstype === "intern_overforing") return "intern overføring";
  if (t.hendelseId) return "plassert";
  return t.status ? `status «${t.status}»` : "ubehandlet";
}

function tidligereTekst(s: TidligereTilstand): string {
  return tilstandTekst({
    status: s.status,
    behandlingstype: s.behandlingstype ?? undefined,
    ignorertSom: s.ignorertSom ?? undefined,
  });
}

function medLogg(
  t: TransaksjonRecord,
  handling: KorrigeringsHandling,
  detalj: string,
  naa: string,
): TransaksjonRecord {
  return {
    ...t,
    korrigeringslogg: [...(t.korrigeringslogg ?? []), { handling, tidspunkt: naa, detalj }],
    updatedAt: naa,
  };
}

/** Fjerner felt i stedet for å sette `undefined` (Realtime Database godtar ikke `undefined`). */
function uten<K extends keyof TransaksjonRecord>(
  t: TransaksjonRecord,
  ...felt: K[]
): TransaksjonRecord {
  const kopi = { ...t };
  for (const f of felt) delete kopi[f];
  return kopi;
}

function somDublett(t: TransaksjonRecord, arsakId: string | null, naa: string): TransaksjonRecord {
  const korr: SaldoKorrigering = {
    type: "dublett",
    tidligere: tilstand(t),
    arsakId,
    tidspunkt: naa,
  };
  const ny: TransaksjonRecord = {
    ...uten(t, "behandlingstype", "motpartTransaksjonId"),
    status: "ignorert",
    ignorertSom: "dublett",
    saldoKorrigering: korr,
  };
  return medLogg(ny, "merket_dublett", `${tilstandTekst(t)} → dublett`, naa);
}

function frakoblet(t: TransaksjonRecord, arsakId: string, naa: string): TransaksjonRecord {
  const korr: SaldoKorrigering = {
    type: "motpart_frakoblet",
    tidligere: tilstand(t),
    arsakId,
    tidspunkt: naa,
  };
  const ny: TransaksjonRecord = { ...uten(t, "motpartTransaksjonId"), saldoKorrigering: korr };
  return medLogg(
    ny,
    "motpart_frakoblet",
    "motposten ble merket som dublett; koblingen er fjernet",
    naa,
  );
}

/** Gjenoppretter feltene fra `tidligere` og fjerner den aktive korrigeringen. */
function gjenopprett(
  t: TransaksjonRecord,
  handling: KorrigeringsHandling,
  naa: string,
): TransaksjonRecord {
  const s = t.saldoKorrigering?.tidligere;
  if (!s) return t;
  let ny: TransaksjonRecord = uten(
    t,
    "saldoKorrigering",
    "behandlingstype",
    "motpartTransaksjonId",
    "ignorertSom",
  );
  ny = { ...ny, status: s.status };
  if (s.behandlingstype) ny.behandlingstype = s.behandlingstype;
  if (s.motpartTransaksjonId) ny.motpartTransaksjonId = s.motpartTransaksjonId;
  if (s.ignorertSom) ny.ignorertSom = s.ignorertSom;
  const detalj =
    handling === "motpart_gjenkoblet"
      ? "koblingen til motposten er gjenopprettet"
      : `dublett → ${tidligereTekst(s)}`;
  return medLogg(ny, handling, detalj, naa);
}

/**
 * Merker `id` som dublett. `motpartValg` kreves når transaksjonen er en
 * koblet intern overføring; uten gyldig valg (eller hvis merkingen ikke
 * lenger er tillatt) returneres dataene uendret.
 */
export function merkSomDublett(
  id: string,
  motpartValg: MotpartValg | null,
  naa: string,
): (prev: TransaksjonRecord[]) => TransaksjonRecord[] {
  return (prev) => {
    const t = prev.find((x) => x.id === id);
    if (!t) return prev;
    const v = vurderDublettMerking(t, prev);
    if (!v.kan) return prev;
    const m = v.motpart;
    if (m && !motpartValg) return prev;
    return prev.map((x) => {
      if (x.id === id) return somDublett(x, null, naa);
      if (m && x.id === m.id) {
        return motpartValg === "ogsaDublett" ? somDublett(x, id, naa) : frakoblet(x, id, naa);
      }
      return x;
    });
  };
}

export function vurderAngring(
  t: TransaksjonRecord,
  alle: readonly TransaksjonRecord[],
): AngreVurdering {
  const k = t.saldoKorrigering;
  if (!k || k.type !== "dublett") {
    return { kan: false, grunn: "Transaksjonen har ingen dublett-merking å angre." };
  }
  const mId = k.tidligere.motpartTransaksjonId;
  if (!mId) return { kan: true, motpart: null, gjenkobles: false };
  const m = alle.find((o) => o.id === mId);
  if (!m) {
    return {
      kan: false,
      grunn:
        "Motposten den var koblet til finnes ikke lenger, så koblingen kan ikke gjenopprettes.",
    };
  }
  const mk = m.saldoKorrigering;
  const frakobletAvDenne =
    mk?.type === "motpart_frakoblet" && mk.arsakId === t.id && !m.motpartTransaksjonId;
  const dublettPar = mk?.type === "dublett" && mk.tidligere.motpartTransaksjonId === t.id;
  if (frakobletAvDenne || dublettPar) return { kan: true, motpart: m, gjenkobles: true };
  if (m.motpartTransaksjonId === t.id) return { kan: true, motpart: m, gjenkobles: false };
  return {
    kan: false,
    grunn:
      "Motposten er koblet til en annen transaksjon siden. Angre den koblingen først, så en intern overføring aldri står halvkoblet.",
  };
}

/** Angrer en dublett-merking, inkludert motpostens frakobling eller par-merking. */
export function angreDublett(
  id: string,
  naa: string,
): (prev: TransaksjonRecord[]) => TransaksjonRecord[] {
  return (prev) => {
    const t = prev.find((x) => x.id === id);
    if (!t) return prev;
    const v = vurderAngring(t, prev);
    if (!v.kan) return prev;
    const mId = v.gjenkobles && v.motpart ? v.motpart.id : null;
    return prev.map((x) => {
      if (x.id === id) return gjenopprett(x, "angret_dublett", naa);
      if (x.id === mId) {
        return gjenopprett(
          x,
          x.saldoKorrigering?.type === "dublett" ? "angret_dublett" : "motpart_gjenkoblet",
          naa,
        );
      }
      return x;
    });
  };
}

/**
 * Endrer avklaringen av en ignorert transaksjon uten aktiv dublett-merking,
 * f.eks. en feilmerket dublett som er en ekte bevegelse. Statusen forblir
 * «ignorert». En aktiv dublett-merking reverseres med `angreDublett`.
 */
export function omklassifiserIgnorert(
  id: string,
  som: IgnorertSom,
  naa: string,
): (prev: TransaksjonRecord[]) => TransaksjonRecord[] {
  return (prev) =>
    prev.map((t) => {
      if (t.id !== id || t.status !== "ignorert" || t.ignorertSom === som) return t;
      if (t.saldoKorrigering?.type === "dublett") return t;
      const fra = tilstandTekst(t);
      const ny: TransaksjonRecord = { ...t, ignorertSom: som };
      return medLogg(ny, "omklassifisert", `${fra} → ${tilstandTekst(ny)}`, naa);
    });
}
