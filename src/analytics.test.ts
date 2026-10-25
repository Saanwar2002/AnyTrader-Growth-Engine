import { describe, expect, it } from "vitest";
import { serializeCampaignPerformanceCsv, serializeLeadCompletenessCsv, summarizeCampaignPerformance, summarizeLeadSourcePerformance } from "./analytics";
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

describe("serializeCampaignPerformanceCsv", () => {
  it("exports loaded-only scope, funnel metrics, and correctly escaped campaign names", () => {
    const summaries = summarizeCampaignPerformance([{ id: "c1", name: 'Painters, "North"' }], [
      { campaignId: "c1", status: "qualified", doNotContact: true, contactRestrictionVerified: false },
      { campaignId: "c1", status: "onboarded", doNotContact: false, contactRestrictionVerified: true },
    ], []);
    const csv = serializeCampaignPerformanceCsv(summaries);
    expect(csv.split("\r\n")[0]).toContain("Scope,Campaign,Loaded leads,Qualified,Contacted,Onboarded");
    expect(csv).toContain('Loaded records only,"Painters, ""North""",2,1,0,1,50.0,50.0');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
  it("exports a header-only file when no campaign summaries are loaded", () => {
    const csv = serializeCampaignPerformanceCsv([]);
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv).toContain("Drafts needing review");
  });
});


describe("serializeOnboardingCohortCsv", () => {
  it("exports all cohort buckets with timestamp scope and escaped attribution caveat", async () => {
    const { serializeOnboardingCohortCsv } = await import("./analytics");
    const csv = serializeOnboardingCohortCsv([
      { month: "2026-09", onboardedLeadCount: 2 },
      { month: "2026-10", onboardedLeadCount: 4 },
    ], 'Legacy records may be excluded, "review backfill".');
    expect(csv.split("\r\n")[0]).toBe("Scope,UTC month,First onboardings,Attribution note");
    expect(csv).toContain('First server-recorded onboarding timestamp,2026-09,2,"Legacy records may be excluded, ""review backfill"".');
    expect(csv).toContain("2026-10,4");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("exports a header-only file when the summary has no buckets", async () => {
    const { serializeOnboardingCohortCsv } = await import("./analytics");
    const csv = serializeOnboardingCohortCsv([], "Timestamped records only.");
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv).toContain("Attribution note");
  });
});

import { serializeFullCampaignFunnelCsv } from "./analytics";

it("serializes full server-side campaign funnel counts with an explicit all-stored scope and escaped names", () => {
  const csv = serializeFullCampaignFunnelCsv([{
    campaignName: 'Roofers, "North"', totalLeadCount: 120, qualifiedLeadCount: 30,
    contactedLeadCount: 20, onboardedLeadCount: 8, qualifiedRatePercent: 25, onboardedRatePercent: 6.7,
  }]);
  expect(csv).toContain("All stored campaign leads,\"Roofers, \"\"North\"\"\",120,30,20,8,25.0,6.7");
  expect(csv.startsWith("Scope,Campaign,All stored leads,Qualified,Contacted,Onboarded,Qualified rate (%),Onboarded rate (%)\r\n")).toBe(true);
});


import { serializeFullLeadSourceFunnelCsv } from "./analytics";

describe("serializeFullLeadSourceFunnelCsv", () => {
  it("exports all-stored source aggregates, attribution caveat, and escaped self-declared labels", () => {
    const csv = serializeFullLeadSourceFunnelCsv([{
      source: 'linkedin, "manual"',
      totalLeadCount: 10,
      qualifiedLeadCount: 3,
      onboardedLeadCount: 1,
      qualifiedRatePercent: 30,
      onboardedRatePercent: 10,
    }], "Self-declared source; unknown values include legacy records.");
    expect(csv).toContain('All stored organisation leads,"linkedin, ""manual""",10,3,1,30.0,10.0,Self-declared source; unknown values include legacy records.');
    expect(csv.startsWith("Scope,Source (self-declared),All stored leads,Qualified,Onboarded,Qualified rate (%),Onboarded rate (%),Attribution note\r\n")).toBe(true);
  });

  it("neutralises spreadsheet formula prefixes and preserves the note for an empty report", () => {
    const csv = serializeFullLeadSourceFunnelCsv([{
      source: '=HYPERLINK("https://bad.example")',
      totalLeadCount: 1,
      qualifiedLeadCount: 0,
      onboardedLeadCount: 0,
      qualifiedRatePercent: 0,
      onboardedRatePercent: 0,
    }], "Source values are self-declared.");
    expect(csv).toContain(`"'=HYPERLINK(""https://bad.example"")"`);
    const empty = serializeFullLeadSourceFunnelCsv([], "Legacy source attribution may be incomplete.");
    expect(empty).toContain("No source-labelled records,0,0,0,0.0,0.0,Legacy source attribution may be incomplete.");
    expect(empty.endsWith("\r\n")).toBe(true);
  });
});


describe("analytics CSV spreadsheet formula safety", () => {
  it("neutralises formulas in loaded and full campaign names", () => {
    const loaded = serializeCampaignPerformanceCsv([{
      campaignId: "c1", campaignName: "  =HYPERLINK(1)", loadedLeadCount: 1,
      qualifiedLeadCount: 0, contactedLeadCount: 0, onboardedLeadCount: 0,
      qualifiedRatePercent: 0, onboardedRatePercent: 0, restrictedLeadCount: 0,
      loadedDraftCount: 0, draftsAwaitingReview: 0,
    }]);
    expect(loaded).toContain("'  =HYPERLINK(1)");

    const full = serializeFullCampaignFunnelCsv([{
      campaignName: "+SUM(A1:A2)", totalLeadCount: 1, qualifiedLeadCount: 0,
      contactedLeadCount: 0, onboardedLeadCount: 0, qualifiedRatePercent: 0, onboardedRatePercent: 0,
    }]);
    expect(full).toContain("'+SUM(A1:A2)");
  });

  it("neutralises formula-like attribution notes in cohort exports", async () => {
    const { serializeOnboardingCohortCsv } = await import("./analytics");
    const csv = serializeOnboardingCohortCsv([{ month: "2026-10", onboardedLeadCount: 2 }], "@SUM(A1)");
    expect(csv).toContain("'@SUM(A1)");
  });
});


describe("summarizeCampaignReadiness", () => {
  const campaign = { id: "c1", name: "Roofers", brand: "AnyTrader", category: "Roofers", location: "Leeds" };
  const safeLead = {
    campaignId: "c1", status: "qualified", source: "linkedin_csv", doNotContact: false,
    contactRestrictionVerified: true, contactReviewStatus: "cleared" as const,
  };

  it("only reports ready for manual review when loaded records have no known blockers", async () => {
    const { summarizeCampaignReadiness } = await import("./analytics");
    const result = summarizeCampaignReadiness([campaign], [safeLead], [{ campaignId: "c1", requiresReview: false }], {
      hasMoreCampaigns: false, hasMoreLeads: false, hasMoreDrafts: false,
    });
    expect(result[0]).toMatchObject({
      status: "ready_for_manual_review", scope: "loaded_records_only", loadedLeadCount: 1,
      contactRestrictedLeadCount: 0, draftsAwaitingReview: 0, sourceAttributionMissingCount: 0,
      missingConfigurationFields: [], hasMoreData: false,
    });
  });

  it("marks incomplete coverage ahead of any optimistic readiness status", async () => {
    const { summarizeCampaignReadiness } = await import("./analytics");
    const result = summarizeCampaignReadiness([campaign], [safeLead], [], {
      hasMoreCampaigns: false, hasMoreLeads: true, hasMoreDrafts: false,
    });
    expect(result[0].status).toBe("incomplete");
    expect(result[0].hasMoreData).toBe(true);
  });

  it("blocks missing setup or contact restrictions and flags source/draft review", async () => {
    const { summarizeCampaignReadiness } = await import("./analytics");
    const blocked = summarizeCampaignReadiness([{ ...campaign, location: " " }], [{
      ...safeLead, doNotContact: true, source: "unknown",
    }], [{ campaignId: "c1", requiresReview: true }], {
      hasMoreCampaigns: false, hasMoreLeads: false, hasMoreDrafts: false,
    })[0];
    expect(blocked.status).toBe("blocked");
    expect(blocked.missingConfigurationFields).toContain("location");
    expect(blocked.contactRestrictedLeadCount).toBe(1);
    expect(blocked.draftsAwaitingReview).toBe(1);
    expect(blocked.sourceAttributionMissingCount).toBe(1);

    const review = summarizeCampaignReadiness([campaign], [safeLead], [{ campaignId: "c1", requiresReview: true }], {
      hasMoreCampaigns: false, hasMoreLeads: false, hasMoreDrafts: false,
    })[0];
    expect(review.status).toBe("review_required");
  });
  it("exports loaded security audit events with explicit scope and spreadsheet-safe cells", async () => {
    const { serializeSecurityAuditEventsCsv } = await import("./analytics");
    const csv = serializeSecurityAuditEventsCsv([{
      createdAt: "2026-10-25T12:00:00.000Z",
      eventType: '=HYPERLINK("https://example.test","click")',
      actorUid: "@SUM(1,1)",
      resourceType: "lead",
      resourceId: "-42",
      outcome: "success",
      metadata: { leadStatus: "qualified" },
    }]);
    expect(csv).toContain("Loaded audit events only");
    expect(csv).toContain("Event time (UTC)");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'@SUM");
    expect(csv).toContain("'-42");
    expect(csv).toContain('"{""leadStatus"":""qualified""}"');
  });

  it("exports an explicit empty-row marker when no audit events are loaded", async () => {
    const { serializeSecurityAuditEventsCsv } = await import("./analytics");
    const csv = serializeSecurityAuditEventsCsv([]);
    expect(csv).toContain("Loaded audit events only");
    expect(csv).toContain("No audit events loaded");
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("exports campaign readiness with loaded-only scope, blockers and outreach boundary", async () => {
    const { serializeCampaignReadinessCsv } = await import("./analytics");
    const csv = serializeCampaignReadinessCsv([{
      campaignName: '=Roofers, "Leeds"',
      status: "incomplete",
      scope: "loaded_records_only",
      loadedLeadCount: 7,
      contactRestrictedLeadCount: 2,
      draftsAwaitingReview: 1,
      sourceAttributionMissingCount: 3,
      missingConfigurationFields: ["location", "brand"],
      hasMoreData: true,
    }]);
    expect(csv).toContain("Loaded records only");
    expect(csv).toContain(`"\'=Roofers, ""Leeds"""`);
    expect(csv).toContain("Incomplete — more pages available");
    expect(csv).toContain("location | brand");
    expect(csv).toContain("Preflight only; manual review required; does not authorise outreach");
  });

  it("makes an empty campaign readiness export explicit", async () => {
    const { serializeCampaignReadinessCsv } = await import("./analytics");
    const csv = serializeCampaignReadinessCsv([]);
    expect(csv).toContain("No campaigns loaded");
    expect(csv).toContain("does not authorise outreach");
    expect(csv.split("\r\n")).toHaveLength(3);
  });

});

describe("serializeLeadCompletenessCsv", () => {
  it("exports all-tenant score bands and clearly states that completeness is not quality", () => {
    const csv = serializeLeadCompletenessCsv({
      totalLeadCount: 9,
      lowCount: 2,
      mediumCount: 3,
      highCount: 3,
      unclassifiedCount: 1,
      note: "Completeness is not a quality, consent, or contactability guarantee.",
    });
    expect(csv).toContain("All stored organisation leads,Low (0–39),2");
    expect(csv).toContain("All stored organisation leads,Unclassified,1");
    expect(csv).toContain("All stored organisation leads,Total,9");
    expect(csv).toContain("not a quality, consent, or contactability guarantee");
  });

  it("neutralises formula-leading note text in the report", () => {
    const csv = serializeLeadCompletenessCsv({
      totalLeadCount: 1,
      lowCount: 1,
      mediumCount: 0,
      highCount: 0,
      unclassifiedCount: 0,
      note: "=HYPERLINK(\"https://example.test\",\"open\")",
    });
    expect(csv).toContain("'=HYPERLINK");
  });
});

describe("serializeFullCampaignReadinessCsv", () => {
  it("exports server-counted readiness metrics with an explicit bounded-coverage note", async () => {
    const { serializeFullCampaignReadinessCsv } = await import("./analytics");
    const csv = serializeFullCampaignReadinessCsv({
      campaigns: [{
        campaignName: "Painter pilot",
        campaignStatus: "active",
        status: "review_required",
        totalLeadCount: 12,
        pendingOrBlockedLeadCount: 2,
        suppressedLeadCount: 1,
        legacyReviewStatusLeadCount: 3,
        draftsAwaitingReview: 4,
        sourceAttributionMissingCount: 2,
        missingConfigurationFields: [],
      }],
      hasMoreCampaigns: true,
      campaignLimit: 20,
      note: "Source labels remain self-declared and unverified.",
    });
    expect(csv).toContain("Server-counted campaign readiness,Painter pilot,active,review_required,12,2,1,3,4,2");
    expect(csv).toContain("Incomplete — additional campaigns beyond the 20-campaign limit are not included");
    expect(csv).toContain("Source labels remain self-declared and unverified.");
  });

  it("neutralises formula-leading campaign names and emits an explicit empty report row", async () => {
    const { serializeFullCampaignReadinessCsv } = await import("./analytics");
    const csv = serializeFullCampaignReadinessCsv({
      campaigns: [{
        campaignName: "=HYPERLINK(\"https://example.test\",\"open\")",
        campaignStatus: "active",
        status: "blocked",
        totalLeadCount: 0,
        pendingOrBlockedLeadCount: 0,
        suppressedLeadCount: 0,
        legacyReviewStatusLeadCount: 0,
        draftsAwaitingReview: 0,
        sourceAttributionMissingCount: 0,
        missingConfigurationFields: ["brand"],
      }],
      hasMoreCampaigns: false,
      campaignLimit: 20,
      note: "No outreach is sent.",
    });
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("Complete within the 20-campaign limit");
    const empty = serializeFullCampaignReadinessCsv({ campaigns: [], hasMoreCampaigns: false, campaignLimit: 20, note: "No campaigns." });
    expect(empty).toContain("No campaigns returned");
    expect(empty.split("\r\n")).toHaveLength(3);
  });
});


describe("classifyLeadFollowUpDate", () => {
  it("classifies date-only follow-ups against the supplied UTC day", async () => {
    const { classifyLeadFollowUpDate } = await import("./analytics");
    expect(classifyLeadFollowUpDate("2026-10-24", "2026-10-25")).toBe("overdue");
    expect(classifyLeadFollowUpDate("2026-10-25", "2026-10-25")).toBe("today");
    expect(classifyLeadFollowUpDate("2026-10-26", "2026-10-25")).toBe("upcoming");
    expect(classifyLeadFollowUpDate(null, "2026-10-25")).toBe("unscheduled");
    expect(classifyLeadFollowUpDate("", "2026-10-25")).toBe("unscheduled");
  });

  it("fails closed for malformed or impossible calendar dates", async () => {
    const { classifyLeadFollowUpDate } = await import("./analytics");
    expect(classifyLeadFollowUpDate("2026-02-30", "2026-10-25")).toBe("unclassified");
    expect(classifyLeadFollowUpDate("2026-1-01", "2026-10-25")).toBe("unclassified");
    expect(classifyLeadFollowUpDate("2026-10-24", "not-a-date")).toBe("unclassified");
  });
});
