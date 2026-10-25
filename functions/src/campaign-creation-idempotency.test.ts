import { describe, expect, it } from "vitest";
import {
  getValidCampaignCreationReplayResult,
  isPersistedCampaignCreationReplayAvailable,
} from "./campaign-creation-idempotency";

const expected = {
  actorUid: "user-1",
  requestHash: "request-hash",
  organisationId: "org-1",
  name: "Spring campaign",
  category: "Painters",
  location: "Manchester",
  brand: "AnyTrader",
  goal: "Onboard local providers",
};

const result = {
  campaignId: "campaign_1",
  organisationId: expected.organisationId,
  name: expected.name,
  category: expected.category,
  location: expected.location,
  brand: expected.brand,
  goal: expected.goal,
  status: "active",
};

const saved = { actorUid: expected.actorUid, requestHash: expected.requestHash, result };

describe("campaign creation idempotency replay integrity", () => {
  it("accepts the exact original actor, request and response", () => {
    expect(getValidCampaignCreationReplayResult(saved, expected)).toEqual(result);
  });

  it("rejects a wrong actor, wrong request hash and malformed saved container", () => {
    expect(getValidCampaignCreationReplayResult({ ...saved, actorUid: "user-2" }, expected)).toBeNull();
    expect(getValidCampaignCreationReplayResult({ ...saved, requestHash: "other" }, expected)).toBeNull();
    expect(getValidCampaignCreationReplayResult(null, expected)).toBeNull();
    expect(getValidCampaignCreationReplayResult({ ...saved, result: [] }, expected)).toBeNull();
  });

  it("rejects missing, extra, tampered, or invalid response fields", () => {
    const invalidResults = [
      { ...result, extraInternalField: "must not leak" },
      { ...result, name: "Different campaign" },
      { ...result, organisationId: "other-org" },
      { ...result, campaignId: "bad/campaign/id" },
      { ...result, status: "paused" },
      Object.fromEntries(Object.entries(result).filter(([key]) => key !== "brand")),
    ];
    for (const invalidResult of invalidResults) {
      expect(getValidCampaignCreationReplayResult({ ...saved, result: invalidResult }, expected)).toBeNull();
    }
  });

  it("requires the persisted campaign to remain owned by the actor with the original payload", () => {
    const persisted = {
      createdBy: expected.actorUid,
      name: expected.name,
      category: expected.category,
      location: expected.location,
      brand: expected.brand,
      goal: expected.goal,
      status: "paused",
    };
    expect(isPersistedCampaignCreationReplayAvailable(persisted, expected)).toBe(true);
    expect(isPersistedCampaignCreationReplayAvailable({ ...persisted, createdBy: "user-2" }, expected)).toBe(false);
    expect(isPersistedCampaignCreationReplayAvailable({ ...persisted, category: "other" }, expected)).toBe(false);
    expect(isPersistedCampaignCreationReplayAvailable({ ...persisted, goal: undefined }, expected)).toBe(false);
    expect(isPersistedCampaignCreationReplayAvailable(null, expected)).toBe(false);
  });
});
