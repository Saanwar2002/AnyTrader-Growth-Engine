import { describe, expect, it } from "vitest";
import { getValidBulkLeadStatusReplayResult } from "./bulk-lead-status-idempotency";

const expected = {
  organisationId: "org-1",
  status: "qualified",
  leadIds: ["lead-1", "lead-2", "lead-3"],
};

const validResult = {
  organisationId: "org-1",
  status: "qualified",
  updatedCount: 2,
  unchangedCount: 1,
  leadIds: ["lead-1", "lead-3"],
};

describe("bulk lead status idempotency replay integrity", () => {
  it("accepts a well-formed committed response for the same request", () => {
    expect(getValidBulkLeadStatusReplayResult(validResult, expected)).toEqual(validResult);
  });

  it("rejects arrays, wrong tenant/status, and malformed counts", () => {
    expect(getValidBulkLeadStatusReplayResult([], expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, organisationId: "other-org" }, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, status: "contacted" }, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, updatedCount: -1 }, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, unchangedCount: 1.5 }, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, updatedCount: 1 }, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, unchangedCount: 2 }, expected)).toBeNull();
  });

  it("rejects sparse changed-ID arrays even when their length matches the updated count", () => {
    expect(getValidBulkLeadStatusReplayResult({
      organisationId: "org-1",
      status: "qualified",
      updatedCount: 1,
      unchangedCount: 0,
      leadIds: Array(1),
    }, {
      organisationId: "org-1",
      status: "qualified",
      leadIds: ["lead-1"],
    })).toBeNull();
  });

  it("rejects duplicate, unrequested, invalid, or count-inconsistent changed lead IDs", () => {
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, leadIds: ["lead-1", "lead-1"] }, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, leadIds: ["lead-1", "other-lead"] }, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, leadIds: ["lead-1", "bad/id"] }, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, leadIds: ["lead-1"] }, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, leadIds: ["lead-1", "lead-3", "lead-2"] }, expected)).toBeNull();
  });

  it("rejects accessor-backed result fields without executing their getters", () => {
    let getterCalls = 0;
    const result = { ...validResult };
    Object.defineProperty(result, "organisationId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "org-1";
      },
    });

    expect(getValidBulkLeadStatusReplayResult(result, expected)).toBeNull();
    expect(getterCalls).toBe(0);
  });

  it("rejects unexpected and symbol result fields and non-plain prototypes", () => {
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, unexpected: true }, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult(Object.assign({ ...validResult }, { [Symbol("extra")]: true }), expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult(Object.assign(Object.create({ inherited: true }), validResult), expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult(new (class ReplayResult { constructor() { Object.assign(this, validResult); } })(), expected)).toBeNull();
  });

  it("rejects accessor-backed changed IDs without executing their getters", () => {
    let getterCalls = 0;
    const ids = ["lead-1", "lead-3"];
    Object.defineProperty(ids, "0", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return "lead-1";
      },
    });

    expect(getValidBulkLeadStatusReplayResult({ ...validResult, leadIds: ids }, expected)).toBeNull();
    expect(getterCalls).toBe(0);
  });

  it("rejects changed-ID arrays with symbol or extra properties", () => {
    const symbolIds = ["lead-1", "lead-3"];
    Object.defineProperty(symbolIds, Symbol("extra"), { value: true });
    const extraIds = ["lead-1", "lead-3"] as string[] & { extra?: boolean };
    extraIds.extra = true;

    expect(getValidBulkLeadStatusReplayResult({ ...validResult, leadIds: symbolIds }, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, leadIds: extraIds }, expected)).toBeNull();
  });

  it("fails closed when hostile proxy inspection throws", () => {
    const hostileResult = new Proxy({ ...validResult }, {
      ownKeys() { throw new Error("sensitive proxy detail"); },
    });
    const hostileIds = new Proxy(["lead-1", "lead-3"], {
      getPrototypeOf() { throw new Error("sensitive proxy detail"); },
    });

    expect(getValidBulkLeadStatusReplayResult(hostileResult, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, leadIds: hostileIds }, expected)).toBeNull();
  });
});
