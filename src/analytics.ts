function escapeAnalyticsCsvCell(value: string | number): string {
  let text = String(value);
  const first = text.trimStart().charAt(0);
  if (["=", "+", "-", "@"].includes(first) || text.startsWith("\t") || text.startsWith("\r") || text.startsWith("\n")) {
    text = "'" + text;
  }
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export interface CampaignPerformanceCampaign { id: string; name: string; }
export interface CampaignPerformanceLead {
  campaignId: string; status: string; doNotContact: boolean; contactRestrictionVerified: boolean;
  contactReviewStatus?: "pending" | "cleared" | "blocked";
}
export interface CampaignPerformanceDraft { campaignId: string; requiresReview: boolean; }
export interface CampaignPerformanceSummary {
  campaignId: string; campaignName: string; loadedLeadCount: number; qualifiedLeadCount: number;
  contactedLeadCount: number; onboardedLeadCount: number; qualifiedRatePercent: number; onboardedRatePercent: number;
  restrictedLeadCount: number; loadedDraftCount: number; draftsAwaitingReview: number;
}
/** Summarise only supplied (potentially paginated) records; never imply global completeness. */
export function summarizeCampaignPerformance(
  campaigns: CampaignPerformanceCampaign[], leads: CampaignPerformanceLead[], drafts: CampaignPerformanceDraft[],
): CampaignPerformanceSummary[] {
  return campaigns.map((campaign) => {
    const campaignLeads = leads.filter((lead) => lead.campaignId === campaign.id);
    const campaignDrafts = drafts.filter((draft) => draft.campaignId === campaign.id);
    return {
      campaignId: campaign.id, campaignName: campaign.name, loadedLeadCount: campaignLeads.length,
      qualifiedLeadCount: campaignLeads.filter((lead) => lead.status === "qualified").length,
      contactedLeadCount: campaignLeads.filter((lead) => lead.status === "contacted").length,
      onboardedLeadCount: campaignLeads.filter((lead) => lead.status === "onboarded").length,
      qualifiedRatePercent: campaignLeads.length ? Math.round((campaignLeads.filter((lead) => lead.status === "qualified").length / campaignLeads.length) * 1000) / 10 : 0,
      onboardedRatePercent: campaignLeads.length ? Math.round((campaignLeads.filter((lead) => lead.status === "onboarded").length / campaignLeads.length) * 1000) / 10 : 0,
      restrictedLeadCount: campaignLeads.filter((lead) => lead.doNotContact || !lead.contactRestrictionVerified
        || lead.contactReviewStatus === "pending" || lead.contactReviewStatus === "blocked").length,
      loadedDraftCount: campaignDrafts.length,
      draftsAwaitingReview: campaignDrafts.filter((draft) => draft.requiresReview).length,
    };
  });
}

export type CampaignReadinessStatus = "incomplete" | "blocked" | "review_required" | "ready_for_manual_review";
export interface CampaignReadinessSummary {
  campaignId: string;
  campaignName: string;
  status: CampaignReadinessStatus;
  scope: "loaded_records_only";
  loadedLeadCount: number;
  contactRestrictedLeadCount: number;
  draftsAwaitingReview: number;
  sourceAttributionMissingCount: number;
  missingConfigurationFields: string[];
  hasMoreData: boolean;
}

/**
 * Conservative read-only preflight over currently loaded records. This is not
 * permission to contact prospects; it never sends messages or mutates records.
 */
export function summarizeCampaignReadiness(
  campaigns: Array<{ id: string; name: string; brand: string; category: string; location: string }>,
  leads: Array<{
    campaignId: string; status: string; source?: string; doNotContact: boolean;
    contactRestrictionVerified: boolean; contactReviewStatus?: "pending" | "cleared" | "blocked";
  }>,
  drafts: Array<{ campaignId: string; requiresReview: boolean }>,
  coverage: { hasMoreCampaigns: boolean; hasMoreLeads: boolean; hasMoreDrafts: boolean },
): CampaignReadinessSummary[] {
  const hasMoreData = coverage.hasMoreCampaigns || coverage.hasMoreLeads || coverage.hasMoreDrafts;
  return campaigns.map((campaign) => {
    const campaignLeads = leads.filter((lead) => lead.campaignId === campaign.id);
    const campaignDrafts = drafts.filter((draft) => draft.campaignId === campaign.id);
    const missingConfigurationFields = ([
      ["name", campaign.name],
      ["brand", campaign.brand],
      ["category", campaign.category],
      ["location", campaign.location],
    ] as const).filter(([, value]) => !value.trim()).map(([field]) => field);
    const contactRestrictedLeadCount = campaignLeads.filter((lead) =>
      lead.doNotContact || !lead.contactRestrictionVerified
      || lead.contactReviewStatus === "pending" || lead.contactReviewStatus === "blocked").length;
    const draftsAwaitingReview = campaignDrafts.filter((draft) => draft.requiresReview).length;
    const sourceAttributionMissingCount = campaignLeads.filter((lead) =>
      typeof lead.source !== "string" || !lead.source.trim() || lead.source.trim().toLowerCase() === "unknown").length;
    const status: CampaignReadinessStatus = hasMoreData
      ? "incomplete"
      : missingConfigurationFields.length > 0 || campaignLeads.length === 0 || contactRestrictedLeadCount > 0
        ? "blocked"
        : draftsAwaitingReview > 0 || sourceAttributionMissingCount > 0
          ? "review_required"
          : "ready_for_manual_review";
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      status,
      scope: "loaded_records_only",
      loadedLeadCount: campaignLeads.length,
      contactRestrictedLeadCount,
      draftsAwaitingReview,
      sourceAttributionMissingCount,
      missingConfigurationFields,
      hasMoreData,
    };
  });
}

export interface LeadSourcePerformanceLead { source: string; status: string; }
export interface LeadSourcePerformanceSummary {
  source: string; loadedLeadCount: number; qualifiedLeadCount: number; onboardedLeadCount: number;
  qualifiedRatePercent: number; onboardedRatePercent: number;
}
/** Group only supplied loaded records. Source values are user-declared attribution, not verified compliance evidence. */
export function summarizeLeadSourcePerformance(leads: LeadSourcePerformanceLead[]): LeadSourcePerformanceSummary[] {
  const grouped = new Map<string, LeadSourcePerformanceLead[]>();
  for (const lead of leads) {
    const source = typeof lead.source === "string" && lead.source.trim() ? lead.source.trim() : "unknown";
    const current = grouped.get(source) ?? [];
    current.push(lead);
    grouped.set(source, current);
  }
  return [...grouped.entries()].map(([source, rows]) => {
    const qualifiedLeadCount = rows.filter((lead) => lead.status === "qualified").length;
    const onboardedLeadCount = rows.filter((lead) => lead.status === "onboarded").length;
    return {
      source, loadedLeadCount: rows.length, qualifiedLeadCount, onboardedLeadCount,
      qualifiedRatePercent: Math.round((qualifiedLeadCount / rows.length) * 1000) / 10,
      onboardedRatePercent: Math.round((onboardedLeadCount / rows.length) * 1000) / 10,
    };
  }).sort((a, b) => b.loadedLeadCount - a.loadedLeadCount || a.source.localeCompare(b.source));
}

/** Export only the supplied campaign summaries; every row explicitly labels its page-limited scope. */
export function serializeCampaignPerformanceCsv(summaries: CampaignPerformanceSummary[]): string {
  const escapeCell = escapeAnalyticsCsvCell;
  const headers = [
    "Scope", "Campaign", "Loaded leads", "Qualified", "Contacted", "Onboarded",
    "Qualified rate (%)", "Onboarded rate (%)", "Restricted/review needed", "Loaded drafts", "Drafts needing review",
  ];
  const rows = summaries.map((item) => [
    "Loaded records only", item.campaignName, item.loadedLeadCount, item.qualifiedLeadCount,
    item.contactedLeadCount, item.onboardedLeadCount, item.qualifiedRatePercent.toFixed(1),
    item.onboardedRatePercent.toFixed(1), item.restrictedLeadCount, item.loadedDraftCount, item.draftsAwaitingReview,
  ]);
  return [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}


/** Export server-counted onboarding cohorts with their timestamp scope and legacy-data caveat. */
export function serializeOnboardingCohortCsv(
  cohorts: Array<{ month: string; onboardedLeadCount: number }>,
  attributionNote: string,
): string {
  const escapeCell = escapeAnalyticsCsvCell;
  const headers = ["Scope", "UTC month", "First onboardings", "Attribution note"];
  const rows = cohorts.map((cohort) => [
    "First server-recorded onboarding timestamp",
    cohort.month,
    cohort.onboardedLeadCount,
    attributionNote,
  ]);
  return [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}

/** Export server-counted completeness bands without including individual lead records. */
export function serializeLeadCompletenessCsv(summary: {
  totalLeadCount: number;
  lowCount: number;
  mediumCount: number;
  highCount: number;
  unclassifiedCount: number;
  note: string;
}): string {
  const headers = ["Scope", "Completeness band", "Lead count", "Interpretation"];
  const scope = "All stored organisation leads";
  const rows = [
    [scope, "Low (0–39)", summary.lowCount, summary.note],
    [scope, "Medium (40–69)", summary.mediumCount, summary.note],
    [scope, "High (70–100)", summary.highCount, summary.note],
    [scope, "Unclassified", summary.unclassifiedCount, summary.note],
    [scope, "Total", summary.totalLeadCount, summary.note],
  ];
  return [headers, ...rows].map((row) => row.map(escapeAnalyticsCsvCell).join(",")).join("\r\n") + "\r\n";
}

/** Export server-side funnel totals across all stored leads, not just loaded UI pages. */
export function serializeFullCampaignFunnelCsv(
  summaries: Array<{
    campaignName: string;
    totalLeadCount: number;
    qualifiedLeadCount: number;
    contactedLeadCount: number;
    onboardedLeadCount: number;
    qualifiedRatePercent: number;
    onboardedRatePercent: number;
  }>,
): string {
  const escapeCell = escapeAnalyticsCsvCell;
  const headers = [
    "Scope", "Campaign", "All stored leads", "Qualified", "Contacted", "Onboarded",
    "Qualified rate (%)", "Onboarded rate (%)",
  ];
  const rows = summaries.map((item) => [
    "All stored campaign leads", item.campaignName, item.totalLeadCount, item.qualifiedLeadCount,
    item.contactedLeadCount, item.onboardedLeadCount, item.qualifiedRatePercent.toFixed(1),
    item.onboardedRatePercent.toFixed(1),
  ]);
  return [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}


/** Export server-counted source funnel totals across every stored organisation lead. */
export function serializeFullLeadSourceFunnelCsv(
  summaries: Array<{
    source: string;
    totalLeadCount: number;
    qualifiedLeadCount: number;
    onboardedLeadCount: number;
    qualifiedRatePercent: number;
    onboardedRatePercent: number;
  }>,
  attributionNote: string,
): string {
  const escapeCell = escapeAnalyticsCsvCell;
  const headers = [
    "Scope", "Source (self-declared)", "All stored leads", "Qualified", "Onboarded",
    "Qualified rate (%)", "Onboarded rate (%)", "Attribution note",
  ];
  const rows = summaries.length
    ? summaries.map((item) => [
        "All stored organisation leads", item.source, item.totalLeadCount, item.qualifiedLeadCount,
        item.onboardedLeadCount, item.qualifiedRatePercent.toFixed(1),
        item.onboardedRatePercent.toFixed(1), attributionNote,
      ])
    : [[
        "All stored organisation leads", "No source-labelled records", 0, 0, 0, "0.0", "0.0", attributionNote,
      ]];
  return [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}


/** Export only audit events already loaded in the UI; callers must not imply full-history coverage. */
export function serializeSecurityAuditEventsCsv(
  events: Array<{
    createdAt: string | null;
    eventType: string;
    actorUid: string;
    resourceType: string;
    resourceId: string;
    outcome: string;
    metadata: Record<string, string | number | boolean>;
  }>,
): string {
  const escapeCell = escapeAnalyticsCsvCell;
  const headers = [
    "Scope", "Event time (UTC)", "Action", "Actor ID", "Resource type", "Resource ID", "Outcome", "Approved metadata",
  ];
  const rows = events.length
    ? events.map((event) => [
        "Loaded audit events only",
        event.createdAt ?? "",
        event.eventType,
        event.actorUid,
        event.resourceType,
        event.resourceId,
        event.outcome,
        JSON.stringify(event.metadata),
      ])
    : [["Loaded audit events only", "", "No audit events loaded", "", "", "", "", ""]];
  return [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}


/** Export the conservative readiness preflight for loaded records only; it never authorises outreach. */
export function serializeCampaignReadinessCsv(
  summaries: Array<{
    campaignName: string;
    status: string;
    scope: "loaded_records_only";
    loadedLeadCount: number;
    contactRestrictedLeadCount: number;
    draftsAwaitingReview: number;
    sourceAttributionMissingCount: number;
    missingConfigurationFields: string[];
    hasMoreData: boolean;
  }>,
): string {
  const escapeCell = escapeAnalyticsCsvCell;
  const headers = [
    "Scope", "Campaign", "Readiness status", "Loaded leads", "Contact restrictions / review",
    "Drafts needing review", "Missing source labels", "Missing setup fields", "Coverage", "Action boundary",
  ];
  const rows = summaries.length
    ? summaries.map((item) => [
        "Loaded records only",
        item.campaignName,
        item.status === "ready_for_manual_review" ? "Ready for manual review" : item.status.replace(/_/g, " "),
        item.loadedLeadCount,
        item.contactRestrictedLeadCount,
        item.draftsAwaitingReview,
        item.sourceAttributionMissingCount,
        item.missingConfigurationFields.length ? item.missingConfigurationFields.join(" | ") : "None",
        item.hasMoreData ? "Incomplete — more pages available" : "Complete for loaded records",
        "Preflight only; manual review required; does not authorise outreach",
      ])
    : [["Loaded records only", "No campaigns loaded", "No readiness result", 0, 0, 0, 0, "Unavailable", "Incomplete", "Preflight only; does not authorise outreach"]];
  return [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}
