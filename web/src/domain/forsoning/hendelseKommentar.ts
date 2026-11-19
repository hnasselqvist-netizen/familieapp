/**
 * Kommentar på én vanlig manuell økonomisk hendelse (#59, ordre 7002365160,
 * roadmap #141). Rene beslutninger på `hendelser`-noden i EKSPORTFORM (REST
 * `format=export`, med prioriteter), lest fersk med ETag og skrevet tilbake
 * med `if-match` (`kjorNodeVersjonert`, review 5971652993). Målet er alltid
 * hendelsens `id`, aldri en indeks.
 *
 * Kontrakt:
 * - teksten trimmes som ved manuell registrering (`bankimport.ts`); tom tekst
 *   fjerner `kommentar`-nøkkelen;
 * - en reell endring setter `oppdatert` til tidspunktet for brukerens
 *   lagringsforsøk. En identisk normalisert verdi gir `allerede` og ingen
 *   skriving;
 * - ingenting annet endres: bare målets nøkkel i noden byttes. Beløp,
 *   fordelinger, status, dato, opprettet, koblinger, ukjente råfelt,
 *   prioriteter og nodens nøkler (også en sparsom form) står;
 * - et stopp er avgjort på den verifiserte lesingen og sender ingenting;
 * - bare en entydig hendelse med `kilde: "manuell"`, uten `mellomvaerende`
 *   og uten bank- eller kvitteringskobling kan få kommentaren endret.
 *   Mellomværende regenererer sin egen kommentar og holdes utenfor.
 */

/** Utfallet av «Lagre kommentar». */
export type KommentarUtfall =
  | "lagret"
  | "allerede"
  | "konflikt"
  | "mangler"
  | "tvetydig"
  | "ikkeBerettiget"
  | "ugyldig"
  | "avvist"
  | "byttet"
  | "stengt"
  | "ikkeLest"
  | "ukjent";

/** Hvorfor en hendelse ikke kan få kommentaren endret her. */
export type KommentarBerettigelse = "ok" | "ikkeManuell" | "mellomvaerende" | "koblet";

const erObjekt = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const harVerdi = (v: unknown) => v !== null && v !== undefined;
/** Eksportform: en verdi med prioritet er `{ ".value": v, ".priority": p }`. */
const erInnpakket = (v: unknown): v is { ".value": unknown; ".priority"?: unknown } =>
  erObjekt(v) && Object.hasOwn(v, ".value");
const verdi = (v: unknown) => (erInnpakket(v) ? v[".value"] : v);

/**
 * Bare en vanlig manuell hendelse: `kilde: "manuell"`, ingen
 * `mellomvaerende`-kobling og ingen bank- eller kvitteringskobling. Tåler
 * både lagret form og eksportform.
 */
export function kommentarBerettigelse(h: unknown): KommentarBerettigelse {
  if (!erObjekt(h) || verdi(h.kilde) !== "manuell") return "ikkeManuell";
  if (harVerdi(h.mellomvaerende)) return "mellomvaerende";
  if (harVerdi(verdi(h.transaksjonId)) || harVerdi(verdi(h.receiptId))) return "koblet";
  return "ok";
}

/** Som manuell registrering: trimmet; tom tekst er «ingen kommentar». */
export function normaliserKommentar(tekst: string): string | undefined {
  const t = tekst.trim();
  return t === "" ? undefined : t;
}

export type KommentarTilstand =
  { type: "tom" } | { type: "tekst"; tekst: string } | { type: "ugyldig" };

/**
 * Kommentaren slik den er lagret. `null` eller manglende er tom. En
 * ikke-tom streng (også med prioritet i eksportform) er tekst, slik den står.
 * Alt annet (tall, objekt, tom streng) er `ugyldig` og endres aldri herfra.
 */
export function lesKommentar(h: Record<string, unknown>): KommentarTilstand {
  const k = verdi(h.kommentar);
  if (k === undefined || k === null) return { type: "tom" };
  if (typeof k === "string" && k !== "") return { type: "tekst", tekst: k };
  return { type: "ugyldig" };
}

const somVerdi = (t: { type: "tom" } | { type: "tekst"; tekst: string }) =>
  t.type === "tekst" ? t.tekst : undefined;

/** Målet: hendelsens id og kommentaren utkastet startet fra. */
export interface KommentarMaal {
  id: string;
  kilde: string | undefined;
}

export type KommentarStopp =
  "allerede" | "konflikt" | "mangler" | "tvetydig" | "ikkeBerettiget" | "ugyldig";

export type KommentarBeslutning =
  { type: "skriv"; eksport: unknown } | { type: "stopp"; utfall: KommentarStopp };

type Funnet =
  | { type: "funnet"; nokkel: string; el: Record<string, unknown> }
  | { type: "mangler" }
  | { type: "tvetydig" };

/**
 * Elementene i noden som (nøkkel, verdi): en liste, eller et objekt der
 * `.priority`/`.value` ikke er elementer. Alt annet har ingen elementer.
 */
function elementer(beholder: unknown): [string, unknown][] {
  if (Array.isArray(beholder)) return beholder.map((v, i) => [String(i), v]);
  if (!erObjekt(beholder) || erInnpakket(beholder)) return [];
  return Object.entries(beholder).filter(([k]) => !k.startsWith("."));
}

/** Finner hendelsen på `id` i hele noden. Flere treff er tvetydig. */
function finn(beholder: unknown, id: string): Funnet {
  let funnet: Funnet = { type: "mangler" };
  for (const [nokkel, el] of elementer(beholder)) {
    if (!erObjekt(el) || verdi(el.id) !== id) continue;
    if (funnet.type === "funnet") return { type: "tvetydig" };
    funnet = { type: "funnet", nokkel, el };
  }
  return funnet;
}

/** Ny verdi med samme prioritet som den gamle, om den hadde en. */
function somFor(gammel: unknown, ny: string): unknown {
  return erInnpakket(gammel) && Object.hasOwn(gammel, ".priority")
    ? { ".value": ny, ".priority": gammel[".priority"] }
    : ny;
}

/**
 * Avgjør endringen mot den FERSKE noden i eksportform. Rekkefølge: mål
 * (mangler, tvetydig) → berettigelse → lagret form → allerede → konflikt →
 * skriv. `utkast` er normalisert (`undefined` = tømming). `naa` er
 * tidspunktet for brukerens lagringsforsøk. En slettet hendelse gjenopprettes
 * aldri. Ved skriving er bare målets nøkkel byttet; resten av noden er den
 * samme verdien.
 */
export function besluttKommentar(
  eksport: unknown,
  maal: KommentarMaal,
  utkast: string | undefined,
  naa: string,
): KommentarBeslutning {
  const f = finn(eksport, maal.id);
  if (f.type !== "funnet") return { type: "stopp", utfall: f.type };
  if (kommentarBerettigelse(f.el) !== "ok") return { type: "stopp", utfall: "ikkeBerettiget" };
  const tilstand = lesKommentar(f.el);
  if (tilstand.type === "ugyldig") return { type: "stopp", utfall: "ugyldig" };
  const naaVerdi = somVerdi(tilstand);
  if (naaVerdi === utkast) return { type: "stopp", utfall: "allerede" };
  if (naaVerdi !== maal.kilde) return { type: "stopp", utfall: "konflikt" };
  const neste: Record<string, unknown> = { ...f.el, oppdatert: somFor(f.el.oppdatert, naa) };
  if (utkast === undefined) delete neste.kommentar;
  else neste.kommentar = somFor(f.el.kommentar, utkast);
  if (Array.isArray(eksport)) {
    const ny = [...eksport];
    ny[Number(f.nokkel)] = neste;
    return { type: "skriv", eksport: ny };
  }
  return { type: "skriv", eksport: { ...(eksport as object), [f.nokkel]: neste } };
}

/**
 * Et sendt «Lagre kommentar»-forsøk med ukjent utfall. Uforanderlig og
 * atskilt fra utkastet. `kontekst` binder det til familie og
 * innloggingssesjon; `sendt` er den normaliserte teksten (`undefined` =
 * tømming).
 *
 * Som notatet (#185): oppfølgingen holder ALLE uavklarte forsøk. Et sikkert
 * avslag på et nytt forsøk avgjør bare det nye; et nytt `ukjent` legges til.
 * Oppfølgingen avsluttes bare når et nytt forsøk gir `lagret`/`allerede`,
 * eller ved et eksplisitt valg etter kontroll. Ingen av dem påstår hva et
 * tidligere forsøk gjorde.
 *
 * Et sent forsøk er en PUT med `if-match` på nodeversjonen det leste: det
 * kan bare nå frem hvis noden står nøyaktig som da (`SENT_FORSOK`).
 */
export interface KommentarForsok {
  kontekst: string;
  hendelseId: string;
  kilde: string | undefined;
  sendt: string | undefined;
}

/** Det en skrivefri lesing viser NÅ, sammenlignet med et uavklart forsøk. */
export type KommentarNaatilstand =
  "likSendt" | "likKilde" | "annet" | "mangler" | "tvetydig" | "ikkeBerettiget" | "ugyldig";

/** Sammenligner en fersk lesing av hele noden (eksportform) med forsøket. Skriver aldri. */
export function vurderKommentarNaatilstand(
  eksport: unknown,
  forsok: KommentarForsok,
): KommentarNaatilstand {
  const f = finn(eksport, forsok.hendelseId);
  if (f.type !== "funnet") return f.type;
  if (kommentarBerettigelse(f.el) !== "ok") return "ikkeBerettiget";
  const t = lesKommentar(f.el);
  if (t.type === "ugyldig") return "ugyldig";
  const naa = somVerdi(t);
  if (naa === forsok.sendt) return "likSendt";
  if (naa === forsok.kilde) return "likKilde";
  return "annet";
}

export type KommentarKontroll = KommentarNaatilstand | "avvist" | "byttet" | "ikkeLest";

/** Hva et sent, uavklart forsøk i verste fall kan gjøre (se `KommentarForsok`). */
export const SENT_FORSOK =
  "Kommer et tidligere forsøk frem senere, kan det bare sette kommentaren til den samme " +
  "teksten, og bare hvis hendelsene står nøyaktig som da det ble sendt.";

/** Brukertekst for utfallet av «Lagre kommentar». */
export function kommentarTekst(utfall: KommentarUtfall): string {
  switch (utfall) {
    case "lagret":
      return "Kommentaren er lagret.";
    case "allerede":
      return "Kommentaren var allerede slik. Ingenting er endret.";
    case "konflikt":
      return (
        "Kommentaren er endret et annet sted siden du begynte. Ingenting er lagret. " +
        "Utkastet ditt står; se over og lagre på nytt hvis det fortsatt skal gjelde."
      );
    case "mangler":
      return "Hendelsen finnes ikke lenger. Ingenting er lagret, og hendelsen er ikke gjenopprettet.";
    case "tvetydig":
      return "Flere hendelser har samme id. Ingenting er lagret.";
    case "ikkeBerettiget":
      return (
        "Hendelsen er ikke lenger en vanlig manuell hendelse, så kommentaren kan ikke " +
        "endres her. Ingenting er lagret."
      );
    case "ugyldig":
      return "Kommentaren er lagret i en form appen ikke kan endre trygt. Ingenting er endret.";
    case "avvist":
      return "Du har ikke tilgang til å endre kommentaren. Ingenting er lagret.";
    case "byttet":
      return "Innloggingen ble endret. Ingenting er lagret.";
    case "stengt":
      return "Skriving i Forvaltning er ikke slått på. Ingenting er lagret.";
    case "ikkeLest":
      return "Kunne ikke lagre kommentaren nå. Ingenting er lagret — prøv igjen.";
    case "ukjent":
      return "Vi vet ikke om kommentaren ble lagret — svaret uteble. Sjekk før du prøver igjen.";
  }
}

const UAVKLART = "Om akkurat dette forsøket ble lagret, er fortsatt ikke avklart.";

/** Brukertekst for den skrivefrie kontrollen. Påstår aldri forsøkets utfall. */
export function kommentarNaatilstandTekst(o: KommentarKontroll): string {
  switch (o) {
    case "likSendt":
      return `Kommentaren står nå slik du ville lagre den. ${UAVKLART}`;
    case "likKilde":
      return (
        `Kommentaren står nå som før forsøket. ${UAVKLART} Forsøket kan fortsatt komme ` +
        "frem, eller det kan ha blitt lagret og senere endret tilbake."
      );
    case "annet":
      return `Kommentaren er nå en annen enn både det du sendte og det du startet fra. ${UAVKLART}`;
    case "mangler":
      return `Hendelsen finnes ikke nå. Ingenting blir gjenopprettet. ${UAVKLART}`;
    case "tvetydig":
      return `Flere hendelser har nå samme id. ${UAVKLART}`;
    case "ikkeBerettiget":
      return `Hendelsen er ikke lenger en vanlig manuell hendelse. ${UAVKLART}`;
    case "ugyldig":
      return `Kommentaren er nå lagret i en form appen ikke kan endre trygt. ${UAVKLART}`;
    case "avvist":
      return `Kunne ikke kontrollere: du har ikke tilgang til å lese hendelsene. ${UAVKLART}`;
    case "byttet":
      return `Kunne ikke kontrollere: innloggingen ble endret. ${UAVKLART}`;
    case "ikkeLest":
      return `Kunne ikke kontrollere nå. ${UAVKLART} Prøv igjen.`;
  }
}

/** Utfallet av «Lagre på nytt». Gjelder bare DET NYE forsøket. */
export function nyttKommentarForsokTekst(utfall: KommentarUtfall): string {
  const fortsatt = "Det første forsøket er fortsatt ikke avklart.";
  const ikke = (grunn: string) => `Det nye forsøket er ikke lagret: ${grunn} ${fortsatt}`;
  switch (utfall) {
    case "lagret":
      return (
        "Det nye forsøket er lagret, og kommentaren står nå slik du ville ha den. " +
        `Om det første forsøket kom frem, er ikke avklart. ${SENT_FORSOK}`
      );
    case "allerede":
      return (
        "Kommentaren står allerede slik du ville ha den, så det nye forsøket skrev " +
        `ingenting. Om det første forsøket kom frem, er ikke avklart. ${SENT_FORSOK}`
      );
    case "konflikt":
      return ikke("kommentaren er endret siden forsøket startet.");
    case "mangler":
      return ikke("hendelsen finnes ikke nå, og den er ikke gjenopprettet.");
    case "tvetydig":
      return ikke("flere hendelser har samme id.");
    case "ikkeBerettiget":
      return ikke("hendelsen er ikke lenger en vanlig manuell hendelse.");
    case "ugyldig":
      return ikke("kommentaren er lagret i en form appen ikke kan endre trygt.");
    case "avvist":
      return ikke("du har ikke tilgang til å endre kommentaren.");
    case "byttet":
      return ikke("innloggingen ble endret.");
    case "stengt":
      return ikke("skriving i Forvaltning er ikke slått på.");
    case "ikkeLest":
      return ikke("kunne ikke lagre nå.");
    case "ukjent":
      return "Svaret på det nye forsøket uteble også. Ingen av forsøkene er avklart. Sjekk før du prøver igjen.";
  }
}

/** Når brukeren eksplisitt avslutter oppfølgingen etter en kontroll. */
export function kommentarAvsluttetTekst(valg: "godta" | "grunnlag" | "lukk"): string {
  const uavklart = "Om forsøket kom frem, er ikke avklart.";
  switch (valg) {
    case "godta":
      return `Kommentaren står slik du ville ha den. ${uavklart} ${SENT_FORSOK}`;
    case "grunnlag":
      return `Den gjeldende kommentaren er nytt grunnlag for utkastet. ${uavklart} ${SENT_FORSOK}`;
    case "lukk":
      return `Oppfølgingen av kommentaren er lukket. ${uavklart} ${SENT_FORSOK}`;
  }
}
