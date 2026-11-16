import type { InnleggingsSkriveutfall, PostSjekk } from "@data/shopping.repository";

/** Tekst for et utfall av «Fjern»; `null` når raden ganske enkelt er fjernet. */
export function fjernTekst(u: InnleggingsSkriveutfall, navn: string): string | null {
  switch (u.utfall) {
    case "anvendt":
      return null;
    case "allerede":
      return `«${navn}» var allerede fjernet fra listen. Ingenting mer er endret.`;
    case "konflikt":
    case "ubekreftet":
      return u.grunn;
    case "avvist":
      return `Ingen tilgang til å fjerne «${navn}». Ingenting er fjernet.`;
    case "ikkeLest":
      return `Kunne ikke lese handlelisten. «${navn}» er ikke fjernet — prøv igjen.`;
    case "ukjent":
      return `Vi vet ikke om «${navn}» ble fjernet — svaret uteble. «Prøv igjen» sjekker bare om raden står på listen; den fjerner ingenting. «Fjern» på raden er sperret til dette er avklart.`;
  }
}

/**
 * Tekst for den skrivefrie oppfølgingen etter ukjent utfall (review
 * 5913786153 pkt. 2). `uavklart`: utfallet er fortsatt ukjent, så planen og
 * sperren på raden består.
 */
export function sjekkTekst(s: PostSjekk, navn: string): { tekst: string; uavklart: boolean } {
  switch (s.utfall) {
    case "borte":
      return { tekst: `«${navn}» er ikke lenger på listen.`, uavklart: false };
    case "finnes":
      return {
        tekst: `«${navn}» står på listen. Ingenting er fjernet nå — trykk «Fjern» på raden hvis den skal bort.`,
        uavklart: false,
      };
    case "avvist":
      return {
        tekst: `Fortsatt ikke avklart om «${navn}» ble fjernet: ingen tilgang til å lese handlelisten nå. Ingenting er endret — prøv igjen senere.`,
        uavklart: true,
      };
    case "ikkeLest":
      return {
        tekst: `Fortsatt ikke avklart om «${navn}» ble fjernet: handlelisten kunne ikke leses nå. Ingenting er endret — prøv igjen.`,
        uavklart: true,
      };
  }
}
