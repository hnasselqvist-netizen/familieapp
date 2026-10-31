/**
 * Feilteksten brukeren ser når en mellomværende-skriving feiler (#95).
 * Avvisninger fra dataene (allerede oppgjort, over restsaldo) forklares;
 * alt annet er en ærlig lagringsfeil. Utkastet beholdes i begge tilfeller.
 */
export const lagringsfeil = (e: unknown): string =>
  e instanceof Error && e.name === "OppgjorAvvist"
    ? e.message
    : "Kunne ikke lagre. Sjekk nettforbindelsen og prøv igjen — beløpet er tatt vare på.";
