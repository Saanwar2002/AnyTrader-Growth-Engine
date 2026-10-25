import { describe, expect, it } from "vitest";
import { getValidOutreachDraftReplayResult, isPersistedOutreachDraftAvailable } from "./outreach-draft-idempotency";

const expected = {
  actorUid: "user-1",
  requestHash: "sha256-request-hash",
  leadId: "lead-1",
  campaignId: "campaign-1",
  subject: "Introductory message",
  body: "Draft body",
};

const saved = {
  actorUid: expected.actorUid,
  requestHash: expected.requestHash,
  result: {
    draftId: "draft-1",
    leadId: expected.leadId,
    campaignId: expected.campaignId,
    subject: expected.subject,
    body: expected.body,
    status: "draft",
    sent: false,
  },
};

describe("outreach draft idempotency replay integrity", () => {
  it("accepts a replay only when actor, request fingerprint and saved response agree", () => {
    expect(getValidOutreachDraftReplayResult(saved, expected)).toEqual(saved.result);
  });

  it("fails closed for wrong actors, mismatched hashes, and malformed result containers", () => {
    expect(getValidOutreachDraftReplayResult({ ...saved, actorUid: "user-2" }, expected)).toBeNull();
    expect(getValidOutreachDraftReplayResult({ ...saved, requestHash: "other-hash" }, expected)).toBeNull();
    expect(getValidOutreachDraftReplayResult({ ...saved, result: [] }, expected)).toBeNull();
    expect(getValidOutreachDraftReplayResult([], expected)).toBeNull();
  });

  it("rejects a saved response whose payload or immutable state differs from the original request", () => {
    for (const result of [
      { ...saved.result, subject: "tampered subject" },
      { ...saved.result, body: "tampered body" },
      { ...saved.result, leadId: "other-lead" },
      { ...saved.result, campaignId: "other-campaign" },
      { ...saved.result, draftId: "bad/draft-id" },
      { ...saved.result, status: "sent" },
      { ...saved.result, sent: true },
    ]) {
      expect(getValidOutreachDraftReplayResult({ ...saved, result }, expected)).toBeNull();
    }
  });

  it("requires the persisted draft to remain in the same tenant relationship and unsent", () => {
    const persisted = { leadId: "lead-1", campaignId: "campaign-1", createdBy: "user-1", sent: false };
    expect(isPersistedOutreachDraftAvailable(persisted, expected)).toBe(true);
    expect(isPersistedOutreachDraftAvailable({ ...persisted, createdBy: "user-2" }, expected)).toBe(false);
    expect(isPersistedOutreachDraftAvailable({ ...persisted, leadId: "other-lead" }, expected)).toBe(false);
    expect(isPersistedOutreachDraftAvailable({ ...persisted, campaignId: "other-campaign" }, expected)).toBe(false);
    expect(isPersistedOutreachDraftAvailable({ ...persisted, sent: true }, expected)).toBe(false);
    expect(isPersistedOutreachDraftAvailable({ ...persisted, sent: undefined }, expected)).toBe(false);
    expect(isPersistedOutreachDraftAvailable(null, expected)).toBe(false);
  });
});
