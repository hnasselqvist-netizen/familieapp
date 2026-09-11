/**
 * Datalag for brukerdefinerte hendelser (Middagsplan v1, §types/mealEvent.ts)
 * — `families/{familyId}/mealEvents/{id}`. Speiler `mealLibrary.repository.ts`
 * sitt mønster for et flatt katalog-element (ingen nøstede arrays å
 * transaksjonere over her, ulikt `mealLibrary`/`meals` sine
 * `shoppingBase[]`/`recipes[]` — en ren/rediger/fjern-ett-felt er derfor
 * en enkel `update`/`remove`, ikke `runTransaction`).
 */
import { onValue, ref, remove, set, update } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { MealEventOption } from "@app-types/mealEvent";

function mealEventsPath(familyId: FamilyId): string {
  return `families/${familyId}/mealEvents`;
}

function mealEventPath(familyId: FamilyId, id: string): string {
  return `${mealEventsPath(familyId)}/${id}`;
}

function parseMealEvent(id: string, raw: Record<string, unknown>): MealEventOption {
  return {
    id,
    name: raw.name as string,
    ...(raw.emoji !== undefined ? { emoji: raw.emoji as string } : {}),
  };
}

/** Abonnerer på hele den brukerdefinerte hendelseskatalogen. Returnerer en avmeldingsfunksjon. */
export function subscribeMealEvents(
  familyId: FamilyId,
  onChange: (events: MealEventOption[]) => void,
): () => void {
  const eventsRef = ref(getFirebaseDatabase(), mealEventsPath(familyId));
  const unsubscribe = onValue(eventsRef, (snapshot) => {
    if (!snapshot.exists()) {
      onChange([]);
      return;
    }
    const value = snapshot.val() as Record<string, Record<string, unknown>>;
    onChange(Object.entries(value).map(([id, fields]) => parseMealEvent(id, fields)));
  });
  return unsubscribe;
}

/** Oppretter en ny, brukerdefinert hendelse. */
export async function createMealEvent(
  familyId: FamilyId,
  event: { name: string; emoji?: string },
): Promise<MealEventOption> {
  const id = crypto.randomUUID();
  await set(ref(getFirebaseDatabase(), mealEventPath(familyId, id)), {
    name: event.name,
    ...(event.emoji !== undefined ? { emoji: event.emoji } : {}),
  });
  return { id, name: event.name, ...(event.emoji !== undefined ? { emoji: event.emoji } : {}) };
}

/** Oppdaterer navn/emoji på en brukerdefinert hendelse — kun de gitte feltene endres. */
export async function updateMealEvent(
  familyId: FamilyId,
  id: string,
  patch: Partial<Pick<MealEventOption, "name" | "emoji">>,
): Promise<void> {
  await update(ref(getFirebaseDatabase(), mealEventPath(familyId, id)), patch);
}

/** Fjerner en brukerdefinert hendelse fra katalogen. Rører ALDRI dager som allerede er satt til denne hendelsen — de beholder sin lagrede `{type:"event",name,emoji}}` uavhengig av katalogens innhold. */
export async function removeMealEvent(familyId: FamilyId, id: string): Promise<void> {
  await remove(ref(getFirebaseDatabase(), mealEventPath(familyId, id)));
}
