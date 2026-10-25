import { describe, expect, it } from "vitest";
import { getValidLeadCreationReplayResult, isPersistedLeadCreationReplayAvailable } from "./lead-creation-idempotency";
const expected = { actorUid:"user-1", requestHash:"hash", organisationId:"org-1", campaignId:"campaign-1", businessName:"Example Ltd", category:"Painters", location:"Manchester", website:"https://example.test", email:"hello@example.test", phone:"0123456789", dedupeEmailKey:"email-key", dedupeWebsiteKey:"website-key", dedupeBusinessLocationKey:"business-location-key" };
const result = { leadId:"lead_123", organisationId:expected.organisationId, campaignId:expected.campaignId, businessName:expected.businessName, category:expected.category, location:expected.location, website:expected.website, email:expected.email, phone:expected.phone, dedupeEmailKey:expected.dedupeEmailKey, dedupeWebsiteKey:expected.dedupeWebsiteKey, dedupeBusinessLocationKey:expected.dedupeBusinessLocationKey, status:"new", source:"manual", score:70, scoreReasons:["website-present"], doNotContact:true, contactReviewStatus:"pending", contactReviewRevision:0 };
const saved = { actorUid:expected.actorUid, requestHash:expected.requestHash, result };
describe("lead creation idempotency replay integrity", () => {
  it("accepts the exact response for the original actor, request and payload", () => {
    expect(getValidLeadCreationReplayResult(saved, expected)).toEqual(result);
  });
  it("rejects wrong actor/hash and malformed records", () => {
    expect(getValidLeadCreationReplayResult({...saved, actorUid:"other"}, expected)).toBeNull();
    expect(getValidLeadCreationReplayResult({...saved, requestHash:"other"}, expected)).toBeNull();
    expect(getValidLeadCreationReplayResult(null, expected)).toBeNull();
    expect(getValidLeadCreationReplayResult({...saved, result:[]}, expected)).toBeNull();
  });
  it("rejects missing, extra, tampered and invalid fields", () => {
    const bad = [
      {...result, internalNote:"must not leak"}, {...result, organisationId:"other-org"},
      {...result, businessName:"Other Ltd"}, {...result, leadId:"bad/id"},
      {...result, score:Number.NaN}, {...result, scoreReasons:["ok",42]},
      {...result, doNotContact:false},
      Object.fromEntries(Object.entries(result).filter(([key]) => key !== "contactReviewRevision")),
    ];
    for (const item of bad) expect(getValidLeadCreationReplayResult({...saved, result:item}, expected)).toBeNull();
  });
  it("compares persisted score, score reasons and creation safety fields", () => {
    const persisted = { createdBy:expected.actorUid, campaignId:expected.campaignId, businessName:expected.businessName, category:expected.category, location:expected.location, website:expected.website, email:expected.email, phone:expected.phone, dedupeEmailKey:expected.dedupeEmailKey, dedupeWebsiteKey:expected.dedupeWebsiteKey, dedupeBusinessLocationKey:expected.dedupeBusinessLocationKey, status:"new", source:"manual", score:result.score, scoreReasons:result.scoreReasons, doNotContact:true, contactReviewStatus:"pending", contactReviewRevision:0 };
    expect(isPersistedLeadCreationReplayAvailable(persisted, expected, result)).toBe(true);
    expect(isPersistedLeadCreationReplayAvailable({...persisted, score:99}, expected, result)).toBe(false);
    expect(isPersistedLeadCreationReplayAvailable({...persisted, scoreReasons:["tampered"]}, expected, result)).toBe(false);
    expect(isPersistedLeadCreationReplayAvailable({...persisted, createdBy:"other"}, expected, result)).toBe(false);
    expect(isPersistedLeadCreationReplayAvailable(null, expected, result)).toBe(false);
  });
});
