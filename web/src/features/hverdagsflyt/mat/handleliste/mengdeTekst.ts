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
 * Tekst for den skrivefrie, identitetsbundne kontrollen etter ukjent utfall
 * (review 5919852371 pkt. 2). Kontrollen ser bare dagens servertilstand, ikke
 * historikken for det tapte forsøket: den beskriver hva som står nå og hva
 * den faktisk kan bekrefte. `uavklart`: lesingen lyktes ikke (planen og
 * sperren består). `lagret`: mengden er nå lik utkastet, så utkastet kan
 * fjernes. Ellers beholdes utkastet, uten å sendes på nytt eller flyttes.
 */
export function mengdeSjekkTekst(
  s: MengdeLesing | LeseAvslag,
  plan: MengdePlan,
): { tekst: string; uavklart: boolean; lagret: boolean } {
  const navn = plan.navn;
  const utkast = vis(plan.ny);
  const ukjentHistorikk = `Det kan ikke avgjøres om utkastet ditt (${utkast}) ble lagret før dette.`;
  const svar = (tekst: string, ekstra: Partial<{ uavklart: boolean; lagret: boolean }> = {}) => ({
    tekst,
    uavklart: false,
    lagret: false,
    ...ekstra,
  });
  switch (s.utfall) {
    case "lest":
      if (s.mengde === plan.ny) {
        return svar(
          `Mengden på «${navn}» er nå ${utkast}, som utkastet ditt. Kontrollen kan ikke se hvem som skrev den, men det er ingenting mer å lagre.`,
          { lagret: true },
        );
      }
      return svar(
        `Mengden på «${navn}» er nå ${vis(s.mengde)}. ${ukjentHistorikk} Utkastet står og er ikke sendt på nytt — lagre det som et nytt valg hvis det fortsatt skal gjelde.`,
      );
    case "erstattet":
      return svar(
        `${s.grunn} ${ukjentHistorikk} Utkastet er ikke sendt på nytt og flyttes ikke til den nye raden.`,
      );
    case "misformet":
      return svar(
        `Mengden på «${navn}» har nå en uventet form. ${ukjentHistorikk} Utkastet er ikke sendt på nytt.`,
      );
    case "borte":
      return svar(
        `«${navn}» er ikke lenger på listen. ${ukjentHistorikk} Utkastet er ikke sendt på nytt.`,
      );
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
