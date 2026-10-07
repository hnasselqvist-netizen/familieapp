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
    // `?? null`: Firebase lagrer ikke null, så et lagret `null` leses tilbake
    // som manglende felt. Uten dette ville en `unmatched` kvittering alltid
    // se endret ut, og bakgrunnsforslaget ville skrevet den på nytt (bare med
    // ny `matchingUpdatedAt`) etter hver rundtur. Bevisst avvik fra legacy
    // (~5900), som har samme sammenligning; sluttilstanden er den samme.
    if (
      (r.suggestedTransactionId ?? null) === nyForeslattId &&
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
 * Er kvitteringen ferdig behandlet: koblet til en hendelse som er FERDIG?
 *
 * **Bevisst avvik (Lønnsdagsrunden, #66, Helens septemberavslutning):**
 * legacy ser bare på den FØRSTE hendelsen med `receiptId` lik kvitteringen
 * (`finnHendelseForKvittering`). Har kvitteringen flere hendelser, for
 * eksempel en gammel hendelse på vent eller uplassert fra før en
 * omkobling eller korrigering, og en nyere ferdig hendelse, ble den stående
 * som aktiv og «Koblet» i innboksen. Det samme gjaldt en asymmetrisk kobling
 * der kvitteringens egen `hendelseId` peker på en ferdig hendelse som har
 * mistet `receiptId` (men ikke når hendelsen peker på en annen kvittering;
 * da er det en reell konflikt). Nå er kvitteringen ferdig når NOEN av hendelsene den
 * er koblet til, er ferdig. Dataene er uendret.
 */
export function erKvitteringFerdigBehandlet(
  r: KvitteringRecord,
  hendelser: readonly HendelseRecord[],
): boolean {
  return hendelser.some(
    (h) =>
      h.status === "ferdig" &&
      ((!!r.id && h.receiptId === r.id) ||
        // Bare når hendelsen ikke peker på en ANNEN kvittering: det er en
        // reell konflikt som skal bli synlig (§kvittering.ts).
        (!!r.hendelseId && h.id === r.hendelseId && !h.receiptId)),
  );
}

/**
 * Kvitteringer som krever en beslutning: ikke forkastet og ikke ferdig
 * behandlet (§erKvitteringFerdigBehandlet). Nyeste kjøpsdato (ellers
 * opprettet) først. Legacy: `aktiveKvitteringer` + render-sorteringen
 * (~6349–6364).
 */
export function aktiveKvitteringer(
  receipts: readonly KvitteringRecord[],
  hendelser: readonly HendelseRecord[],
): KvitteringRecord[] {
  return receipts
    .filter((r) => !r.forkastet && !erKvitteringFerdigBehandlet(r, hendelser))
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
  if (erKvitteringFerdigBehandlet(r, hendelser)) {
    return { tekst: "Ferdig behandlet", tone: "ferdig" };
  }
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
