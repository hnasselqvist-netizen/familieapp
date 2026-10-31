/**
 * Datalag for «kvalitetssikret» (#59, 6542594363):
 * `families/{familyId}/transaksjonskontroller/{nøkkel}`.
 *
 * Ny, additiv node som bare React skriver. Nøkkelen er den tapsfrie
 * kodingen av den STABILE transaksjons-ID-en (`kontoNokkel`), ikke
 * arrayposisjonen, så slettinger/hull i `transaksjoner` aldri flytter en
 * kontroll til en annen rad. Ingen eksisterende node røres: forsoningens
 * helnode-transaksjoner skriver bare `transaksjoner|hendelser|receipts|rules`.
 *
 * Hver skriving er én `runTransaction` på én transaksjons kontroll, med
 * samtidighetsvakt: endringen avbrytes hvis den gjeldende kontrollen ikke
 * lenger er den brukeren så (en annen enhet merket/opphevet i mellomtiden).
 */
import { onValue, ref, runTransaction } from "firebase/database";
import type {
  KontrollMerke,
  KontrollSpor,
  Transaksjonskontroll,
} from "@app-types/kvalitetssikring";
import { getFirebaseDatabase } from "./firebase";
import { kontoNokkel } from "./saldokontroller.repository";
import type { FamilyId } from "@app-types/family";

export const transaksjonskontrollerPath = (familyId: FamilyId): string =>
  `families/${familyId}/transaksjonskontroller`;

export const transaksjonskontrollPath = (familyId: FamilyId, transaksjonId: string): string =>
  `${transaksjonskontrollerPath(familyId)}/${kontoNokkel(transaksjonId)}`;

/** Er den gjeldende kontrollen den samme som brukeren så? */
const sammeGjeldende = (a: KontrollMerke | null, b: KontrollMerke | null): boolean =>
  !a || !b ? !a && !b : a.grunnlag === b.grunnlag && a.tid === b.tid && a.av === b.av;

export class KontrollEndretAvAndre extends Error {
  constructor() {
    super("Kontrollen ble endret et annet sted. Se gjennom raden på nytt.");
    this.name = "KontrollEndretAvAndre";
  }
}

const erMerke = (v: unknown): v is KontrollMerke =>
  !!v &&
  typeof v === "object" &&
  typeof (v as KontrollMerke).grunnlag === "string" &&
  typeof (v as KontrollMerke).tid === "string";

/** `{nøkkel: kontroll}` → kart fra transaksjons-ID. Ugyldige poster hoppes over. */
export function parseTransaksjonskontroller(raw: unknown): Map<string, Transaksjonskontroll> {
  const ut = new Map<string, Transaksjonskontroll>();
  if (!raw || typeof raw !== "object") return ut;
  for (const verdi of Object.values(raw as Record<string, unknown>)) {
    if (!verdi || typeof verdi !== "object") continue;
    const v = verdi as Partial<Transaksjonskontroll> & { gjeldende?: unknown; spor?: unknown };
    if (typeof v.transaksjonId !== "string") continue;
    const spor: Record<string, KontrollSpor> = {};
    if (v.spor && typeof v.spor === "object") {
      for (const [k, s] of Object.entries(v.spor as Record<string, unknown>)) {
        if (erMerke(s)) spor[k] = s as KontrollSpor;
      }
    }
    ut.set(v.transaksjonId, {
      transaksjonId: v.transaksjonId,
      gjeldende: erMerke(v.gjeldende) ? v.gjeldende : null,
      spor,
    });
  }
  return ut;
}

export function subscribeTransaksjonskontroller(
  familyId: FamilyId,
  onChange: (kontroller: Map<string, Transaksjonskontroll>) => void,
): () => void {
  return onValue(ref(getFirebaseDatabase(), transaksjonskontrollerPath(familyId)), (snapshot) =>
    onChange(parseTransaksjonskontroller(snapshot.val())),
  );
}

/**
 * Skriver én kontrollendring. `forventet` er den gjeldende kontrollen
 * brukeren så; avviker serverens verdi, avbrytes skrivingen med
 * `KontrollEndretAvAndre`. `endre` får serverens ferske verdi.
 */
export async function skrivTransaksjonskontroll(
  familyId: FamilyId,
  transaksjonId: string,
  forventet: KontrollMerke | null,
  endre: (forrige: Transaksjonskontroll | null) => Transaksjonskontroll,
): Promise<void> {
  const nodeRef = ref(getFirebaseDatabase(), transaksjonskontrollPath(familyId, transaksjonId));
  // Lytt til noden til serververdien er kjent, så transaksjonen starter fra
  // den ekte verdien og ikke fra SDK-ets foreløpige `null` (som ellers ville
  // fått samtidighetsvakten til å avvise en gyldig skriving).
  let stopp: (() => void) | undefined;
  await new Promise<void>((resolve, reject) => {
    stopp = onValue(nodeRef, () => resolve(), reject);
  });
  let konflikt = false;
  try {
    const resultat = await runTransaction(
      nodeRef,
      (raw: unknown) => {
        // Stien er kilden til identitet; verdien leses uavhengig av hva
        // som står i `transaksjonId`-feltet.
        const forrige = raw
          ? (parseTransaksjonskontroller({
              x: { ...(raw as object), transaksjonId },
            }).get(transaksjonId) ?? null)
          : null;
        konflikt = !sammeGjeldende(forrige?.gjeldende ?? null, forventet);
        return konflikt ? undefined : endre(forrige);
      },
      { applyLocally: false },
    );
    if (konflikt) throw new KontrollEndretAvAndre();
    if (!resultat.committed) throw new Error("Kontrollen ble ikke lagret.");
  } finally {
    stopp?.();
  }
}
