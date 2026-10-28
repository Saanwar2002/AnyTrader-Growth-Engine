import { describe, expect, it } from "vitest";
import { snapshotPersistedSecurityAuditEvent } from "./security-audit-event-shape";

const validEvent = () => ({
  schemaVersion: 1,
  eventType: "lead.created",
  organisationId: "org-1",
  actorUid: "user-1",
  resourceType: "lead",
  resourceId: "lead-1",
  outcome: "success",
  metadata: { leadStatus: "new" },
  createdAt: { toDate: () => new Date("2026-01-01T00:00:00.000Z") },
});

describe("persisted security audit event shape", () => {
  it("returns a detached null-prototype snapshot of exact data fields", () => {
    const event = validEvent();
    const snapshot = snapshotPersistedSecurityAuditEvent(event);
    expect(snapshot).not.toBeNull();
    expect(Object.getPrototypeOf(snapshot)).toBeNull();
    event.actorUid = "mutated";
    expect(snapshot?.actorUid).toBe("user-1");
  });

  it.each([
    ["unknown fields", { ...validEvent(), unexpected: true }],
    ["symbol fields", Object.assign(validEvent(), { [Symbol("extra")]: true })],
    ["class instances", new (class EventRecord { constructor() { Object.assign(this, validEvent()); } })()],
  ])("rejects %s", (_label, value) => {
    expect(snapshotPersistedSecurityAuditEvent(value)).toBeNull();
  });

  it("rejects accessor-backed fields without executing getters", () => {
    let invoked = false;
    const event = Object.defineProperty(validEvent(), "actorUid", {
      enumerable: true,
      get: () => { invoked = true; return "user-1"; },
    });
    expect(snapshotPersistedSecurityAuditEvent(event)).toBeNull();
    expect(invoked).toBe(false);
  });

  it("fails closed when object inspection traps throw", () => {
    const hostile = new Proxy(validEvent(), { ownKeys() { throw new Error("trap"); } });
    expect(snapshotPersistedSecurityAuditEvent(hostile)).toBeNull();
  });

  it("rejects non-enumerable own fields", () => {
    const event = Object.defineProperty(validEvent(), "actorUid", {
      configurable: true,
      enumerable: false,
      value: "user-1",
    });
    expect(snapshotPersistedSecurityAuditEvent(event)).toBeNull();
  });

  it.each([
    ["prototype inspection", { getPrototypeOf() { throw new Error("prototype trap"); } }],
    ["descriptor inspection", { getOwnPropertyDescriptor() { throw new Error("descriptor trap"); } }],
  ])("fails closed when hostile proxy %s throws", (_label, handler) => {
    const hostile = new Proxy(validEvent(), handler);
    expect(snapshotPersistedSecurityAuditEvent(hostile)).toBeNull();
  });

});