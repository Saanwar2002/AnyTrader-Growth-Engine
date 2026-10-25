import { describe, expect, it } from "vitest";
import { getValidImportReplayResult, isPersistedImportedLeadReplayAvailable } from "./import-idempotency";
const expected = { actorUid:"user-1", requestHash:"hash", organisationId:"org-1", campaignId:"campaign-1", received:2 };
const result = { organisationId:"org-1", campaignId:"campaign-1", received:2, imported:1, duplicatesSkipped:1, leads:[{leadId:"lead_1",businessName:"Example Ltd"}], sent:false, messageSentByThisAction:false };
const saved = { actorUid:"user-1", requestHash:"hash", result };
describe("CSV import idempotency replay integrity", () => {
  it("accepts the exact original actor, request and bounded result", () => {
    expect(getValidImportReplayResult(saved, expected)).toEqual(result);
  });
  it("rejects wrong actor/hash and malformed containers", () => {
    expect(getValidImportReplayResult({...saved,actorUid:"other"},expected)).toBeNull();
    expect(getValidImportReplayResult({...saved,requestHash:"other"},expected)).toBeNull();
    expect(getValidImportReplayResult(null,expected)).toBeNull();
    expect(getValidImportReplayResult({...saved,result:[]},expected)).toBeNull();
  });
  it("rejects extra/missing fields, inconsistent totals, unsafe lead IDs and duplicate IDs", () => {
    const badResults = [
      {...result, internalNote:"no"}, {...result, imported:2}, {...result, received:3},
      {...result, leads:[{...result.leads[0],email:"private@example.test"}]},
      {...result, leads:[{leadId:"bad/id",businessName:"Example Ltd"}]},
      {...result, leads:[result.leads[0],result.leads[0]], imported:2, duplicatesSkipped:0, received:2},
      {...result, sent:true},
      Object.fromEntries(Object.entries(result).filter(([key]) => key !== "messageSentByThisAction")),
    ];
    for (const invalid of badResults) expect(getValidImportReplayResult({...saved,result:invalid},expected)).toBeNull();
  });
  it("requires persisted imported leads to remain in the original tenant/campaign and safely suppressed", () => {
    const persisted = {createdBy:"user-1",campaignId:"campaign-1",businessName:"Example Ltd",source:"csv_import",status:"new",doNotContact:true,contactReviewStatus:"pending",contactReviewRevision:0};
    expect(isPersistedImportedLeadReplayAvailable(persisted,{actorUid:"user-1",campaignId:"campaign-1",businessName:"Example Ltd",sourceLabel:"csv_import"})).toBe(true);
    expect(isPersistedImportedLeadReplayAvailable({...persisted,createdBy:"other"},{actorUid:"user-1",campaignId:"campaign-1",businessName:"Example Ltd",sourceLabel:"csv_import"})).toBe(false);
    expect(isPersistedImportedLeadReplayAvailable({...persisted,doNotContact:false},{actorUid:"user-1",campaignId:"campaign-1",businessName:"Example Ltd",sourceLabel:"csv_import"})).toBe(false);
    expect(isPersistedImportedLeadReplayAvailable(null,{actorUid:"user-1",campaignId:"campaign-1",businessName:"Example Ltd",sourceLabel:"csv_import"})).toBe(false);
  });
});
