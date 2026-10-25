import { describe, expect, it } from "vitest";
import { getValidOrganisationCreationReplayResult } from "./organisation-creation-idempotency";

const expected = { actorUid: "user-1", requestHash: "request-hash", name: "Pilot Workspace" };
const result = { organisationId: "org_123", name: expected.name, role: "owner" };
const saved = { actorUid: expected.actorUid, requestHash: expected.requestHash, result };

describe("organisation creation idempotency replay integrity", () => {
  it("accepts the exact saved owner response for the original actor and request", () => {
    expect(getValidOrganisationCreationReplayResult(saved, expected)).toEqual(result);
  });

  it("rejects wrong actors, changed request hashes and malformed records", () => {
    expect(getValidOrganisationCreationReplayResult({ ...saved, actorUid: "other-user" }, expected)).toBeNull();
    expect(getValidOrganisationCreationReplayResult({ ...saved, requestHash: "other-hash" }, expected)).toBeNull();
    expect(getValidOrganisationCreationReplayResult(null, expected)).toBeNull();
    expect(getValidOrganisationCreationReplayResult({ ...saved, result: [] }, expected)).toBeNull();
  });

  it("rejects missing, extra, tampered, or malformed response fields", () => {
    const invalidResults = [
      { ...result, email: "private@example.test" },
      { ...result, name: "Different workspace" },
      { ...result, role: "admin" },
      { ...result, organisationId: "org/invalid" },
      Object.fromEntries(Object.entries(result).filter(([key]) => key !== "role")),
    ];
    for (const invalidResult of invalidResults) {
      expect(getValidOrganisationCreationReplayResult({ ...saved, result: invalidResult }, expected)).toBeNull();
    }
  });
});
