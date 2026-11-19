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

/**
 * Et sendt «Lagre notat»-forsøk med ukjent utfall (review 5969230962).
 * Uforanderlig og atskilt fra det redigerbare utkastet: oppfølgingen
 * kontrollerer alltid DETTE forsøket, aldri det som står i feltet nå.
 * `kontekst` binder forsøket til familie og innloggingssesjon; `sendt` er
 * den normaliserte teksten som ble sendt (`undefined` = tømming).
 *
 * Oppfølgingen holder ALLE uavklarte forsøk for middagen (review
 * 5969643874). Et sikkert avslag på et nytt forsøk (`konflikt`, `mangler`,
 * `ugyldig`, `forLang`, `avvist`, `byttet`, `ikkeLest`) avgjør bare det nye
 * forsøket, aldri et tidligere. Et nytt `ukjent` legges til; det erstatter
 * ingenting.
 *
 * Oppfølgingen avsluttes bare slik, og ingen av dem påstår hva som skjedde
 * med et tidligere forsøk:
 * - et nytt forsøk gir `lagret` eller `allerede`: notatet står da slik
 *   brukeren ville ha det;
 * - etter kontroll, et eksplisitt valg: «Godta nåtilstanden» (`likSendt`),
 *   «Bruk gjeldende notat som grunnlag» (`annet`) eller «Lukk» (`mangler`,
 *   `ugyldig`).
 *
 * Det er forsvarlig fordi et sent forsøk bare kan nå frem med `if-match` på
 * versjonen det leste: det kan bare sette notatet til den samme teksten, og
 * bare hvis middagen står nøyaktig som da det ble sendt (`SENT_FORSOK`).
 */
export interface NotatForsok {
  kontekst: string;
  mealId: string;
  kilde: string | undefined;
  sendt: string | undefined;
}

/**
 * Det en skrivefri lesing viser NÅ, sammenlignet med et uavklart forsøk. En
 * lesing av nåtilstanden beviser ikke forsøkets utfall: forespørselen kan
 * fortsatt nå serveren etter lesingen, eller den kan ha blitt lagret og
 * senere endret tilbake av en annen. Ingen av disse avklarer forsøket alene.
 */
export type NotatNaatilstand = "likSendt" | "likKilde" | "annet" | "mangler" | "ugyldig";

/** Sammenligner en fersk lesing (`null` = posten finnes ikke) med forsøket. Skriver aldri. */
export function vurderNotatNaatilstand(eksport: unknown, forsok: NotatForsok): NotatNaatilstand {
  if (eksport === null || eksport === undefined) return "mangler";
  const tilstand = lesNotat(eksport);
  if (tilstand.type === "ugyldig") return "ugyldig";
  const naa = somVerdi(tilstand);
  if (naa === forsok.sendt) return "likSendt";
  if (naa === forsok.kilde) return "likKilde";
  return "annet";
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

/**
 * Brukertekst for den skrivefrie kontrollen av et uavklart forsøk. Tekstene
 * beskriver nåtilstanden og sier aldri at forsøket sikkert er lagret eller
 * sikkert ikke er lagret.
 */
export function naatilstandTekst(
  o: NotatNaatilstand | "avvist" | "byttet" | "ikkeLest",
  navn: string,
): string {
  const uavklart = "Om akkurat dette forsøket ble lagret, er fortsatt ikke avklart.";
  switch (o) {
    case "likSendt":
      return `Notatet på «${navn}» står nå slik du ville lagre det. ${uavklart}`;
    case "likKilde":
      return (
        `Notatet på «${navn}» står nå som før forsøket. ${uavklart} Forsøket kan fortsatt ` +
        "komme frem, eller det kan ha blitt lagret og senere endret tilbake."
      );
    case "annet":
      return `Notatet på «${navn}» er nå et annet enn både det du sendte og det du startet fra. ${uavklart}`;
    case "mangler":
      return `«${navn}» finnes ikke nå. Ingenting blir gjenopprettet. ${uavklart}`;
    case "ugyldig":
      return `Notatet på «${navn}» er nå lagret i en form appen ikke kan endre trygt. ${uavklart}`;
    case "avvist":
      return `Kunne ikke kontrollere «${navn}»: du har ikke tilgang til å lese middagen. ${uavklart}`;
    case "byttet":
      return `Kunne ikke kontrollere «${navn}»: innloggingen ble endret. ${uavklart}`;
    case "ikkeLest":
      return `Kunne ikke kontrollere «${navn}» nå. ${uavklart} Prøv igjen.`;
  }
}

/** Hva et sent, uavklart forsøk i verste fall kan gjøre (se `NotatForsok`). */
export const SENT_FORSOK =
  "Kommer et tidligere forsøk frem senere, kan det bare sette notatet til den samme " +
  "teksten, og bare hvis middagen står nøyaktig som da det ble sendt.";

/**
 * Brukertekst for utfallet av «Lagre på nytt» (review 5969643874). Gjelder
 * bare DET NYE forsøket; et tidligere forsøk omtales aldri som avklart.
 */
export function nyttForsokTekst(utfall: NotatUtfall, navn: string): string {
  const fortsatt = "Det første forsøket er fortsatt ikke avklart.";
  const ikke = (grunn: string) => `Det nye forsøket er ikke lagret: ${grunn} ${fortsatt}`;
  switch (utfall) {
    case "lagret":
      return (
        `Det nye forsøket er lagret, og notatet på «${navn}» står nå slik du ville ha det. ` +
        `Om det første forsøket kom frem, er ikke avklart. ${SENT_FORSOK}`
      );
    case "allerede":
      return (
        `Notatet på «${navn}» står allerede slik du ville ha det, så det nye forsøket ` +
        `skrev ingenting. Om det første forsøket kom frem, er ikke avklart. ${SENT_FORSOK}`
      );
    case "konflikt":
      return ikke(`notatet på «${navn}» er endret siden forsøket startet.`);
    case "mangler":
      return ikke(`«${navn}» finnes ikke nå, og middagen er ikke gjenopprettet.`);
    case "ugyldig":
      return ikke(`notatet på «${navn}» er lagret i en form appen ikke kan endre trygt.`);
    case "forLang":
      return ikke(`notatet er for langt (høyst ${MAKS_NOTAT} tegn).`);
    case "avvist":
      return ikke("du har ikke tilgang til å endre notatet.");
    case "byttet":
      return ikke("innloggingen ble endret.");
    case "ikkeLest":
      return ikke(`kunne ikke lese «${navn}» nå.`);
    case "ukjent":
      return (
        `Svaret på det nye forsøket uteble også. Ingen av forsøkene på «${navn}» er ` +
        "avklart. Sjekk før du prøver igjen."
      );
  }
}

/** Brukertekst når brukeren eksplisitt avslutter oppfølgingen etter en kontroll. */
export function avsluttetTekst(valg: "godta" | "grunnlag" | "lukk", navn: string): string {
  const uavklart = "Om forsøket kom frem, er ikke avklart.";
  switch (valg) {
    case "godta":
      return `Notatet på «${navn}» står slik du ville ha det. ${uavklart} ${SENT_FORSOK}`;
    case "grunnlag":
      return (
        `Det gjeldende notatet på «${navn}» er nytt grunnlag for utkastet. ${uavklart} ` +
        SENT_FORSOK
      );
    case "lukk":
      return `Oppfølgingen av notatet på «${navn}» er lukket. ${uavklart} ${SENT_FORSOK}`;
  }
}
