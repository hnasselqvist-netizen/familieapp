import type { BasisvareFjerningResultat } from "@hooks/useStaples";

/** Beskjeden etter «Fjern» på en basisvare (Mat #20, ordre 6948538722). */
export interface BasisvareFjerningMelding {
  tekst: string;
  /** `status` for bekreftede og skrivefrie utfall, `alert` når noe står igjen. */
  alvor: "status" | "alert";
}

/**
 * Utfallstekst. «Fjernet» sies bare når serveren har bekreftet slettingen;
 * et uteblitt svar sies aldri å ha fjernet noe.
 */
export function basisvareFjerningTekst(
  nokkel: string,
  r: BasisvareFjerningResultat,
): BasisvareFjerningMelding {
  const v = `«${nokkel}»`;
  switch (r.utfall) {
    case "fjernet":
      return { alvor: "status", tekst: `${v} er fjernet som basisvare.` };
    case "borte":
      return {
        alvor: "status",
        tekst: `${v} var allerede fjernet som basisvare. Ingenting er endret.`,
      };
    case "erstattet":
      return {
        alvor: "alert",
        tekst: `${v} er endret på en annen enhet og er ikke lenger en vanlig basisvaremarkering. Den er ikke fjernet.`,
      };
    case "avvist":
      return { alvor: "alert", tekst: `Fjerningen av ${v} ble avvist. Ingenting er endret.` };
    case "ikkeLest":
      return {
        alvor: "alert",
        tekst: `Kunne ikke lese basisvaren ${v}. Ingenting er endret — prøv igjen.`,
      };
    case "samtidig":
      return {
        alvor: "alert",
        tekst: `${v} endres samtidig på en annen enhet. Ingenting er fjernet — prøv igjen.`,
      };
    case "byttet":
      return {
        alvor: "alert",
        tekst: `Innloggingen ble endret før ${v} ble fjernet som basisvare. Ingenting er endret.`,
      };
    case "ugyldig":
      return {
        alvor: "alert",
        tekst: `${v} er ikke én gyldig basisvarenøkkel og kan ikke fjernes her. Ingenting er endret.`,
      };
    case "ukjent":
      return {
        alvor: "alert",
        tekst: `Fikk ikke bekreftet om ${v} ble fjernet. Se listen før du prøver igjen.`,
      };
  }
}
