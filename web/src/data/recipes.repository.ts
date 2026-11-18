/**
 * Datalag for kokeboken (`families/{familyId}/recipes`).
 *
 * Skrivemønster: målrettede skrivinger til én oppskrift-node
 * (`recipes/{id}`) — aldri hele samlingen tilbake. Dagens `index.html`
 * (linje ~16459–16466, `setRecipes`) serialiserer og skriver HELE
 * `recipes`-samlingen ved hver eneste oppskriftsendring (opprett,
 * rediger, slett, "bekreft middag"-statistikk) — nøyaktig samme
 * tapt-oppdatering-risikoklasse som Fryserens skrivemønster hadde før
 * Fase 0 runde 2 (§Kontrolltårn-review): to nesten samtidige
 * operasjoner på ULIKE oppskrifter (f.eks. én bruker redigerer en
 * oppskrift mens "Bekreft middag" samtidig oppdaterer en annen sin
 * `timesCooked`) kan i dagens kode miste hverandres endring, fordi
 * begge leser og skriver samme, hele collection-objektet fra hver sin
 * potensielt utdaterte lokale kopi.
 *
 * Oppdatering av en EKSISTERENDE oppskrift går derfor via
 * `transactRecipe` (RTDB `runTransaction`), ikke et ubetinget `set()`
 * — samme mønster som `transactFreezerItem`
 * (§data/freezer.repository.ts).
 *
 * **Funn under integrasjonstesting, ikke dokumentert i designbok.md:**
 * Realtime Database lagrer aldri en tom liste/objekt eller `null` — et
 * felt satt til `[]` eller `null` er ikke-eksisterende når det leses
 * tilbake, ikke en tom liste. En oppskrift skrevet med `tags:[]` kommer
 * altså tilbake fra Firebase UTEN `tags`-nøkkelen i det hele tatt (samme
 * for `ingredients`/`ingredientGroups`/`imageUrl`/`lastCooked`). Uten
 * `parseRecipeFields` under ville f.eks. en `updater` som gjør
 * `[...current.tags, "ny"]` kastet ("current.tags is not iterable") for
 * enhver oppskrift uten tagger fra før — oppdaget nettopp av
 * konkurranse-testen lenger ned, som opprinnelig skrev en oppskrift med
 * `tags:[]` og krasjet i selve transaksjonen. Normaliseringen skjer
 * derfor på LESING (både abonnement og transaksjonens `current`), ikke
 * på skriving — skriving av `[]`/`null` er fortsatt gyldig og betyr
 * nøyaktig det samme som fravær av feltet.
 *
 * **Funn under Førsteutkast-skiven, samme feilklasse:** de nye,
 * valgfrie `lettvint`/`variationTags`-feltene ble opprinnelig ikke lest
 * inn av `parseRecipeFields` i det hele tatt — skrivingen selv fungerte
 * fint (`transactRecipe` hvitlister ikke felt på skriving), men
 * `subscribeRecipes`/`transactRecipe` sin `current` viste alltid
 * `undefined` for begge, uansett hva som faktisk lå lagret. Samme
 * bug ble funnet parallelt i `mealLibrary.repository.ts`, der DEN
 * versjonen i tillegg hvitlistet feltene bort på selve skrivingen.
 */
import { onValue, ref, remove, runTransaction, set } from "firebase/database";
import { databaseRestUrl, getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { Recipe, RecipeFields } from "@app-types/recipe";

function recipesPath(familyId: FamilyId): string {
  return `families/${familyId}/recipes`;
}

function recipePath(familyId: FamilyId, id: string): string {
  return `${recipesPath(familyId)}/${id}`;
}

/**
 * Normaliserer en oppskrift-node slik den faktisk kommer tilbake fra
 * Firebase — se filens toppkommentar for hvorfor dette må skje på
 * lesing. `raw` er ukjent formet inndata (Firebase sin egen
 * `unknown`/`any`-verdi), ikke allerede en gyldig `RecipeFields`.
 */
function parseRecipeFields(raw: Record<string, unknown>): RecipeFields {
  return {
    name: raw.name as string,
    cat: raw.cat as string,
    tags: (raw.tags as string[] | undefined) ?? [],
    time: raw.time as number,
    servings: raw.servings as number,
    url: raw.url as string,
    imageUrl: (raw.imageUrl as string | null | undefined) ?? null,
    source: raw.source as string,
    instructions: raw.instructions as string,
    ingredients: (raw.ingredients as RecipeFields["ingredients"] | undefined) ?? [],
    ingredientGroups: (raw.ingredientGroups as RecipeFields["ingredientGroups"] | undefined) ?? [],
    lastCooked: (raw.lastCooked as number | null | undefined) ?? null,
    timesCooked: (raw.timesCooked as number | undefined) ?? 0,
    createdAt: raw.createdAt as number,
    ...(raw.updatedAt !== undefined ? { updatedAt: raw.updatedAt as number } : {}),
    ...(raw.lettvint !== undefined ? { lettvint: raw.lettvint as boolean } : {}),
    ...(raw.variationTags !== undefined ? { variationTags: raw.variationTags as string[] } : {}),
  };
}

/** Abonnerer på hele kokeboken. Returnerer en avmeldingsfunksjon. */
/**
 * Eksportformen (`exportVal()`, med prioriteter på alle nivåer) av oppskriften
 * hver `Recipe` fra `subscribeRecipes` ble lest fra, fra samme snapshot (#151;
 * Mat #20, ordre 6970785122). Brukes som grunnlag for «Slett», så også felt
 * `parseRecipeFields` utelater, og prioriteter, er med. Klient-SDK-ens
 * `exportVal()` og REST `format=export` gir samme data (lister som `{"0": …}`
 * mot `[…]`). Lagret skjema og `Recipe` endres ikke: koblingen ligger bare
 * her, og forsvinner med oppskriftsobjektet.
 */
const eksportFraAbonnement = new WeakMap<Recipe, unknown>();

/** Eksportgrunnlaget `recipe` ble lest fra, hvis den kom fra `subscribeRecipes`. */
export function eksportGrunnlag(recipe: Recipe): unknown {
  return eksportFraAbonnement.get(recipe);
}

export function subscribeRecipes(
  familyId: FamilyId,
  onChange: (recipes: Recipe[]) => void,
): () => void {
  const recipesRef = ref(getFirebaseDatabase(), recipesPath(familyId));
  const unsubscribe = onValue(recipesRef, (snapshot) => {
    const value = snapshot.exists()
      ? (snapshot.val() as Record<string, Record<string, unknown>>)
      : null;
    onChange(
      value
        ? Object.entries(value).map(([id, fields]) => {
            const recipe: Recipe = { id, ...parseRecipeFields(fields) };
            eksportFraAbonnement.set(recipe, snapshot.child(id).exportVal());
            return recipe;
          })
        : [],
    );
  });
  return unsubscribe;
}

/** Oppretter en ny oppskrift på sin egen node. Ingen les-endre-skriv-risiko ved opprettelse. */
export async function createRecipe(familyId: FamilyId, fields: RecipeFields): Promise<Recipe> {
  const id = crypto.randomUUID();
  await set(ref(getFirebaseDatabase(), recipePath(familyId, id)), fields);
  return { id, ...fields };
}

/**
 * Muterer én oppskrift-node atomisk. `updater` mottar den FAKTISKE,
 * ferskeste server-verdien for noden — aldri en potensielt utdatert
 * lokal/React-kopi — og returnerer den nye verdien, eller `null` for å
 * fjerne noden. Brukes både for vanlig redigering og for
 * `markRecipeCooked` (§domain/recipes/recipes.ts) sin
 * statistikkoppdatering, slik at de to aldri kan overskrive hverandre
 * selv om de treffer samme node nesten samtidig.
 */
export async function transactRecipe(
  familyId: FamilyId,
  id: string,
  updater: (current: RecipeFields | null) => RecipeFields | null,
): Promise<void> {
  await runTransaction(ref(getFirebaseDatabase(), recipePath(familyId, id)), (current) => {
    const raa = current ? (current as Record<string, unknown>) : null;
    const neste = updater(raa ? parseRecipeFields(raa) : null);
    return raa && neste ? medBevarteFelt(raa, neste) : neste;
  });
}

/** Utfallet av `transactRecipeMedUtfall`. */
export type OppskriftSkriveUtfall<U> =
  { type: "lagret" } | { type: "stopp"; utfall: U } | { type: "avvist" } | { type: "ukjent" };

/**
 * Som `transactRecipe`, men med serververifisert utfall (#20 6781074174,
 * review 5851280024). Samme mønster som fryserens `kjorMedUtfall`:
 *
 * - `beregn` får den ferske posten, både tolket og rå, eller `null` når den
 *   mangler (`mangler`).
 *   Den kan skrive en ny post, slette posten (`slett`, #20 6789830224) eller
 *   stoppe.
 * - **Stopp** returnerer gjeldende verdi uendret i stedet for å avbryte. Da
 *   verifiseres den mot serveren før stoppet rapporteres, så en utdatert
 *   lokal cache aldri gir et falskt, definitivt utfall. En post som mangler,
 *   forblir tom og gjenopprettes aldri.
 * - `applyLocally: false`: ingen optimistisk visning før serveren har
 *   bekreftet.
 * - **Lagret** bare når transaksjonen er `committed` med en skriving eller
 *   sletting.
 *   `permission_denied` er `avvist`, og skriver garantert ingenting. Annen
 *   feil eller manglende commit er `ukjent`: da vet vi ikke om skrivingen
 *   nådde serveren. Ingen automatisk nytt forsøk.
 * - Ved skriving flettes resultatet med den rå posten (`medBevarteFelt`, #134).
 */
export async function transactRecipeMedUtfall<U>(
  familyId: FamilyId,
  id: string,
  beregn: (
    current: RecipeFields,
    raa: Readonly<Record<string, unknown>>,
  ) => { type: "skriv"; fields: RecipeFields } | { type: "slett" } | { type: "stopp"; utfall: U },
  mangler: U,
): Promise<OppskriftSkriveUtfall<U>> {
  let stopp = null as { u: U } | null;
  try {
    const res = await runTransaction(
      ref(getFirebaseDatabase(), recipePath(familyId, id)),
      (current) => {
        stopp = null;
        if (!current) {
          stopp = { u: mangler };
          return current;
        }
        const raa = current as Record<string, unknown>;
        const r = beregn(parseRecipeFields(raa), raa);
        if (r.type === "stopp") {
          stopp = { u: r.utfall };
          return current;
        }
        if (r.type === "slett") return null;
        return medBevarteFelt(raa, r.fields);
      },
      { applyLocally: false },
    );
    if (!res.committed) return { type: "ukjent" };
    const s = stopp as { u: U } | null;
    return s ? { type: "stopp", utfall: s.u } : { type: "lagret" };
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown } | null;
    if (/permission[_ ]denied/i.test(String(e?.code ?? e?.message ?? ""))) {
      return { type: "avvist" };
    }
    return { type: "ukjent" };
  }
}

/**
 * Feltene `parseRecipeFields` kjenner. Alt annet på posten er ukjent for appen.
 * `Record<keyof RecipeFields, true>` gjør at et nytt felt i typen gir
 * kompileringsfeil her til det er lagt til.
 */
const KJENTE_FELT: Readonly<Record<keyof RecipeFields, true>> = {
  name: true,
  cat: true,
  tags: true,
  time: true,
  servings: true,
  url: true,
  imageUrl: true,
  source: true,
  instructions: true,
  ingredients: true,
  ingredientGroups: true,
  lastCooked: true,
  timesCooked: true,
  createdAt: true,
  updatedAt: true,
  lettvint: true,
  variationTags: true,
};
const erKjent = (k: string) => Object.hasOwn(KJENTE_FELT, k);

/**
 * Den nye posten slik den skal skrives (#20 6736384489). `parseRecipeFields`
 * tar bare med kjente felt, så uten dette forsvant det lagrede `id`-feltet
 * (som `index.html` leser oppskriftens id fra) og alle andre ukjente felt ved
 * en ordinær redigering eller «Bekreft middag».
 *
 * - **Ukjente rå felt** (f.eks. `id`, også et numerisk `id` fra eldre data)
 *   bevares uendret. `id` legges aldri til der den mangler.
 * - **Updaterens resultat** skrives som før, så tilsiktet tømming virker
 *   uendret: `[]`/`null` lagres ikke av RTDB, og et kjent felt updateren
 *   utelater, forsvinner.
 * - **`undefined`** i et kjent felt betyr «finnes ikke» og utelates. Parseren
 *   gir `undefined` for kjente felt eldre poster mangler (f.eks. `source`,
 *   `createdAt`), og RTDB avviser hele transaksjonen hvis de sendes med.
 */
export function medBevarteFelt(
  raa: Record<string, unknown>,
  neste: RecipeFields,
): Record<string, unknown> {
  return Object.fromEntries([
    ...Object.entries(raa).filter(([k]) => !erKjent(k)),
    ...Object.entries(neste).filter(([, v]) => v !== undefined),
  ]);
}

/** Fjerner én oppskrift i sin helhet. Ingen les-endre-skriv-risiko ved en ubetinget sletting. */
export async function deleteRecipe(familyId: FamilyId, id: string): Promise<void> {
  await remove(ref(getFirebaseDatabase(), recipePath(familyId, id)));
}

/** Utfallet av `slettRecipeVersjonert`. */
export type OppskriftSletteUtfall<U> =
  | { type: "lagret" }
  | { type: "stopp"; utfall: U }
  | { type: "konflikt" }
  | { type: "mangler" }
  | { type: "avvist" }
  | { type: "ikkeLest" }
  | { type: "ukjent" };

/** Avgrenset ventetid for hele «Slett» (samme frist som #175–#177). */
export const OPPSKRIFT_FRIST_MS = 15_000;

class SletteAvvist extends Error {}
class SletteStoppet extends Error {}

/** Fristen og om en sletting er sendt, delt i ett forsøk. */
interface SletteVakt {
  stoppet: boolean;
  sendt: boolean;
  signal: AbortSignal;
}

/** REST mot eksakt `families/{familyId}/recipes/{id}`: GET i eksportform med ETag, eller DELETE med `if-match`. */
async function oppskriftRest(
  familyId: FamilyId,
  id: string,
  vakt: SletteVakt,
  sletting?: { etag: string },
): Promise<Response> {
  const bruker = getFirebaseAuth().currentUser;
  if (!bruker) throw new SletteAvvist("ikke innlogget");
  const url = databaseRestUrl(recipePath(familyId, id));
  const token = await bruker.getIdToken();
  // Et sent token etter fristen fører aldri til en forespørsel.
  if (vakt.stoppet) throw new SletteStoppet();
  url.searchParams.set("auth", token);
  if (!sletting) {
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
    method: "DELETE",
    cache: "no-store",
    credentials: "omit",
    headers: { "if-match": sletting.etag },
    signal: vakt.signal,
  });
}

/**
 * «Slett» i Kokeboken med versjonsbetinget sletting på eksakt
 * familie/oppskrift (Mat #20, ordre 6970785122; mønster fra #177). Erstatter
 * slettegrenen i `transactRecipeMedUtfall`, der grunnlaget var `val()` (uten
 * prioriteter) og et stopp ble verifisert med en commit:
 *
 * 1. Les oppskriften FERSKT fra serveren i eksportform med ETag (skrivefri).
 * 2. Mangler den: `mangler`. Ellers avgjør `beslutt` (domenets
 *    `slettHvisUendret`) mot eksportgrunnlaget detaljen viste; et stopp gir
 *    sitt utfall. Ingen av dem skriver noe — bare GET er sendt.
 * 3. Ellers sendes DELETE med `if-match`. 412 betyr at oppskriften er endret
 *    mellom lesing og sletting (også bare en prioritet): `konflikt`, sikkert
 *    ikke slettet, og ingen ny runde.
 *
 * Hele forsøket — autentisering, lesing og sletting — har en frist
 * (`fristMs`). Ved utløp avbrytes ventende forespørsler, og en stoppvakt
 * hindrer at et sent token eller en sen lesing starter en sletting. Utfallet
 * er da `ikkeLest` (ingenting slettet) hvis ingen sletting var sendt, ellers
 * `ukjent`. 401/403 og ikke innlogget er `avvist`. Ingen automatisk nytt
 * forsøk. Redigering bruker fortsatt `transactRecipeMedUtfall`, uendret.
 */
export async function slettRecipeVersjonert<U>(
  familyId: FamilyId,
  id: string,
  beslutt: (eksport: unknown) => { type: "slett" } | { type: "stopp"; utfall: U },
  valg: { fristMs?: number } = {},
): Promise<OppskriftSletteUtfall<U>> {
  const styring = new AbortController();
  const vakt: SletteVakt = { stoppet: false, sendt: false, signal: styring.signal };
  let tidtaker: ReturnType<typeof setTimeout> | undefined;
  const frist = new Promise<OppskriftSletteUtfall<U>>((resolve) => {
    tidtaker = setTimeout(() => {
      vakt.stoppet = true;
      resolve({ type: vakt.sendt ? "ukjent" : "ikkeLest" });
      styring.abort();
    }, valg.fristMs ?? OPPSKRIFT_FRIST_MS);
  });
  try {
    return await Promise.race([slettEnGang(familyId, id, beslutt, vakt), frist]);
  } finally {
    clearTimeout(tidtaker);
  }
}

async function slettEnGang<U>(
  familyId: FamilyId,
  id: string,
  beslutt: (eksport: unknown) => { type: "slett" } | { type: "stopp"; utfall: U },
  vakt: SletteVakt,
): Promise<OppskriftSletteUtfall<U>> {
  let etag: string | null;
  let eksport: unknown;
  try {
    const res = await oppskriftRest(familyId, id, vakt);
    if (res.status === 401 || res.status === 403) return { type: "avvist" };
    if (!res.ok) return { type: "ikkeLest" };
    etag = res.headers.get("ETag");
    if (!etag) return { type: "ikkeLest" };
    eksport = await res.json();
  } catch (err) {
    if (err instanceof SletteAvvist) return { type: "avvist" };
    if (!vakt.stoppet) console.error("[Kokebok] lesing før sletting feilet:", err);
    return { type: "ikkeLest" };
  }
  // Fristen kan ha gått ut mens lesingen pågikk: da avgjøres og sendes ingenting.
  if (vakt.stoppet) return { type: "ikkeLest" };
  if (eksport === null || eksport === undefined) return { type: "mangler" };
  const b = beslutt(eksport);
  if (b.type === "stopp") return { type: "stopp", utfall: b.utfall };

  let res: Response;
  try {
    res = await oppskriftRest(familyId, id, vakt, { etag });
  } catch (err) {
    if (err instanceof SletteStoppet) return { type: "ikkeLest" };
    if (err instanceof SletteAvvist) return { type: "avvist" };
    if (!vakt.stoppet) console.error("[Kokebok] svar på sletting uteble:", err);
    return { type: vakt.sendt ? "ukjent" : "ikkeLest" };
  }
  if (res.status === 412) return { type: "konflikt" };
  if (res.status === 401 || res.status === 403) return { type: "avvist" };
  return res.ok ? { type: "lagret" } : { type: "ukjent" };
}
