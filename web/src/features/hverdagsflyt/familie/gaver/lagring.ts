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
      const navn = e instanceof Error ? e.name : "";
      const erKonflikt = navn === "EndretAvAndre";
      setKonflikt(erKonflikt);
      // Datalagets egne utfall har en ærlig tekst: konflikt, sikkert ikke
      // lagret, eller ukjent (sendt uten svar; aldri «ikke lagret»).
      setFeil(
        erKonflikt || navn === "EndringIkkeLagret" || navn === "UkjentSkriveUtfall"
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
