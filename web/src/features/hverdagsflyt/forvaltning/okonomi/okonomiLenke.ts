/** Områdene i den samlede økonomiflaten (`/forvaltning/okonomi`). */
export type Omrade = "inntekter" | "kostnader" | "sparing";

/**
 * Lenke til ett område i den samlede økonomiflaten. Med `post` åpnes
 * postens eksisterende detaljredigering direkte (funn F: vei fra
 * Spillerom-varselet til riktig post, identifisert ved gruppe- og post-ID).
 */
export const okonomiLenke = (omrade: Omrade, post?: { gruppeId: string; postId: string }) => {
  const params = new URLSearchParams({ omrade });
  if (post) {
    params.set("gruppe", post.gruppeId);
    params.set("post", post.postId);
  }
  return `/forvaltning/okonomi?${params.toString()}`;
};
