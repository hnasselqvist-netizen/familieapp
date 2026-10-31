/**
 * Kontrollmetadata for «kvalitetssikret» (#59, 6542594363). Logikken bor i
 * `domain/forsoning/kvalitetssikring.ts`; lagringen i
 * `data/transaksjonskontroller.repository.ts`.
 */

/** Én gjeldende kvalitetssikring. */
export interface KontrollMerke {
  /** SHA-256 (hex) av det kanoniske grunnlaget brukeren kontrollerte. */
  grunnlag: string;
  versjon: number;
  /** ISO-tid for kontrollen. */
  tid: string;
  /** Autentisert bruker (Firebase uid). */
  av: string;
  /** Visningsnavn/e-post på kontrolltidspunktet. */
  avNavn: string;
}

export interface KontrollSpor extends KontrollMerke {
  handling: "kvalitetssikret" | "opphevet";
}

/**
 * `families/{f}/transaksjonskontroller/{nøkkel}` — knyttet til den stabile
 * transaksjons-ID-en, ikke til arrayposisjonen. Sporet bevares når en
 * kontroll blir utdatert eller oppheves.
 */
export interface Transaksjonskontroll {
  transaksjonId: string;
  gjeldende: KontrollMerke | null;
  spor: Record<string, KontrollSpor>;
}
