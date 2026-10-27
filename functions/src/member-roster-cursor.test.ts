import { describe, expect, it } from "vitest";
import { getValidMemberRosterCursorUid } from "./member-roster-cursor";

const validCursor = () => ({
  scope: "organisation_member_roster",
  organisationId: "org-1",
  lastUid: "user_1",
});

describe("member roster cursor payload", () => {
  it("accepts an exact cursor bound to the requested organisation", () => {
    expect(getValidMemberRosterCursorUid(validCursor(), "org-1")).toBe("user_1");
  });

  it.each([
    ["wrong scope", { ...validCursor(), scope: "other" }],
    ["wrong organisation", { ...validCursor(), organisationId: "org-2" }],
    ["invalid UID", { ...validCursor(), lastUid: "../user" }],
    ["unknown key", { ...validCursor(), unexpected: true }],
    ["missing UID", { scope: "organisation_member_roster", organisationId: "org-1" }],
    ["array payload", []],
    ["class instance", new (class Cursor { constructor() { Object.assign(this, validCursor()); } })()],
  ])("rejects %s", (_label, value) => {
    expect(getValidMemberRosterCursorUid(value, "org-1")).toBeNull();
  });

  it("rejects accessor-backed fields without invoking getters", () => {
    let invoked = false;
    const value = Object.defineProperty(validCursor(), "lastUid", {
      enumerable: true,
      get: () => { invoked = true; return "user_1"; },
    });
    expect(getValidMemberRosterCursorUid(value, "org-1")).toBeNull();
    expect(invoked).toBe(false);
  });

  it("fails closed when object inspection traps throw", () => {
    const hostile = new Proxy(validCursor(), { ownKeys() { throw new Error("trap"); } });
    expect(getValidMemberRosterCursorUid(hostile, "org-1")).toBeNull();
  });
});
