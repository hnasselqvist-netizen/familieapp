/**
 * Domene-/tjenestefeil som verktøylaget oversetter til et `isError`-
 * verktøyresultat. `retryable` forteller klienten om SAMME forespørsel
 * (samme requestId) trygt kan prøves på nytt.
 */
export type ToolErrorCode =
  | "duplicate_items"
  | "idempotency_conflict"
  | "internal_error"
  /** Full lesing og skriving: ugyldig sti (`data/sti.ts`). */
  | "invalid_path"
  /** Generell skriving (`data/skriving.ts`). */
  | "ugyldig_skriving"
  | "beskyttet"
  | "konflikt"
  | "forelder_er_verdi"
  | "utlopt"
  | "for_stor"
  /** Transaksjonen kastet, og kvitteringen ble ikke funnet: prøv igjen med samme opId. */
  | "ukjent_utfall";

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly retryable: boolean;
  /** Strukturerte detaljer til klienten (f.eks. nåværende versjoner ved konflikt). Aldri dataverdier. */
  readonly detaljer?: Record<string, unknown>;

  constructor(
    code: ToolErrorCode,
    message: string,
    retryable: boolean,
    detaljer?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.detaljer = detaljer;
    this.name = "ToolError";
  }
}
