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
  it("rejects accessor-backed replay envelopes and results without invoking getters", () => {
    let getterInvoked = false;
    const unsafeEnvelope = Object.defineProperty({ requestHash: expected.requestHash, result }, "actorUid", {
      enumerable: true,
      get: () => { getterInvoked = true; return expected.actorUid; },
    });
    expect(getValidLeadCreationReplayResult(unsafeEnvelope, expected)).toBeNull();

    const unsafeResult = Object.defineProperty({ ...result }, "businessName", {
      enumerable: true,
      get: () => { getterInvoked = true; return expected.businessName; },
    });
    expect(getValidLeadCreationReplayResult({ ...saved, result: unsafeResult }, expected)).toBeNull();
    expect(getterInvoked).toBe(false);
  });

  it("rejects accessor-backed score reason indices, symbols, and class instances", () => {
    let getterInvoked = false;
    const reasons = ["website-present"];
    Object.defineProperty(reasons, "0", {
      enumerable: true,
      configurable: true,
      get: () => { getterInvoked = true; return "website-present"; },
    });
    expect(getValidLeadCreationReplayResult({ ...saved, result: { ...result, scoreReasons: reasons } }, expected)).toBeNull();

    expect(getValidLeadCreationReplayResult({ ...saved, [Symbol("extra")]: true }, expected)).toBeNull();
    class ReplayResult { leadId = "lead_123"; }
    expect(getValidLeadCreationReplayResult({ ...saved, result: new ReplayResult() }, expected)).toBeNull();
    expect(getterInvoked).toBe(false);
  });

  it("rejects accessor-backed persisted lead fields without invoking getters", () => {
    let getterInvoked = false;
    const persisted = Object.defineProperty({
      campaignId: expected.campaignId, businessName: expected.businessName, category: expected.category,
      location: expected.location, website: expected.website, email: expected.email, phone: expected.phone,
      dedupeEmailKey: expected.dedupeEmailKey, dedupeWebsiteKey: expected.dedupeWebsiteKey,
      dedupeBusinessLocationKey: expected.dedupeBusinessLocationKey, source: "manual", status: "new",
      score: result.score, scoreReasons: result.scoreReasons, doNotContact: true,
      contactReviewStatus: "pending", contactReviewRevision: 0,
    }, "createdBy", {
      enumerable: true,
      get: () => { getterInvoked = true; return expected.actorUid; },
    });
    expect(isPersistedLeadCreationReplayAvailable(persisted, expected, result)).toBe(false);
    expect(getterInvoked).toBe(false);
  });

  it("rejects missing, extra, tampered and invalid fields", () => {
    const bad = [
      {...result, internalNote:"must not leak"}, {...result, organisationId:"other-org"},
      {...result, businessName:"Other Ltd"}, {...result, leadId:"bad/id"},
      {...result, score:Number.NaN}, {...result, score:-1}, {...result, score:101}, {...result, scoreReasons:["ok",42]},
      {...result, scoreReasons:Array(1)},
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
    expect(isPersistedLeadCreationReplayAvailable({...persisted, scoreReasons:Array(1)}, expected, result)).toBe(false);
    expect(isPersistedLeadCreationReplayAvailable({...persisted, createdBy:"other"}, expected, result)).toBe(false);
    expect(isPersistedLeadCreationReplayAvailable(null, expected, result)).toBe(false);
  });
});


describe("manual lead source record ID replay integrity", () => {
  const attributedExpected = { ...expected, sourceRecordId: "directory-record-42" };
  const attributedResult = { ...result, sourceRecordId: "directory-record-42" };
  it("accepts an exact attributed creation replay", () => {
    expect(getValidLeadCreationReplayResult({
      actorUid: attributedExpected.actorUid,
      requestHash: attributedExpected.requestHash,
      result: attributedResult,
    }, attributedExpected)).toEqual(attributedResult);
  });
  it("rejects mismatched source IDs in saved and persisted replay state", () => {
    expect(getValidLeadCreationReplayResult({
      actorUid: attributedExpected.actorUid,
      requestHash: attributedExpected.requestHash,
      result: { ...attributedResult, sourceRecordId: "other-record" },
    }, attributedExpected)).toBeNull();
    const persisted = {
      createdBy: attributedExpected.actorUid, campaignId: attributedExpected.campaignId,
      businessName: attributedExpected.businessName, category: attributedExpected.category,
      location: attributedExpected.location, website: attributedExpected.website, email: attributedExpected.email,
      phone: attributedExpected.phone, dedupeEmailKey: attributedExpected.dedupeEmailKey,
      dedupeWebsiteKey: attributedExpected.dedupeWebsiteKey,
      dedupeBusinessLocationKey: attributedExpected.dedupeBusinessLocationKey,
      sourceRecordId: "directory-record-42", status: "new", source: "manual", score: result.score,
      scoreReasons: result.scoreReasons, doNotContact: true, contactReviewStatus: "pending", contactReviewRevision: 0,
    };
    expect(isPersistedLeadCreationReplayAvailable(persisted, attributedExpected, attributedResult)).toBe(true);
    expect(isPersistedLeadCreationReplayAvailable({ ...persisted, sourceRecordId: "other-record" }, attributedExpected, attributedResult)).toBe(false);
  });
});
