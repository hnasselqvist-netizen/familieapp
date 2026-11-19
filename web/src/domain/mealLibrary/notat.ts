/**
 * Notat på én middag i Middagsbiblioteket (Mat #20, ordre 6998241717; #137).
 *
 * Kontrakten for det lagrede feltet:
 *  - `mealLibrary/{id}/notat` er en valgfri streng på SELVE middagen, ikke på
 *    en variant;
 *  - linjeskift bevares (CRLF lagres som LF);
 *  - tomt notat, eller bare mellomrom og linjeskift, lagres aldri: da fjernes
 *    nøkkelen, så det finnes bare én tom form;
 *  - høyst `MAKS_NOTAT` tegn.
 *
 * Beslutningene her tar posten i EKSPORTFORM (REST `format=export`, med
 * prioriteter), slik datalaget leser den med ETag. Det som skrives, er den
 * ferske eksporten med bare `notat` endret, så samtidige andre felt, ukjente
 * felt og prioriteter står. Ren: ingen I/O.
 */

export const MAKS_NOTAT = 2000;

/** Utfallet av «Lagre notat». */
export type NotatUtfall =
  /** Skrevet og bekreftet av serveren. */
  | "lagret"
  /** Notatet var allerede slik utkastet sier (f.eks. etter et tidligere forsøk). Ingenting skrevet. */
  | "allerede"
  /** Notatet er endret siden utkastet startet. Ingenting skrevet; utkastet beholdes. */
  | "konflikt"
  /** Middagen finnes ikke lenger. Ingenting skrevet, ingenting gjenopprettet. */
  | "mangler"
  /** Lagret notat eller post har en form appen ikke kan endre trygt. Ingenting skrevet. */
  | "ugyldig"
  /** Utkastet er lengre enn `MAKS_NOTAT`. Ingenting sendt. */
  | "forLang"
  /** 401/403 eller ikke innlogget. Ingenting skrevet. */
  | "avvist"
  /** Innloggingen ble byttet eller avsluttet før skrivingen ble sendt. Ingenting skrevet. */
  | "byttet"
  /** Kunne ikke lese eller kontrollere innen fristen. Ingenting skrevet. */
  | "ikkeLest"
  /** En skriving ble sendt, men svaret uteble. */
  | "ukjent";

/** Notatets lagrede tilstand i eksportformen av posten. */
export type NotatTilstand =
  { type: "tom" } | { type: "tekst"; tekst: string } | { type: "ugyldig" };

type Eksport = Record<string, unknown>;
const erObjekt = (v: unknown): v is Eksport =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Utkastet slik det lagres: `undefined` betyr «ingen notat» (nøkkelen
 * fjernes). Linjeskift bevares; CRLF/CR gjøres til LF. Teksten trimmes ikke.
 */
export function normaliserNotat(tekst: string): string | undefined {
  const lf = tekst.replace(/\r\n?/g, "\n");
  return lf.trim() === "" ? undefined : lf;
}

/** Posten i eksportform er et objekt med ordinære felt (ikke en enkeltverdi med prioritet). */
function erPost(eksport: unknown): eksport is Eksport {
  return erObjekt(eksport) && !Object.hasOwn(eksport, ".value");
}

/**
 * Notatet slik det er lagret. Eksportformen gir en streng, eller
 * `{".value": streng, ".priority": p}` når notatet har prioritet. Alt annet,
 * også en tom streng (som appen aldri skriver), er `ugyldig` og endres ikke.
 */
export function lesNotat(eksport: unknown): NotatTilstand {
  if (!erPost(eksport)) return { type: "ugyldig" };
  if (!Object.hasOwn(eksport, "notat")) return { type: "tom" };
  const n = eksport.notat;
  const verdi =
    erObjekt(n) && Object.keys(n).every((k) => k === ".value" || k === ".priority")
      ? n[".value"]
      : n;
  return typeof verdi === "string" && verdi !== ""
    ? { type: "tekst", tekst: verdi }
    : { type: "ugyldig" };
}

const somVerdi = (t: NotatTilstand): string | undefined =>
  t.type === "tekst" ? t.tekst : undefined;

/**
 * «Lagre notat» mot en fersk lesing (`eksport`, ikke `null`: manglende post
 * avgjøres av datalaget). `kilde` er notatet slik det var da utkastet
 * startet (`undefined` = ingen notat), `utkast` er det brukeren vil lagre
 * (allerede normalisert).
 *
 *  - Er notatet allerede likt utkastet: `allerede`, ingen skriving. Det gjør
 *    et nytt forsøk etter et tapt svar trygt.
 *  - Er notatet endret siden kilden: `konflikt`, ingen skriving.
 *  - Ugyldig lagret form: `ugyldig`, ingen skriving.
 *  - Ellers skrives den ferske eksporten med bare `notat` endret. En
 *    prioritet på notatet bevares.
 */
export function besluttNotat(
  eksport: unknown,
  kilde: string | undefined,
  utkast: string | undefined,
):
  | { type: "skriv"; eksport: Eksport }
  | { type: "stopp"; utfall: "allerede" | "konflikt" | "ugyldig" | "forLang" } {
  if (utkast !== undefined && utkast.length > MAKS_NOTAT) {
    return { type: "stopp", utfall: "forLang" };
  }
  const tilstand = lesNotat(eksport);
  if (tilstand.type === "ugyldig" || !erPost(eksport)) return { type: "stopp", utfall: "ugyldig" };
  const naa = somVerdi(tilstand);
  if (naa === utkast) return { type: "stopp", utfall: "allerede" };
  if (naa !== kilde) return { type: "stopp", utfall: "konflikt" };
  const neste: Eksport = { ...eksport };
  if (utkast === undefined) {
    delete neste.notat;
  } else {
    const gammel = eksport.notat;
    neste.notat =
      erObjekt(gammel) && Object.hasOwn(gammel, ".priority")
        ? { ".value": utkast, ".priority": gammel[".priority"] }
        : utkast;
  }
  return { type: "skriv", eksport: neste };
}

/** Skrivefri oppfølging etter et tapt svar: hva står nå? */
export type NotatOppfolging = "lagret" | "ikkeLagret" | "endret" | "mangler" | "ugyldig";

/**
 * Sammenligner en fersk lesing med utkastet og kilden. `null` betyr at
 * posten ikke finnes. Skriver aldri.
 */
export function vurderNotatOppfolging(
  eksport: unknown,
  kilde: string | undefined,
  utkast: string | undefined,
): NotatOppfolging {
  if (eksport === null || eksport === undefined) return "mangler";
  const tilstand = lesNotat(eksport);
  if (tilstand.type === "ugyldig") return "ugyldig";
  const naa = somVerdi(tilstand);
  if (naa === utkast) return "lagret";
  if (naa === kilde) return "ikkeLagret";
  return "endret";
}

/** Brukertekst for utfallet av «Lagre notat». */
export function notatTekst(utfall: NotatUtfall, navn: string): string {
  switch (utfall) {
    case "lagret":
      return `Notatet på «${navn}» er lagret.`;
    case "allerede":
      return `Notatet på «${navn}» var allerede slik. Ingenting er endret.`;
    case "konflikt":
      return (
        `Notatet på «${navn}» er endret på en annen enhet siden du begynte. Ingenting er ` +
        "lagret. Utkastet ditt står; se over og lagre på nytt hvis det fortsatt skal gjelde."
      );
    case "mangler":
      return `«${navn}» er slettet på en annen enhet. Notatet er ikke lagret, og middagen er ikke gjenopprettet.`;
    case "ugyldig":
      return (
        `Notatet på «${navn}» er lagret i en form appen ikke kan endre trygt. ` +
        "Ingenting er endret."
      );
    case "forLang":
      return `Notatet er for langt (høyst ${MAKS_NOTAT} tegn). Ingenting er lagret.`;
    case "avvist":
      return "Du har ikke tilgang til å endre notatet. Ingenting er lagret.";
    case "byttet":
      return "Innloggingen ble endret mens notatet ble lagret. Ingenting er lagret.";
    case "ikkeLest":
      return `Kunne ikke kontrollere «${navn}» nå. Ingenting er lagret — prøv igjen.`;
    case "ukjent":
      return (
        `Vi vet ikke om notatet på «${navn}» ble lagret — svaret uteble. ` +
        "Sjekk før du prøver igjen."
      );
  }
}

/** Brukertekst for den skrivefrie oppfølgingen. */
export function oppfolgingTekst(
  o: NotatOppfolging | "avvist" | "byttet" | "ikkeLest",
  navn: string,
): string {
  switch (o) {
    case "lagret":
      return `Bekreftet: notatet på «${navn}» er lagret.`;
    case "ikkeLagret":
      return `Notatet på «${navn}» ble ikke lagret. Utkastet ditt står; du kan lagre på nytt.`;
    case "endret":
      return (
        `Notatet på «${navn}» er endret på en annen enhet. Utkastet ditt står; ` +
        "se over og lagre på nytt hvis det fortsatt skal gjelde."
      );
    case "mangler":
      return `«${navn}» finnes ikke lenger. Notatet er ikke lagret.`;
    case "ugyldig":
      return `Notatet på «${navn}» er lagret i en form appen ikke kan endre trygt.`;
    case "avvist":
      return `Fortsatt ikke avklart om notatet på «${navn}» ble lagret: du har ikke tilgang til å lese middagen.`;
    case "byttet":
      return `Fortsatt ikke avklart om notatet på «${navn}» ble lagret: innloggingen ble endret. Ingenting er sendt.`;
    case "ikkeLest":
      return `Fortsatt ikke avklart om notatet på «${navn}» ble lagret: middagen kunne ikke leses nå. Prøv igjen.`;
  }
}
