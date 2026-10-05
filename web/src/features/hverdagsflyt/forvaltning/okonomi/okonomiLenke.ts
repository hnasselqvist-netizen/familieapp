/** Områdene i den samlede økonomiflaten (`/forvaltning/okonomi`). */
export type Omrade = "inntekter" | "kostnader" | "sparing";

/** Lenke til ett område i den samlede økonomiflaten. */
export const okonomiLenke = (omrade: Omrade) => `/forvaltning/okonomi?omrade=${omrade}`;
