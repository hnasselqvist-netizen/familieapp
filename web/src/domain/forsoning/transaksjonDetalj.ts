/**
 * Detaljgrunnlag for én transaksjon i sidepanelet (#59, PC-2, ordre
 * 6647608110). Ren avledning, ingen ny datakontrakt.
 *
 * - **Regelgrunnlag** viser regelen slik den er NÅ. Det finnes ikke noe
 *   øyeblikksbilde av regelen da den ble brukt, så panelet sier det
 *   eksplisitt. En slettet regel vises som slettet.
 * - **Kvitteringer** følges gjennom alle faktiske koblingsveier:
 *   kvitteringens `transactionId` (direkte opplasting), hendelsens
 *   `receiptId` og kvitteringens `hendelseId`. Flere koblinger vises alle,
 *   så en konflikt er synlig. Forkastede kvitteringer gjenopplives ikke —
 *   de telles bare.
 */
import type {
  HendelseRecord,
  KvitteringRecord,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";

export type Regelgrunnlag =
  | { type: "regel"; regel: RegelRecord }
  | { type: "regel_slettet"; regelId: string }
  | { type: "laert_forslag"; navn: string; gruppe: string | null; flerbruk: boolean }
  | { type: "ingen" };

export function regelgrunnlag(
  t: Pick<TransaksjonRecord, "laertKobling">,
  h: Pick<HendelseRecord, "regelId"> | null | undefined,
  rules: readonly RegelRecord[],
): Regelgrunnlag {
  if (h?.regelId) {
    const regel = rules.find((r) => r.id === h.regelId);
    return regel ? { type: "regel", regel } : { type: "regel_slettet", regelId: h.regelId };
  }
  const lk = t.laertKobling;
  if (lk && lk.navn) {
    return {
      type: "laert_forslag",
      navn: lk.navn,
      gruppe: lk.gruppe ?? null,
      flerbruk: !!lk.flerbruk,
    };
  }
  return { type: "ingen" };
}

export type KvitteringVei = "transaksjon" | "hendelse_peker" | "kvittering_peker";

export const KVITTERING_VEI_LABEL: Record<KvitteringVei, string> = {
  transaksjon: "lastet opp på transaksjonen",
  hendelse_peker: "koblet fra hendelsen",
  kvittering_peker: "kvitteringen peker på hendelsen",
};

export interface KobletKvittering {
  kvittering: KvitteringRecord;
  veier: KvitteringVei[];
}

export function kvitteringerForTransaksjon(
  t: Pick<TransaksjonRecord, "id">,
  h: Pick<HendelseRecord, "id" | "receiptId"> | null | undefined,
  receipts: readonly KvitteringRecord[],
): { koblet: KobletKvittering[]; forkastet: number } {
  const koblet: KobletKvittering[] = [];
  let forkastet = 0;
  for (const r of receipts || []) {
    const veier: KvitteringVei[] = [];
    if (r.transactionId && r.transactionId === t.id) veier.push("transaksjon");
    if (h && h.receiptId && h.receiptId === r.id) veier.push("hendelse_peker");
    if (h && r.hendelseId && r.hendelseId === h.id) veier.push("kvittering_peker");
    if (veier.length === 0) continue;
    if (r.forkastet) forkastet += 1;
    else koblet.push({ kvittering: r, veier });
  }
  return { koblet, forkastet };
}
