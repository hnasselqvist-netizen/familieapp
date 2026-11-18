/**
 * «Slett middag» i Middagsbiblioteket med grunnlagsvern (Mat #20, ordre
 * 6968416205). Samme mønster som Kokebokens «Slett» (#151).
 */

/**
 * Utfallet av «Slett middag». `endret` og `mangler` er avgjort mot en fersk
 * lesing fra serveren, og ingenting er slettet. `avvist` er 401/403 eller ikke
 * innlogget, og ingenting er slettet. `ikkeLest` betyr at posten ikke kunne
 * leses eller kontrolleres innen fristen, og at ingen sletting ble sendt.
 * `ukjent` betyr at en sletting ble sendt, men svaret uteble.
 */
export type SletteUtfall = "slettet" | "endret" | "mangler" | "avvist" | "ikkeLest" | "ukjent";

/**
 * Stabil serialisering (sorterte nøkler) av RTDB-data. RTDB har ingen ekte
 * lister: klient-SDK-ens `exportVal()` gir `{"0": …}`, mens REST
 * `format=export` gir `[…]` for de samme dataene. En liste regnes derfor som
 * objektet med indeksnøkler (tomme plasser finnes ikke lagret).
 */
function stabilJson(v: unknown): string {
  if (Array.isArray(v)) {
    return stabilJson(
      Object.fromEntries(
        v.flatMap((x, i) => (x === null || x === undefined ? [] : [[String(i), x]])),
      ),
    );
  }
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stabilJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * Sletting med observert grunnlag. Skal kjøres inne i
 * `slettMealLibraryEntryVersjonert`, der `fersk` er posten i eksportform fra
 * en fersk lesing med ETag på eksakt nøkkel.
 *
 * Grunnlaget er hele posten i eksportform slik bekreftelsen viste den
 * (`observert`, fra samme abonnementssnapshot): også felt appen ikke kjenner
 * og prioriteter — på posten, i varelinjer og i varianter (review
 * 5950868309). Har noe endret seg siden, eller er posten erstattet, stoppes
 * slettingen med `endret`, og ingenting slettes. Mangler eller er grunnlaget
 * ugyldig, slettes ingenting heller: uten det kan ingen endring utelukkes.
 */
export function slettHvisUendret(
  fersk: unknown,
  observert: unknown,
): { type: "slett" } | { type: "stopp"; utfall: "endret" } {
  return observert !== undefined &&
    observert !== null &&
    typeof observert === "object" &&
    stabilJson(fersk) === stabilJson(observert)
    ? { type: "slett" }
    : { type: "stopp", utfall: "endret" };
}

/**
 * Teksten i bekreftelsen. Generatoren henter handlegrunnlag og varianter via
 * biblioteksposten (`resolveLibraryConcept`), så dager som henter varer fra
 * den, gir ingen varer fra den etter slettingen. En oppskrift som er koblet
 * direkte til dagen (`recipeId`), leveres som før. Planreferansene står.
 */
export function sletteBekreftelse(navn: string): string {
  return (
    `«${navn}» fjernes fra biblioteket. Dager i ukeplanen som henter handlegrunnlag eller ` +
    "varianter fra denne middagen, beholder navnet, men gir ikke lenger varer fra den når " +
    "du lager handleliste. En oppskrift som er koblet direkte til dagen, gir fortsatt varer."
  );
}

/** Brukertekst for utfallet av «Slett middag». */
export function sletteTekst(utfall: SletteUtfall, navn: string): string {
  switch (utfall) {
    case "slettet":
      return `«${navn}» er slettet fra biblioteket.`;
    case "endret":
      return (
        `«${navn}» er endret på en annen enhet siden du åpnet bekreftelsen. Ingenting er ` +
        "slettet. Se over middagen og velg «Slett middag» på nytt hvis den fortsatt skal bort."
      );
    case "mangler":
      return `«${navn}» var allerede slettet på en annen enhet. Ingenting er gjenopprettet.`;
    case "avvist":
      return "Du har ikke tilgang til å slette middagen. Ingenting er slettet.";
    case "ikkeLest":
      return `Kunne ikke kontrollere «${navn}» nå. Ingenting er slettet — prøv igjen.`;
    case "ukjent":
      return (
        `Vi vet ikke om «${navn}» ble slettet — svaret uteble. Se om den fortsatt står i ` +
        "biblioteket før du prøver igjen."
      );
  }
}
