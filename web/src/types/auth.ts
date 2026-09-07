/**
 * Appens eget, minimale syn på en innlogget bruker — ikke Firebase sin
 * User-type direkte, slik at ingenting utenfor src/data/** trenger å vite
 * at Firebase Auth finnes (håndhevet av eslint.config.js).
 */
export interface AuthUser {
  uid: string;
  email: string | null;
}
