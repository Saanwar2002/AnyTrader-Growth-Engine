import { httpsCallable, type Functions } from "firebase/functions";

export type OrganisationRole = "owner" | "admin" | "member" | "viewer";
export type ServerCampaignStatus = "draft" | "active" | "paused" | "completed";
export type ServerLeadStatus = "new" | "reviewing" | "qualified" | "contacted" | "onboarded" | "rejected";
export type CsvImportSourceLabel = "csv_import" | "linkedin_csv" | "google_places_manual" | "other_approved";

export interface CallableInvoker {
  <TRequest, TResponse>(name: string, payload: TRequest): Promise<TResponse>;
}

export interface OrganisationSummary { organisationId: string; name: string; role: OrganisationRole; }
export interface CampaignInput { organisationId: string; idempotencyKey: string; name: string; brand: string; category: string; location: string; goal: string; }
export interface CampaignSummary { id: string; name: string; brand: string; category: string; location: string; goal: string; status: ServerCampaignStatus; createdAt: string | null; }
export interface LeadFieldsInput { organisationId: string; campaignId: string; businessName: string; category?: string; location?: string; website?: string; email?: string; phone?: string; }
export interface LeadInput extends LeadFieldsInput { idempotencyKey: string; }
export interface CsvImportLeadInput { businessName: string; category?: string; location?: string; website?: string; email?: string; phone?: string; }
export interface CsvImportResult { organisationId: string; campaignId: string; received: number; imported: number; duplicatesSkipped: number; leads: Array<{ leadId: string; businessName: string }>; sent: false; messageSentByThisAction: false; }
export interface LeadSummary { id: string; campaignId: string; businessName: string; category: string; location: string; website: string; email: string; phone: string; source: string; status: ServerLeadStatus; score: number; scoreReasons: string[]; notes: string; doNotContact: boolean; contactRestrictionVerified: boolean; contactReviewStatus?: "pending" | "cleared" | "blocked"; contactReviewRevision: number; createdAt: string | null; }
export interface OutreachDraftSummary { id: string; leadId: string; campaignId: string; subject: string; body: string; status: string; leadSuppressed: boolean; requiresReview: boolean; reviewReason: string | null; createdAt: string | null; }

/** Typed boundary for callable functions. All authorisation still happens server-side. */
export function createGrowthEngineApi(call: CallableInvoker) {
  return {
    listMyOrganisations: (pageToken?: string) => call<{ pageToken?: string }, { organisations: OrganisationSummary[]; hasMoreOrganisations: boolean; nextPageToken: string | null }>("listMyOrganisations", pageToken ? { pageToken } : {}),
    createOrganisation: (payload: { name: string; idempotencyKey: string }) => call<typeof payload, OrganisationSummary>("createOrganisation", payload),
    updateOrganisationSettings: (payload: { organisationId: string; name: string }) => call<typeof payload, { organisationId: string; name: string }>("updateOrganisationSettings", payload),
    createCampaign: (payload: CampaignInput) => call<CampaignInput, { campaignId: string; status: ServerCampaignStatus }>("createCampaign", payload),
    updateCampaignStatus: (payload: { organisationId: string; campaignId: string; status: ServerCampaignStatus }) => call<typeof payload, { campaignId: string; status: ServerCampaignStatus }>("updateCampaignStatus", payload),
    updateCampaignDetails: (payload: { organisationId: string; campaignId: string; name: string; brand: string; category: string; location: string; goal: string }) => call<typeof payload, { campaignId: string; name: string; brand: string; category: string; location: string; goal: string }>("updateCampaignDetails", payload),
    listCampaigns: (payload: { organisationId: string; pageToken?: string }) => call<typeof payload, { campaigns: CampaignSummary[]; hasMoreCampaigns: boolean; nextPageToken: string | null }>("listCampaigns", payload),
    listLeads: (payload: { organisationId: string; pageToken?: string }) => call<typeof payload, { leads: LeadSummary[]; hasMoreLeads: boolean; nextPageToken: string | null }>("listLeads", payload),
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
