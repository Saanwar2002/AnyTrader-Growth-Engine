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

  it("rejects duplicate, unrequested, invalid, or count-inconsistent changed lead IDs", () => {
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, leadIds: ["lead-1", "lead-1"] }, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, leadIds: ["lead-1", "other-lead"] }, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, leadIds: ["lead-1", "bad/id"] }, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, leadIds: ["lead-1"] }, expected)).toBeNull();
    expect(getValidBulkLeadStatusReplayResult({ ...validResult, leadIds: ["lead-1", "lead-3", "lead-2"] }, expected)).toBeNull();
  });
});
