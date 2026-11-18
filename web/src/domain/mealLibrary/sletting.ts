/**
 * «Slett middag» i Middagsbiblioteket med grunnlagsvern (Mat #20, ordre
 * 6968416205). Samme mønster som Kokebokens «Slett» (#151).
 */

/**
 * Utfallet av «Slett middag». `endret` og `mangler` er serververifisert, og
 * ingenting er slettet. `avvist` er `permission_denied`, og ingenting er
 * slettet. `ukjent` betyr at vi ikke vet om slettingen nådde serveren.
 */
export type SletteUtfall = "slettet" | "endret" | "mangler" | "avvist" | "ukjent";

/** Stabil serialisering (sorterte nøkler) — likhet uavhengig av nøkkelrekkefølge. */
function stabilJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stabilJson).join(",")}]`;
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
 * `slettMealLibraryEntryMedUtfall`, der `raaFersk` er den ferskeste
 * råverdien på eksakt nøkkel.
 *
 * Grunnlaget er hele råposten slik bekreftelsen viste den (`raaObservert`,
 * fra samme abonnementssnapshot), også felt appen ikke kjenner — på posten,
 * i varelinjer og i varianter. Har noe endret seg siden, eller er posten
 * erstattet, stoppes slettingen med `endret`, og ingenting slettes. Mangler
 * grunnlaget, slettes ingenting heller: uten det kan ingen endring utelukkes.
 */
export function slettHvisUendret(
  raaFersk: Readonly<Record<string, unknown>>,
  raaObservert: Readonly<Record<string, unknown>> | undefined,
): { type: "slett" } | { type: "stopp"; utfall: "endret" } {
  return raaObservert !== undefined && stabilJson(raaFersk) === stabilJson(raaObservert)
    ? { type: "slett" }
    : { type: "stopp", utfall: "endret" };
}

/**
 * Teksten i bekreftelsen. Generatoren finner handlegrunnlaget via
 * biblioteksposten (`resolveLibraryConcept`), så dager som bruker middagen,
 * gir ingen varer fra den etter slettingen. Planreferansene står.
 */
export function sletteBekreftelse(navn: string): string {
  return (
    `«${navn}» fjernes fra biblioteket. Dager i ukeplanen som bruker middagen, beholder ` +
    "navnet, men handlelistegeneratoren finner ikke lenger handlegrunnlaget eller variantene " +
    "for den — de dagene gir da ingen varer fra denne middagen."
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
    case "ukjent":
      return (
        `Vi vet ikke om «${navn}» ble slettet — svaret uteble. Se om den fortsatt står i ` +
        "biblioteket før du prøver igjen."
      );
  }
}
