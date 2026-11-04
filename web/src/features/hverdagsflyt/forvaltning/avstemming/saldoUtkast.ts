import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

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

/**
 * En endring: felt som slås sammen, `null` (fjern utkastet), eller en
 * funksjon av det gjeldende utkastet — for svar fra en lagring som kan
 * komme etter at brukeren har skrevet videre.
 */
export type SaldoEndring = Partial<SaldoUtkast> | null | ((naa: SaldoUtkast) => SaldoUtkast | null);

export interface SaldoUtkastLager {
  hent: (nokkel: string) => SaldoUtkast;
  /** Siste gjengitte utkast, også fra en lagring som startet i et annet felt. */
  les: (nokkel: string) => SaldoUtkast;
  sett: (nokkel: string, endring: SaldoEndring) => void;
}

function anvend(naa: SaldoUtkast, endring: SaldoEndring): SaldoUtkast | null {
  if (endring === null) return null;
  if (typeof endring === "function") return endring(naa);
  return { ...naa, ...endring };
}

const TOM: SaldoUtkast = { lagrer: false, feil: null };

export const saldoNokkel = (konto: string, maaned: string): string => `${konto}|${maaned}`;

/** Selve lageret; holdes av `AvstemmingView`. */
export function useSaldoUtkastLager(): SaldoUtkastLager {
  const [utkast, setUtkast] = useState<Record<string, SaldoUtkast>>({});
  const siste = useRef(utkast);
  siste.current = utkast;
  const hent = useCallback((n: string) => utkast[n] ?? TOM, [utkast]);
  const les = useCallback((n: string) => siste.current[n] ?? TOM, []);
  const sett = useCallback((n: string, endring: SaldoEndring) => {
    setUtkast((u) => {
      const ny = anvend(u[n] ?? TOM, endring);
      if (ny === null) {
        const resten = { ...u };
        delete resten[n];
        return resten;
      }
      return { ...u, [n]: ny };
    });
  }, []);
  return useMemo(() => ({ hent, les, sett }), [hent, les, sett]);
}

export const SaldoUtkastKontekst = createContext<SaldoUtkastLager | null>(null);

/**
 * Utkastet for ett saldofelt. Uten lager (f.eks. en isolert test) holdes
 * det lokalt i feltet, som før.
 */
export function useSaldoUtkast(
  nokkel: string,
): [SaldoUtkast, (e: SaldoEndring) => void, () => SaldoUtkast] {
  const lager = useContext(SaldoUtkastKontekst);
  const [lokal, setLokal] = useState<SaldoUtkast>(TOM);
  const sisteLokal = useRef(lokal);
  sisteLokal.current = lokal;
  const les = useCallback(() => (lager ? lager.les(nokkel) : sisteLokal.current), [lager, nokkel]);
  const settLokal = useCallback((e: SaldoEndring) => setLokal((u) => anvend(u, e) ?? TOM), []);
  const sett = useCallback(
    (e: SaldoEndring) => (lager ? lager.sett(nokkel, e) : settLokal(e)),
    [lager, nokkel, settLokal],
  );
  return [lager ? lager.hent(nokkel) : lokal, sett, les];
}
