/**
 * Versjonsbetinget endring av ÉN post over REST, på eksakt sti (#20, ordre
 * 7013713991). Samme mønster som notatet på bibliotekmiddag (#185) og
 * kommentaren på en økonomisk hendelse (#186):
 *
 * 1. Fersk lesing rett fra serveren i EKSPORTFORM (`format=export`, med
 *    prioriteter) med ETag. Aldri SDK-cachen.
 * 2. `beslutt` avgjør på den verifiserte lesingen (`null` = posten finnes
 *    ikke). Et stopp sender ingenting: ingen skriving, ingen tapt prioritet.
 * 3. Ellers PUT av posten i eksportform med `if-match`. En samtidig endring
 *    (også bare en prioritet) gir 412 og en ny runde mot fersk lesing
 *    (høyst fem).
 *
 * Forsøket er bundet til innloggingen som startet det (og til `valg.sesjon`
 * når den er gitt): samme bruker for alle kall, og sesjonen kontrolleres
 * etter hver tokenhenting og hver lesing. Hele forsøket, også tokenhenting og
 * JSON-lesing, har én frist. Etter fristen sendes ingenting mer, og utfallet
 * er `ikkeLest` hvis ingen PUT var sendt, ellers `ukjent`. 401/403 og ikke
 * innlogget er `avvist`. Ingen automatisk nytt forsøk.
 */
import { sesjonFor } from "./auth.repository";
import { databaseRestUrl, getFirebaseAuth } from "./firebase";

export type PostUtfall<U> =
  /** `svar`: serverens bekreftede svar på PUT (verdien slik den ble lagret), hvis det kunne leses. */
  | { type: "lagret"; svar?: unknown }
  | { type: "stopp"; utfall: U }
  | { type: "avvist" }
  | { type: "byttet" }
  | { type: "ikkeLest" }
  | { type: "ukjent" };

export type PostBeslutning<U> = { type: "skriv"; eksport: unknown } | { type: "stopp"; utfall: U };

export interface VersjonertValg {
  fristMs: number;
  sesjon?: string;
  /** Prefiks i konsollen ved uventede feil. */
  logg: string;
}

const MAKS_RUNDER = 5;

class Stoppet extends Error {}
class SesjonByttet extends Error {}
type Innlogget = NonNullable<ReturnType<typeof getFirebaseAuth>["currentUser"]>;
interface Vakt {
  bruker: Innlogget;
  stoppet: boolean;
  sendt: boolean;
  /** Serveren har bekreftet skrivingen (2xx): utfallet er «lagret», også om fristen går ut nå. */
  bekreftet: boolean;
  signal: AbortSignal;
}

const sammeSesjon = (vakt: Vakt) => getFirebaseAuth().currentUser === vakt.bruker;

export async function kjorVersjonertPost<U>(
  sti: string,
  beslutt: (eksport: unknown) => PostBeslutning<U>,
  valg: VersjonertValg,
): Promise<PostUtfall<U>> {
  const bruker = getFirebaseAuth().currentUser;
  if (!bruker) return { type: "avvist" };
  // Synkront før noe sendes: forsøket hører til en annen innlogging.
  if (valg.sesjon !== undefined && sesjonFor(bruker) !== valg.sesjon) return { type: "byttet" };
  const styring = new AbortController();
  const vakt: Vakt = {
    bruker,
    stoppet: false,
    sendt: false,
    bekreftet: false,
    signal: styring.signal,
  };
  let tidtaker: ReturnType<typeof setTimeout> | undefined;
  const frist = new Promise<PostUtfall<U>>((resolve) => {
    tidtaker = setTimeout(() => {
      vakt.stoppet = true;
      resolve({ type: vakt.bekreftet ? "lagret" : vakt.sendt ? "ukjent" : "ikkeLest" });
      styring.abort();
    }, valg.fristMs);
  });
  try {
    return await Promise.race([runder(sti, beslutt, vakt, valg.logg), frist]);
  } finally {
    clearTimeout(tidtaker);
  }
}

async function rest(
  sti: string,
  vakt: Vakt,
  endring?: { etag: string; eksport: unknown },
): Promise<Response> {
  // Alltid tokenet til innloggingen som startet forsøket.
  const token = await vakt.bruker.getIdToken();
  // Et token som kommer etter fristen, starter aldri en forespørsel.
  if (vakt.stoppet) throw new Stoppet();
  if (!sammeSesjon(vakt)) throw new SesjonByttet();
  const url = databaseRestUrl(sti);
  url.searchParams.set("auth", token);
  if (!endring) {
    url.searchParams.set("format", "export");
    return fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { "X-Firebase-ETag": "true" },
      signal: vakt.signal,
    });
  }
  vakt.sendt = true;
  return fetch(url, {
    method: "PUT",
    cache: "no-store",
    credentials: "omit",
    headers: { "if-match": endring.etag, "Content-Type": "application/json" },
    body: JSON.stringify(endring.eksport),
    signal: vakt.signal,
  });
}

async function runder<U>(
  sti: string,
  beslutt: (eksport: unknown) => PostBeslutning<U>,
  vakt: Vakt,
  logg: string,
): Promise<PostUtfall<U>> {
  for (let runde = 0; runde < MAKS_RUNDER; runde++) {
    let etag: string | null;
    let eksport: unknown;
    if (vakt.stoppet) return { type: "ikkeLest" };
    try {
      const res = await rest(sti, vakt);
      if (res.status === 401 || res.status === 403) return { type: "avvist" };
      if (!res.ok) return { type: "ikkeLest" };
      etag = res.headers.get("ETag");
      if (!etag) return { type: "ikkeLest" };
      eksport = await res.json();
    } catch (err) {
      if (err instanceof SesjonByttet) return { type: "byttet" };
      if (!vakt.stoppet && !(err instanceof Stoppet))
        console.error(`[${logg}] lesing feilet:`, err);
      return { type: "ikkeLest" };
    }
    // Fristen kan ha gått ut, eller sesjonen byttet, mens lesingen pågikk.
    if (vakt.stoppet) return { type: "ikkeLest" };
    if (!sammeSesjon(vakt)) return { type: "byttet" };
    const b = beslutt(eksport ?? null);
    if (b.type === "stopp") return b;

    let res: Response;
    try {
      res = await rest(sti, vakt, { etag, eksport: b.eksport });
    } catch (err) {
      if (err instanceof Stoppet) return { type: "ikkeLest" };
      if (err instanceof SesjonByttet) return { type: "byttet" };
      if (!vakt.stoppet) console.error(`[${logg}] svar på skriving uteble:`, err);
      return { type: vakt.sendt ? "ukjent" : "ikkeLest" };
    }
    if (res.status === 412) {
      // Avvist på ETag: sikkert ikke skrevet; ny runde mot fersk tilstand.
      vakt.sendt = false;
      continue;
    }
    if (res.status === 401 || res.status === 403) return { type: "avvist" };
    if (!res.ok) return { type: "ukjent" };
    vakt.bekreftet = true;
    try {
      return { type: "lagret", svar: (await res.json()) as unknown };
    } catch {
      return { type: "lagret" };
    }
  }
  // Posten endres hele tiden: ingenting er skrevet.
  return { type: "ikkeLest" };
}
