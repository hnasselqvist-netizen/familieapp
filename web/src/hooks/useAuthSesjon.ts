import { useSyncExternalStore } from "react";
import { aktivSesjon, subscribeAuthSesjon } from "@data/auth.repository";

/**
 * Sesjonen til innloggingen akkurat nå (se `aktivSesjon`), eller `null`.
 * Endres ved utlogging og ny innlogging, også med samme uid, men ikke ved
 * tokenfornyelse (Mat #20, review 5969643874).
 */
export function useAuthSesjon(): string | null {
  return useSyncExternalStore(subscribeAuthSesjon, aktivSesjon);
}
