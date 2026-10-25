import { httpsCallable, type Functions } from "firebase/functions";

export type OrganisationRole = "owner" | "admin" | "member" | "viewer";
export type ServerCampaignStatus = "draft" | "active" | "paused" | "completed";
export type ServerLeadStatus = "new" | "reviewing" | "qualified" | "contacted" | "onboarded" | "rejected";
export type CsvImportSourceLabel = "csv_import" | "linkedin_csv" | "google_places_manual" | "other_approved";

export interface CallableInvoker {
  <TRequest, TResponse>(name: string, payload: TRequest): Promise<TResponse>;
}

export interface OrganisationSummary { organisationId: string; name: string; role: OrganisationRole; }
export interface OrganisationMemberSummary { uid: string; email: string | null; role: OrganisationRole; createdAt: string | null; }
export interface OrganisationMemberRoster { organisationId: string; members: OrganisationMemberSummary[]; hasMoreMembers: boolean; nextPageToken: string | null; scope: "organisation_member_roster"; }
export type OffboardingPreviewCategory = "members" | "campaigns" | "leads" | "leadActivities" | "outreachDrafts" | "securityAuditEvents" | "campaignCreationIdempotency" | "importIdempotency" | "leadCreationIdempotency" | "outreachDraftCreationIdempotency";
export interface OffboardingPreviewCategoryResult { category: OffboardingPreviewCategory; status: "complete" | "limit_reached" | "unavailable"; exactCount: number | null; observedCount: number; }
export interface OffboardingPreviewResult { complete: boolean; destructiveActionPerformed: false; maxRecordsPerCategory: number; categories: OffboardingPreviewCategoryResult[]; }
export interface CampaignInput { organisationId: string; idempotencyKey: string; name: string; brand: string; category: string; location: string; goal: string; }
export interface CampaignSummary { id: string; name: string; brand: string; category: string; location: string; goal: string; status: ServerCampaignStatus; createdAt: string | null; }
export interface CampaignFunnelAnalyticsSummary { organisationId: string; campaignId: string; totalLeadCount: number; qualifiedLeadCount: number; contactedLeadCount: number; onboardedLeadCount: number; qualifiedRatePercent: number; onboardedRatePercent: number; scope: "all_stored_campaign_leads"; }
export interface LeadSourceFunnelSummary { source: string; totalLeadCount: number; qualifiedLeadCount: number; onboardedLeadCount: number; qualifiedRatePercent: number; onboardedRatePercent: number; }
export interface LeadSourceFunnelAnalytics { organisationId: string; sourceSummaries: LeadSourceFunnelSummary[]; scope: "all_stored_organisation_leads"; attributionNote: string; }
export interface OnboardingCohort { month: string; onboardedLeadCount: number; }
export interface OnboardingCohortAnalytics { organisationId: string; cohorts: OnboardingCohort[]; scope: "first_onboarding_timestamp"; windowMonths: 12; attributionNote: string; }
export interface PlanUsageCounters { campaigns: number; leads: number; members: number; monthlyAiSuggestions: number; }
export interface OrganisationPlanUsageSummary {
  organisationId: string;
  status: "authoritative" | "reconciliation_required";
  plan: { id: "pilot"; displayName: string; limits: PlanUsageCounters };
  usage: PlanUsageCounters | null;
  remaining: PlanUsageCounters | null;
  aiUsagePeriod: string | null;
  message: string;
}
export interface PlanUsageReconciliationSummary {
  organisationId: string;
  status: "missing" | "invalid" | "present";
  actual: Pick<PlanUsageCounters, "campaigns" | "leads" | "members">;
  stored: (PlanUsageCounters & { aiUsagePeriod: string }) | null;
  mismatchedMetrics: Array<"campaigns" | "leads" | "members">;
  aiUsageReviewRequired: true;
  currentAiUsagePeriod: string | null;
  notes: string[];
  destructiveActionPerformed: false;
}
export interface LeadFieldsInput { organisationId: string; campaignId: string; businessName: string; category?: string; location?: string; website?: string; email?: string; phone?: string; }
export interface LeadInput extends LeadFieldsInput { idempotencyKey: string; }
export interface CsvImportLeadInput { businessName: string; category?: string; location?: string; website?: string; email?: string; phone?: string; }
export interface CsvImportResult { organisationId: string; campaignId: string; received: number; imported: number; duplicatesSkipped: number; leads: Array<{ leadId: string; businessName: string }>; sent: false; messageSentByThisAction: false; }
export interface LeadActivityTimeline {
  organisationId: string;
  leadId: string;
  activities: Array<{ id: string; message: string; createdAt: string | null }>;
  scope: "latest_20_lead_activity_events";
  hasMoreHistory: boolean;
}
export interface LeadSummary { id: string; campaignId: string; businessName: string; category: string; location: string; website: string; email: string; phone: string; source: string; status: ServerLeadStatus; score: number; scoreReasons: string[]; notes: string; doNotContact: boolean; contactRestrictionVerified: boolean; contactReviewStatus?: "pending" | "cleared" | "blocked"; contactReviewRevision: number; onboardedAt: string | null; createdAt: string | null; }
export interface OutreachDraftSummary { id: string; leadId: string; campaignId: string; subject: string; body: string; status: string; leadSuppressed: boolean; requiresReview: boolean; reviewReason: string | null; createdAt: string | null; }

/** Typed boundary for callable functions. All authorisation still happens server-side. */
export function createGrowthEngineApi(call: CallableInvoker) {
  return {
    listMyOrganisations: (pageToken?: string) => call<{ pageToken?: string }, { organisations: OrganisationSummary[]; hasMoreOrganisations: boolean; nextPageToken: string | null }>("listMyOrganisations", pageToken ? { pageToken } : {}),
    createOrganisation: (payload: { name: string; idempotencyKey: string }) => call<typeof payload, OrganisationSummary>("createOrganisation", payload),
    updateOrganisationSettings: (payload: { organisationId: string; name: string }) => call<typeof payload, { organisationId: string; name: string }>("updateOrganisationSettings", payload),
    previewOrganisationOffboarding: (payload: { organisationId: string }) => call<typeof payload, OffboardingPreviewResult>("previewOrganisationOffboarding", payload),
    addOrganisationMember: (payload: { organisationId: string; targetEmail: string; role?: "member" | "viewer"; idempotencyKey: string }) => call<typeof payload, { organisationId: string; uid: string; role: OrganisationRole; added: boolean }>("addOrganisationMember", payload),
    listOrganisationMembers: (payload: { organisationId: string; pageToken?: string }) => call<typeof payload, OrganisationMemberRoster>("listOrganisationMembers", payload),
    removeOrganisationMember: (payload: { organisationId: string; targetUid: string }) => call<typeof payload, { organisationId: string; targetUid: string; removed: boolean }>("removeOrganisationMember", payload),
    updateOrganisationMemberRole: (payload: { organisationId: string; targetUid: string; role: "admin" | "member" | "viewer" }) => call<typeof payload, { organisationId: string; targetUid: string; role: "admin" | "member" | "viewer"; changed: boolean }>("updateOrganisationMemberRole", payload),
    createCampaign: (payload: CampaignInput) => call<CampaignInput, { campaignId: string; status: ServerCampaignStatus }>("createCampaign", payload),
    updateCampaignStatus: (payload: { organisationId: string; campaignId: string; status: ServerCampaignStatus }) => call<typeof payload, { campaignId: string; status: ServerCampaignStatus }>("updateCampaignStatus", payload),
    updateCampaignDetails: (payload: { organisationId: string; campaignId: string; name: string; brand: string; category: string; location: string; goal: string }) => call<typeof payload, { campaignId: string; name: string; brand: string; category: string; location: string; goal: string }>("updateCampaignDetails", payload),
    listCampaigns: (payload: { organisationId: string; pageToken?: string }) => call<typeof payload, { campaigns: CampaignSummary[]; hasMoreCampaigns: boolean; nextPageToken: string | null }>("listCampaigns", payload),
    getCampaignFunnelSummary: (payload: { organisationId: string; campaignId: string }) => call<typeof payload, CampaignFunnelAnalyticsSummary>("getCampaignFunnelSummary", payload),
    getLeadSourceFunnelSummary: (payload: { organisationId: string }) => call<typeof payload, LeadSourceFunnelAnalytics>("getLeadSourceFunnelSummary", payload),
    getOnboardingCohortSummary: (payload: { organisationId: string }) => call<typeof payload, OnboardingCohortAnalytics>("getOnboardingCohortSummary", payload),
    getOrganisationPlanUsage: (payload: { organisationId: string }) => call<typeof payload, OrganisationPlanUsageSummary>("getOrganisationPlanUsage", payload),
    getOrganisationPlanUsageReconciliation: (payload: { organisationId: string }) => call<typeof payload, PlanUsageReconciliationSummary>("getOrganisationPlanUsageReconciliation", payload),
    listLeads: (payload: { organisationId: string; pageToken?: string }) => call<typeof payload, { leads: LeadSummary[]; hasMoreLeads: boolean; nextPageToken: string | null }>("listLeads", payload),
    getLeadActivityTimeline: (payload: { organisationId: string; leadId: string }) => call<typeof payload, LeadActivityTimeline>("getLeadActivityTimeline", payload),
    createLead: (payload: LeadInput) => call<LeadInput, { leadId: string; status: ServerLeadStatus }>("createLead", payload),
    importLeads: (payload: { organisationId: string; campaignId: string; idempotencyKey: string; sourceLabel?: CsvImportSourceLabel; leads: CsvImportLeadInput[] }) => call<typeof payload, CsvImportResult>("importLeads", payload),
    updateLeadContact: (payload: LeadFieldsInput & { leadId: string }) => call<typeof payload, { leadId: string; doNotContact: boolean; contactReviewStatus: "pending" | "cleared" | "blocked"; contactRestrictionVerified: boolean; contactReviewRevision: number }>("updateLeadContact", payload),
    updateLeadStatus: (payload: { organisationId: string; leadId: string; status: ServerLeadStatus }) => call<typeof payload, { leadId: string; status: ServerLeadStatus }>("updateLeadStatus", payload),
    updateLeadNotes: (payload: { organisationId: string; leadId: string; notes: string }) => call<typeof payload, { leadId: string; notes: string }>("updateLeadNotes", payload),
    setLeadSuppression: (payload: { organisationId: string; leadId: string; doNotContact: boolean; contactReviewRevision?: number }) => call<typeof payload, { leadId: string; doNotContact: boolean }>("setLeadSuppression", payload),
    createOutreachDraft: (payload: { organisationId: string; leadId: string; subject: string; body: string; idempotencyKey: string }) => call<typeof payload, { draftId: string; leadId: string; campaignId: string; subject: string; body: string; status: "draft"; sent: false }>("createOutreachDraft", payload),
    suggestOutreachDraft: (payload: { organisationId: string; leadId: string }) => call<typeof payload, { subject: string; body: string; sent: false }>("suggestOutreachDraft", payload),
    listOutreachDrafts: (payload: { organisationId: string; pageToken?: string }) => call<typeof payload, { drafts: OutreachDraftSummary[]; hasMoreDrafts: boolean; nextPageToken: string | null }>("listOutreachDrafts", payload),
    updateOutreachDraft: (payload: { organisationId: string; draftId: string; subject: string; body: string }) => call<typeof payload, { draftId: string; status: "draft"; sent: false }>("updateOutreachDraft", payload),
    deleteOutreachDraft: (payload: { organisationId: string; draftId: string }) => call<typeof payload, { draftId: string; deleted: true; sent: false }>("deleteOutreachDraft", payload),
  };
}

export function createFirebaseCallableInvoker(functions: Functions): CallableInvoker {
  return async <TRequest, TResponse>(name: string, payload: TRequest): Promise<TResponse> => {
    const callable = httpsCallable<TRequest, TResponse>(functions, name);
    const response = await callable(payload);
    return response.data;
  };
}
