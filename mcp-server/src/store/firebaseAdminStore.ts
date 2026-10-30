/**
 * Firebase Admin SDK-adapter for store-porten (variant A i auth-designet,
 * Issue #27 kommentar 5936936743). ENESTE fil (utenom `main.ts`) som får
 * importere `firebase-admin` (§eslint.config.js).
 *
 * Admin SDK-et omgår security rules — autorisasjonen (kobling +
 * medlemskap per kall) gjøres derfor eksplisitt i `auth/authorize.ts`
 * FØR noen av metodene under kalles for en familie.
 *
 * Ren I/O: rå verdier inn og ut. All tolkning bor i `handleliste/shoppingNode.ts`.
 *
 * I denne foundation-PR-en kjøres adapteren KUN mot RTDB-emulatoren
 * (`*.integration.test.ts`). Ingen ekte credentialing, ingen prod-skriving.
 */
import type { Database } from "firebase-admin/database";
import type { Vare } from "@app-types/vare";
import type { LestSide } from "../data/side";
import { familieSti } from "../data/sti";
import { FORSONINGSNODER, type RaaForsoningsnoder } from "../forvaltning/cutoverKontroll";
import { withoutUndefined } from "./json";
import {
  actionDayEntryPath,
  actionPath,
  actionsByDayPath,
  forsoningsnodePath,
  itemPath,
  itemsPath,
  memberPath,
  principalPath,
  shoppingOpsPath,
  shoppingPath,
} from "./paths";
import { skrivebeskyttet } from "./skrivebeskyttet";
import type {
  ActionRecord,
  FamilyId,
  HverdagsflytStore,
  NodeUpdater,
  PrincipalLink,
  ShoppingUpdater,
} from "./types";

/**
 * RTDB-ens REST-API, brukt KUN til grunn nøkkellisting (`shallow=true`), som
 * Admin SDK-et ikke har. `token` er et OAuth-tilgangstoken for den samme
 * kjøretidsidentiteten som Admin SDK-et bruker (Application Default
 * Credentials); mot emulatoren brukes `owner`.
 */
export interface RtdbRest {
  /** Databasens rot, f.eks. `https://x-default-rtdb.europe-west1.firebasedatabase.app/`. */
  baseUrl: string;
  /** Emulatorens namespace (`?ns=`); utelatt i produksjon. */
  ns?: string;
  token: () => Promise<string>;
}

/** Mot emulatoren kan REST-oppsettet utledes; i produksjon gis det eksplisitt (`main.ts`). */
export function emulatorRest(databaseUrl: string, emulatorHost: string): RtdbRest {
  const url = new URL(databaseUrl);
  return {
    baseUrl: `http://${emulatorHost}/`,
    ns: url.searchParams.get("ns") ?? url.hostname.split(".")[0],
    token: async () => "owner",
  };
}

export class FirebaseAdminStore implements HverdagsflytStore {
  private readonly db: Database;
  /** Full lesing går KUN gjennom denne: alle skrivemetoder avvises (`skrivebeskyttet.ts`). */
  private readonly lesing: Database;
  private readonly rest: RtdbRest | null;

  constructor(db: Database, options: { rest?: RtdbRest } = {}) {
    this.db = db;
    this.lesing = skrivebeskyttet(db);
    const emulator = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
    const databaseUrl = db.app.options.databaseURL;
    this.rest =
      options.rest ?? (emulator && databaseUrl ? emulatorRest(databaseUrl, emulator) : null);
  }

  async getPrincipalLink(idpSub: string): Promise<PrincipalLink | null> {
    const snap = await this.db.ref(principalPath(idpSub)).get();
    if (!snap.exists()) return null;
    const raw = snap.val() as Record<string, unknown>;
    if (typeof raw.firebaseUid !== "string" || typeof raw.familyId !== "string") return null;
    return {
      firebaseUid: raw.firebaseUid,
      familyId: raw.familyId,
      disabled: raw.disabled === true,
    };
  }

  async isFamilyMember(familyId: FamilyId, firebaseUid: string): Promise<boolean> {
    const snap = await this.db.ref(memberPath(familyId, firebaseUid)).get();
    return snap.exists() && snap.val() !== false;
  }

  async readShoppingNode(familyId: FamilyId): Promise<unknown> {
    return (await this.db.ref(shoppingPath(familyId)).get()).val();
  }

  async readShoppingOps(familyId: FamilyId): Promise<unknown> {
    return (await this.db.ref(shoppingOpsPath(familyId)).get()).val();
  }

  async readItems(familyId: FamilyId): Promise<Vare[]> {
    const snap = await this.db.ref(itemsPath(familyId)).get();
    if (!snap.exists()) return [];
    const value = snap.val() as Record<string, Record<string, unknown>>;
    return Object.entries(value).flatMap(([id, fields]) =>
      fields && typeof fields.name === "string"
        ? [{ id, name: fields.name, cat: typeof fields.cat === "string" ? fields.cat : "Diverse" }]
        : [],
    );
  }

  /** Fire uavhengige `get()` — ren lesing, som Admin SDK-et gjør med viewer-rollen. */
  async readForsoningsnoder(familyId: FamilyId): Promise<RaaForsoningsnoder> {
    const verdier = await Promise.all(
      FORSONINGSNODER.map(async (n) =>
        (await this.db.ref(forsoningsnodePath(familyId, n)).get()).val(),
      ),
    );
    return Object.fromEntries(
      FORSONINGSNODER.map((n, i) => [n, verdier[i] as unknown]),
    ) as RaaForsoningsnoder;
  }

  async listChildKeys(
    familyId: FamilyId,
    segmenter: readonly string[],
  ): Promise<{ type: "mangler" | "verdi" | "node"; nokler: string[] }> {
    if (!this.rest) throw new Error("RTDB-REST er ikke konfigurert for grunn nøkkellisting.");
    const url = new URL(
      `${familieSti(familyId, segmenter).split("/").map(encodeURIComponent).join("/")}.json`,
      this.rest.baseUrl,
    );
    url.searchParams.set("shallow", "true");
    if (this.rest.ns) url.searchParams.set("ns", this.rest.ns);
    // Bare GET: REST-kallet kan ikke skrive noe.
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${await this.rest.token()}` },
    });
    if (!res.ok) throw new Error(`RTDB-REST svarte ${res.status}`);
    const v: unknown = await res.json();
    if (v === null) return { type: "mangler", nokler: [] };
    if (typeof v !== "object") return { type: "verdi", nokler: [] };
    return { type: "node", nokler: Object.keys(v as object) };
  }

  async readChildPage(
    familyId: FamilyId,
    segmenter: readonly string[],
    etter: string | null,
    antall: number,
  ): Promise<LestSide> {
    const ref = this.lesing.ref(familieSti(familyId, segmenter));
    let q = ref.orderByKey();
    if (etter !== null) q = q.startAfter(etter);
    const snap = await q.limitToFirst(antall).get();
    if (!snap.exists()) {
      if (etter !== null) return { finnes: true, barn: [] };
      // En spørring på en primitiv verdi er tom: les noden selv (bare da).
      const selv = await ref.get();
      if (!selv.exists()) return { finnes: false, barn: [] };
      return { finnes: true, verdi: selv.val() as string | number | boolean, barn: [] };
    }
    const barn: [string, unknown][] = [];
    snap.forEach((c) => {
      barn.push([c.key!, c.val()]);
    });
    return { finnes: true, barn };
  }

  /**
   * Transaksjon på `items/{id}`: for `null` returneres en KONKRET verdi
   * (aldri `undefined`), så et spekulativt første kall mot kald cache
   * sammenlignes mot — og om nødvendig kjøres på nytt mot — serververdien
   * (samme lærdom som appens `toggleShoppingItemDone`). Finnes noden,
   * avbrytes transaksjonen og den eksisterende verdien returneres.
   */
  async createItemIfAbsent(
    familyId: FamilyId,
    id: string,
    fields: Omit<Vare, "id">,
  ): Promise<Omit<Vare, "id">> {
    const result = await this.db
      .ref(itemPath(familyId, id))
      .transaction(
        (current: unknown) => (current === null ? withoutUndefined(fields) : undefined),
        undefined,
        false,
      );
    const stored = result.snapshot.val() as Record<string, unknown> | null;
    return {
      name: typeof stored?.name === "string" ? stored.name : fields.name,
      cat: typeof stored?.cat === "string" ? stored.cat : "Diverse",
    };
  }

  /**
   * ÉN RTDB-transaksjon på `families/{f}/shopping`. RTDB kjører updateren
   * på nytt mot ferskeste serververdi hver gang den lokale gjetningen var
   * feil (compare-and-set på hele noden). `applyLocally=false`: ingen
   * mellomliggende lokale hendelser. Updateren returnerer en konkret verdi
   * for `null`/ukjent node; `undefined` (avbryt) kun ved replay/konflikt,
   * som er basert på en faktisk sett `_ops`-record.
   */
  async transactShopping(
    familyId: FamilyId,
    updater: ShoppingUpdater,
  ): Promise<{ committed: boolean }> {
    const result = await this.db.ref(shoppingPath(familyId)).transaction(
      (current: unknown) => {
        const next = updater(current);
        return next === undefined ? undefined : withoutUndefined(next as object);
      },
      undefined,
      false,
    );
    return { committed: result.committed };
  }

  /** Én `get()` gjennom skrivevakten — samme snapshot for verdi og versjon. */
  async lesNode(familyId: FamilyId, segmenter: readonly string[]): Promise<unknown> {
    return (await this.lesing.ref(familieSti(familyId, segmenter)).get()).val();
  }

  /**
   * ÉN RTDB-transaksjon på hele `families/{f}` (#27, `data_skriv`).
   *
   * Kald cache (6514708855): uten en aktiv lytter kjører Admin SDK-et
   * updateren først mot en tom lokal cache (`null`). Et avvisende svar
   * (`undefined`) på den gjetningen ville avbrutt transaksjonen uten at
   * serveren ble spurt. Derfor holdes en `value`-lytter på familienoden
   * mens transaksjonen kjører: transaksjonen starter først når serverens
   * verdi er mottatt, og updaterens første kall ser den. Motprøvd mot
   * emulatoren: uten lytteren gir en fersk Admin-app falsk `not_member` på
   * en eksisterende familie (11 av 17 tester i
   * `dataSkriving.integration.test.ts` feiler), og en fersk `get()` alene
   * hjelper ikke, fordi den ikke fyller transaksjonens cache. Tjenestens
   * verifisering av avvisninger (`data/dataSkriving.ts`) dekker i tillegg
   * en cache som henger etter. Neste verdi er allerede i lagringsform
   * (ingen `undefined`), så den sendes som den er.
   */
  async transactFamily(familyId: FamilyId, updater: NodeUpdater): Promise<{ committed: boolean }> {
    const ref = this.db.ref(familieSti(familyId, []));
    let mottatt!: () => void;
    let feilet!: (err: Error) => void;
    const forste = new Promise<void>((resolve, reject) => {
      mottatt = resolve;
      feilet = reject;
    });
    const lytter = ref.on(
      "value",
      () => mottatt(),
      (err: Error) => feilet(err),
    );
    try {
      await forste;
      const result = await ref.transaction(updater, undefined, false);
      return { committed: result.committed };
    } finally {
      ref.off("value", lytter);
    }
  }

  async readArchivedAction(familyId: FamilyId, requestId: string): Promise<unknown> {
    return (await this.db.ref(actionPath(familyId, requestId)).get()).val();
  }

  /** Én multi-path `update()`: recorden og dens dagsindeks, alt-eller-ingenting. */
  async archiveAction(familyId: FamilyId, record: ActionRecord, day: string): Promise<void> {
    await this.db.ref().update({
      [actionPath(familyId, record.requestId)]: withoutUndefined(record),
      [actionDayEntryPath(familyId, day, record.requestId)]: true,
    });
  }

  /**
   * Dagsbøttene er nøkkelordnet (`YYYY-MM-DD`), så `orderByKey` + `endAt`
   * finner de eldste uten noen `.indexOn`-regel.
   */
  async pruneArchivedActions(familyId: FamilyId, lastDay: string, maxDays: number) {
    const snap = await this.db
      .ref(actionsByDayPath(familyId))
      .orderByKey()
      .endAt(lastDay)
      .limitToFirst(maxDays)
      .get();
    if (!snap.exists()) return 0;
    const updates: Record<string, null> = {};
    let removed = 0;
    for (const [day, entries] of Object.entries(snap.val() as Record<string, object>)) {
      for (const key of Object.keys(entries)) {
        updates[`mcp/actions/${familyId}/${key}`] = null;
        removed += 1;
      }
      updates[`${actionsByDayPath(familyId)}/${day}`] = null;
    }
    await this.db.ref().update(updates);
    return removed;
  }
}
