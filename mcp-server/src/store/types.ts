/**
 * Store-PORTEN — alt MCP-serveren trenger fra Hverdagsflyts datalag, og
 * ingenting mer. Tjenestelogikken (`handleliste/`) kjenner kun denne
 * kontrakten; Firebase Admin-adapteren (`firebaseAdminStore.ts`) og
 * in-memory-faken (`memoryStore.ts`) implementerer den og kjøres mot den
 * SAMME kontrakttesten (`storeContract.ts`).
 *
 * Adapterne er ren I/O: de leser/skriver RÅ RTDB-verdier, og all tolkning
 * (hva er en vare, hva er metadata, replay/konflikt, beskjæring) skjer i
 * den rene modulen `handleliste/shoppingNode.ts` — ett sted, testet uten I/O.
 *
 * ## Firebase-shape (Kontrolltårn-beslutning 5950478583, alternativ A)
 *
 *  - `families/{f}/shopping/{id}` — UENDRET source of truth, appens form.
 *  - `families/{f}/shopping/_ops/{requestId}` — kompakt idempotens-record
 *    (`OpRecord`), skrevet i SAMME transaksjon som vareendringen. Ingen
 *    vare; alle lesere filtrerer reserverte `_`-nøkler eksplisitt.
 *  - `families/{f}/items/{id}` — varebasen, appens form.
 *  - `families/{f}/transaksjoner|hendelser|receipts|rules` — forsoningsnodene
 *    (legacy-arrays). KUN lest, av cutover-kontrollen; aldri skrevet.
 *  - `mcp/actions/{f}/{requestId}` — lengre replay-/konfliktregister og
 *    audit (`ActionRecord`, 90 d), med `mcp/actionsByDay/{f}/{dag}/{requestId}`
 *    som beskjæringsindeks (nøkkelordnet — krever ingen `.indexOn`-regel).
 *  - `mcp/principals/{idpSubKey}` — eksplisitt IdP-sub → Firebase-bruker-
 *    kobling (aldri e-postbasert). Opprettes manuelt, ikke av serveren.
 *
 * `mcp/` er bevisst utenfor `families/`: dagens security rules gir kun
 * medlemmer tilgang under `families/{familyId}`, så appen kan verken lese
 * eller endre koblinger/registeret — kun Admin SDK-et (som omgår reglene).
 */
import type { Vare } from "@app-types/vare";
import type { RaaForsoningsnoder } from "../forvaltning/cutoverKontroll";

export type FamilyId = string;

/** `mcp/principals/{idpSubKey}` — v1: én familie per kobling (multi-family-seamen bevares). */
export interface PrincipalLink {
  firebaseUid: string;
  familyId: FamilyId;
  /** Satt for å trekke tilbake tilgang uten å slette koblingen (audit-spor). */
  disabled?: boolean;
}

/** Utfallet per vare i `shopping_list_add_items` — lagret i både op- og action-recorden. */
export interface AddItemOutcome {
  /** Navnet slik det ble sendt inn (trimmet). */
  inputName: string;
  outcome: "added" | "merged" | "already_on_list";
  entryId: string;
  itemId: string;
  /** Navnet posten faktisk har på listen (varebasens kanoniske navn). */
  name: string;
  /** Mengden etter handlingen. */
  amount: string;
  /** Kun for `merged`: mengden før sammenslåing. */
  previousAmount?: string;
  cat: string;
  newItemCreated: boolean;
}

export type ActionTool = "shopping_list_add_items";

/**
 * `families/{f}/shopping/_ops/{requestId}` — kompakt, kortlevd (7 d / maks
 * 100) idempotens-record, skrevet atomisk sammen med vareendringen.
 * Korte feltnavn: den lastes ned sammen med listen av alle klienter.
 */
export interface OpRecord {
  tool: ActionTool;
  /** sha256 av validert payload — samme requestId + annen payload → konflikt. */
  fp: string;
  /** IdP-sub — samme requestId fra annen principal → konflikt. */
  sub: string;
  /** Firebase-uid og OAuth-klient — nok til å gjenopprette action-recorden. */
  uid: string;
  client: string;
  /** Committet (ms). */
  at: number;
  result: AddItemOutcome[];
}

/** `mcp/actions/{f}/{requestId}` — replay-/konfliktregister og audit (90 d). */
export interface ActionRecord {
  requestId: string;
  tool: ActionTool;
  fingerprint: string;
  idpSub: string;
  firebaseUid: string;
  clientId: string;
  committedAt: number;
  result: AddItemOutcome[];
}

/**
 * Updater for `transactShopping`: får den RÅ, ferske verdien av
 * `families/{f}/shopping` (null, objekt — eller array for legacy-seeden)
 * og returnerer ny verdi, eller `undefined` for "avbryt uten å skrive".
 * Kan kalles flere ganger (compare-and-set); kun siste kall teller.
 */
export type ShoppingUpdater = (current: unknown) => unknown;

export interface HverdagsflytStore {
  getPrincipalLink(idpSub: string): Promise<PrincipalLink | null>;
  isFamilyMember(familyId: FamilyId, firebaseUid: string): Promise<boolean>;

  /** Rå verdi av `families/{f}/shopping` (inkl. `_ops`). */
  readShoppingNode(familyId: FamilyId): Promise<unknown>;
  /** Rå verdi av `families/{f}/shopping/_ops` alene. */
  readShoppingOps(familyId: FamilyId): Promise<unknown>;
  readItems(familyId: FamilyId): Promise<Vare[]>;

  /**
   * Rå verdier av forsoningsnodene `families/{f}/transaksjoner|hendelser|
   * receipts|rules` (Issue #34, cutover-kontroll). KUN lesing — porten har
   * ingen skrivemetode for disse nodene.
   */
  readForsoningsnoder(familyId: FamilyId): Promise<RaaForsoningsnoder>;

  /**
   * Skriver varen KUN hvis `items/{id}` ikke finnes (atomisk). Returnerer
   * verdien som ligger der etterpå — vår, eller en eksisterende.
   */
  createItemIfAbsent(
    familyId: FamilyId,
    id: string,
    fields: Omit<Vare, "id">,
  ): Promise<Omit<Vare, "id">>;

  /**
   * ÉN RTDB-transaksjon på `families/{f}/shopping`. Updateren kjøres mot
   * ferskeste serververdi og på nytt hvis noden endret seg underveis —
   * en verdi beregnet fra en utdatert tilstand blir aldri skrevet.
   */
  transactShopping(familyId: FamilyId, updater: ShoppingUpdater): Promise<{ committed: boolean }>;

  /** Rå verdi av `mcp/actions/{f}/{requestId}`. */
  readArchivedAction(familyId: FamilyId, requestId: string): Promise<unknown>;

  /**
   * Skriver action-recorden OG dens beskjæringsindeks
   * (`mcp/actionsByDay/{f}/{day}/{requestId}`) i én atomisk operasjon.
   */
  archiveAction(familyId: FamilyId, record: ActionRecord, day: string): Promise<void>;

  /**
   * Sletter action-recorder i dagsbøtter med nøkkel ≤ `lastDay` (eldste
   * først, maks `maxDays` bøtter per kall). Returnerer antall slettede recorder.
   */
  pruneArchivedActions(familyId: FamilyId, lastDay: string, maxDays: number): Promise<number>;
}
