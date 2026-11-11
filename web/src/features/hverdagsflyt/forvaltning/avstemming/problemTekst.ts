import type { AvstemmingsRad, Problem } from "@domain/avstemming/avstemmingsko";
import { forrigeMaaned, sisteDagIMaaned } from "@domain/avstemming/saldoavstemming";
import { STATUS_TEKST, datoKort, differanseTekst, krOre, maanedNavn } from "./avstemmingTekst";

const flertall = (n: number, en: string, flere: string) => (n === 1 ? en : flere);

/** Årsaken i klartekst og den neste handlingen — samme tekst på PC og mobil. */
export function problemTekst(p: Problem): { aarsak: string; handling: string } {
  const n = p.antall ?? 0;
  switch (p.type) {
    case "ukjent_konto":
      return {
        aarsak: `${n} ${flertall(n, "transaksjon", "transaksjoner")} i ${maanedNavn(p.maaned, true)} mangler konto og kan ikke avstemmes mot noen konto.`,
        handling: "Gi dem konto i Transaksjoner",
      };
    case "mangler_saldo":
      return {
        aarsak: `Saldo fra banken for ${datoKort(sisteDagIMaaned(p.maaned))} er ikke registrert.`,
        handling: "Registrer saldo",
      };
    case "startpunkt": {
      const forrige = forrigeMaaned(p.maaned);
      return {
        aarsak: `${maanedNavn(p.maaned, true)} kan ikke kontrolleres uten saldo for ${datoKort(sisteDagIMaaned(forrige))}.`,
        handling: `Registrer saldo for ${maanedNavn(forrige, true)}`,
      };
    }
    case "uavklart_ignorert":
      return {
        aarsak: `${n} ${flertall(n, "ignorert transaksjon", "ignorerte transaksjoner")} (${krOre(p.belopOre ?? 0)}) er ikke avklart, så måneden er usikker.`,
        handling: `Avklar ${n} ${flertall(n, "ignorert", "ignorerte")}`,
      };
    case "avledet_mulig_importert":
      return {
        aarsak: `${n} ${flertall(n, "avledet motpost", "avledede motposter")} kan allerede være importert. De telles ikke før du har avklart.`,
        handling: "Koble importert motpost",
      };
    case "avledet_kilde_endret":
      return {
        aarsak: `Kilden til ${n} ${flertall(n, "avledet motpost", "avledede motposter")} er endret etter bekreftelsen, og telles ikke.`,
        handling: "Bekreft på nytt på kildens konto",
      };
    case "avledet_endret":
      return {
        aarsak: `${n} ${flertall(n, "avledet motpost", "avledede motposter")} er endret i Transaksjoner etter at den ble lagt til.`,
        handling: "Avslutt den endrede motposten",
      };
    case "avvik":
      return { aarsak: `${differanseTekst(p.belopOre ?? 0)}.`, handling: "Finn avviket" };
    case "manglende_motpost":
      return {
        aarsak: `${n} ${flertall(n, "intern overføring", "interne overføringer")} på andre kontoer mangler motpost. Mangler en av dem her?`,
        handling: "Se mulige motposter",
      };
    case "grunnlag_endret":
      return {
        aarsak: `Transaksjonsgrunnlaget er endret siden saldoen ble lagret${
          n !== 0
            ? ` (${n > 0 ? "+" : ""}${n} ${flertall(Math.abs(n), "transaksjon", "transaksjoner")})`
            : ""
        }. Statusen er regnet på nytt.`,
        handling: "Bekreft saldoen på nytt",
      };
    case "avledet":
      return {
        aarsak: `Stemmer bare med ${n} ${flertall(n, "avledet motpost", "avledede motposter")} (${krOre(p.belopOre ?? 0)}), som ikke er bankimportert. Ikke bankverifisert.`,
        handling: "Venter på ekte motpost",
      };
  }
}

/** Kort status for raden i tabellen. */
export function radStatus(r: AvstemmingsRad): string {
  if (r.fase === "ingen_data") return "Ingen data";
  if (r.fase === "foer_start") return "Før startsaldo";
  if (r.fase === "start") return "Startsaldo";
  if (r.ok) return "Avstemt";
  if (r.status === "avstemt") return "Avstemt, med åpne forhold";
  return STATUS_TEKST[r.status];
}

/** Neste handling for raden i tabellen, med antallet som gjenstår. */
export function radHandling(r: AvstemmingsRad): string | null {
  const [forste, ...resten] = r.problemer;
  if (!forste) return null;
  const h = problemTekst(forste).handling;
  return resten.length > 0 ? `${h} (+${resten.length})` : h;
}
