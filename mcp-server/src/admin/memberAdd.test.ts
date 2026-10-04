import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memoryStore";
import {
  type AddMemberRequest,
  type AuthDirectory,
  type AuthUserInfo,
  type MemberDb,
  type MemberFacts,
  planAddMember,
  resolveProjectId,
  runAddMember,
  validateAddMember,
} from "./memberAdd";

const helen: AuthUserInfo = {
  uid: "uidHelen1",
  email: "helen@example.no",
  emailVerified: true,
  displayName: "Helen",
  disabled: false,
  providers: ["password"],
  createdAt: "Sat, 01 Jan 2022 10:00:00 GMT",
  lastSignInAt: "Sat, 04 Oct 2026 09:00:00 GMT",
};
const req: AddMemberRequest = { familyId: "familie1", email: "helen@example.no" };
const facts = (o: Partial<MemberFacts> = {}): MemberFacts => ({
  user: helen,
  familyExists: true,
  current: null,
  ...o,
});

describe("validateAddMember", () => {
  it("godtar e-post eller uid, men ikke begge eller ingen", () => {
    expect(validateAddMember(req)).toBeNull();
    expect(validateAddMember({ familyId: "familie1", uid: "uidHelen1" })).toBeNull();
    expect(validateAddMember({ familyId: "familie1", uid: "a", email: "a@b.no" })).toMatch(
      /ikke begge/,
    );
    expect(validateAddMember({ familyId: "familie1" })).toMatch(/Oppgi --email/);
  });

  it("meldingen sier hva som er galt: mellomrom i kantene, ugyldig form", () => {
    expect(validateAddMember({ ...req, email: " helen@example.no" })).toBe(
      "e-post har mellomrom i kantene.",
    );
    expect(validateAddMember({ ...req, email: "ikke-en-epost" })).toBe("e-post har ugyldig form.");
  });

  it("avviser ugyldig familyId, e-post og uid", () => {
    for (const bad of [
      { ...req, familyId: "" },
      { ...req, familyId: "../annen" },
      { ...req, familyId: "fam/ilie" },
      { ...req, email: "" },
      { ...req, email: " helen@example.no" },
      { ...req, email: "helen@example.no " },
      { ...req, email: "ikke-en-epost" },
      { ...req, email: "a@b" },
      { ...req, email: `${"a".repeat(250)}@b.no` },
      { familyId: "familie1", uid: "" },
      { familyId: "familie1", uid: " uid" },
      { familyId: "familie1", uid: "a/b" },
      { familyId: "familie1", uid: "a.b" },
      { familyId: "familie1", uid: "x".repeat(129) },
      { ...req, expectUid: "a/b" },
    ] as AddMemberRequest[]) {
      expect(validateAddMember(bad), JSON.stringify(bad)).not.toBeNull();
    }
  });
});

describe("planAddMember", () => {
  it("oppretter ett medlemskap for en aktiv bruker i en eksisterende familie", () => {
    // Nøyaktig denne formen, og ingenting ekstra.
    expect(planAddMember(req, facts())).toEqual({
      action: "create",
      path: "families/familie1/members/uidHelen1",
      next: true,
      user: helen,
      current: null,
    });
  });

  it("e-post sammenlignes uten hensyn til store/små bokstaver", () => {
    expect(planAddMember({ ...req, email: "Helen@Example.NO" }, facts()).action).toBe("create");
  });

  it("avslår når brukeren ikke finnes", () => {
    expect(planAddMember(req, facts({ user: null }))).toMatchObject({
      action: "refuse",
      reason: expect.stringContaining("helen@example.no"),
    });
    expect(
      planAddMember({ familyId: "familie1", uid: "ukjent" }, facts({ user: null })),
    ).toMatchObject({ action: "refuse", reason: expect.stringContaining("uid ukjent") });
  });

  it("avslår når oppslaget ikke gir det som ble bedt om (e-post, uid, expect-uid)", () => {
    const annen = { ...helen, uid: "uidAnnen", email: "annen@example.no" };
    expect(planAddMember(req, facts({ user: annen })).action).toBe("refuse");
    expect(
      planAddMember({ familyId: "familie1", uid: "uidHelen1" }, facts({ user: annen })).action,
    ).toBe("refuse");
    expect(planAddMember({ ...req, expectUid: "uidAnnen" }, facts())).toMatchObject({
      action: "refuse",
      reason: expect.stringContaining("--expect-uid"),
    });
    expect(planAddMember({ ...req, expectUid: "uidHelen1" }, facts()).action).toBe("create");
  });

  it("avslår en deaktivert bruker og en familie som ikke finnes", () => {
    expect(planAddMember(req, facts({ user: { ...helen, disabled: true } })).action).toBe("refuse");
    expect(planAddMember(req, facts({ familyExists: false }))).toMatchObject({
      action: "refuse",
      reason: expect.stringContaining("Oppretter aldri en ny familie"),
    });
  });

  it("rører aldri et eksisterende medlemskap: true er uendret, false overskrives ikke", () => {
    expect(planAddMember(req, facts({ current: true })).action).toBe("unchanged");
    // Samme regel som isFamilyMember: alt som ikke er null/false er medlemskap.
    expect(planAddMember(req, facts({ current: { rolle: "x" } })).action).toBe("unchanged");
    expect(planAddMember(req, facts({ current: false }))).toMatchObject({
      action: "refuse",
      reason: expect.stringContaining("false"),
    });
  });

  it("uid med tegn RTDB koder, får samme sti som serveren slår opp", () => {
    // memberPath koder uid; `validateAddMember` slipper bare trygge tegn gjennom,
    // så stien er alltid ukodet i praksis — men bygges likevel med serverens funksjon.
    expect(
      planAddMember(
        { familyId: "familie1", uid: "a_b-C9" },
        facts({ user: { ...helen, uid: "a_b-C9" } }),
      ),
    ).toMatchObject({ path: "families/familie1/members/a_b-C9" });
  });

  it("avslår ugyldig input før noe annet", () => {
    expect(planAddMember({ ...req, familyId: "../x" }, facts()).action).toBe("refuse");
  });
});

describe("runAddMember", () => {
  let store: MemoryStore;
  let calls: string[];
  let db: MemberDb;
  let auth: AuthDirectory;
  const users = new Map<string, AuthUserInfo>([[helen.uid, helen]]);

  beforeEach(() => {
    store = new MemoryStore();
    store.set("families/familie1/shopping/a", { id: "a", name: "Melk" });
    store.set("families/familie1/members/uidEivind", true);
    store.set("mcp/principals/auth0|x", { firebaseUid: "uidEivind", familyId: "familie1" });
    calls = [];
    db = {
      get: async (p) => (calls.push(`get ${p}`), store.get(p)),
      set: async (p, v) => (calls.push(`set ${p}`), store.set(p, v)),
      familyExists: async (f) => (
        calls.push(`familyExists ${f}`),
        store.get(`families/${f}`) !== null
      ),
    };
    auth = {
      byUid: async (uid) => (calls.push(`byUid ${uid}`), users.get(uid) ?? null),
      byEmail: async (email) => (
        calls.push(`byEmail ${email}`),
        [...users.values()].find((u) => u.email === email.toLowerCase()) ?? null
      ),
    };
  });

  const snapshot = () => JSON.stringify([store.get("families"), store.get("mcp")]);

  it("tørrkjøring skriver ingenting og viser identiteten", async () => {
    const foer = snapshot();
    const r = await runAddMember(db, auth, req, false);
    expect(r).toMatchObject({
      action: "create",
      applied: false,
      user: { email: "helen@example.no", displayName: "Helen", providers: ["password"] },
    });
    expect(snapshot()).toBe(foer);
    expect(calls.filter((c) => c.startsWith("set"))).toEqual([]);
  });

  it("--apply skriver nøyaktig ett medlemskap, og ingenting annet endres", async () => {
    const foer = JSON.parse(snapshot()) as [Record<string, unknown>, unknown];
    const r = await runAddMember(db, auth, req, true);
    expect(r).toMatchObject({ action: "create", applied: true });
    expect(calls.filter((c) => c.startsWith("set"))).toEqual([
      "set families/familie1/members/uidHelen1",
    ]);
    expect(store.get("families/familie1/members/uidHelen1")).toBe(true);

    // Resten av treet er identisk: kun den ene nye noden er lagt til.
    const etter = JSON.parse(snapshot()) as [
      { familie1: { members: Record<string, unknown> } },
      unknown,
    ];
    delete etter[0].familie1.members.uidHelen1;
    expect(etter).toEqual(foer);
  });

  it("er idempotent: andre --apply er «unchanged» og skriver ikke", async () => {
    await runAddMember(db, auth, req, true);
    calls.length = 0;
    expect(await runAddMember(db, auth, req, true)).toMatchObject({
      action: "unchanged",
      applied: false,
    });
    expect(calls.filter((c) => c.startsWith("set"))).toEqual([]);
  });

  it("slår opp via uid også, og --expect-uid fester resultatet", async () => {
    expect(
      await runAddMember(db, auth, { familyId: "familie1", uid: "uidHelen1" }, false),
    ).toMatchObject({ action: "create" });
    expect(await runAddMember(db, auth, { ...req, expectUid: "annen" }, true)).toMatchObject({
      action: "refuse",
      applied: false,
    });
    expect(store.get("families/familie1/members/uidHelen1")).toBeNull();
  });

  it("ukjent bruker: avslår uten å lese eller skrive i databasen", async () => {
    const r = await runAddMember(
      db,
      auth,
      { familyId: "familie1", email: "ukjent@example.no" },
      true,
    );
    expect(r).toMatchObject({ action: "refuse", applied: false });
    expect(calls).toEqual(["byEmail ukjent@example.no"]);
  });

  it("ugyldig input: ingen I/O i det hele tatt", async () => {
    const r = await runAddMember(db, auth, { familyId: "../x", email: "helen@example.no" }, true);
    expect(r).toMatchObject({ action: "refuse", applied: false });
    expect(calls).toEqual([]);
  });

  it("familie som ikke finnes: avslag og ingen «spøkelsesfamilie»", async () => {
    const r = await runAddMember(db, auth, { ...req, familyId: "famlie1" }, true);
    expect(r).toMatchObject({ action: "refuse", applied: false });
    expect(store.get("families/famlie1")).toBeNull();
    expect(calls.filter((c) => c.startsWith("set"))).toEqual([]);
  });

  it("deaktivert bruker og eksplisitt false skrives aldri over, også med --apply", async () => {
    users.set("uidOff", { ...helen, uid: "uidOff", email: "off@example.no", disabled: true });
    expect(
      (await runAddMember(db, auth, { familyId: "familie1", email: "off@example.no" }, true))
        .action,
    ).toBe("refuse");

    store.set("families/familie1/members/uidHelen1", false);
    expect((await runAddMember(db, auth, req, true)).action).toBe("refuse");
    expect(store.get("families/familie1/members/uidHelen1")).toBe(false);
    users.delete("uidOff");
  });

  it("feil i oppslaget (f.eks. manglende tilgang) kastes videre i stedet for å bli «ingen bruker»", async () => {
    const stengt: AuthDirectory = {
      byUid: async () => {
        throw new Error("permission denied");
      },
      byEmail: async () => {
        throw new Error("permission denied");
      },
    };
    await expect(runAddMember(db, stengt, req, true)).rejects.toThrow("permission denied");
    expect(calls.filter((c) => c.startsWith("set"))).toEqual([]);
  });
});

describe("resolveProjectId", () => {
  const URL = "https://familieapp-a5d15-default-rtdb.europe-west1.firebasedatabase.app";

  it("utleder prosjektet fra databasens URL, med eller uten samsvarende miljøvariabel", () => {
    expect(resolveProjectId(URL, undefined)).toEqual({ projectId: "familieapp-a5d15" });
    expect(resolveProjectId(URL, "familieapp-a5d15")).toEqual({ projectId: "familieapp-a5d15" });
  });

  it("nekter at miljøet peker på et annet prosjekt enn databasen", () => {
    expect(resolveProjectId(URL, "et-annet-prosjekt")).toEqual({
      error: expect.stringContaining("stemmer ikke med databasen familieapp-a5d15"),
    });
  });

  it("faller tilbake på miljøet for en URL uten prosjektet, og feiler uten begge", () => {
    expect(resolveProjectId("https://x.firebaseio.com", "mitt-prosjekt")).toEqual({
      projectId: "mitt-prosjekt",
    });
    expect(resolveProjectId("https://x.firebaseio.com", undefined)).toEqual({
      error: expect.stringContaining("Sett GOOGLE_CLOUD_PROJECT"),
    });
    expect(resolveProjectId("", "")).toEqual({ error: expect.any(String) });
  });
});
