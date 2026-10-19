import { httpsCallable, type Functions } from "firebase/functions";

export type OrganisationRole = "owner" | "admin" | "member" | "viewer";
export type ServerCampaignStatus = "draft" | "active" | "paused" | "completed";
export type ServerLeadStatus = "new" | "reviewing" | "qualified" | "contacted" | "onboarded" | "rejected";

export interface CallableInvoker {
  <TRequest, TResponse>(name: string, payload: TRequest): Promise<TResponse>;
}

export interface OrganisationSummary { organisationId: string; name: string; role: OrganisationRole; }
export interface CampaignInput { organisationId: string; name: string; brand: string; category: string; location: string; goal: string; }
export interface CampaignSummary { id: string; name: string; brand: string; category: string; location: string; goal: string; status: ServerCampaignStatus; createdAt: string | null; }
export interface LeadInput { organisationId: string; campaignId: string; businessName: string; category?: string; location?: string; website?: string; email?: string; phone?: string; }
export interface LeadSummary { id: string; campaignId: string; businessName: string; category: string; location: string; website: string; email: string; phone: string; source: string; status: ServerLeadStatus; score: number; scoreReasons: string[]; notes: string; doNotContact: boolean; contactRestrictionVerified: boolean; createdAt: string | null; }
export interface OutreachDraftSummary { id: string; leadId: string; campaignId: string; subject: string; body: string; status: "draft"; leadSuppressed: boolean; requiresReview: boolean; reviewReason: string | null; createdAt: string | null; }

/** Typed boundary for callable functions. All authorisation still happens server-side. */
export function createGrowthEngineApi(call: CallableInvoker) {
  return {
    listMyOrganisations: (pageToken?: string) => call<{ pageToken?: string }, { organisations: OrganisationSummary[]; hasMoreOrganisations: boolean; nextPageToken: string | null }>("listMyOrganisations", pageToken ? { pageToken } : {}),
    createOrganisation: (payload: { name: string }) => call<typeof payload, OrganisationSummary>("createOrganisation", payload),
    createCampaign: (payload: CampaignInput) => call<CampaignInput, { campaignId: string; status: ServerCampaignStatus }>("createCampaign", payload),
    updateCampaignStatus: (payload: { organisationId: string; campaignId: string; status: ServerCampaignStatus }) => call<typeof payload, { campaignId: string; status: ServerCampaignStatus }>("updateCampaignStatus", payload),
    listCampaigns: (payload: { organisationId: string }) => call<typeof payload, { campaigns: CampaignSummary[] }>("listCampaigns", payload),
    listLeads: (payload: { organisationId: string }) => call<typeof payload, { leads: LeadSummary[] }>("listLeads", payload),
    createLead: (payload: LeadInput) => call<LeadInput, { leadId: string; status: ServerLeadStatus }>("createLead", payload),
    updateLeadContact: (payload: LeadInput & { leadId: string }) => call<typeof payload, { leadId: string }>("updateLeadContact", payload),
    updateLeadStatus: (payload: { organisationId: string; leadId: string; status: ServerLeadStatus }) => call<typeof payload, { leadId: string; status: ServerLeadStatus }>("updateLeadStatus", payload),
    updateLeadNotes: (payload: { organisationId: string; leadId: string; notes: string }) => call<typeof payload, { leadId: string; notes: string }>("updateLeadNotes", payload),
    setLeadSuppression: (payload: { organisationId: string; leadId: string; doNotContact: boolean }) => call<typeof payload, { leadId: string; doNotContact: boolean }>("setLeadSuppression", payload),
    createOutreachDraft: (payload: { organisationId: string; leadId: string; subject: string; body: string }) => call<typeof payload, { draftId: string; leadId: string; status: "draft"; sent: false }>("createOutreachDraft", payload),
    listOutreachDrafts: (payload: { organisationId: string }) => call<typeof payload, { drafts: OutreachDraftSummary[] }>("listOutreachDrafts", payload),
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
