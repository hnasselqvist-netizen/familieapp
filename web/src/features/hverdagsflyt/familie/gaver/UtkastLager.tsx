import { useCallback, useMemo, useState, type ReactNode } from "react";
import { LagerKontekst, type UtkastPost } from "./utkast";

/** Eier utkastene for hele gavesiden (se `utkast.ts`). */
export function UtkastLager({ children }: { children: ReactNode }) {
  const [poster, setPoster] = useState<Map<string, UtkastPost>>(() => new Map());
  const [verter, setVerter] = useState<Map<string, number>>(() => new Map());

  const sett = useCallback(
    (n: string, p: UtkastPost) => setPoster((m) => new Map(m).set(n, p)),
    [],
  );
  const oppdater = useCallback(
    (n: string, fn: (p: UtkastPost) => UtkastPost) =>
      setPoster((m) => {
        const p = m.get(n);
        return p ? new Map(m).set(n, fn(p)) : m;
      }),
    [],
  );
  const fjern = useCallback(
    (n: string) =>
      setPoster((m) => {
        if (!m.has(n)) return m;
        const ny = new Map(m);
        ny.delete(n);
        return ny;
      }),
    [],
  );
  const registrer = useCallback((n: string) => {
    setVerter((m) => new Map(m).set(n, (m.get(n) ?? 0) + 1));
    return () =>
      setVerter((m) => {
        const ny = new Map(m);
        const antall = (ny.get(n) ?? 1) - 1;
        if (antall <= 0) ny.delete(n);
        else ny.set(n, antall);
        return ny;
      });
  }, []);

  const verdi = useMemo(
    () => ({ poster, sett, oppdater, fjern, verter, registrer }),
    [poster, sett, oppdater, fjern, verter, registrer],
  );
  return <LagerKontekst.Provider value={verdi}>{children}</LagerKontekst.Provider>;
}
