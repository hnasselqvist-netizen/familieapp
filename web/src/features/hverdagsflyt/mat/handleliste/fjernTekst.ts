import type { InnleggingsSkriveutfall } from "@data/shopping.repository";

/** Tekst for et utfall; `null` når raden ganske enkelt er fjernet. */
export function fjernTekst(
  u: InnleggingsSkriveutfall,
  navn: string,
  gjentak: boolean,
): string | null {
  switch (u.utfall) {
    case "anvendt":
      return gjentak ? `«${navn}» er bekreftet fjernet.` : null;
    case "allerede":
      return gjentak
        ? `«${navn}» er ikke lenger på listen.`
        : `«${navn}» var allerede fjernet fra listen. Ingenting mer er endret.`;
    case "konflikt":
    case "ubekreftet":
      return u.grunn;
    case "avvist":
      return `Ingen tilgang til å fjerne «${navn}». Ingenting er fjernet.`;
    case "ikkeLest":
      return `Kunne ikke lese handlelisten. «${navn}» er ikke fjernet — prøv igjen.`;
    case "ukjent":
      return `Vi vet ikke om «${navn}» ble fjernet — svaret uteble. «Prøv igjen» sjekker raden på nytt og fjerner den bare hvis den fortsatt er slik du så den.`;
  }
}
