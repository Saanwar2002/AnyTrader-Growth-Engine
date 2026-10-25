import { describe, expect, it } from "vitest";
import { summarizeCampaignPerformance, summarizeLeadSourcePerformance } from "./analytics";
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
      { campaignId: "c1", campaignName: "Edinburgh painters", loadedLeadCount: 3, qualifiedLeadCount: 1, contactedLeadCount: 0, onboardedLeadCount: 1, qualifiedRatePercent: 33.3, onboardedRatePercent: 33.3, restrictedLeadCount: 1, loadedDraftCount: 2, draftsAwaitingReview: 1 },
      { campaignId: "c2", campaignName: "Glasgow decorators", loadedLeadCount: 1, qualifiedLeadCount: 0, contactedLeadCount: 0, onboardedLeadCount: 0, qualifiedRatePercent: 0, onboardedRatePercent: 0, restrictedLeadCount: 1, loadedDraftCount: 0, draftsAwaitingReview: 0 },
    ]);
  });
  it("uses loaded leads as the explicit denominator for funnel rates", () => {
    const [summary] = summarizeCampaignPerformance([{ id: "c1", name: "Pilot" }], [
      { campaignId: "c1", status: "qualified", doNotContact: true, contactRestrictionVerified: false },
      { campaignId: "c1", status: "onboarded", doNotContact: false, contactRestrictionVerified: true },
      { campaignId: "c1", status: "contacted", doNotContact: false, contactRestrictionVerified: true },
    ], []);
    expect(summary.contactedLeadCount).toBe(1);
    expect(summary.qualifiedRatePercent).toBe(33.3);
    expect(summary.onboardedRatePercent).toBe(33.3);
  });
  it("returns zero counts for campaigns with no loaded records", () => {
    expect(summarizeCampaignPerformance([{ id: "c1", name: "Empty" }], [], [])[0]).toEqual({
      campaignId: "c1", campaignName: "Empty", loadedLeadCount: 0, qualifiedLeadCount: 0, contactedLeadCount: 0,
      onboardedLeadCount: 0, qualifiedRatePercent: 0, onboardedRatePercent: 0, restrictedLeadCount: 0, loadedDraftCount: 0, draftsAwaitingReview: 0,
    });
  });
});

describe("summarizeLeadSourcePerformance", () => {
  it("reports source-level funnel counts and rates using loaded records only", () => {
    expect(summarizeLeadSourcePerformance([
      { source: "linkedin_csv", status: "qualified" },
      { source: "linkedin_csv", status: "new" },
      { source: "google_places_manual", status: "onboarded" },
      { source: "google_places_manual", status: "contacted" },
      { source: "", status: "new" },
    ])).toEqual([
      { source: "google_places_manual", loadedLeadCount: 2, qualifiedLeadCount: 0, onboardedLeadCount: 1, qualifiedRatePercent: 0, onboardedRatePercent: 50 },
      { source: "linkedin_csv", loadedLeadCount: 2, qualifiedLeadCount: 1, onboardedLeadCount: 0, qualifiedRatePercent: 50, onboardedRatePercent: 0 },
      { source: "unknown", loadedLeadCount: 1, qualifiedLeadCount: 0, onboardedLeadCount: 0, qualifiedRatePercent: 0, onboardedRatePercent: 0 },
    ]);
  });
  it("returns an empty list for no loaded leads", () => {
    expect(summarizeLeadSourcePerformance([])).toEqual([]);
  });
});
