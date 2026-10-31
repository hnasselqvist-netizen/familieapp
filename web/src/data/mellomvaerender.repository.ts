/**
 * Datalag for mellomværende-avtaler (#95):
 * `families/{familyId}/mellomvaerender/{id}`.
 *
 * Ny, additiv node; bare avtalen ligger her. Den økonomiske effekten
 * (kostnad og oppgjør) skrives som hendelser via forsoningens helnode-
 * transaksjon (`forsoningSkriving.repository.ts`), så restsaldo og faktisk
 * kostnad alltid avledes fra samme kilde.
 *
 * En avtale opprettes én gang og endres ikke av appen etterpå: `id` lages
 * av klienten og beholdes ved retry, og opprettingen er en transaksjon som
 * ikke overskriver en eksisterende avtale.
 */
import { onValue, ref, runTransaction } from "firebase/database";
import type { FamilyId } from "@app-types/family";
import type { Eierandel } from "@app-types/forsoning";
import type { Mellomvaerende, MellomvaerendePost } from "@app-types/mellomvaerende";
import { getFirebaseDatabase } from "./firebase";

export const mellomvaerenderPath = (familyId: FamilyId): string =>
  `families/${familyId}/mellomvaerender`;

const MAANED = /^\d{4}-(0[1-9]|1[0-2])$/;
const heltallOver0 = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

function parsePost(raw: unknown): MellomvaerendePost | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<MellomvaerendePost>;
  if (typeof p.postId !== "string" || !p.postId) return null;
  const eiere: Eierandel[] = Array.isArray(p.eiere)
    ? p.eiere
        .filter((e) => e && typeof e.person === "string")
        .map((e) => ({ person: e.person, prosent: Number(e.prosent) || 0 }))
    : Object.values((p.eiere as Record<string, Eierandel> | undefined) ?? {}).map((e) => ({
        person: e.person,
        prosent: Number(e.prosent) || 0,
      }));
  return {
    postId: p.postId,
    postNavn: typeof p.postNavn === "string" ? p.postNavn : p.postId,
    plasseringType:
      p.plasseringType === "income" || p.plasseringType === "sparing" ? p.plasseringType : "budget",
    eiere,
  };
}

/** `{id: avtale}` → liste sortert på startmåned. Ugyldige avtaler hoppes over. */
export function parseMellomvaerender(raw: unknown): Mellomvaerende[] {
  if (!raw || typeof raw !== "object") return [];
  const ut: Mellomvaerende[] = [];
  for (const [nokkel, verdi] of Object.entries(raw as Record<string, unknown>)) {
    if (!verdi || typeof verdi !== "object") continue;
    const v = verdi as Partial<Mellomvaerende>;
    const kostnad = parsePost(v.kostnad);
    const oppgjor = parsePost(v.oppgjor);
    if (
      !kostnad ||
      !oppgjor ||
      !heltallOver0(v.opprinneligOre) ||
      !heltallOver0(v.standardBelopOre) ||
      typeof v.startMaaned !== "string" ||
      !MAANED.test(v.startMaaned)
    ) {
      continue;
    }
    ut.push({
      // Stien er kilden til identitet.
      id: nokkel,
      navn: typeof v.navn === "string" ? v.navn : "",
      motpart: typeof v.motpart === "string" ? v.motpart : "",
      opprinneligOre: v.opprinneligOre,
      startMaaned: v.startMaaned,
      kostnad,
      oppgjor,
      standardBelopOre: v.standardBelopOre,
      opprettet: typeof v.opprettet === "string" ? v.opprettet : "",
      av: typeof v.av === "string" ? v.av : "",
    });
  }
  return ut.sort((a, b) => a.startMaaned.localeCompare(b.startMaaned) || a.id.localeCompare(b.id));
}

export function subscribeMellomvaerender(
  familyId: FamilyId,
  onChange: (avtaler: Mellomvaerende[]) => void,
): () => void {
  return onValue(ref(getFirebaseDatabase(), mellomvaerenderPath(familyId)), (snapshot) =>
    onChange(parseMellomvaerender(snapshot.val())),
  );
}

/**
 * Oppretter avtalen hvis den ikke finnes. Idempotent ved retry med samme
 * `id`: en eksisterende avtale overskrives aldri.
 */
export async function opprettMellomvaerende(
  familyId: FamilyId,
  avtale: Mellomvaerende,
): Promise<void> {
  const nodeRef = ref(getFirebaseDatabase(), `${mellomvaerenderPath(familyId)}/${avtale.id}`);
  const resultat = await runTransaction(nodeRef, (naa: unknown) =>
    naa ? undefined : JSON.parse(JSON.stringify(avtale)),
  );
  if (!resultat.snapshot.exists()) throw new Error("Mellomværendet ble ikke lagret.");
}
