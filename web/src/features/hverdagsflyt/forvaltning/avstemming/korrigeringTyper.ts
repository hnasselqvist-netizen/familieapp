import type { MotpartValg } from "@domain/avstemming/saldokorrigering";
import type { IgnorertSom } from "@app-types/forsoning";

/** Korrigeringene avvikshjelpen kan gjøre (#59) — implementert i `useAvstemming`. */
export interface Korrigeringshandlinger {
  merkDublett: (transaksjonId: string, motpartValg: MotpartValg | null) => Promise<void>;
  angreDublett: (transaksjonId: string) => Promise<void>;
  omklassifiser: (transaksjonId: string, som: IgnorertSom) => Promise<void>;
  leggTilMotpost: (transaksjonId: string, konto: string, dato: string) => Promise<void>;
  angreMotpost: (transaksjonId: string) => Promise<void>;
  avsluttMotpost: (transaksjonId: string) => Promise<void>;
  kobleImportert: (kildeId: string, motpostId: string) => Promise<void>;
}
