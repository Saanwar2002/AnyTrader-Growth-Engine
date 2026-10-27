import { describe, expect, it } from "vitest";
import { getValidLeadIdentifierReservationState } from "./lead-identifier-reservation-state";

describe("persisted lead identifier reservation state", () => {
  it("accepts valid reservation identity with or without creation metadata", () => {
    expect(getValidLeadIdentifierReservationState({
      schemaVersion: 1, identifierType: "email", leadId: "lead-1",
    }, "email")).toEqual({ leadId: "lead-1", identifierType: "email" });
    expect(getValidLeadIdentifierReservationState({
      schemaVersion: 1, identifierType: "website", leadId: "lead_2", createdAt: { legacy: true },
    }, "website")).toEqual({ leadId: "lead_2", identifierType: "website" });
  });

  it.each([
    ["wrong schema version", { schemaVersion: 2, identifierType: "email", leadId: "lead-1" }],
    ["wrong identifier type", { schemaVersion: 1, identifierType: "website", leadId: "lead-1" }],
    ["missing lead ID", { schemaVersion: 1, identifierType: "email" }],
    ["invalid lead ID", { schemaVersion: 1, identifierType: "email", leadId: "../lead" }],
    ["unknown field", { schemaVersion: 1, identifierType: "email", leadId: "lead-1", unexpected: true }],
  ])("rejects malformed reservation state: %s", (_label, value) => {
    expect(getValidLeadIdentifierReservationState(value, "email")).toBeNull();
  });

  it("rejects accessor-backed fields without executing getters", () => {
    let getterInvoked = false;
    const value = Object.defineProperty({ schemaVersion: 1, identifierType: "email" }, "leadId", {
      enumerable: true,
      get: () => { getterInvoked = true; return "lead-1"; },
    });
    expect(getValidLeadIdentifierReservationState(value, "email")).toBeNull();
    expect(getterInvoked).toBe(false);
  });

  it("rejects symbols, hidden fields, class instances, and hostile proxies", () => {
    expect(getValidLeadIdentifierReservationState({
      schemaVersion: 1, identifierType: "email", leadId: "lead-1", [Symbol("extra")]: true,
    }, "email")).toBeNull();
    const hidden = { schemaVersion: 1, identifierType: "email", leadId: "lead-1" };
    Object.defineProperty(hidden, "hidden", { value: true, enumerable: false });
    expect(getValidLeadIdentifierReservationState(hidden, "email")).toBeNull();
    class Reservation { schemaVersion = 1; identifierType = "email"; leadId = "lead-1"; }
    expect(getValidLeadIdentifierReservationState(new Reservation(), "email")).toBeNull();
    const hostile = new Proxy({ schemaVersion: 1, identifierType: "email", leadId: "lead-1" }, {
      ownKeys: () => { throw new Error("sensitive proxy detail"); },
    });
    expect(getValidLeadIdentifierReservationState(hostile, "email")).toBeNull();
  });
});
