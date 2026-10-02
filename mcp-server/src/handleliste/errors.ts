/**
 * Domene-/tjenestefeil som verktøylaget oversetter til et `isError`-
 * verktøyresultat. `retryable` forteller klienten om SAMME forespørsel
 * (samme requestId) trygt kan prøves på nytt.
 */
export type ToolErrorCode = "duplicate_items" | "idempotency_conflict" | "internal_error";

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly retryable: boolean;

  constructor(code: ToolErrorCode, message: string, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = "ToolError";
  }
}
