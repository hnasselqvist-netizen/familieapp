/**
 * Falskt objektlager i minnet (#59, B1): samme kontrakt som GCS-adapteren —
 * opprett bare hvis stien er ledig, aldri overskriving, aldri sletting.
 * Brukes i tester og i lokal emulatorkjøring uten bøtte.
 */
import type { Objektlager, VedleggType } from "./kjerne";

export class MinneObjektlager implements Objektlager {
  readonly objekter = new Map<string, { bytes: Uint8Array; type: VedleggType }>();
  /** Teller faktiske skrivinger (for idempotenstester). */
  skrivinger = 0;

  async opprettHvisLedig(
    sti: string,
    bytes: Uint8Array,
    type: VedleggType,
  ): Promise<"opprettet" | "fantes"> {
    if (this.objekter.has(sti)) return "fantes";
    this.skrivinger++;
    this.objekter.set(sti, { bytes: new Uint8Array(bytes), type });
    return "opprettet";
  }

  async les(sti: string) {
    const o = this.objekter.get(sti);
    return o ? { bytes: new Uint8Array(o.bytes), type: o.type } : null;
  }
}
