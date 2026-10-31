/**
 * Klient for vedleggstjenesten (#59, kvitteringer B1): samme origin via
 * Hosting-rewrite (`/api/vedlegg/**`), autentisert med brukerens Firebase
 * ID-token. Ingen URL-er lagres; nedlasting gir en Blob som kalleren lager
 * (og frigir) en object-URL av.
 *
 * Produksjonsaktivering er AV: tjenesten brukes bare når
 * `VITE_VEDLEGG_TJENESTE=aktiv` (se docs/drift/kvitteringsvedlegg.md).
 */
import type { FamilyId } from "@app-types/family";
import type { KvitteringFil } from "@app-types/forsoning";
import { getFirebaseAuth } from "./firebase";

export const vedleggTjenesteAktiv = (): boolean =>
  import.meta.env.VITE_VEDLEGG_TJENESTE === "aktiv";

const base = (): string => import.meta.env.VITE_VEDLEGG_API || "/api/vedlegg";

export class KvitteringsfilFeil extends Error {
  readonly status: number;
  readonly kode: string;
  constructor(status: number, kode: string, melding: string) {
    super(melding);
    this.name = "KvitteringsfilFeil";
    this.status = status;
    this.kode = kode;
  }
}

async function idToken(): Promise<string> {
  const bruker = getFirebaseAuth().currentUser;
  if (!bruker) throw new KvitteringsfilFeil(401, "mangler_token", "Du er ikke logget inn.");
  return bruker.getIdToken();
}

async function feilFra(r: Response): Promise<KvitteringsfilFeil> {
  let kode = "ukjent";
  let melding = "Noe gikk galt. Prøv igjen.";
  try {
    const j = (await r.json()) as { feil?: string; melding?: string };
    kode = j.feil ?? kode;
    melding = j.melding ?? melding;
  } catch {
    // ikke JSON — behold standardtekst
  }
  return new KvitteringsfilFeil(r.status, kode, melding);
}

const sti = (...deler: string[]) => `${base()}/${deler.map(encodeURIComponent).join("/")}`;

export interface LagretFil {
  sha256: string;
  type: KvitteringFil["type"];
  storrelse: number;
  status: "opprettet" | "fantes";
}

export async function lastOppKvitteringsfil(
  familyId: FamilyId,
  receiptId: string,
  fil: Blob,
): Promise<LagretFil> {
  const r = await fetch(sti(familyId, receiptId), {
    method: "POST",
    headers: { Authorization: `Bearer ${await idToken()}` },
    body: fil,
  });
  if (!r.ok) throw await feilFra(r);
  return (await r.json()) as LagretFil;
}

export async function hentKvitteringsfil(
  familyId: FamilyId,
  receiptId: string,
  sha256: string,
): Promise<Blob> {
  const r = await fetch(sti(familyId, receiptId, sha256), {
    headers: { Authorization: `Bearer ${await idToken()}` },
  });
  if (!r.ok) throw await feilFra(r);
  return r.blob();
}
