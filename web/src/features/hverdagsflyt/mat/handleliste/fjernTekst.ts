import type { InnleggingsSkriveutfall, PostSjekk, PosterSjekk } from "@data/shopping.repository";
import type {
  FjernFullfortePlan,
  FullforteOppsummering,
} from "@domain/shopping/handlelisteFjernFullforte";

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

const varer = (n: number) => (n === 1 ? "1 fullført vare" : `${n} fullførte varer`);
const navneliste = (r: readonly { navn: string }[]) => r.map((x) => `«${x.navn}»`).join(", ");

/**
 * Samlet utfall av «Fjern fullførte» (Mat #20, ordre 6905636191): skiller
 * fjernet, beholdt (endret siden Helen så listen) og allerede borte.
 */
export function fullforteTekst(
  u: InnleggingsSkriveutfall & { detaljer?: FullforteOppsummering },
): string {
  switch (u.utfall) {
    case "anvendt":
    case "allerede": {
      const d = u.detaljer;
      if (!d) return "Fullførte varer er fjernet.";
      const deler = [
        d.fjernet.length > 0 ? `Fjernet ${varer(d.fjernet.length)}.` : "Ingen varer er fjernet.",
      ];
      if (d.beholdt.length > 0) {
        deler.push(
          `Beholdt ${d.beholdt.length} som er endret siden du så listen: ${d.beholdt
            .map((b) => `«${b.navn}» (${b.grunn})`)
            .join(", ")}.`,
        );
      }
      if (d.borte.length > 0) {
        deler.push(`${d.borte.length} var allerede borte: ${navneliste(d.borte)}.`);
      }
      if (d.beholdt.length > 0) {
        deler.push("Se de oppdaterte radene og trykk «Fjern fullførte» igjen hvis de skal bort.");
      }
      return deler.join(" ");
    }
    case "konflikt":
    case "ubekreftet":
      return /Ingenting er/.test(u.grunn) ? u.grunn : `${u.grunn} Ingenting er fjernet.`;
    case "avvist":
      return "Ingen tilgang til å fjerne fullførte varer. Ingenting er fjernet.";
    case "ikkeLest":
      return "Kunne ikke lese handlelisten. Ingenting er fjernet — prøv igjen.";
    case "ukjent":
      return "Vi vet ikke om de fullførte varene ble fjernet — svaret uteble. «Prøv igjen» sjekker bare hva som står på listen; den fjerner ingenting. «Fjern fullførte» er sperret til dette er avklart.";
  }
}

/**
 * Den skrivefrie oppfølgingen etter ukjent utfall. `uavklart`: fortsatt
 * ukjent, så planen og sperren består.
 */
export function fullforteSjekkTekst(
  s: PosterSjekk,
  plan: FjernFullfortePlan,
): { tekst: string; uavklart: boolean } {
  switch (s.utfall) {
    case "lest": {
      const navn = new Map(plan.rader.map((r) => [r.id, r.sett.name]));
      const star = s.finnes.map((id) => ({ navn: navn.get(id) ?? id }));
      const borte = `${s.borte.length} av ${plan.rader.length} er ikke lenger på listen.`;
      return {
        tekst:
          star.length === 0
            ? `Bekreftet: ${borte}`
            : `${borte} ${star.length} står fortsatt: ${navneliste(star)}. Ingenting er fjernet nå — trykk «Fjern fullførte» igjen hvis de skal bort.`,
        uavklart: false,
      };
    }
    case "avvist":
      return {
        tekst:
          "Fortsatt ikke avklart om de fullførte varene ble fjernet: ingen tilgang til å lese handlelisten nå. Ingenting er endret — prøv igjen senere.",
        uavklart: true,
      };
    case "ikkeLest":
      return {
        tekst:
          "Fortsatt ikke avklart om de fullførte varene ble fjernet: handlelisten kunne ikke leses nå. Ingenting er endret — prøv igjen.",
        uavklart: true,
      };
  }
}
