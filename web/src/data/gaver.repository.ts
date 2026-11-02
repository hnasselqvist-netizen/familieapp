/**
 * Datalag for gave- og relasjonsmodulen (S1 julegaver), se
 * docs/arkitektur/gave-relasjon-kartlegging.md §3 og `@app-types/gaver`.
 *
 *   families/{familyId}/relasjonsgrupper/{gruppeId}
 *   families/{familyId}/relasjoner/{personId}
 *   families/{familyId}/anledninger/{anledningId}
 *   families/{familyId}/gaver/{gaveId}
 *
 * Skrivemønster:
 *  - **Per post**, aldri hele noden. Hver skriving er én transaksjon på
 *    postens egen sti.
 *  - **Versjonsvakt.** Kalleren sender det den så (`vakt`); avviker den
 *    ferske serververdien, avbrytes skrivingen med `EndretAvAndre`, og
 *    ingenting overskrives. Utkastet ligger igjen i UI-et.
 *  - **Ukjente felt bevares**: endringen flettes inn i den ferske verdien.
 *  - **Retry er idempotent**: hver skriving bærer en `skrivId`. Finner en
 *    retry sin egen skriving allerede lagret, er utfallet «allerede», ikke
 *    konflikt.
 *  - **Oppretting** er create-if-absent: en eksisterende post overskrives
 *    aldri, og den LAGREDE verdien returneres.
 *  - Ingen `null` skrives (RTDB sletter null). Fjerning av et felt er en
 *    eksplisitt sletting i endringen (`undefined`).
 */
import { onValue, push, ref, runTransaction } from "firebase/database";
import type { FamilyId } from "@app-types/family";
import {
  type Anledning,
  type AnledningsType,
  type Budsjettvalg,
  type Endring,
  type FastBudsjett,
  type Gave,
  type GaveStatus,
  type Gruppe,
  type GruppeId,
  type GruppeStandard,
  type Mottaker,
  type Person,
  type PersonUnntak,
  GRUPPER,
} from "@app-types/gaver";
import { getFirebaseDatabase } from "./firebase";

export type GaveNode = "relasjonsgrupper" | "relasjoner" | "anledninger" | "gaver";

export const gaveNodePath = (familyId: FamilyId, node: GaveNode): string =>
  `families/${familyId}/${node}`;

/** Skrivingen ble avbrutt fordi posten er endret et annet sted siden brukeren så den. */
export class EndretAvAndre extends Error {
  constructor() {
    super("Dette er endret på en annen enhet i mellomtiden. Det du skrev, er tatt vare på.");
    this.name = "EndretAvAndre";
  }
}

// ── Parsing (robust: ugyldige poster hoppes over, ukjente felt ignoreres) ──

type Raa = Record<string, unknown>;
const erObjekt = (v: unknown): v is Raa => !!v && typeof v === "object" && !Array.isArray(v);
const tekst = (v: unknown): string => (typeof v === "string" ? v : "");
const valgfriTekst = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;
const heltall = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const versjon = (v: unknown): number => (heltall(v) ? v : 0);
const GRUPPE_IDER = new Set<string>(GRUPPER.map((g) => g.id));
const erGruppeId = (v: unknown): v is GruppeId => typeof v === "string" && GRUPPE_IDER.has(v);
const TYPER: AnledningsType[] = ["jul", "bursdag"];

function parseFastBudsjett(v: unknown): FastBudsjett | undefined {
  if (!erObjekt(v)) return undefined;
  if (v.type === "ikke_satt") return { type: "ikke_satt" };
  if (v.type === "belop" && heltall(v.belopOre)) return { type: "belop", belopOre: v.belopOre };
  return undefined;
}

function parseBudsjettvalg(v: unknown): Budsjettvalg | undefined {
  if (erObjekt(v) && v.type === "arv") return { type: "arv" };
  return parseFastBudsjett(v);
}

function parseStandard(v: unknown): GruppeStandard | undefined {
  if (!erObjekt(v)) return undefined;
  const s: GruppeStandard = {};
  if (typeof v.aktiv === "boolean") s.aktiv = v.aktiv;
  const b = parseFastBudsjett(v.budsjett);
  if (b) s.budsjett = b;
  return s;
}

function parseUnntak(v: unknown): PersonUnntak | undefined {
  if (!erObjekt(v)) return undefined;
  const u: PersonUnntak = {};
  if (typeof v.aktiv === "boolean") u.aktiv = v.aktiv;
  const b = parseBudsjettvalg(v.budsjett);
  if (b) u.budsjett = b;
  return u;
}

export function parseGrupper(raw: unknown): Partial<Record<GruppeId, Gruppe>> {
  const ut: Partial<Record<GruppeId, Gruppe>> = {};
  if (!erObjekt(raw)) return ut;
  for (const [id, v] of Object.entries(raw)) {
    if (!erGruppeId(id) || !erObjekt(v)) continue;
    const standard: Gruppe["standard"] = {};
    const s = erObjekt(v.standard) ? v.standard : {};
    for (const t of TYPER) {
      const p = parseStandard(s[t]);
      if (p) standard[t] = p;
    }
    ut[id] = { id, standard, versjon: versjon(v.versjon) };
  }
  return ut;
}

export function parsePersoner(raw: unknown): Person[] {
  if (!erObjekt(raw)) return [];
  const ut: Person[] = [];
  for (const [id, v] of Object.entries(raw)) {
    if (!erObjekt(v) || typeof v.navn !== "string" || !v.navn.trim() || !erGruppeId(v.gruppe))
      continue;
    const unntak: Person["unntak"] = {};
    const u = erObjekt(v.unntak) ? v.unntak : {};
    for (const t of TYPER) {
      const p = parseUnntak(u[t]);
      if (p) unntak[t] = p;
    }
    const p: Person = {
      id,
      navn: v.navn,
      gruppe: v.gruppe,
      unntak,
      versjon: versjon(v.versjon),
      opprettet: tekst(v.opprettet),
      oppdatert: tekst(v.oppdatert),
    };
    const fd = valgfriTekst(v.fodselsdato);
    if (fd) p.fodselsdato = fd;
    const notat = valgfriTekst(v.notat);
    if (notat) p.notat = notat;
    const ark = valgfriTekst(v.arkivert);
    if (ark) p.arkivert = ark;
    ut.push(p);
  }
  return ut;
}

function parseMottakere(v: unknown): Record<string, Mottaker> {
  const ut: Record<string, Mottaker> = {};
  if (!erObjekt(v)) return ut;
  for (const [pid, m] of Object.entries(v)) {
    if (!erObjekt(m)) continue;
    const mottaker: Mottaker = { budsjett: parseFastBudsjett(m.budsjett) ?? { type: "ikke_satt" } };
    const f = valgfriTekst(m.fjernet);
    if (f) mottaker.fjernet = f;
    ut[pid] = mottaker;
  }
  return ut;
}

export function parseAnledning(id: string, v: unknown): Anledning | null {
  if (!erObjekt(v) || !heltall(v.aar)) return null;
  const type = v.type === "jul" || v.type === "bursdag" || v.type === "annen" ? v.type : null;
  if (!type) return null;
  const a: Anledning = {
    id,
    type,
    aar: v.aar,
    mottakere: parseMottakere(v.mottakere),
    versjon: versjon(v.versjon),
    opprettet: tekst(v.opprettet),
    oppdatert: tekst(v.oppdatert),
  };
  const navn = valgfriTekst(v.navn);
  if (navn) a.navn = navn;
  return a;
}

export function parseAnledninger(raw: unknown): Anledning[] {
  if (!erObjekt(raw)) return [];
  return Object.entries(raw)
    .map(([id, v]) => parseAnledning(id, v))
    .filter((a): a is Anledning => a !== null);
}

const STATUSER = new Set<string>(["ide", "kjopt", "gitt"]);

export function parseGaver(raw: unknown): Gave[] {
  if (!erObjekt(raw)) return [];
  const ut: Gave[] = [];
  for (const [id, v] of Object.entries(raw)) {
    if (!erObjekt(v) || typeof v.personId !== "string" || !v.personId) continue;
    const g: Gave = {
      id,
      personId: v.personId,
      tekst: tekst(v.tekst),
      status: STATUSER.has(v.status as string) ? (v.status as GaveStatus) : "ide",
      versjon: versjon(v.versjon),
      opprettet: tekst(v.opprettet),
      oppdatert: tekst(v.oppdatert),
    };
    const a = valgfriTekst(v.anledningId);
    if (a) g.anledningId = a;
    if (v.valgt === true) g.valgt = true;
    if (heltall(v.planlagtOre)) g.planlagtOre = v.planlagtOre;
    ut.push(g);
  }
  return ut;
}

// ── Lesing ──────────────────────────────────────────────────────────────

function abonner<T>(
  familyId: FamilyId,
  node: GaveNode,
  parse: (raw: unknown) => T,
  onChange: (v: T) => void,
  onError?: (e: Error) => void,
): () => void {
  return onValue(
    ref(getFirebaseDatabase(), gaveNodePath(familyId, node)),
    (snapshot) => onChange(parse(snapshot.val())),
    (e) => onError?.(e),
  );
}

export const subscribeGrupper = (
  f: FamilyId,
  cb: (g: Partial<Record<GruppeId, Gruppe>>) => void,
  onError?: (e: Error) => void,
) => abonner(f, "relasjonsgrupper", parseGrupper, cb, onError);
export const subscribePersoner = (
  f: FamilyId,
  cb: (p: Person[]) => void,
  onError?: (e: Error) => void,
) => abonner(f, "relasjoner", parsePersoner, cb, onError);
export const subscribeAnledninger = (
  f: FamilyId,
  cb: (a: Anledning[]) => void,
  onError?: (e: Error) => void,
) => abonner(f, "anledninger", parseAnledninger, cb, onError);
export const subscribeGaver = (
  f: FamilyId,
  cb: (g: Gave[]) => void,
  onError?: (e: Error) => void,
) => abonner(f, "gaver", parseGaver, cb, onError);

// ── Skriving ────────────────────────────────────────────────────────────

/** Ny, unik post-id (klientgenerert; beholdes ved retry). */
export function nyPostId(familyId: FamilyId, node: GaveNode): string {
  const id = push(ref(getFirebaseDatabase(), gaveNodePath(familyId, node))).key;
  if (!id) throw new Error("Kunne ikke lage ny id.");
  return id;
}

export type { Endring } from "@app-types/gaver";

function settSti(mål: Raa, sti: string, verdi: unknown): void {
  const deler = sti.split("/");
  let node = mål;
  for (const del of deler.slice(0, -1)) {
    const neste = node[del];
    node[del] = erObjekt(neste) ? { ...neste } : {};
    node = node[del] as Raa;
  }
  const siste = deler[deler.length - 1]!;
  if (verdi === undefined) delete node[siste];
  else node[siste] = verdi;
}

/**
 * Avviser `null` (og `undefined` inne i en verdi) hvor som helst i en verdi
 * som skal lagres, rekursivt gjennom objekter og arrays. RTDB ville stille
 * slettet feltet; her feiler skrivingen i stedet, med stien i feilen.
 * Eksplisitt `undefined` er bare lov som HELE verdien på en endringssti
 * (sletting av det feltet).
 */
export function validerVerdi(verdi: unknown, sti: string): void {
  if (verdi === null) throw new Error(`null kan ikke lagres (${sti}).`);
  if (verdi === undefined) throw new Error(`Tom verdi kan ikke lagres (${sti}).`);
  if (typeof verdi === "number" && !Number.isFinite(verdi))
    throw new Error(`Ugyldig tall kan ikke lagres (${sti}).`);
  if (Array.isArray(verdi)) verdi.forEach((v, i) => validerVerdi(v, `${sti}/${i}`));
  else if (erObjekt(verdi))
    for (const [k, v] of Object.entries(verdi)) validerVerdi(v, `${sti}/${k}`);
}

/** Validerer en hel endring før den brukes. `undefined` på en endringssti = sletting. */
export function validerEndring(endring: Endring): void {
  for (const [sti, verdi] of Object.entries(endring)) {
    if (verdi !== undefined) validerVerdi(verdi, sti);
  }
}

/** Fletter endringen inn i den ferske verdien; ukjente felt bevares. */
export function flett(raa: unknown, endring: Endring): Raa {
  validerEndring(endring);
  const ut: Raa = erObjekt(raa) ? JSON.parse(JSON.stringify(raa)) : {};
  for (const [sti, verdi] of Object.entries(endring)) {
    settSti(ut, sti, verdi === undefined ? undefined : JSON.parse(JSON.stringify(verdi)));
  }
  return ut;
}

export interface EndreValg {
  /** Godtar den ferske serververdien (typisk: samme versjon som brukeren så). */
  vakt: (raa: Raa | null) => boolean;
  endring: Endring;
  /**
   * Hva brukeren så (typisk versjonen). Sammen med posten og endringen gir
   * den en innholdsbasert `skrivId`, så en retry av NØYAKTIG samme endring
   * fra samme grunnlag er idempotent, mens en endret endring er en ny skriving.
   */
  grunn: string;
  tid: string;
}

/** Stabil JSON (sorterte nøkler; `undefined` som egen markør). */
function stabil(v: unknown): string {
  if (v === undefined) return '"\u0000undefined"';
  if (!erObjekt(v)) return Array.isArray(v) ? `[${v.map(stabil).join(",")}]` : JSON.stringify(v);
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stabil(v[k])}`)
    .join(",")}}`;
}

/** FNV-1a 32-bit, to ganger med ulik startverdi → 16 heksadesimale tegn. */
function hash(tekst: string): string {
  const en = (start: number) => {
    let h = start;
    for (let i = 0; i < tekst.length; i++) {
      h ^= tekst.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  return en(0x811c9dc5) + en(0x01000193);
}

export const skrivIdFor = (node: GaveNode, id: string, grunn: string, endring: Endring): string =>
  hash(`${node}/${id}|${grunn}|${stabil(endring)}`);

export type SkriveUtfall = "lagret" | "allerede";

/** Vakt: posten har fortsatt versjonen brukeren så (0 = finnes ikke). */
export const sammeVersjon =
  (forventet: number) =>
  (raa: Raa | null): boolean =>
    versjon(raa?.versjon) === forventet;

/**
 * Endrer én post i en transaksjon mot fersk serververdi. Avviser vakten
 * den ferske verdien, kastes `EndretAvAndre` og ingenting skrives — med
 * mindre det er denne skrivingens egen retry (samme `skrivId` allerede
 * lagret), som gir «allerede».
 */
export async function endrePost(
  familyId: FamilyId,
  node: GaveNode,
  id: string,
  valg: EndreValg,
): Promise<SkriveUtfall> {
  validerEndring(valg.endring);
  const nodeRef = ref(getFirebaseDatabase(), `${gaveNodePath(familyId, node)}/${id}`);
  // Vent til serververdien er kjent før transaksjonen starter.
  let stopp: (() => void) | undefined;
  await new Promise<void>((resolve, reject) => {
    stopp = onValue(nodeRef, () => resolve(), reject);
  });
  const skrivId = skrivIdFor(node, id, valg.grunn, valg.endring);
  let utfall: SkriveUtfall | "konflikt" = "konflikt";
  try {
    // Updateren avbryter ALDRI (returnerer aldri `undefined`): ved avvisning
    // returneres den uendrede verdien, så serveren sammenligner med sin
    // egen og kjører på nytt hvis den lokale cachen var foreldet. Utfallet
    // fra SISTE kjøring (mot fersk serververdi) avgjør.
    const resultat = await runTransaction(
      nodeRef,
      (naa: unknown) => {
        const raa = erObjekt(naa) ? naa : null;
        if (raa && raa.sisteSkriving === skrivId) {
          utfall = "allerede";
          return naa;
        }
        if (!valg.vakt(raa)) {
          utfall = "konflikt";
          return naa;
        }
        utfall = "lagret";
        return flett(raa, {
          ...valg.endring,
          versjon: versjon(raa?.versjon) + 1,
          oppdatert: valg.tid,
          sisteSkriving: skrivId,
        });
      },
      { applyLocally: false },
    );
    if (!resultat.committed) throw new Error("Endringen ble ikke lagret.");
    if (utfall === "konflikt") throw new EndretAvAndre();
    return utfall;
  } finally {
    stopp?.();
  }
}

/** Innholdet som identifiserer en oppretting (uten tidsstempler, som endres ved retry). */
const opprettInnhold = (verdi: Raa): Raa => {
  const { opprettet: _o, oppdatert: _u, sisteSkriving: _s, ...rest } = verdi;
  void _o;
  void _u;
  void _s;
  return rest;
};

export interface Opprettelse {
  lagret: unknown;
  /** Denne kallingen opprettet posten. */
  opprettet: boolean;
  /**
   * Posten finnes allerede med NØYAKTIG dette innholdet fra en tidligere
   * oppretting som ikke er endret siden (typisk en retry der bekreftelsen
   * ble borte).
   */
  identisk: boolean;
}

/**
 * Oppretter posten hvis den ikke finnes (create-if-absent) og returnerer
 * verdien slik den FAKTISK er lagret. En eksisterende post overskrives
 * aldri. Opprettingen lagrer en innholdsbasert `sisteSkriving`, så en retry
 * kan skille «min identiske oppretting er allerede lagret» fra «posten er
 * endret siden» (av en annen enhet, eller fordi utkastet er endret).
 */
export async function opprettPost(
  familyId: FamilyId,
  node: GaveNode,
  id: string,
  verdi: Raa,
): Promise<Opprettelse> {
  validerEndring(verdi);
  const skrivId = skrivIdFor(node, id, "ny", opprettInnhold(verdi));
  const nodeRef = ref(getFirebaseDatabase(), `${gaveNodePath(familyId, node)}/${id}`);
  let opprettet = false;
  const resultat = await runTransaction(
    nodeRef,
    (naa: unknown) => {
      // Finnes den: returner uendret (ikke avbryt), så serveren avgjør mot
      // sin egen verdi hvis den lokale cachen var foreldet.
      if (naa !== null && naa !== undefined) {
        opprettet = false;
        return naa;
      }
      opprettet = true;
      return flett(null, { ...verdi, sisteSkriving: skrivId });
    },
    { applyLocally: false },
  );
  const lagret = resultat.snapshot.val();
  if (lagret === null || lagret === undefined) throw new Error("Posten ble ikke lagret.");
  if (!resultat.committed) throw new Error("Posten ble ikke lagret.");
  return {
    lagret,
    opprettet,
    identisk: erObjekt(lagret) && lagret.sisteSkriving === skrivId,
  };
}

/**
 * Ny post fra et skjema. Finnes posten allerede (retry), godtas den bare
 * hvis den er NØYAKTIG denne opprettingen og uendret siden; ellers kastes
 * `EndretAvAndre` og utkastet beholdes. Fersk versjon adopteres aldri
 * automatisk: å lagre utkastet over den lagrede posten er et eksplisitt
 * valg (vanlig endring med den lagrede versjonen som grunnlag).
 */
export async function opprettNy(
  familyId: FamilyId,
  node: GaveNode,
  id: string,
  verdi: Raa,
): Promise<"lagret" | "allerede"> {
  const r = await opprettPost(familyId, node, id, verdi);
  if (r.opprettet) return "lagret";
  if (r.identisk) return "allerede";
  throw new EndretAvAndre();
}
