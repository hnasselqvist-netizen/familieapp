import { useCallback, useState } from "react";

/**
 * Lagringstilstand for ett skjema eller én handling. Utkastet ligger i
 * komponenten og forsvinner aldri ved feil; et skjema lukkes først når
 * lagringen er bekreftet (`kjor` returnerer `true`).
 */
export function useLagring() {
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [konflikt, setKonflikt] = useState(false);

  const kjor = useCallback(async (fn: () => Promise<void>): Promise<boolean> => {
    setLagrer(true);
    setFeil(null);
    setKonflikt(false);
    try {
      await fn();
      return true;
    } catch (e) {
      const erKonflikt = e instanceof Error && e.name === "EndretAvAndre";
      setKonflikt(erKonflikt);
      setFeil(
        erKonflikt
          ? (e as Error).message
          : "Kunne ikke lagre. Sjekk nettforbindelsen og prøv igjen — det du skrev, er tatt vare på.",
      );
      return false;
    } finally {
      setLagrer(false);
    }
  }, []);

  const nullstill = useCallback(() => {
    setFeil(null);
    setKonflikt(false);
  }, []);

  return { lagrer, feil, konflikt, kjor, nullstill };
}
