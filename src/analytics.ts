export interface CampaignPerformanceCampaign { id: string; name: string; }
export interface CampaignPerformanceLead {
  campaignId: string; status: string; doNotContact: boolean; contactRestrictionVerified: boolean;
  contactReviewStatus?: "pending" | "cleared" | "blocked";
}
export interface CampaignPerformanceDraft { campaignId: string; requiresReview: boolean; }
export interface CampaignPerformanceSummary {
  campaignId: string; campaignName: string; loadedLeadCount: number; qualifiedLeadCount: number;
  onboardedLeadCount: number; restrictedLeadCount: number; loadedDraftCount: number; draftsAwaitingReview: number;
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
      onboardedLeadCount: campaignLeads.filter((lead) => lead.status === "onboarded").length,
      restrictedLeadCount: campaignLeads.filter((lead) => lead.doNotContact || !lead.contactRestrictionVerified
        || lead.contactReviewStatus === "pending" || lead.contactReviewStatus === "blocked").length,
      loadedDraftCount: campaignDrafts.length,
      draftsAwaitingReview: campaignDrafts.filter((draft) => draft.requiresReview).length,
    };
  });
}
