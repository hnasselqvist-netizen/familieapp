/**
 * Kvitteringsinnboksens skrivende handlinger (§Issue #34 R3b-3), portert
 * fra legacy `KvitteringInnboksScreen` (`index.html` ~5854–6140): kobling
 * og omkobling til en banktransaksjon, ny kvittering, redigering (med
 * synk av koblet hendelse), forkasting og bakgrunnsforslaget.
 *
 * Rene funksjoner. Skrivende handlinger returnerer en `Beslutningsendring`
 * for den felles skriveren (`hooks/useForsoningSkriver.ts`) bak
 * forsoningsporten.
 */
import type {
  HendelseRecord,
  KvitteringRecord,
  KvitteringSplit,
  TransaksjonRecord,
} from "@app-types/forsoning";
import type { Beslutningsendring } from "./beslutning";
import { finnHendelseForKvittering, finnHendelseForTransaksjon } from "./fordeling";
import {
  type KoblingsVurdering,
  byggSynkronisertKvitteringOgHendelse,
  fordelingerFraKvitteringSplits,
  vurderKvitteringKobling,
} from "./kvittering";
import { forslagIMinnet } from "./kvitteringsinnboks";

export interface KvitteringSnapshot {
  transaksjoner: TransaksjonRecord[];
  hendelser: HendelseRecord[];
  receipts: KvitteringRecord[];
}

/** Brukerens valg når transaksjonen allerede er fordelt annerledes enn kvitteringen. */
export type TvungetHandling = "bruk_kvittering" | "behold_eksisterende" | null;

/** Legacy sin inline konflikt i listeraden (`konflikter[receipt.id]`). */
export type Konflikt = KoblingsVurdering & { transactionId: string; kunLenke?: boolean };

export interface KoblingsUtfall {
  /** Konflikten som skal vises (null = fjern en eventuell eksisterende). */
  konflikt: Konflikt | null;
  /** Hva som skrives (null = ingenting). */
  endring: Beslutningsendring | null;
}

/** Legacy `KONFLIKT_TEKST` (~6002). */
export const KONFLIKT_TEKST: Record<string, string> = {
  transaksjon_ignorert:
    "Hendelsen er arkivert. Gjenåpne den i Bankimport for å kunne koble en kvittering til den.",
  transaksjon_koblet_annen_kvittering:
    "Denne hendelsen er allerede koblet til en annen kvittering.",
  transaksjon_har_avvikende_actual:
    "Hendelsen er allerede fordelt annerledes enn kvitteringen. Velg hvilken fordeling som skal gjelde.",
  ikke_fordelt:
    "Kvitteringen er koblet, men må fordeles før kjøpet kan ferdigbehandles automatisk.",
  splitt_avvik:
    "Splittsummen stemmer ikke med kvitteringens totalbeløp. Rett opp fordelingen for å ferdigbehandle automatisk.",
  belop_avvik:
    "Kvitteringsbeløpet stemmer ikke med banktransaksjonen. Sjekk at riktig hendelse er valgt.",
};

/**
 * Legacy `kobleKvitteringTilTransaksjon` (~5904): vurder → (omkoble) →
 * opprett/oppdater hendelsen → pek transaksjonen og kvitteringen på den.
 */
export function kobleKvittering(
  snap: KvitteringSnapshot,
  receipt: KvitteringRecord,
  transactionId: string,
  tvungetHandling: TvungetHandling,
  deps: { newId: () => string; naa: string },
): KoblingsUtfall {
  const transaction = snap.transaksjoner.find((t) => t.id === transactionId);
  if (!transaction) return { konflikt: null, endring: null };

  const kvitteringensHendelse = finnHendelseForKvittering(snap.hendelser, receipt.id);
  const forrigeTransaksjonId = kvitteringensHendelse ? kvitteringensHendelse.transaksjonId : null;
  const erOmkobling = !!forrigeTransaksjonId && forrigeTransaksjonId !== transactionId;

  const vurdering = vurderKvitteringKobling(receipt, transaction, snap.hendelser, snap.receipts);
  if (!vurdering.kanKobles) return { konflikt: { ...vurdering, transactionId }, endring: null };
  if (vurdering.kode === "transaksjon_har_avvikende_actual" && !tvungetHandling) {
    return { konflikt: { ...vurdering, transactionId }, endring: null };
  }

  const naa = deps.naa;
  const skalLukke =
    vurdering.kanLukkes ||
    (vurdering.kode === "transaksjon_har_avvikende_actual" && !!tvungetHandling);
  const brukKvitteringensFordeling =
    vurdering.handling === "opprett_ny_hendelse" || tvungetHandling === "bruk_kvittering";

  const eksisterendeHendelse = finnHendelseForTransaksjon(snap.hendelser, transaction.id);
  const hendelseId = eksisterendeHendelse ? eksisterendeHendelse.id : deps.newId();

  let nyStatus: HendelseRecord["status"];
  let nyeFordelinger: HendelseRecord["fordelinger"];
  const nyRegelId = eksisterendeHendelse ? eksisterendeHendelse.regelId : null;
  if (skalLukke && brukKvitteringensFordeling) {
    nyStatus = "ferdig";
    nyeFordelinger = fordelingerFraKvitteringSplits(receipt.splits).map((f) => ({
      plasseringId: f.post.id,
      plasseringType: f.post.retning === "inn" ? "income" : "budget",
      plasseringNavn: f.post.name,
      belop: f.belop,
      eiere: f.eiere,
    }));
  } else if (skalLukke) {
    nyStatus = "ferdig";
    nyeFordelinger = eksisterendeHendelse ? eksisterendeHendelse.fordelinger : [];
  } else {
    nyStatus = eksisterendeHendelse ? eksisterendeHendelse.status : "uplassert";
    nyeFordelinger = eksisterendeHendelse ? eksisterendeHendelse.fordelinger : [];
  }

  const hendelse: HendelseRecord = {
    id: hendelseId,
    status: nyStatus,
    paaVentAarsak: eksisterendeHendelse ? eksisterendeHendelse.paaVentAarsak : null,
    transaksjonId: transaction.id,
    receiptId: receipt.id,
    fordelinger: nyeFordelinger,
    dato: transaction.dato,
    regelId: nyRegelId,
    opprettet: eksisterendeHendelse ? eksisterendeHendelse.opprettet : naa,
    oppdatert: naa,
  };

  const endring: Beslutningsendring = {
    hendelser: (prev) => {
      const etterOmkobling = erOmkobling
        ? prev.filter((h) => h.transaksjonId !== forrigeTransaksjonId)
        : prev;
      return [...etterOmkobling.filter((h) => h.id !== hendelseId), hendelse];
    },
    transaksjoner: (prev) =>
      prev
        .map((t) => (erOmkobling && t.id === forrigeTransaksjonId ? { ...t, hendelseId: null } : t))
        .map((t) => (t.id !== transaction.id ? t : { ...t, hendelseId })),
    receipts: (prev) =>
      prev.map((r) =>
        r.id !== receipt.id
          ? r
          : { ...r, hendelseId, matchingStatus: "matched", matchingUpdatedAt: naa },
      ),
  };
  return {
    konflikt: skalLukke ? null : { ...vurdering, transactionId, kunLenke: true },
    endring,
  };
}

export interface NyKvittering {
  dato: string;
  leverandor: string;
  /** Rå tekst fra beløpsfeltet (legacy: `parseFloat(nyTotal)||0`). */
  total: string;
  allocationMode: "single" | "split" | null;
  splits: KvitteringSplit[];
}

/**
 * Legacy `lagKvittering` (~6074) uten bilde (Drive-opplasting er ikke
 * portert — åpent valg i `r3b-cutover.md` §7). Legacy lagrer også uten
 * bilde når opplastingen feiler.
 */
export function nyKvittering(
  k: NyKvittering,
  deps: { newId: () => string; naa: string },
): Beslutningsendring {
  const naa = deps.naa;
  const receipt = {
    id: deps.newId(),
    driveFileId: null,
    driveWebViewLink: null,
    driveFolderId: null,
    originalFileName: "",
    mimeType: "",
    transactionId: null,
    merchant: k.leverandor.trim(),
    purchaseDate: k.dato,
    total: parseFloat(k.total) || 0,
    allocationMode: k.allocationMode,
    splits: k.splits,
    ocrStatus: "none",
    ocrText: "",
    matchingStatus: "unmatched",
    matchConfidence: 0,
    suggestedTransactionId: null,
    hendelseId: null,
    matchingUpdatedAt: naa,
    createdAt: naa,
    updatedAt: naa,
  } as unknown as KvitteringRecord;
  return { receipts: (prev) => [...prev, receipt] };
}

export type RedigeringsUtfall =
  { feil: string; endring: null } | { feil: null; endring: Beslutningsendring };

/**
 * Legacy `oppdaterKvittering` (~6125): redigering — og forkasting
 * (`{forkastet: true}`) — speiler en koblet hendelse. Asymmetrisk eller
 * manglende kobling gir feil og INGEN skriving.
 */
export function oppdaterKvittering(
  snap: Pick<KvitteringSnapshot, "receipts" | "hendelser">,
  id: string,
  felter: Partial<KvitteringRecord>,
  naa: string,
): RedigeringsUtfall | null {
  const receipt = snap.receipts.find((x) => x.id === id);
  if (!receipt) return null;
  const r = byggSynkronisertKvitteringOgHendelse(receipt, felter, snap.hendelser, naa);
  if (r.feil !== null) return { feil: r.feil, endring: null };
  const { nyReceipt, nyHendelse } = r;
  return {
    feil: null,
    endring: {
      receipts: (prev) => prev.map((x) => (x.id !== id ? x : nyReceipt)),
      ...(nyHendelse
        ? {
            hendelser: (prev: HendelseRecord[]) => [
              ...prev.filter((h) => h.id !== nyHendelse.id),
              nyHendelse,
            ],
          }
        : {}),
    },
  };
}

/**
 * Bakgrunnsforslaget (legacy-effekten ~5854) som helnode-updater mot fersk
 * verdi: matchede kvitteringer røres aldri; øvrige får beste kandidat.
 * Returnerer `null` når ingenting ville endret seg — da skrives ingenting
 * (legacy returnerer `prevReceipts`).
 */
export function bakgrunnsforslag(
  receipts: readonly KvitteringRecord[],
  transaksjoner: readonly TransaksjonRecord[],
  hendelser: readonly HendelseRecord[],
  naa: string,
): Beslutningsendring | null {
  if (transaksjoner.length === 0 || receipts.length === 0) return null;
  const etter = forslagIMinnet(receipts, transaksjoner, hendelser, naa);
  if (etter.every((r, i) => r === receipts[i])) return null;
  return {
    receipts: (prev) => forslagIMinnet(prev, transaksjoner, hendelser, naa),
  };
}
