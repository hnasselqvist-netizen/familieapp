/**
 * Appens eget, minimale syn på en innlogget bruker — ikke Firebase sin
 * User-type direkte, slik at ingenting utenfor src/data/** trenger å vite
 * at Firebase Auth finnes (håndhevet av eslint.config.js).
 */
export interface AuthUser {
  uid: string;
  email: string | null;
  /**
   * Brukt av Gangens hilsen (§Kontrolltårn-handoff, Issue #20,
   * "hovedløft" — "God morgen, Helen" osv., §GangenScreen.tsx). `null`
   * er en gyldig, vanlig tilstand — ikke alle Firebase-brukere har satt
   * et visningsnavn.
   */
  displayName: string | null;
}
