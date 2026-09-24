/**
 * Datalag-/integrasjonstest — snakker med en EKTE Firebase Emulator
 * Suite-instans (RTDB + Auth), aldri med produksjon eller en
 * Hosting-forhåndsvisning. Kjøres via `npm run test:integration`. Se
 * freezer.repository.integration.test.ts for medlemskaps-/sikkerhets-
 * regeltesten — ikke duplisert her, samme regel gjelder alle stier
 * under `families/{familyId}`.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { get, ref } from "firebase/database";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activateAnnualBudgetDetails,
  addAnnualBudgetDetail,
  applyAnnualRestOfYear,
  applyAnnualRestOfYearToDetail,
  removeAnnualBudgetDetail,
  removeAnnualBudgetDetailLevel,
  renameAnnualBudgetDetail,
  spreadAnnualYearlyAmount,
  subscribeAnnualPlans,
  updateAnnualBudgetDetailMonth,
  updateAnnualItemMonth,
  updateAnnualPlanSliceTransactional,
} from "./arsbudsjett.repository";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import type { AnnualPlansByYear } from "@app-types/arsbudsjett";

const FAMILY_ID = "familie1";
const YEAR = 2099; // et år langt utenfor CURRENT_BUDGET_YEAR-nærheten, kolliderer aldri med andre tester
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;

let adminApp: AdminApp;

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "arsbudsjett-integration-test-admin",
  );

  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await getAdminDatabase(adminApp).ref(`families/${FAMILY_ID}/members/${uid}`).set(true);

  const customToken = await getAdminAuth(adminApp).createCustomToken(uid);
  await signInWithCustomToken(getFirebaseAuth(), customToken);
});

afterAll(async () => {
  await getAdminDatabase(adminApp).ref(`families/${FAMILY_ID}/annualBudgetPlans`).remove();
  await deleteApp(adminApp);
});

function waitForAnnualPlans(predicate: (plans: AnnualPlansByYear) => boolean) {
  return new Promise<void>((resolve) => {
    // Samme TDZ-unngåelse som budsjettfamilie.repository.integration.test.ts
    // sin waitForBudgetGroups — se den filens kommentar for begrunnelsen.
    let unsubscribe: (() => void) | null = null;
    let settled = false;
    unsubscribe = subscribeAnnualPlans(FAMILY_ID, (plans) => {
      if (!predicate(plans)) return;
      settled = true;
      resolve();
      unsubscribe?.();
    });
    if (settled) unsubscribe();
  });
}

describe("arsbudsjett.repository (emulator)", () => {
  it("updateAnnualItemMonth oppretter nødvendige mellomliggende noder for et år som ikke finnes fra før", async () => {
    const groupId = randomUUID();
    const itemId = randomUUID();

    await updateAnnualItemMonth(FAMILY_ID, YEAR, "costs", groupId, itemId, 3, 500);

    // v-mat-varebase-1.1: "ingen eager scaffold" (§filens toppkommentar)
    // betyr at måned 0-2 ALDRI fysisk skrives til Firebase — det er
    // parseren (parseAnnualPlanEntry, brukt av subscribeAnnualPlans under)
    // som normaliserer fravær til budget:0 for appen. Et rått
    // snapshot-lesing av months[0] ville derfor IKKE gitt {budget:0}
    // (RTDB gir enten et hull eller null der ingenting er skrevet) — vi
    // verifiserer derfor "urørt/aldri skrevet" via den parsede formen,
    // ikke via en rå snapshot-antakelse om array-oppfylling.
    let parsed: { months: { budget: number }[] } | undefined;
    await waitForAnnualPlans((p) => {
      const entry = p[YEAR]?.costs?.[groupId]?.[itemId];
      if (entry?.months[3]?.budget !== 500) return false;
      parsed = entry;
      return true;
    });
    expect(parsed?.months[3]?.budget).toBe(500);
    expect(parsed?.months[0]?.budget).toBe(0);
  });

  it("spreadAnnualYearlyAmount og applyAnnualRestOfYear er målrettede flerfelts-skrivinger, uten å røre andre poster", async () => {
    const groupId = randomUUID();
    const spreadItemId = randomUUID();
    const restItemId = randomUUID();
    const uroertItemId = randomUUID();

    await updateAnnualItemMonth(FAMILY_ID, YEAR, "income", groupId, uroertItemId, 0, 42);
    await waitForAnnualPlans(
      (p) => p[YEAR]?.income?.[groupId]?.[uroertItemId]?.months[0]?.budget === 42,
    );

    await spreadAnnualYearlyAmount(FAMILY_ID, YEAR, "income", groupId, spreadItemId, 1000);
    await waitForAnnualPlans(
      (p) => p[YEAR]?.income?.[groupId]?.[spreadItemId]?.months[0]?.budget === 83,
    );

    await updateAnnualItemMonth(FAMILY_ID, YEAR, "income", groupId, restItemId, 0, 10);
    await applyAnnualRestOfYear(FAMILY_ID, YEAR, "income", groupId, restItemId, 6, 500);
    await waitForAnnualPlans(
      (p) => p[YEAR]?.income?.[groupId]?.[restItemId]?.months[6]?.budget === 500,
    );

    const snapshot = await get(
      ref(
        getFirebaseDatabase(),
        `families/${FAMILY_ID}/annualBudgetPlans/${YEAR}/income/${groupId}`,
      ),
    );
    const value = snapshot.val() as {
      [itemId: string]: { months: { budget: number }[] };
    };
    expect(value[spreadItemId]?.months.slice(0, 11).every((m) => m.budget === 83)).toBe(true);
    expect(value[spreadItemId]?.months[11]?.budget).toBe(83 + (1000 - 83 * 12));
    // restItemId hadde KUN måned 0 skrevet (via updateAnnualItemMonth) før
    // applyAnnualRestOfYear satte måned 6-11 — måned 1-5 er derfor aldri
    // fysisk skrevet (sparse hull, "ingen eager scaffold"). Et
    // `.slice(0,6).every(...)`-uttrykk her ville stille validert dette,
    // siden `Array.prototype.every` HOPPER OVER hull i et sparse array i
    // stedet for å kalle callbacken — sjekker derfor kun den ene faktisk
    // skrevne måneden eksplisitt.
    expect(value[restItemId]?.months[0]?.budget).toBe(10);
    expect(value[restItemId]?.months.slice(6).every((m) => m.budget === 500)).toBe(true);
    expect(value[uroertItemId]?.months[0]?.budget).toBe(42); // uendret av de to andre skrivingene
  });

  it("activateAnnualBudgetDetails/addAnnualBudgetDetail/updateAnnualBudgetDetailMonth/renameAnnualBudgetDetail/removeAnnualBudgetDetail summerer months på nytt ved hver endring", async () => {
    const groupId = randomUUID();
    const itemId = randomUUID();

    await activateAnnualBudgetDetails(FAMILY_ID, YEAR, "costs", groupId, itemId);
    await waitForAnnualPlans(
      (p) => (p[YEAR]?.costs?.[groupId]?.[itemId]?.budgetDetails?.length ?? 0) === 1,
    );
    let snapshot = await get(
      ref(
        getFirebaseDatabase(),
        `families/${FAMILY_ID}/annualBudgetPlans/${YEAR}/costs/${groupId}/${itemId}`,
      ),
    );
    let value = snapshot.val() as {
      months: { budget: number }[];
      budgetDetails: { id: string }[];
    };
    expect(value.budgetDetails).toHaveLength(1);
    expect(value.months.every((m) => m.budget === 0)).toBe(true);
    const forsteDetaljId = value.budgetDetails[0]!.id;

    // No-op andre gang.
    await activateAnnualBudgetDetails(FAMILY_ID, YEAR, "costs", groupId, itemId);
    snapshot = await get(
      ref(
        getFirebaseDatabase(),
        `families/${FAMILY_ID}/annualBudgetPlans/${YEAR}/costs/${groupId}/${itemId}`,
      ),
    );
    value = snapshot.val() as { months: { budget: number }[]; budgetDetails: { id: string }[] };
    expect(value.budgetDetails).toHaveLength(1);
    expect(value.budgetDetails[0]!.id).toBe(forsteDetaljId);

    await addAnnualBudgetDetail(FAMILY_ID, YEAR, "costs", groupId, itemId);
    await waitForAnnualPlans(
      (p) => (p[YEAR]?.costs?.[groupId]?.[itemId]?.budgetDetails?.length ?? 0) === 2,
    );
    snapshot = await get(
      ref(
        getFirebaseDatabase(),
        `families/${FAMILY_ID}/annualBudgetPlans/${YEAR}/costs/${groupId}/${itemId}`,
      ),
    );
    const andreDetaljId = (
      snapshot.val() as { budgetDetails: { id: string }[] }
    ).budgetDetails.find((d) => d.id !== forsteDetaljId)!.id;

    await updateAnnualBudgetDetailMonth(
      FAMILY_ID,
      YEAR,
      "costs",
      groupId,
      itemId,
      forsteDetaljId,
      0,
      100,
    );
    await updateAnnualBudgetDetailMonth(
      FAMILY_ID,
      YEAR,
      "costs",
      groupId,
      itemId,
      andreDetaljId,
      0,
      50,
    );
    await waitForAnnualPlans((p) => p[YEAR]?.costs?.[groupId]?.[itemId]?.months[0]?.budget === 150);

    await renameAnnualBudgetDetail(
      FAMILY_ID,
      YEAR,
      "costs",
      groupId,
      itemId,
      forsteDetaljId,
      "Strøm",
    );
    await waitForAnnualPlans(
      (p) =>
        p[YEAR]?.costs?.[groupId]?.[itemId]?.budgetDetails?.find((d) => d.id === forsteDetaljId)
          ?.name === "Strøm",
    );

    await removeAnnualBudgetDetail(FAMILY_ID, YEAR, "costs", groupId, itemId, andreDetaljId);
    await waitForAnnualPlans((p) => p[YEAR]?.costs?.[groupId]?.[itemId]?.months[0]?.budget === 100);

    snapshot = await get(
      ref(
        getFirebaseDatabase(),
        `families/${FAMILY_ID}/annualBudgetPlans/${YEAR}/costs/${groupId}/${itemId}`,
      ),
    );
    const sluttverdi = snapshot.val() as {
      months: { budget: number }[];
      budgetDetails: { id: string; name: string }[];
    };
    expect(sluttverdi.budgetDetails).toHaveLength(1);
    expect(sluttverdi.budgetDetails[0]!.name).toBe("Strøm");
    expect(sluttverdi.months[0]?.budget).toBe(100);
  });

  it("applyAnnualRestOfYearToDetail setter verdi på ÉN detalj fra valgt måned, summerer months på nytt", async () => {
    const groupId = randomUUID();
    const itemId = randomUUID();
    await activateAnnualBudgetDetails(FAMILY_ID, YEAR, "costs", groupId, itemId);
    await waitForAnnualPlans(
      (p) => (p[YEAR]?.costs?.[groupId]?.[itemId]?.budgetDetails?.length ?? 0) === 1,
    );
    const snapshot = await get(
      ref(
        getFirebaseDatabase(),
        `families/${FAMILY_ID}/annualBudgetPlans/${YEAR}/costs/${groupId}/${itemId}`,
      ),
    );
    const detailId = (snapshot.val() as { budgetDetails: { id: string }[] }).budgetDetails[0]!.id;

    await applyAnnualRestOfYearToDetail(
      FAMILY_ID,
      YEAR,
      "costs",
      groupId,
      itemId,
      detailId,
      6,
      200,
    );
    await waitForAnnualPlans((p) => p[YEAR]?.costs?.[groupId]?.[itemId]?.months[6]?.budget === 200);

    const etter = await get(
      ref(
        getFirebaseDatabase(),
        `families/${FAMILY_ID}/annualBudgetPlans/${YEAR}/costs/${groupId}/${itemId}`,
      ),
    );
    const value = etter.val() as { months: { budget: number }[] };
    expect(value.months.slice(0, 6).every((m) => m.budget === 0)).toBe(true);
    expect(value.months.slice(6).every((m) => m.budget === 200)).toBe(true);
  });

  it("removeAnnualBudgetDetailLevel beholder dagens summerte months, fjerner kun budgetDetails", async () => {
    const groupId = randomUUID();
    const itemId = randomUUID();
    await activateAnnualBudgetDetails(FAMILY_ID, YEAR, "costs", groupId, itemId);
    await waitForAnnualPlans(
      (p) => (p[YEAR]?.costs?.[groupId]?.[itemId]?.budgetDetails?.length ?? 0) === 1,
    );
    const snapshot = await get(
      ref(
        getFirebaseDatabase(),
        `families/${FAMILY_ID}/annualBudgetPlans/${YEAR}/costs/${groupId}/${itemId}`,
      ),
    );
    const detailId = (snapshot.val() as { budgetDetails: { id: string }[] }).budgetDetails[0]!.id;
    await updateAnnualBudgetDetailMonth(
      FAMILY_ID,
      YEAR,
      "costs",
      groupId,
      itemId,
      detailId,
      0,
      250,
    );
    await waitForAnnualPlans((p) => p[YEAR]?.costs?.[groupId]?.[itemId]?.months[0]?.budget === 250);

    await removeAnnualBudgetDetailLevel(FAMILY_ID, YEAR, "costs", groupId, itemId);
    await waitForAnnualPlans(
      (p) => p[YEAR]?.costs?.[groupId]?.[itemId]?.budgetDetails === undefined,
    );

    const etter = await get(
      ref(
        getFirebaseDatabase(),
        `families/${FAMILY_ID}/annualBudgetPlans/${YEAR}/costs/${groupId}/${itemId}`,
      ),
    );
    const value = etter.val() as { months: { budget: number }[]; budgetDetails?: unknown };
    expect(value.budgetDetails).toBeUndefined();
    expect(value.months[0]?.budget).toBe(250);
  });

  it("updateAnnualPlanSliceTransactional endrer kun ett år+type i ett kall, uten å røre andre typer/år", async () => {
    const otherYear = YEAR - 1;
    await updateAnnualItemMonth(FAMILY_ID, otherYear, "savings", "buffer", "urort", 0, 999);
    await waitForAnnualPlans(
      (p) => p[otherYear]?.savings?.buffer?.urort?.months[0]?.budget === 999,
    );

    await updateAnnualPlanSliceTransactional(FAMILY_ID, YEAR, "costs", (current) => ({
      ...current,
      bolig: {
        ...current.bolig,
        p1: { months: Array.from({ length: 12 }, () => ({ budget: 0 })) },
      },
    }));
    await waitForAnnualPlans((p) => p[YEAR]?.costs?.bolig?.p1 !== undefined);

    const urort = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/annualBudgetPlans/${otherYear}/savings`),
    );
    expect(
      (urort.val() as { buffer: { urort: { months: { budget: number }[] } } }).buffer.urort
        .months[0]?.budget,
    ).toBe(999);
  });

  it("updateAnnualPlanSliceTransactional bruker den FAKTISKE server-skiven ved commit — en samtidig endring fra en annen klient overlever, manglende detaljstruktur legges til (§Kontrolltårn-review, PR #38)", async () => {
    const groupId = randomUUID();
    const eksisterendeItemId = randomUUID();
    const manglerDetaljerItemId = randomUUID();

    // "Andre klient" skriver en månedsendring til SAMME år+type FØR den
    // guardede "Hent manglende detaljer"-handlingen committer —
    // simulerer at et React-snapshot lest FØR denne skrivingen ville
    // vært foreldet ved commit-tidspunkt.
    await updateAnnualItemMonth(FAMILY_ID, YEAR, "costs", groupId, eksisterendeItemId, 3, 750);
    await waitForAnnualPlans(
      (p) => p[YEAR]?.costs?.[groupId]?.[eksisterendeItemId]?.months[3]?.budget === 750,
    );

    // updateren legger til detalj-STRUKTUR kun på poster som ikke
    // allerede har det i `current` (den faktiske server-skiven ved
    // commit-tidspunkt) — speiler formen på hentManglendeDetaljerFraKilde
    // sin bruk i useArsbudsjett.hentManglendeDetaljer, uten å importere
    // domain/ herfra (§data/ kan ikke importere domain/,
    // web/eslint.config.js — domenelagets egen logikk er allerede
    // karakterisert i domain/arsbudsjett/arsbudsjett.test.ts).
    await updateAnnualPlanSliceTransactional(FAMILY_ID, YEAR, "costs", (current) => {
      const gruppe = current[groupId] ?? {};
      return {
        ...current,
        [groupId]: {
          ...gruppe,
          [manglerDetaljerItemId]: gruppe[manglerDetaljerItemId] ?? {
            months: Array.from({ length: 12 }, () => ({ budget: 0 })),
            budgetDetails: [
              {
                id: "d1",
                name: "Ny detalj",
                months: Array.from({ length: 12 }, () => ({ budget: 0 })),
              },
            ],
          },
        },
      };
    });
    await waitForAnnualPlans(
      (p) => p[YEAR]?.costs?.[groupId]?.[manglerDetaljerItemId]?.budgetDetails !== undefined,
    );

    const snapshot = await get(
      ref(
        getFirebaseDatabase(),
        `families/${FAMILY_ID}/annualBudgetPlans/${YEAR}/costs/${groupId}`,
      ),
    );
    const value = snapshot.val() as {
      [itemId: string]: { months: { budget: number }[]; budgetDetails?: unknown };
    };
    // Den samtidige endringen overlevde — transaksjonen las faktisk
    // servertilstand ved commit, ikke et snapshot lest før den skjedde.
    expect(value[eksisterendeItemId]?.months[3]?.budget).toBe(750);
    // Den manglende detaljstrukturen ble lagt til på den andre posten.
    expect(value[manglerDetaljerItemId]?.budgetDetails).toBeDefined();
  });
});
