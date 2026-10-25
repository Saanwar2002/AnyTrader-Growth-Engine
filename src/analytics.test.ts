import { describe, expect, it } from "vitest";
import { summarizeCampaignPerformance } from "./analytics";
describe("summarizeCampaignPerformance", () => {
  it("summarises loaded records and conservatively counts restricted leads", () => {
    expect(summarizeCampaignPerformance(
      [{ id: "c1", name: "Edinburgh painters" }, { id: "c2", name: "Glasgow decorators" }],
      [
        { campaignId: "c1", status: "qualified", doNotContact: false, contactRestrictionVerified: true, contactReviewStatus: "cleared" },
        { campaignId: "c1", status: "onboarded", doNotContact: false, contactRestrictionVerified: true, contactReviewStatus: "cleared" },
        { campaignId: "c1", status: "new", doNotContact: true, contactRestrictionVerified: false, contactReviewStatus: "pending" },
        { campaignId: "c2", status: "new", doNotContact: false, contactRestrictionVerified: false },
      ],
      [{ campaignId: "c1", requiresReview: true }, { campaignId: "c1", requiresReview: false }],
    )).toEqual([
      { campaignId: "c1", campaignName: "Edinburgh painters", loadedLeadCount: 3, qualifiedLeadCount: 1, onboardedLeadCount: 1, restrictedLeadCount: 1, loadedDraftCount: 2, draftsAwaitingReview: 1 },
      { campaignId: "c2", campaignName: "Glasgow decorators", loadedLeadCount: 1, qualifiedLeadCount: 0, onboardedLeadCount: 0, restrictedLeadCount: 1, loadedDraftCount: 0, draftsAwaitingReview: 0 },
    ]);
  });
  it("returns zero counts for campaigns with no loaded records", () => {
    expect(summarizeCampaignPerformance([{ id: "c1", name: "Empty" }], [], [])[0]).toEqual({
      campaignId: "c1", campaignName: "Empty", loadedLeadCount: 0, qualifiedLeadCount: 0,
      onboardedLeadCount: 0, restrictedLeadCount: 0, loadedDraftCount: 0, draftsAwaitingReview: 0,
    });
  });
});
