import { useState } from "react";

export interface BudsjettCelleProps {
  /** Lagret verdi, slik subscriptionen sist leverte den. */
  verdi: number;
  label: string;
  className?: string;
  /**
   * Kalles ved blur når verdien faktisk er endret. `opprinnelig` er den
   * lagrede verdien da redigeringen startet.
   */
  onCommit: (nyVerdi: number, opprinnelig: number) => void;
}

/**
 * Én redigerbar måned i Årsbudsjett (#59, 6541936120).
 *
 * Rotårsak til feilen: cellene var ukontrollerte (`defaultValue`) med
 * stabil `key`. React oppdaterer ikke DOM-verdien når `defaultValue`
 * endres etter montering, så etter «samme beløp resten av året» (eller
 * annen ekstern oppdatering) viste feltene de gamle tallene til siden ble
 * lastet på nytt, selv om databasen og summene var riktige.
 *
 * Nå er cellen kontrollert: uten fokus viser den alltid den lagrede
 * verdien; under redigering holder den et lokalt utkast, så en ekstern
 * oppdatering ikke overskriver det brukeren skriver.
 */
export function BudsjettCelle({ verdi, label, className, onCommit }: BudsjettCelleProps) {
  const [utkast, setUtkast] = useState<{ tekst: string; opprinnelig: number } | null>(null);
  return (
    <input
      type="number"
      value={utkast ? utkast.tekst : String(verdi ?? 0)}
      aria-label={label}
      className={className}
      onFocus={(e) => {
        setUtkast({ tekst: String(verdi ?? 0), opprinnelig: verdi ?? 0 });
        e.target.select();
      }}
      onChange={(e) => setUtkast((u) => (u ? { ...u, tekst: e.target.value } : u))}
      onBlur={() => {
        if (!utkast) return;
        const nyVerdi = Number.parseFloat(utkast.tekst) || 0;
        setUtkast(null);
        if (nyVerdi !== utkast.opprinnelig) onCommit(nyVerdi, utkast.opprinnelig);
      }}
    />
  );
}
