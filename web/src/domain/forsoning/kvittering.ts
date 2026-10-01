/**
 * Kvitteringsmotorene — klar-for-lukking, koblingsvurdering, kandidat-
 * matching og synk av en koblet kvittering mot hendelsen. Rene funksjoner,
 * portert 1:1 fra `index.html` ~9423–10310 (§Issue #34, R0).
 *
 * Kjent, UENDRET asymmetri (kartlegging 5938206324 §2.6):
 * `byggSynkronisertKvitteringOgHendelse` setter hendelsen `ferdig` uten å
 * kjøre `erKvitteringKlarForLukking` på nytt — i motsetning til koblingen.
 * Porten bevarer dette; en eventuell retting er en egen beslutning (R3).
 */
import type {
  Eierandel,
  Fordeling,
  HendelseRecord,
  KvitteringRecord,
  KvitteringSplit,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { finnHendelseForTransaksjon } from "./fordeling";
import { belopMatcherIOre, dagerMellom, normalizeMerchant } from "./tekst";

/** kr — samme toleranse som ellers i legacy (`finnMatchForPreview`). */
export const BELOPSTOLERANSE_KOBLING = 1;
export const KVITTERING_TIDSVINDU_DAGER = 5;

/** Legacy: `calculateSplitTotal`. */
export function calculateSplitTotal(
  receipt: Pick<KvitteringRecord, "splits"> | null | undefined,
): number {
  if (!receipt || !receipt.splits) return 0;
  return receipt.splits.reduce((s, sp) => s + (sp.amount || 0), 0);
}

/** Legacy: `findReceipt` — den ELDRE, direkte opplastingskoblingen (`receipt.transactionId`). */
export function findReceipt(
  transactionId: string | null | undefined,
  receipts: KvitteringRecord[] | null | undefined,
): KvitteringRecord | null {
  if (!transactionId || !receipts) return null;
  return receipts.find((r) => r.transactionId === transactionId) || null;
}

export type KlarForLukking =
  | { klar: true }
  | {
      klar: false;
      kode: "mangler_kvittering" | "ikke_fordelt" | "splitt_avvik";
      detaljer?: { splitSum: number; total: number };
    };

/** Fordelt + splittsum = total (±1 kr). Legacy: `erKvitteringKlarForLukking`. */
export function erKvitteringKlarForLukking(
  receipt: KvitteringRecord | null | undefined,
): KlarForLukking {
  if (!receipt) return { klar: false, kode: "mangler_kvittering" };
  if (!receipt.allocationMode || !(receipt.splits && receipt.splits.length > 0)) {
    return { klar: false, kode: "ikke_fordelt" };
  }
  const splitSum = calculateSplitTotal(receipt);
  const total = receipt.total || 0;
  if (Math.abs(splitSum - total) > BELOPSTOLERANSE_KOBLING) {
    return { klar: false, kode: "splitt_avvik", detaljer: { splitSum, total } };
  }
  return { klar: true };
}

export interface KoblingsVurdering {
  kanKobles: boolean;
  kanLukkes: boolean;
  kode?: string;
  handling?: "bekreft_eksisterende_hendelse" | "opprett_ny_hendelse";
  detaljer?: Record<string, unknown>;
}

/**
 * Kan kvitteringen kobles til transaksjonen, og kan koblingen LUKKE den?
 * Legacy: `vurderKvitteringKobling`. (`alleReceipts` tas imot for
 * signaturparitet, men brukes ikke — som i legacy.)
 */
export function vurderKvitteringKobling(
  receipt: KvitteringRecord | null | undefined,
  transaction: TransaksjonRecord | null | undefined,
  alleHendelser: HendelseRecord[] | null | undefined,
  alleReceipts?: KvitteringRecord[] | null,
): KoblingsVurdering {
  void alleReceipts;
  if (!receipt || !transaction) return { kanKobles: false, kanLukkes: false, kode: "mangler_data" };
  if (transaction.status === "ignorert") {
    return { kanKobles: false, kanLukkes: false, kode: "transaksjon_ignorert" };
  }

  const eksisterende = finnHendelseForTransaksjon(alleHendelser, transaction.id);
  if (eksisterende && eksisterende.receiptId && eksisterende.receiptId !== receipt.id) {
    return {
      kanKobles: false,
      kanLukkes: false,
      kode: "transaksjon_koblet_annen_kvittering",
      detaljer: { annenKvitteringId: eksisterende.receiptId },
    };
  }

  const fordelt = erKvitteringKlarForLukking(receipt);
  if (!fordelt.klar) {
    return { kanKobles: true, kanLukkes: false, kode: fordelt.kode, detaljer: fordelt.detaljer };
  }

  if (Math.abs((receipt.total || 0) - Math.abs(transaction.belop || 0)) > BELOPSTOLERANSE_KOBLING) {
    return {
      kanKobles: true,
      kanLukkes: false,
      kode: "belop_avvik",
      detaljer: { kvitteringTotal: receipt.total, bankBelop: transaction.belop },
    };
  }

  if (eksisterende && eksisterende.status === "ferdig" && eksisterende.receiptId !== receipt.id) {
    const eksisterendeSum = (eksisterende.fordelinger || []).reduce(
      (s, f) => s + (f.belop || 0),
      0,
    );
    if (Math.abs(eksisterendeSum - (receipt.total || 0)) <= BELOPSTOLERANSE_KOBLING) {
      return { kanKobles: true, kanLukkes: true, handling: "bekreft_eksisterende_hendelse" };
    }
    return {
      kanKobles: true,
      kanLukkes: false,
      kode: "transaksjon_har_avvikende_actual",
      detaljer: { eksisterendeSum, kvitteringTotal: receipt.total },
    };
  }

  return { kanKobles: true, kanLukkes: true, handling: "opprett_ny_hendelse" };
}

export interface KvitteringKandidat {
  transaction: TransaksjonRecord;
  dagerAvvik: number;
  tekstlikhet: 0 | 1;
}

/**
 * Transaksjonskandidater for én kvittering: utgift, eksakt beløp i øre,
 * innen 5 dager, ikke koblet til en ANNEN kvittering. Sortert på
 * datoavvik, deretter leverandørlikhet. Legacy: `finnKvitteringTransaksjonKandidater`.
 */
export function finnKvitteringTransaksjonKandidater(
  receipt: KvitteringRecord | null | undefined,
  transactions: TransaksjonRecord[] | null | undefined,
  alleHendelser: HendelseRecord[] | null | undefined,
): KvitteringKandidat[] {
  if (!receipt || !transactions) return [];
  return transactions
    .filter((t) => {
      if (t.retning !== "ut") return false;
      if (!belopMatcherIOre(receipt.total, t.belop)) return false;
      if (dagerMellom(receipt.purchaseDate, t.dato) > KVITTERING_TIDSVINDU_DAGER) return false;
      const h = finnHendelseForTransaksjon(alleHendelser, t.id);
      if (h && h.receiptId && h.receiptId !== receipt.id) return false;
      return true;
    })
    .map((t) => {
      const kl = normalizeMerchant(receipt.merchant);
      const tl = normalizeMerchant(t.tekst);
      const tekstlikhet: 0 | 1 = kl && tl && (tl.indexOf(kl) >= 0 || kl.indexOf(tl) >= 0) ? 1 : 0;
      return { transaction: t, dagerAvvik: dagerMellom(receipt.purchaseDate, t.dato), tekstlikhet };
    })
    .sort((a, b) => {
      if (a.dagerAvvik !== b.dagerAvvik) return a.dagerAvvik - b.dagerAvvik;
      return b.tekstlikhet - a.tekstlikhet;
    });
}

export interface KvitteringFordelingsLinje {
  post: { id: string; name: string; retning: "inn" | "ut" };
  belop: number;
  eiere: Eierandel[];
}

/** Kvitteringens splitter i fordelings-formatet. Legacy: `fordelingerFraKvitteringSplits`. */
export function fordelingerFraKvitteringSplits(
  splits: KvitteringSplit[] | null | undefined,
): KvitteringFordelingsLinje[] {
  return (splits || []).map((sp) => ({
    post: {
      id: sp.targetId,
      name: sp.targetName,
      retning: sp.targetType === "income" ? "inn" : "ut",
    },
    belop: sp.amount || 0,
    eiere: sp.eiere && sp.eiere.length > 0 ? sp.eiere : [{ person: "Felles", prosent: 100 }],
  }));
}

/** Kvitteringslinjer → hendelsens `fordelinger` (samme mapping legacy bruker i kobling og synk). */
export function hendelseFordelingerFraKvittering(
  splits: KvitteringSplit[] | null | undefined,
): Fordeling[] {
  return fordelingerFraKvitteringSplits(splits).map((f) => ({
    plasseringId: f.post.id,
    plasseringType: f.post.retning === "inn" ? "income" : "budget",
    plasseringNavn: f.post.name,
    belop: f.belop,
    eiere: f.eiere,
  }));
}

export type SynkResultat =
  | { feil: null; nyReceipt: KvitteringRecord; nyHendelse: HendelseRecord | null }
  | { feil: string; nyReceipt: null; nyHendelse: null };

/**
 * Redigering av en kvittering; er den koblet, oppdateres hendelsen til å
 * speile kvitteringens nåværende splitter. Asymmetrisk/manglende kobling →
 * feil og INGEN skriving. Legacy: `byggSynkronisertKvitteringOgHendelse`.
 */
export function byggSynkronisertKvitteringOgHendelse(
  receipt: KvitteringRecord,
  felter: Partial<KvitteringRecord>,
  hendelser: HendelseRecord[] | null | undefined,
  naa: string,
): SynkResultat {
  const oppdatertReceipt: KvitteringRecord = { ...receipt, ...felter, updatedAt: naa };
  if (!receipt.hendelseId) return { feil: null, nyReceipt: oppdatertReceipt, nyHendelse: null };

  const hendelse = (hendelser || []).find((h) => h.id === receipt.hendelseId);
  if (!hendelse) {
    return {
      feil: "Fant ikke hendelsen denne kvitteringen skal være koblet til. Endringen ble ikke lagret.",
      nyReceipt: null,
      nyHendelse: null,
    };
  }
  if (hendelse.receiptId !== receipt.id) {
    return {
      feil: "Hendelsen peker ikke tilbake på denne kvitteringen (asymmetrisk kobling). Endringen ble ikke lagret.",
      nyReceipt: null,
      nyHendelse: null,
    };
  }
  const oppdatertHendelse: HendelseRecord = {
    ...hendelse,
    status: "ferdig",
    paaVentAarsak: null,
    fordelinger: hendelseFordelingerFraKvittering(oppdatertReceipt.splits),
    oppdatert: naa,
  };
  return { feil: null, nyReceipt: oppdatertReceipt, nyHendelse: oppdatertHendelse };
}
