import type { InnleggingsSkriveutfall, LeseAvslag } from "@data/shopping.repository";
import { type StatusLesing, type StatusPlan, statusNavn } from "@domain/shopping/handlelisteStatus";

/**
 * Tekst for et utfall av «Merk som fullført»/«Merk som ikke fullført» (Mat
 * #20, ordre 6908431056); `null` når statusen er satt eller allerede var
 * målet (skrivefri no-op).
 */
export function statusTekst(u: InnleggingsSkriveutfall, plan: StatusPlan): string | null {
  const navn = plan.navn;
  switch (u.utfall) {
    case "anvendt":
    case "allerede":
      return null;
    case "konflikt":
    case "ubekreftet":
      return u.grunn;
    case "avvist":
      return `Ingen tilgang til å endre «${navn}». Status er ikke endret.`;
    case "ikkeLest":
      return `Kunne ikke lese handlelisten. «${navn}» er ikke merket som ${statusNavn(plan.maal)} — prøv igjen.`;
    case "ukjent":
      return `Vi vet ikke om «${navn}» ble merket som ${statusNavn(plan.maal)} — svaret uteble. «Prøv igjen» sjekker bare statusen nå; den endrer ingenting. Raden er sperret til dette er avklart.`;
  }
}

/**
 * Tekst for den skrivefrie kontrollen etter ukjent utfall. Den reverserer
 * aldri status. `uavklart`: fortsatt ukjent, så planen og sperren består.
 */
export function statusSjekkTekst(
  s: StatusLesing | LeseAvslag,
  plan: StatusPlan,
): { tekst: string; uavklart: boolean } {
  const navn = plan.navn;
  const maal = statusNavn(plan.maal);
  switch (s.utfall) {
    case "borte":
      return { tekst: `«${navn}» er ikke lenger på listen.`, uavklart: false };
    case "lest":
      return s.done === plan.maal
        ? { tekst: `Bekreftet: «${navn}» er merket som ${maal}.`, uavklart: false }
        : {
            tekst: `«${navn}» står som ${statusNavn(s.done)}. Ingenting er endret nå — velg på nytt på raden hvis statusen skal endres.`,
            uavklart: false,
          };
    case "erstattet":
      return {
        tekst: `${s.grunn} Statusen for «${navn}» kan ikke bekreftes, og ingenting er endret — se listen og velg på nytt på raden hvis statusen skal endres.`,
        uavklart: false,
      };
    case "misformet":
      return {
        tekst: `Raden for «${navn}» har en uventet form, så statusen kan ikke bekreftes. Ingenting er endret.`,
        uavklart: false,
      };
    case "avvist":
      return {
        tekst: `Fortsatt ikke avklart om «${navn}» ble merket som ${maal}: ingen tilgang til å lese handlelisten nå. Ingenting er endret — prøv igjen senere.`,
        uavklart: true,
      };
    case "ikkeLest":
      return {
        tekst: `Fortsatt ikke avklart om «${navn}» ble merket som ${maal}: handlelisten kunne ikke leses nå. Ingenting er endret — prøv igjen.`,
        uavklart: true,
      };
  }
}
