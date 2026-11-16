import type { InnleggingsSkriveutfall, LeseAvslag } from "@data/shopping.repository";
import { FELTNAVN, type FeltLesing, type FeltPlan } from "@domain/shopping/handlelisteFelt";

const vis = (v: string) => `«${v}»`;
const stor = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
/** Det Helen ville lagre: navneutkastet eller kategorivalget. */
const hennes = (plan: FeltPlan) => (plan.felt === "name" ? "utkastet ditt" : "valget ditt");

/**
 * Tekst for et utfall av «Lagre navn» eller et kategorivalg (Mat #20, ordre
 * 6921967679); `null` når feltet er lagret eller allerede hadde verdien.
 * Ved kategori står valget i teksten, siden velgeren viser verdien på
 * listen.
 */
export function feltTekst(u: InnleggingsSkriveutfall, plan: FeltPlan): string | null {
  const navn = plan.navn;
  const valg =
    plan.felt === "cat"
      ? ` Valget ditt var ${vis(plan.ny)} — velg på nytt hvis det fortsatt skal gjelde.`
      : "";
  switch (u.utfall) {
    case "anvendt":
    case "allerede":
      return null;
    case "konflikt":
    case "ubekreftet":
      return `${u.grunn}${valg}`;
    case "avvist":
      return `Ingen tilgang til å lagre ${FELTNAVN[plan.felt]} på «${navn}». Ingenting er lagret.${valg}`;
    case "ikkeLest":
      return `Kunne ikke lese handlelisten. ${stor(FELTNAVN[plan.felt])} på «${navn}» er ikke lagret — prøv igjen.${valg}`;
    case "ukjent":
      return `Vi vet ikke om ${FELTNAVN[plan.felt]} på «${navn}» ble lagret (${vis(plan.ny)}) — svaret uteble. «Sjekk» leser bare feltet nå; den sender ikke ${hennes(plan)} på nytt. Lagring er sperret til dette er avklart.`;
  }
}

/**
 * Tekst for den skrivefrie, identitetsbundne kontrollen etter ukjent utfall.
 * Kontrollen ser bare dagens servertilstand, ikke historikken for det tapte
 * forsøket. `uavklart`: lesingen lyktes ikke. `lagret`: feltet er nå lik
 * det Helen ville lagre, så et navneutkast kan fjernes.
 */
export function feltSjekkTekst(
  s: FeltLesing | LeseAvslag,
  plan: FeltPlan,
): { tekst: string; uavklart: boolean; lagret: boolean } {
  const navn = plan.navn;
  const felt = FELTNAVN[plan.felt];
  const ukjent = `Det kan ikke avgjøres om ${hennes(plan)} (${vis(plan.ny)}) ble lagret før dette.`;
  const igjen = "Ingenting er sendt på nytt.";
  const svar = (tekst: string, ekstra: Partial<{ uavklart: boolean; lagret: boolean }> = {}) => ({
    tekst,
    uavklart: false,
    lagret: false,
    ...ekstra,
  });
  switch (s.utfall) {
    case "lest":
      if (s.verdi === plan.ny) {
        return svar(
          `${stor(felt)} på «${navn}» er nå ${vis(plan.ny)}, som ${hennes(plan)}. Kontrollen kan ikke se hvem som skrev det, men det er ingenting mer å lagre.`,
          { lagret: true },
        );
      }
      return svar(`${stor(felt)} på «${navn}» er nå ${vis(s.verdi)}. ${ukjent} ${igjen}`);
    case "erstattet":
      return svar(`${s.grunn} ${ukjent} ${igjen}`);
    case "misformet":
      return svar(`${stor(felt)} på «${navn}» har nå en uventet form. ${ukjent} ${igjen}`);
    case "borte":
      return svar(`«${navn}» er ikke lenger på listen. ${ukjent} ${igjen}`);
    case "avvist":
      return svar(
        `Fortsatt ikke avklart om ${felt} på «${navn}» ble lagret: ingen tilgang til å lese handlelisten nå. ${igjen} Prøv igjen senere.`,
        { uavklart: true },
      );
    case "ikkeLest":
      return svar(
        `Fortsatt ikke avklart om ${felt} på «${navn}» ble lagret: handlelisten kunne ikke leses nå. ${igjen} Prøv igjen.`,
        { uavklart: true },
      );
  }
}
