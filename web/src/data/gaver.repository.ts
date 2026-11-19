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
 *  - **Per post**, aldri hele noden. En endring (`endrePost`) er en
 *    versjonsbetinget REST-skriving på postens egen sti, i eksportform
 *    (`versjonertPost.ts`); en oppretting er én transaksjon på stien.
 *  - **Versjonsvakt.** Kalleren sender det den så (`vakt`); avviker den
 *    ferske serververdien, avbrytes skrivingen med `EndretAvAndre`, og
 *    ingenting overskrives. Utkastet ligger igjen i UI-et.
 *  - **Ukjente felt og prioriteter bevares**: endringen flettes inn i den
 *    ferske verdien i eksportform, og et stopp sender ingenting.
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
import { kjorVersjonertPost } from "./versjonertPost";

export type GaveNode = "relasjonsgrupper" | "relasjoner" | "anledninger" | "gaver";

export const gaveNodePath = (familyId: FamilyId, node: GaveNode): string =>
  `families/${familyId}/${node}`;

/**
 * Skrivingen ble avbrutt fordi posten er endret et annet sted siden brukeren
 * så den. `tidligereUkjent`: et tidligere sendt forsøk med samme endring fikk
 * ukjent utfall, og dette stoppet avgjør ikke om det ble lagret før den
 * andre endringen (review 5980273065) — begge forholdene sies.
 */
export class EndretAvAndre extends Error {
  readonly tidligereUkjent: boolean;
  constructor(tidligereUkjent = false) {
    super(
      tidligereUkjent
        ? "Dette er endret på en annen enhet i mellomtiden. Vi vet fortsatt ikke om det forrige forsøket ditt ble lagret før det. Det du skrev, er tatt vare på."
        : "Dette er endret på en annen enhet i mellomtiden. Det du skrev, er tatt vare på.",
    );
    this.name = "EndretAvAndre";
    this.tidligereUkjent = tidligereUkjent;
  }
}

/**
 * Endringen ble sikkert ikke lagret av dette forsøket: ingenting ble sendt,
 * eller serveren avviste det. Utkastet ligger igjen i UI-et.
 */
export class EndringIkkeLagret extends Error {
  readonly grunn: "ikkeLest" | "avvist" | "byttet";
  constructor(grunn: "ikkeLest" | "avvist" | "byttet") {
    super(
      grunn === "avvist"
        ? "Endringen ble ikke lagret: ingen tilgang. Det du skrev, er tatt vare på."
        : grunn === "byttet"
          ? "Endringen ble ikke lagret fordi innloggingen er byttet. Det du skrev, er tatt vare på."
          : "Endringen ble ikke lagret. Sjekk nettforbindelsen og prøv igjen — det du skrev, er tatt vare på.",
    );
    this.name = "EndringIkkeLagret";
    this.grunn = grunn;
  }
}

/**
 * En skriving ble sendt, men svaret uteble: den kan være lagret eller ikke.
 * Et nytt forsøk med nøyaktig samme endring er trygt (samme `skrivId` gir
 * «allerede» hvis den første kom frem), og et nytt forsøk som ikke kommer
 * frem, avgjør aldri det første.
 */
export class UkjentSkriveUtfall extends Error {
  constructor() {
    super(
      "Vi vet ikke om endringen ble lagret. Se om den vises før du prøver igjen — det du skrev, er tatt vare på, og samme endring lagres ikke dobbelt.",
    );
    this.name = "UkjentSkriveUtfall";
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

/**
 * Statusene denne versjonen kjenner. En ukjent status (fra en nyere versjon)
 * vises som idé, men en skriving på en slik gave avvises (`kjentGaveStatus`
 * i vakten i `useGaver`), så den aldri overskrives med «ide».
 */
const STATUSER = new Set<string>(["ide", "kjopt", "pakket", "gitt"]);

/** Om en lagret gave har en status denne versjonen kjenner (eller ingen status). */
export const kjentGaveStatus = (raa: Raa | null): boolean =>
  raa?.status === undefined || STATUSER.has(raa.status as string);
const ISO_DATO = /^\d{4}-\d{2}-\d{2}$/;

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
    if (typeof v.kjopsdato === "string" && ISO_DATO.test(v.kjopsdato)) g.kjopsdato = v.kjopsdato;
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
  /** Frist for hele forsøket (standard `GAVE_FRIST_MS`). */
  fristMs?: number;
  /**
   * Posten kan mangle og opprettes av denne endringen (bare en gruppe som
   * lagres første gang, med versjon 0 som grunnlag). Uten dette er en
   * manglende post alltid `EndretAvAndre`, og den gjenopprettes aldri.
   */
  nyHvisMangler?: boolean;
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
 * Vakten for en endring av en GAVE (#20, ordre 7005959850): samme versjon som
 * brukeren så, OG en status denne versjonen kjenner. En gave med en status
 * fra en nyere versjon (vist som idé her) skrives derfor aldri over med
 * «ide»: endringen avvises som `EndretAvAndre`, og ingenting skrives.
 */
export const gaveVakt =
  (forventet: number) =>
  (raa: Raa | null): boolean =>
    sammeVersjon(forventet)(raa) && kjentGaveStatus(raa);

/** Avgrenset ventetid for hele én endring (samme som de andre versjonerte skrivingene). */
export const GAVE_FRIST_MS = 15_000;

/**
 * Forsøk der en sendt skriving fikk ukjent utfall og ingen senere lesing har
 * avgjort det. Nøkkelen er den faktiske poststien (med familie) pluss
 * `skrivId` (review 5980273065): `skrivIdFor` har ingen familie, så samme
 * endring i en annen familie er et annet forsøk. Innloggingen er ikke med:
 * et innloggingsbytte avklarer ingenting. Bare «lagret» eller «allerede» på
 * samme sti og `skrivId` avklarer.
 */
const ukjenteForsok = new Set<string>();

const PRI = ".priority";
const erInnpakket = (v: unknown): v is Raa => erObjekt(v) && Object.hasOwn(v, ".value");
const prioritet = (v: unknown): unknown =>
  erObjekt(v) && Object.hasOwn(v, PRI) ? v[PRI] : undefined;
/** Barna til en beholder i eksportform (objekt eller liste); alt annet har ingen. */
const barnAv = (v: unknown): Raa | unknown[] | null =>
  Array.isArray(v) ? v : erObjekt(v) && !erInnpakket(v) ? v : null;

/**
 * Eksportform (`format=export`/`exportVal()`) → verdiform (`val()`): uten
 * prioriteter, og `{".value": v}` pakkes ut. Brukes til vakten og replay.
 */
export function fraEksport(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fraEksport);
  if (!erObjekt(v)) return v;
  if (erInnpakket(v)) return fraEksport(v[".value"]);
  const ut: Raa = {};
  for (const [k, x] of Object.entries(v)) if (k !== PRI) ut[k] = fraEksport(x);
  return ut;
}

/** `ny` (vanlig verdi) i eksportform, med prioritetene fra `gammel` der nøkkelen består. */
function somEksport(gammel: unknown, ny: unknown): unknown {
  const p = prioritet(gammel);
  if (erObjekt(ny) || Array.isArray(ny)) {
    const gamle = (barnAv(gammel) ?? {}) as Raa;
    const ut: Raa = {};
    for (const [k, x] of Object.entries(ny)) ut[k] = somEksport(gamle[k], x);
    if (p !== undefined) ut[PRI] = p;
    return ut;
  }
  return p === undefined ? ny : { ".value": ny, [PRI]: p };
}

const harBarn = (v: Raa) => Object.keys(v).some((k) => k !== PRI);

function settEksport(node: Raa, deler: string[], verdi: unknown): void {
  const [del, ...rest] = deler as [string, ...string[]];
  if (rest.length === 0) {
    if (verdi === undefined) delete node[del];
    else node[del] = somEksport(node[del], verdi);
    return;
  }
  const naa = node[del];
  let barn: Raa;
  if (Array.isArray(naa)) barn = Object.fromEntries(naa.map((x, i) => [String(i), x]));
  else if (erObjekt(naa) && !erInnpakket(naa)) barn = naa;
  else {
    // Ingenting å slette under et blad eller en manglende node.
    if (verdi === undefined) return;
    const p = prioritet(naa);
    barn = p === undefined ? {} : { [PRI]: p };
  }
  node[del] = barn;
  settEksport(barn, rest, verdi);
  // Som i RTDB: en node uten barn finnes ikke.
  if (verdi === undefined && !harBarn(barn)) delete node[del];
}

/**
 * Fletter endringen inn i posten i EKSPORTFORM: bare stiene i endringen
 * berøres. Prioriteter på posten, på nøstede objekter og på blader som ikke
 * endres, står; et blad eller objekt som erstattes, beholder sin prioritet
 * (og prioritetene til underfelt som består). Ukjente felt står.
 */
export function flettEksport(eksport: unknown, endring: Endring): Raa {
  validerEndring(endring);
  const rot: Raa =
    erObjekt(eksport) && !erInnpakket(eksport) ? JSON.parse(JSON.stringify(eksport)) : {};
  for (const [sti, verdi] of Object.entries(endring)) {
    settEksport(
      rot,
      sti.split("/"),
      verdi === undefined ? undefined : JSON.parse(JSON.stringify(verdi)),
    );
  }
  return rot;
}

/**
 * Endrer én post med en versjonsbetinget REST-skriving på postens egen sti
 * (#20, ordre 7013713991; `versjonertPost.ts`). Posten leses fersk fra
 * serveren i eksportform:
 *
 * - **Finnes ikke** (slettet): `EndretAvAndre`. Posten gjenopprettes aldri,
 *   uansett hva vakten godtar — unntatt med `nyHvisMangler` (en gruppe som
 *   lagres første gang), der vakten avgjør som før.
 * - **Egen retry** (samme `skrivId` lagret): «allerede», uten skriving.
 * - **Vakten avviser** den ferske verdien: `EndretAvAndre`, uten skriving.
 * - Ellers PUT av posten i eksportform med `if-match`: bare feltene i
 *   endringen pluss `versjon`+1, `oppdatert` og `sisteSkriving` endres, og
 *   alle prioriteter og ukjente felt står. En samtidig endring gir en ny
 *   runde mot fersk lesing.
 *
 * Ingenting sendt eller sikkert avvist: `EndringIkkeLagret`. Sendt uten svar
 * (frist eller tapt svar): `UkjentSkriveUtfall`, og så lenge ingen senere
 * lesing har avgjort det, gir også et mislykket nytt forsøk med samme
 * `skrivId` på samme sti `UkjentSkriveUtfall`, aldri «ikke lagret», og et
 * stopp gir `EndretAvAndre` med `tidligereUkjent`.
 */
export async function endrePost(
  familyId: FamilyId,
  node: GaveNode,
  id: string,
  valg: EndreValg,
): Promise<SkriveUtfall> {
  validerEndring(valg.endring);
  const skrivId = skrivIdFor(node, id, valg.grunn, valg.endring);
  const sti = `${gaveNodePath(familyId, node)}/${id}`;
  const forsok = `${sti}|${skrivId}`;
  const r = await kjorVersjonertPost<"allerede" | "konflikt">(
    sti,
    (eksport) => {
      const raa = fraEksport(eksport);
      const ny = raa === null && valg.nyHvisMangler === true;
      if (!erObjekt(raa) && !ny) return { type: "stopp", utfall: "konflikt" };
      const post = erObjekt(raa) ? raa : null;
      if (post?.sisteSkriving === skrivId) return { type: "stopp", utfall: "allerede" };
      if (!valg.vakt(post)) return { type: "stopp", utfall: "konflikt" };
      return {
        type: "skriv",
        eksport: flettEksport(eksport, {
          ...valg.endring,
          versjon: versjon(post?.versjon) + 1,
          oppdatert: valg.tid,
          sisteSkriving: skrivId,
        }),
      };
    },
    { fristMs: valg.fristMs ?? GAVE_FRIST_MS, logg: "Gaver" },
  );
  switch (r.type) {
    case "lagret":
      ukjenteForsok.delete(forsok);
      return "lagret";
    case "stopp":
      if (r.utfall === "allerede") {
        ukjenteForsok.delete(forsok);
        return "allerede";
      }
      // Konflikt, slettet post eller ukjent status: et tidligere ukjent
      // forsøk er fortsatt uavklart og sies sammen med konflikten.
      throw new EndretAvAndre(ukjenteForsok.has(forsok));
    case "ukjent":
      ukjenteForsok.add(forsok);
      throw new UkjentSkriveUtfall();
    default:
      if (ukjenteForsok.has(forsok)) throw new UkjentSkriveUtfall();
      throw new EndringIkkeLagret(r.type);
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

/**
 * Etterregistrering av en gave (helårsoversikten, review 5820769716). RTDB
 * har ingen betinget skriving over to stier, så dette er to
 * create-if-absent-transaksjoner i en rekkefølge som gjør feil trygge:
 *
 *  1. **Gaven først** (`opprettNy`): identisk retry gir «allerede», en
 *     endret lagret post (annen enhet, endret utkast eller mottaker på samme
 *     gave-id) gir `EndretAvAndre`. Feiler steget, er INGENTING skrevet —
 *     heller ingen anledning med et budsjettøyeblikksbilde som senere
 *     registreringer ville arvet.
 *  2. **Deretter anledningen** (`opprettPost`, f.eks. `bursdag-<id>-<år>`).
 *     Finnes den, brukes den lagrede uendret, også ved samtidig
 *     registrering fra flere enheter.
 *
 * Feiler steg 2, kastes `AnledningGjenstar`: gaven er lagret uten
 * anledning, den teller likevel i oversikten (året avgjøres av
 * `anledningId`), og en identisk retry eller en eksplisitt fullføring
 * oppretter anledningen. En anledning skrevet herfra
 * finnes derfor aldri uten gaven.
 */
export async function registrerGaveOgAnledning(
  familyId: FamilyId,
  gaveId: string,
  gave: Raa,
  anledning?: { id: string; verdi: Raa },
): Promise<void> {
  await opprettNy(familyId, "gaver", gaveId, gave);
  if (!anledning) return;
  try {
    await opprettPost(familyId, "anledninger", anledning.id, anledning.verdi);
  } catch (e) {
    // Gaven ER lagret: et eget utfall, så UI-et ikke tilbyr en ny registrering
    // (ny gave-id = samme gave to ganger), bare fullføring (review 5821211956).
    throw new AnledningGjenstar(gaveId, anledning.id, e);
  }
}

/** Registreringens andre steg feilet: gaven er lagret, anledningen gjenstår. */
export class AnledningGjenstar extends Error {
  readonly gaveId: string;
  readonly anledningId: string;
  readonly aarsak: unknown;
  constructor(gaveId: string, anledningId: string, aarsak: unknown) {
    super("Gaven er lagret. Bursdagen gjenstår.");
    this.name = "AnledningGjenstar";
    this.gaveId = gaveId;
    this.anledningId = anledningId;
    this.aarsak = aarsak;
  }
}
