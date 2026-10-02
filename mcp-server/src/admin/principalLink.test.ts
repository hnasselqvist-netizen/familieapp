import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memoryStore";
import { type PrincipalLinkDb, planPrincipalLink, runPrincipalLink } from "./principalLink";

const SUB = "google-oauth2|123";
const req = { idpSub: SUB, firebaseUid: "uid-1", familyId: "familie1" };

describe("planPrincipalLink", () => {
  it("oppretter kun for eksisterende medlem", () => {
    expect(planPrincipalLink(req, null, true)).toMatchObject({
      action: "create",
      path: "mcp/principals/google-oauth2|123",
      next: { firebaseUid: "uid-1", familyId: "familie1" },
    });
    expect(planPrincipalLink(req, null, false).action).toBe("refuse");
  });

  it("validerer input", () => {
    for (const bad of [
      { ...req, idpSub: "" },
      { ...req, idpSub: " sub" },
      { ...req, firebaseUid: "" },
      { ...req, familyId: "../annen" },
      { ...req, familyId: "" },
    ]) {
      expect(planPrincipalLink(bad, null, true).action, JSON.stringify(bad)).toBe("refuse");
    }
  });

  it("idempotent: samme kobling er uendret", () => {
    expect(
      planPrincipalLink(req, { firebaseUid: "uid-1", familyId: "familie1" }, true).action,
    ).toBe("unchanged");
  });

  it("overskriver aldri en annen persons kobling uten --replace", () => {
    const other = { firebaseUid: "uid-2", familyId: "familie1" };
    expect(planPrincipalLink(req, other, true).action).toBe("refuse");
    expect(planPrincipalLink({ ...req, replace: true }, other, true).action).toBe("update");
  });

  it("deaktivering virker også etter at medlemskapet er fjernet, og kan reaktiveres", () => {
    const linked = { firebaseUid: "uid-1", familyId: "familie1" };
    expect(planPrincipalLink({ ...req, disable: true }, linked, false)).toMatchObject({
      action: "update",
      next: { disabled: true },
    });
    expect(planPrincipalLink({ ...req, disable: true }, null, false).action).toBe("refuse");
    const reactivated = planPrincipalLink(req, { ...linked, disabled: true }, true);
    expect(reactivated).toMatchObject({ action: "update" });
    expect(reactivated.action === "update" && reactivated.next).not.toHaveProperty("disabled");
  });
});

describe("runPrincipalLink", () => {
  let store: MemoryStore;
  let db: PrincipalLinkDb;
  beforeEach(() => {
    store = new MemoryStore();
    store.set("families/familie1/members/uid-1", true);
    db = { get: async (p) => store.get(p), set: async (p, v) => store.set(p, v) };
  });

  it("tørrkjøring skriver ingenting; --apply skriver én node", async () => {
    expect(await runPrincipalLink(db, req, false)).toMatchObject({
      action: "create",
      applied: false,
    });
    expect(store.get("mcp/principals/google-oauth2|123")).toBeNull();
    expect(await runPrincipalLink(db, req, true)).toMatchObject({
      action: "create",
      applied: true,
    });
    expect(store.get("mcp/principals/google-oauth2|123")).toEqual({
      firebaseUid: "uid-1",
      familyId: "familie1",
    });
    expect(await runPrincipalLink(db, req, true)).toMatchObject({
      action: "unchanged",
      applied: false,
    });
  });

  it("sub med RTDB-ulovlige tegn kodes som serveren slår den opp", async () => {
    await runPrincipalLink(db, { ...req, idpSub: "https://idp.example/u.1" }, true);
    expect(store.get("mcp/principals/https:%2F%2Fidp%2Eexample%2Fu%2E1")).toMatchObject({
      firebaseUid: "uid-1",
    });
  });
});
