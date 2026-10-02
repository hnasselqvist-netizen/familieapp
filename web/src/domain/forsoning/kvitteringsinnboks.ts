/**
 * Kvitteringsinnboks — rene visningsfunksjoner, portert 1:1 fra legacy
 * `KvitteringInnboksScreen` (`index.html` ~5844–6471) og `KvitteringDetalj`
 * (~5528–5842), §Issue #34 R2 (kun visning).
 *
 * **Bakgrunnsforslaget skrives ikke.** Legacy kjører en effekt (~5854) som
 * skriver `suggestedTransactionId`/`matchConfidence`/`matchingStatus` til
 * HELE `receipts`-noden på hver enhet som har innboksen åpen. Å porte den
 * ville gjort React til en ny aktiv skriver av `receipts` (ADR 0002).
 * `forslagIMinnet` kjører i stedet effektens EGEN updater-logikk i minnet,
 * så skjermen viser det samme forslaget legacy ville skrevet og vist — uten
 * å skrive noe.
 */
import type {
  HendelseRecord,
  KvitteringRecord,
  KvitteringSplit,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { finnHendelseForKvittering } from "./fordeling";
import { finnKvitteringTransaksjonKandidater } from "./kvittering";

/** Legacy: `getDisplayDescription` (~10375). */
export function getDisplayDescription(
  line: Pick<KvitteringSplit, "description" | "ocrDescription"> | null | undefined,
): string {
  if (!line) return "";
  return line.description || line.ocrDescription || "";
}

/**
 * Effektens updater (~5865), uten skriving: matchede kvitteringer røres
 * aldri; øvrige får beste kandidat som forslag (`suggested`) eller
 * `unmatched`. Uendrede kvitteringer returneres som samme objekt.
 * Som legacy-effekten gjør den ingenting når det mangler transaksjoner
 * eller kvitteringer — da gjelder de lagrede verdiene.
 */
export function forslagIMinnet(
  receipts: readonly KvitteringRecord[],
  transaksjoner: readonly TransaksjonRecord[],
  hendelser: readonly HendelseRecord[],
  naa: string,
): KvitteringRecord[] {
  if (transaksjoner.length === 0 || receipts.length === 0) return [...receipts];
  return receipts.map((r) => {
    if (r.matchingStatus === "matched") return r;
    const kandidater = finnKvitteringTransaksjonKandidater(r, [...transaksjoner], [...hendelser]);
    const beste = kandidater.length > 0 ? kandidater[0]! : null;
    const nyForeslattId = beste ? beste.transaction.id : null;
    const nyConfidence = beste ? Math.max(0, 100 - beste.dagerAvvik * 10) : 0;
    const nyStatus = beste ? "suggested" : "unmatched";
    if (
      r.suggestedTransactionId === nyForeslattId &&
      r.matchingStatus === nyStatus &&
      r.matchConfidence === nyConfidence
    ) {
      return r;
    }
    return {
      ...r,
      suggestedTransactionId: nyForeslattId,
      matchConfidence: nyConfidence,
      matchingStatus: nyStatus,
      matchingUpdatedAt: naa,
    };
  });
}

/**
 * Kvitteringer som krever en beslutning: ikke forkastet, og uten en
 * FERDIG hendelse. Nyeste kjøpsdato (ellers opprettet) først.
 * Legacy: `aktiveKvitteringer` + render-sorteringen (~6349–6364).
 */
export function aktiveKvitteringer(
  receipts: readonly KvitteringRecord[],
  hendelser: readonly HendelseRecord[],
): KvitteringRecord[] {
  return receipts
    .filter((r) => {
      if (r.forkastet) return false;
      const h = finnHendelseForKvittering([...hendelser], r.id);
      return !h || h.status !== "ferdig";
    })
    .sort(
      (a, b) =>
        new Date(b.purchaseDate || b.createdAt || "").getTime() -
        new Date(a.purchaseDate || a.createdAt || "").getTime(),
    );
}

export type KvitteringStatusTone = "ferdig" | "koblet" | "foreslatt" | "ikke_koblet";

/** Statusteksten i listeraden. Legacy: `statusTekst` (~6378). */
export function kvitteringStatus(
  r: KvitteringRecord,
  hendelser: readonly HendelseRecord[],
): { tekst: string; tone: KvitteringStatusTone } {
  const h = finnHendelseForKvittering([...hendelser], r.id);
  if (h && h.status === "ferdig") return { tekst: "Ferdig behandlet", tone: "ferdig" };
  if (r.matchingStatus === "matched") return { tekst: "Koblet", tone: "koblet" };
  if (r.matchingStatus === "suggested") return { tekst: "Foreslått", tone: "foreslatt" };
  return { tekst: "Ikke koblet", tone: "ikke_koblet" };
}

/** Transaksjonen bak et forslag, hvis den finnes. Legacy: `foreslattTrans` (~6367). */
export function foreslattTransaksjon(
  r: KvitteringRecord,
  transaksjoner: readonly TransaksjonRecord[],
): TransaksjonRecord | null {
  return r.matchingStatus === "suggested" && r.suggestedTransactionId
    ? (transaksjoner.find((t) => t.id === r.suggestedTransactionId) ?? null)
    : null;
}
