import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Saldoutkast per konto/måned (#59, AV-1). Ligger over valget mellom PC og
 * mobil, så det du har tastet, en pågående lagring og en feil står når
 * vinduet endrer bredde eller abonnementet oppdaterer vurderingene.
 */
export interface SaldoUtkast {
  /** Tastet tekst; `undefined` = vis den lagrede saldoen. */
  tekst?: string;
  lagrer: boolean;
  feil: string | null;
}

export interface SaldoUtkastLager {
  hent: (nokkel: string) => SaldoUtkast;
  sett: (nokkel: string, endring: Partial<SaldoUtkast> | null) => void;
}

const TOM: SaldoUtkast = { lagrer: false, feil: null };

export const saldoNokkel = (konto: string, maaned: string): string => `${konto}|${maaned}`;

/** Selve lageret; holdes av `AvstemmingView`. */
export function useSaldoUtkastLager(): SaldoUtkastLager {
  const [utkast, setUtkast] = useState<Record<string, SaldoUtkast>>({});
  const hent = useCallback((n: string) => utkast[n] ?? TOM, [utkast]);
  const sett = useCallback((n: string, endring: Partial<SaldoUtkast> | null) => {
    setUtkast((u) => {
      if (endring === null) {
        const resten = { ...u };
        delete resten[n];
        return resten;
      }
      return { ...u, [n]: { ...(u[n] ?? TOM), ...endring } };
    });
  }, []);
  return useMemo(() => ({ hent, sett }), [hent, sett]);
}

export const SaldoUtkastKontekst = createContext<SaldoUtkastLager | null>(null);

/**
 * Utkastet for ett saldofelt. Uten lager (f.eks. en isolert test) holdes
 * det lokalt i feltet, som før.
 */
export function useSaldoUtkast(
  nokkel: string,
): [SaldoUtkast, (e: Partial<SaldoUtkast> | null) => void] {
  const lager = useContext(SaldoUtkastKontekst);
  const [lokal, setLokal] = useState<SaldoUtkast>(TOM);
  const settLokal = useCallback(
    (e: Partial<SaldoUtkast> | null) => setLokal((u) => (e === null ? TOM : { ...u, ...e })),
    [],
  );
  const sett = useCallback(
    (e: Partial<SaldoUtkast> | null) => (lager ? lager.sett(nokkel, e) : settLokal(e)),
    [lager, nokkel, settLokal],
  );
  return [lager ? lager.hent(nokkel) : lokal, sett];
}
