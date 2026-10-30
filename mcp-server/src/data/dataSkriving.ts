/**
 * `data_hent` og `data_skriv` mot store-porten. Kontrakten og den rene
 * beslutningen står i `skriving.ts`; her er I/O-rekkefølgen:
 *
 *  1. Valider hele kallet (ingen I/O).
 *  2. ÉN transaksjon på `families/{f}`; updateren kaller den rene
 *     `besluttSkriving` (kun siste kall teller).
 *  3. Avviste kall og replay skriver aldri (updateren returnerer
 *     `undefined`). En avvisning verifiseres mot en FERSK serverlesing; gir
 *     den ferske verdien en skriving, kjøres transaksjonen på nytt — så en
 *     cache som henger etter aldri gir falsk `ikke_medlem`/`konflikt`.
 *     (En helt kald cache løses av adapterens lytter, se
 *     `FirebaseAdminStore.transactFamily`.)
 *  4. Kaster transaksjonen, letes kvitteringen opp: finnes den med samme
 *     fingeravtrykk, er skrivingen committet; ellers `ukjent_utfall`
 *     (prøv igjen med samme opId — replay hindrer dobbeltskriving).
 *  5. Skrivefri tilbakelesing per posisjon: `commit`-versjonen (fra
 *     transaksjonen) og den nå `observerte` skilles; en nyere appendring er
 *     `senereEndret`, aldri en feil. Feiler tilbakelesingen, er svaret
 *     fortsatt `committed` (dataene ER lagret), med `tilbakelesing.ok=false`.
 */
import { AuthorizationError, type FamilyContext } from "../auth/authorize";
import { ToolError } from "../handleliste/errors";
import { tryggFeil } from "../audit/log";
import { type AuditLog, safeAudit } from "../handleliste/service";
import type { HverdagsflytStore } from "../store/types";
import { bytesAv } from "./side";
import {
  type Beslutning,
  besluttSkriving,
  forberedSkriving,
  type ForberedtSkriving,
  type Kvittering,
  parseKvittering,
  type SkriveInn,
  type SkrivingUtfall,
  UgyldigSkriving,
} from "./skriving";
import { parseSti, UgyldigSti } from "./sti";
import { MCP_NOKKEL, utenMcp, versjonAv } from "./versjon";

/** `data_hent` returnerer verdien bare opp til denne størrelsen (ellers smalere sti). */
export const MAKS_HENT_BYTES = 500_000;
/** Ferske verifiseringer + nye transaksjonsforsøk før `ukjent_utfall`. */
const MAKS_FORSOK = 3;

export interface DataHentSvar {
  sti: string;
  finnes: boolean;
  verdi?: unknown;
  versjon?: string;
  bytes: number;
  forStor?: boolean;
}

export interface DataSkrivSvar {
  utfall: "committed" | "replay";
  opId: string;
  skrivinger: SkrivingUtfall[];
  tilbakelesing:
    | { ok: true; skrivinger: { sti: string; versjon: string; senereEndret: boolean }[] }
    | { ok: false };
}

function stiEllerFeil(sti: string): string[] {
  try {
    return parseSti(sti);
  } catch (err) {
    if (err instanceof UgyldigSti) throw new ToolError("invalid_path", err.message, false);
    throw err;
  }
}

export async function hentData(
  store: HverdagsflytStore,
  ctx: FamilyContext,
  sti: string,
): Promise<DataHentSvar> {
  const segmenter = stiEllerFeil(sti);
  const raa = await store.lesNode(ctx.familyId, segmenter);
  const rot = segmenter.length === 0;
  const verdi = rot ? utenMcp(raa) : raa;
  const versjon = versjonAv(verdi);
  if (verdi === null || verdi === undefined || versjon === "mangler") {
    return { sti, finnes: false, versjon, bytes: 0 };
  }
  const bytes = bytesAv(verdi);
  // For stor: ingen versjon uten verdien — en skriving skal alltid bygge på data klienten så.
  if (bytes > MAKS_HENT_BYTES) return { sti, finnes: true, bytes, forStor: true };
  return { sti, finnes: true, verdi, versjon, bytes };
}

export interface SkrivDeps {
  store: HverdagsflytStore;
  audit: AuditLog;
  now: () => number;
}

export async function skrivData(
  deps: SkrivDeps,
  ctx: FamilyContext,
  inn: SkriveInn,
): Promise<DataSkrivSvar> {
  // Audit er best-effort: en loggfeil skal aldri skjule at data er lagret (#85-review).
  deps = { ...deps, audit: safeAudit(deps.audit) };
  const naa = deps.now();
  let forberedt: ForberedtSkriving;
  try {
    forberedt = forberedSkriving(inn, naa);
  } catch (err) {
    if (err instanceof UgyldigSkriving) throw new ToolError(err.code, err.message, false);
    throw err;
  }
  const principal = { sub: ctx.idpSub, uid: ctx.firebaseUid, client: ctx.clientId };
  const besluttMot = (raa: unknown) => besluttSkriving(raa, forberedt, principal, naa);

  for (let forsok = 1; forsok <= MAKS_FORSOK; forsok++) {
    let siste: Beslutning | null = null;
    let committed: boolean;
    try {
      ({ committed } = await deps.store.transactFamily(ctx.familyId, (current) => {
        siste = besluttMot(current);
        return siste.kind === "apply" ? siste.neste : undefined;
      }));
    } catch (err) {
      return etterUkjentUtfall(deps, ctx, forberedt, err);
    }
    const beslutning = siste as Beslutning | null;
    if (!beslutning) throw new Error("Transaksjonen kjørte aldri updateren");

    if (beslutning.kind === "apply") {
      if (!committed) throw new Error("Transaksjonen ble ikke fullført");
      deps.audit.event("data_skriv_committed", loggbart(forberedt, beslutning.kvittering));
      return svar(deps, ctx, forberedt.opId, "committed", beslutning.kvittering);
    }

    // Avvisning eller replay: ingen skriving. Verifiser mot en fersk lesing.
    const fersk = besluttMot(await deps.store.lesNode(ctx.familyId, []));
    if (fersk.kind === "apply") continue; // cachen var utdatert — prøv transaksjonen igjen
    if (fersk.kind === "replay") {
      return svar(deps, ctx, forberedt.opId, "replay", fersk.kvittering);
    }
    throw avvisning(fersk);
  }
  throw new ToolError(
    "ukjent_utfall",
    "Familiens data endret seg gjentatte ganger under skrivingen. Ingenting er skrevet; prøv igjen med samme opId.",
    true,
  );
}

function avvisning(b: Exclude<Beslutning, { kind: "apply" } | { kind: "replay" }>): Error {
  switch (b.kind) {
    case "ikke_medlem":
      return new AuthorizationError(
        "not_member",
        "Den koblede Hverdagsflyt-brukeren er ikke lenger medlem av familien.",
      );
    case "idempotens_konflikt":
      return new ToolError(
        "idempotency_conflict",
        "Dette opId-et er allerede brukt med en annen forespørsel eller av en annen bruker. Bruk et nytt opId.",
        false,
      );
    case "utlopt":
      return new ToolError(
        "utlopt",
        "opId-et er utløpt (eldre enn 30 dager, eller kvitteringene for datoen er beskåret). Ingenting er skrevet; les dataene på nytt og bruk et nytt opId.",
        false,
      );
    case "for_stor":
      return new ToolError(
        "for_stor",
        b.grunn === "skriving"
          ? "Etter endringen ville familiens data blitt større enn det én Firebase-skriving tåler. Ingenting er skrevet; en endring som gjør dataene mindre, går fortsatt."
          : "Familiens data er større enn det serveren kan laste i én skrivetransaksjon. Ingenting er skrevet.",
        false,
        { bytes: b.bytes, grense: b.grense, grunn: b.grunn },
      );
    case "forelder_er_verdi":
      return new ToolError(
        "forelder_er_verdi",
        `«${b.sti}» er i dag en enkeltverdi; den erstattes ikke stille. Skriv «${b.sti}» selv med forventet versjon. Ingenting er skrevet.`,
        false,
        { sti: b.sti },
      );
    case "konflikt":
      return new ToolError(
        "konflikt",
        "Dataene er endret siden de ble lest. Ingenting er skrevet; les på nytt med data_hent og bygg endringen på de nye verdiene.",
        false,
        { avvik: b.avvik },
      );
  }
}

/**
 * Transaksjonen kastet: kanskje committet, kanskje ikke. Kvitteringen
 * ligger i SAMME transaksjon som dataene, så finnes den (med vårt
 * fingeravtrykk og vår principal), er skrivingen gjort.
 */
async function etterUkjentUtfall(
  deps: SkrivDeps,
  ctx: FamilyContext,
  forberedt: ForberedtSkriving,
  opprinnelig: unknown,
): Promise<DataSkrivSvar> {
  deps.audit.event("data_skriv_ukjent", { opId: forberedt.opId, ...tryggFeil(opprinnelig) });
  let k: Kvittering | null = null;
  try {
    k = parseKvittering(
      await deps.store.lesNode(ctx.familyId, [MCP_NOKKEL, "ops", forberedt.opId]),
    );
  } catch {
    // Faller gjennom til ukjent_utfall.
  }
  if (k && k.fp === forberedt.fp && k.sub === ctx.idpSub) {
    deps.audit.event("data_skriv_committed", loggbart(forberedt, k));
    return svar(deps, ctx, forberedt.opId, "committed", k);
  }
  throw new ToolError(
    "ukjent_utfall",
    "Det er uvisst om skrivingen ble lagret. Prøv igjen med SAMME opId: er den lagret, svarer serveren med replay uten å skrive på nytt.",
    true,
  );
}

async function svar(
  deps: SkrivDeps,
  ctx: FamilyContext,
  opId: string,
  utfall: DataSkrivSvar["utfall"],
  k: Kvittering,
): Promise<DataSkrivSvar> {
  let tilbakelesing: DataSkrivSvar["tilbakelesing"];
  try {
    const lest = await Promise.all(
      k.skrivinger.map(async (s) => {
        const segmenter = s.sti === "" ? [] : s.sti.split("/");
        const raa = await deps.store.lesNode(ctx.familyId, segmenter);
        const versjon = versjonAv(raa, { rot: segmenter.length === 0 });
        return { sti: s.sti, versjon, senereEndret: versjon !== s.etter };
      }),
    );
    tilbakelesing = { ok: true, skrivinger: lest };
  } catch (err) {
    deps.audit.event("data_skriv_tilbakelesing_feilet", { opId, ...tryggFeil(err) });
    tilbakelesing = { ok: false };
  }
  return { utfall, opId, skrivinger: k.skrivinger, tilbakelesing };
}

/**
 * Til serverloggen: opId og antall per type — aldri stier (nøkler kan være
 * brukertekst, f.eks. varenavn), verdier eller versjoner (en digest av en
 * kort verdi kan gjettes). Hele kvitteringen ligger i `_mcp/ops/{opId}`.
 */
function loggbart(forberedt: ForberedtSkriving, k: Kvittering) {
  const antall = (type: string) => k.skrivinger.filter((s) => s.type === type).length;
  return {
    opId: forberedt.opId,
    antall: k.skrivinger.length,
    set: antall("set"),
    update: antall("update"),
    slett: antall("slett"),
  };
}
