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
 */
import { onValue, ref, remove, runTransaction, set } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
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
  };
}

/** Abonnerer på hele kokeboken. Returnerer en avmeldingsfunksjon. */
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
        ? Object.entries(value).map(([id, fields]) => ({ id, ...parseRecipeFields(fields) }))
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
  await runTransaction(ref(getFirebaseDatabase(), recipePath(familyId, id)), (current) =>
    updater(current ? parseRecipeFields(current as Record<string, unknown>) : null),
  );
}

/** Fjerner én oppskrift i sin helhet. Ingen les-endre-skriv-risiko ved en ubetinget sletting. */
export async function deleteRecipe(familyId: FamilyId, id: string): Promise<void> {
  await remove(ref(getFirebaseDatabase(), recipePath(familyId, id)));
}
