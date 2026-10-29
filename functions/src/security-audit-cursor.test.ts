import { describe, expect, it } from "vitest";
import { getValidSecurityAuditCursorId } from "./security-audit-cursor";

const validCursor = () => ({
  scope: "organisation_security_audit",
  organisationId: "org-1",
  lastEventId: "event_1",
});

describe("security audit cursor payload", () => {
  it("accepts an exact cursor bound to the requested organisation", () => {
    expect(getValidSecurityAuditCursorId(validCursor(), "org-1")).toBe("event_1");
  });

  it.each([
    ["wrong scope", { ...validCursor(), scope: "other" }],
    ["wrong organisation", { ...validCursor(), organisationId: "org-2" }],
    ["invalid event ID", { ...validCursor(), lastEventId: "../event" }],
    ["unknown key", { ...validCursor(), unexpected: true }],
    ["missing event ID", { scope: "organisation_security_audit", organisationId: "org-1" }],
    ["array payload", []],
    ["class instance", new (class Cursor { constructor() { Object.assign(this, validCursor()); } })()],
  ])("rejects %s", (_label, value) => {
    expect(getValidSecurityAuditCursorId(value, "org-1")).toBeNull();
  });

  it("rejects accessor-backed fields without invoking getters", () => {
    let invoked = false;
    const value = Object.defineProperty(validCursor(), "lastEventId", {
      enumerable: true,
      get: () => { invoked = true; return "event_1"; },
    });
    expect(getValidSecurityAuditCursorId(value, "org-1")).toBeNull();
    expect(invoked).toBe(false);
  });

  it("fails closed when prototype and descriptor inspection traps throw", () => {
    const prototypeTrap = new Proxy(validCursor(), {
      getPrototypeOf() { throw new Error("prototype inspection failed"); },
    });
    const descriptorTrap = new Proxy(validCursor(), {
      getPrototypeOf() { return Object.prototype; },
      getOwnPropertyDescriptor() { throw new Error("descriptor inspection failed"); },
    });

    expect(getValidSecurityAuditCursorId(prototypeTrap, "org-1")).toBeNull();
    expect(getValidSecurityAuditCursorId(descriptorTrap, "org-1")).toBeNull();
  });

  it("fails closed when object inspection traps throw", () => {
    const hostile = new Proxy(validCursor(), { ownKeys() { throw new Error("trap"); } });
    expect(getValidSecurityAuditCursorId(hostile, "org-1")).toBeNull();
  });
});
