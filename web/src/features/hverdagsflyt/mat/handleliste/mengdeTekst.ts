import type { InnleggingsSkriveutfall, LeseAvslag } from "@data/shopping.repository";
import type { MengdeLesing, MengdePlan } from "@domain/shopping/handlelisteMengde";

const vis = (m: string) => (m === "" ? "tom" : `«${m}»`);

/**
 * Tekst for et utfall av «Lagre mengde» (Mat #20, ordre 6914072575);
 * `null` når mengden er lagret eller allerede var utkastet.
 */
export function mengdeTekst(u: InnleggingsSkriveutfall, plan: MengdePlan): string | null {
  const navn = plan.navn;
  switch (u.utfall) {
    case "anvendt":
    case "allerede":
      return null;
    case "konflikt":
    case "ubekreftet":
      return u.grunn;
    case "avvist":
      return `Ingen tilgang til å lagre mengden på «${navn}». Utkastet ditt står.`;
    case "ikkeLest":
      return `Kunne ikke lese handlelisten. Mengden på «${navn}» er ikke lagret — utkastet ditt står, prøv igjen.`;
    case "ukjent":
      return `Vi vet ikke om mengden på «${navn}» ble lagret — svaret uteble. «Sjekk» leser bare mengden nå; den sender ikke utkastet på nytt. Lagring er sperret til dette er avklart.`;
  }
}

/**
 * Tekst for den skrivefrie, identitetsbundne kontrollen etter ukjent utfall.
 * `uavklart`: fortsatt ukjent (planen og sperren består). `lagret`: utkastet
 * er bekreftet lagret og kan fjernes. `borte`: raden finnes ikke lenger.
 */
export function mengdeSjekkTekst(
  s: MengdeLesing | LeseAvslag,
  plan: MengdePlan,
): { tekst: string; uavklart: boolean; lagret: boolean; borte: boolean } {
  const navn = plan.navn;
  const svar = (
    tekst: string,
    ekstra: Partial<{ uavklart: boolean; lagret: boolean; borte: boolean }> = {},
  ) => ({
    tekst,
    uavklart: false,
    lagret: false,
    borte: false,
    ...ekstra,
  });
  switch (s.utfall) {
    case "lest":
      if (s.mengde === plan.ny) {
        return svar(`Bekreftet: mengden på «${navn}» er lagret (${vis(plan.ny)}).`, {
          lagret: true,
        });
      }
      if (s.mengde === plan.foer) {
        return svar(
          `Mengden på «${navn}» står fortsatt som ${vis(plan.foer)}. Utkastet ditt (${vis(plan.ny)}) er ikke lagret — trykk «Lagre mengde» hvis det fortsatt skal gjelde.`,
        );
      }
      return svar(
        `Mengden på «${navn}» er nå ${vis(s.mengde)} (endret på en annen enhet). Utkastet ditt (${vis(plan.ny)}) er ikke lagret.`,
      );
    case "erstattet":
      return svar(`${s.grunn} Mengden kan ikke bekreftes, og utkastet ditt er ikke lagret.`);
    case "misformet":
      return svar(
        `Mengden på «${navn}» har en uventet form, så den kan ikke bekreftes. Utkastet ditt er ikke lagret.`,
      );
    case "borte":
      return svar(`«${navn}» er ikke lenger på listen. Mengden er ikke lagret.`, { borte: true });
    case "avvist":
      return svar(
        `Fortsatt ikke avklart om mengden på «${navn}» ble lagret: ingen tilgang til å lese handlelisten nå. Ingenting er sendt på nytt — prøv igjen senere.`,
        { uavklart: true },
      );
    case "ikkeLest":
      return svar(
        `Fortsatt ikke avklart om mengden på «${navn}» ble lagret: handlelisten kunne ikke leses nå. Ingenting er sendt på nytt — prøv igjen.`,
        { uavklart: true },
      );
  }
}
