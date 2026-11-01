/**
 * Firebase-/GCS-adaptere for vedleggstjenesten (#59, B1). Én av filene som
 * får importere firebase-admin (§eslint.config.js).
 *
 * - Token: `verifyIdToken(token, checkRevoked = true)` — tilbakekalte økter
 *   avvises med en gang, ikke først når ID-tokenet utløper.
 * - Medlemskap: dagens `families/{f}/members/{uid}` i RTDB, lest per kall.
 *   Tjenesten SKRIVER aldri til RTDB.
 * - Objektlager: GCS med `ifGenerationMatch: 0` (opprett bare hvis ledig).
 *   Ingen sletting, ingen offentlige/tokenbaserte URL-er.
 */
import type { Auth } from "firebase-admin/auth";
import type { Database } from "firebase-admin/database";
import type { Storage } from "firebase-admin/storage";
import { memberPath } from "../store/paths";
import {
  type Medlemskap,
  type Objektlager,
  type TokenVerifiserer,
  type VedleggType,
  gjenkjennType,
} from "./kjerne";

export const firebaseToken = (auth: Auth): TokenVerifiserer => ({
  uid: async (idToken) => (await auth.verifyIdToken(idToken, true)).uid,
});

export const rtdbMedlemskap = (db: Database): Medlemskap => ({
  // Samme sti som MCP-serverens medlemskapssjekk (`store/paths.ts`).
  erMedlem: async (familyId, uid) => (await db.ref(memberPath(familyId, uid)).get()).exists(),
});

const httpKode = (e: unknown): number | undefined =>
  typeof e === "object" && e !== null && "code" in e
    ? Number((e as { code: unknown }).code)
    : undefined;

type Bucket = ReturnType<Storage["bucket"]>;

export class GcsObjektlager implements Objektlager {
  private readonly bucket: Bucket;
  constructor(bucket: Bucket) {
    this.bucket = bucket;
  }

  async opprettHvisLedig(
    sti: string,
    bytes: Uint8Array,
    type: VedleggType,
  ): Promise<"opprettet" | "fantes"> {
    try {
      await this.bucket.file(sti).save(Buffer.from(bytes), {
        contentType: type,
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { cacheControl: "private, no-store" },
      });
      return "opprettet";
    } catch (e) {
      // 412: stien finnes allerede. Innholdsadressert → identisk innhold.
      if (httpKode(e) === 412) return "fantes";
      throw e;
    }
  }

  async les(sti: string) {
    try {
      const [buf] = await this.bucket.file(sti).download();
      const bytes = new Uint8Array(buf);
      // Typen bestemmes på nytt fra bytene, ikke fra lagret metadata.
      const type = gjenkjennType(bytes);
      return type ? { bytes, type } : null;
    } catch (e) {
      if (httpKode(e) === 404) return null;
      throw e;
    }
  }
}
