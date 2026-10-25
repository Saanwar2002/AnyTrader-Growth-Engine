import { describe, expect, it } from "vitest";
import { createGrowthEngineApi, type CallableInvoker } from "./backendApi";

function makeInvoker(responses: unknown[] = []) {
  const calls: Array<{ name: string; payload: unknown }> = [];
  const invoke: CallableInvoker = async <TRequest, TResponse>(name: string, payload: TRequest) => {
    calls.push({ name, payload });
    return (responses.shift() ?? {}) as TResponse;
  };
  return { invoke, calls };
}

describe("typed backend API boundary", () => {
  it("passes the stable idempotency key for organisation creation", async () => {
    const response = { organisationId: "org-1", name: "Pilot", role: "owner" as const };
    const { invoke, calls } = makeInvoker([response]);
    const api = createGrowthEngineApi(invoke);
    const payload = { name: "Pilot", idempotencyKey: "organisation-create-key-0001" };
    await expect(api.createOrganisation(payload)).resolves.toEqual(response);
    expect(calls).toEqual([{ name: "createOrganisation", payload }]);
  });

  it("passes member addition through the server-authorised callable with an idempotency key", async () => {
    const response = { organisationId: "org-1", uid: "user-2", role: "viewer" as const, added: true };
    const { invoke, calls } = makeInvoker([response]);
    const api = createGrowthEngineApi(invoke);
    const payload = { organisationId: "org-1", targetEmail: "user-2@example.test", role: "viewer" as const, idempotencyKey: "member-addition-api-key-0001" };
    await expect(api.addOrganisationMember(payload)).resolves.toEqual(response);
    expect(calls).toEqual([{ name: "addOrganisationMember", payload }]);
  });

  it("passes the stable idempotency key for campaign creation", async () => {
    const response = { campaignId: "campaign-1", organisationId: "org-1", status: "active" as const };
    const { invoke, calls } = makeInvoker([response]);
    const api = createGrowthEngineApi(invoke);
    const payload = {
      organisationId: "org-1",
      idempotencyKey: "campaign-create-key-0001",
      name: "Provider pilot",
      brand: "AnyTrader",
      category: "Painters",
      location: "Leeds",
      goal: "Recruit providers",
    };
    await expect(api.createCampaign(payload)).resolves.toEqual(response);
    expect(calls).toEqual([{ name: "createCampaign", payload }]);
  });

  it("requests only the signed-in user's organisations without accepting a client UID", async () => {
    const response = { organisations: [{ organisationId: "org-1", name: "Example", role: "owner" }] };
    const { invoke, calls } = makeInvoker([response]);
    const api = createGrowthEngineApi(invoke);
    await expect(api.listMyOrganisations()).resolves.toEqual(response);
    expect(calls[0]).toEqual({ name: "listMyOrganisations", payload: {} });
  });


  it("passes an organisation cursor token to request the next page", async () => {
    const response = { organisations: [], hasMoreOrganisations: false, nextPageToken: null };
    const { invoke, calls } = makeInvoker([response]);
    const api = createGrowthEngineApi(invoke);
    await expect(api.listMyOrganisations("organisations/org-1/members/user-1")).resolves.toEqual(response);
    expect(calls[0]).toEqual({
      name: "listMyOrganisations",
      payload: { pageToken: "organisations/org-1/members/user-1" },
    });
  });

  it("passes suppression mutations to the server without client-side role claims", async () => {
    const { invoke, calls } = makeInvoker([{ leadId: "lead-1", doNotContact: true }]);
    const api = createGrowthEngineApi(invoke);
    await api.setLeadSuppression({ organisationId: "org-1", leadId: "lead-1", doNotContact: true });
    expect(calls).toEqual([{
      name: "setLeadSuppression",
      payload: { organisationId: "org-1", leadId: "lead-1", doNotContact: true },
    }]);
  });

  it("uses draft-only callable names and has no send operation", async () => {
    const { invoke, calls } = makeInvoker([{ draftId: "draft-1", leadId: "lead-1", status: "draft", sent: false }]);
    const api = createGrowthEngineApi(invoke);
    const result = await api.createOutreachDraft({ organisationId: "org-1", leadId: "lead-1", subject: "Hello", body: "Please review", idempotencyKey: "outreach-draft-api-test-0001" });
    expect(calls[0]?.name).toBe("createOutreachDraft");
    expect(result.sent).toBe(false);
    expect(Object.keys(api).some((key) => /send/i.test(key))).toBe(false);
  });

  it("returns the server's tenant-scoped lead list response", async () => {
    const response = { leads: [{ id: "lead-1", businessName: "Synthetic Example Ltd", doNotContact: false }] };
    const { invoke, calls } = makeInvoker([response]);
    const api = createGrowthEngineApi(invoke);
    await expect(api.listLeads({ organisationId: "org-1" })).resolves.toEqual(response);
    expect(calls[0]).toEqual({ name: "listLeads", payload: { organisationId: "org-1" } });
  });

  it("passes the tenant-scoped campaign cursor to the listing callable", async () => {
    const response = { campaigns: [], hasMoreCampaigns: false, nextPageToken: null };
    const { invoke, calls } = makeInvoker([response]);
    const api = createGrowthEngineApi(invoke);
    await expect(api.listCampaigns({ organisationId: "org-1", pageToken: "organisations/org-1/campaigns/campaign-100" })).resolves.toEqual(response);
    expect(calls[0]).toEqual({
      name: "listCampaigns",
      payload: { organisationId: "org-1", pageToken: "organisations/org-1/campaigns/campaign-100" },
    });
  });

  it("passes tenant-scoped pagination tokens to lead and draft listing callables", async () => {
    const { invoke, calls } = makeInvoker([
      { leads: [], hasMoreLeads: false, nextPageToken: null },
      { drafts: [], hasMoreDrafts: false, nextPageToken: null },
    ]);
    const api = createGrowthEngineApi(invoke);
    await api.listLeads({ organisationId: "org-1", pageToken: "organisations/org-1/leads/lead-100" });
    await api.listOutreachDrafts({ organisationId: "org-1", pageToken: "organisations/org-1/outreachDrafts/draft-100" });
    expect(calls).toEqual([
      { name: "listLeads", payload: { organisationId: "org-1", pageToken: "organisations/org-1/leads/lead-100" } },
      { name: "listOutreachDrafts", payload: { organisationId: "org-1", pageToken: "organisations/org-1/outreachDrafts/draft-100" } },
    ]);
  });

  it("submits reviewed CSV rows through the tenant-scoped idempotent import callable", async () => {
    const response = {
      organisationId: "org-1", campaignId: "campaign-1", received: 2, imported: 1,
      duplicatesSkipped: 1, leads: [{ leadId: "lead-new", businessName: "North Star Roofing" }],
      sent: false as const, messageSentByThisAction: false as const,
    };
    const { invoke, calls } = makeInvoker([response]);
    const api = createGrowthEngineApi(invoke);
    const payload = {
      organisationId: "org-1",
      campaignId: "campaign-1",
      idempotencyKey: "csv-import-key-0001",
      leads: [
        { businessName: "North Star Roofing", category: "Roofers", location: "Leeds", email: "hello@example.test" },
        { businessName: "Duplicate Roofing", category: "Roofers", location: "Leeds", website: "https://duplicate.example" },
      ],
    };

    await expect(api.importLeads(payload)).resolves.toEqual(response);
    expect(calls).toEqual([{ name: "importLeads", payload }]);
    expect(response.sent).toBe(false);
    expect(response.messageSentByThisAction).toBe(false);
  });

  it("passes the stable idempotency key for outreach draft creation", async () => {
    const response = { draftId: "draft-1", leadId: "lead-1", campaignId: "campaign-1", subject: "Review me", body: "Draft only", status: "draft" as const, sent: false as const };
    const { invoke, calls } = makeInvoker([response]);
    const api = createGrowthEngineApi(invoke);
    const payload = { organisationId: "org-1", leadId: "lead-1", subject: "Review me", body: "Draft only", idempotencyKey: "outreach-draft-create-key-0001" };
    await expect(api.createOutreachDraft(payload)).resolves.toEqual(response);
    expect(calls).toEqual([{ name: "createOutreachDraft", payload }]);
  });

});


  it("requests server-side campaign funnel counts for the selected tenant and campaign", async () => {
    const response = {
      organisationId: "org-1",
      campaignId: "campaign-1",
      totalLeadCount: 120,
      qualifiedLeadCount: 30,
      contactedLeadCount: 12,
      onboardedLeadCount: 4,
      qualifiedRatePercent: 25,
      onboardedRatePercent: 3.3,
      scope: "all_stored_campaign_leads" as const,
    };
    const { invoke, calls } = makeInvoker([response]);
    const api = createGrowthEngineApi(invoke);
    await expect(api.getCampaignFunnelSummary({ organisationId: "org-1", campaignId: "campaign-1" })).resolves.toEqual(response);
    expect(calls[0]).toEqual({
      name: "getCampaignFunnelSummary",
      payload: { organisationId: "org-1", campaignId: "campaign-1" },
    });
  });


it("requests complete server-side lead source attribution for the selected organisation", async () => {
  const response = {
    organisationId: "org-1",
    sourceSummaries: [
      { source: "manual", totalLeadCount: 8, qualifiedLeadCount: 2, onboardedLeadCount: 1, qualifiedRatePercent: 25, onboardedRatePercent: 12.5 },
      { source: "unknown", totalLeadCount: 2, qualifiedLeadCount: 0, onboardedLeadCount: 0, qualifiedRatePercent: 0, onboardedRatePercent: 0 },
    ],
    scope: "all_stored_organisation_leads" as const,
    attributionNote: "Source values are self-declared.",
  };
  const { invoke, calls } = makeInvoker([response]);
  const api = createGrowthEngineApi(invoke);
  await expect(api.getLeadSourceFunnelSummary({ organisationId: "org-1" })).resolves.toEqual(response);
  expect(calls[0]).toEqual({
    name: "getLeadSourceFunnelSummary",
    payload: { organisationId: "org-1" },
  });
});


it("requests a read-only organisation offboarding inventory for the selected tenant", async () => {
  const response = {
    complete: false,
    destructiveActionPerformed: false as const,
    maxRecordsPerCategory: 1000,
    categories: [
      { category: "leads" as const, status: "limit_reached" as const, exactCount: null, observedCount: 1000 },
      { category: "securityAuditEvents" as const, status: "unavailable" as const, exactCount: null, observedCount: 2 },
    ],
  };
  const { invoke, calls } = makeInvoker([response]);
  const api = createGrowthEngineApi(invoke);
  await expect(api.previewOrganisationOffboarding({ organisationId: "org-1" })).resolves.toEqual(response);
  expect(calls).toEqual([{ name: "previewOrganisationOffboarding", payload: { organisationId: "org-1" } }]);
  expect(response.destructiveActionPerformed).toBe(false);
});


it("requests server-side monthly onboarding cohorts for the selected organisation", async () => {
  const response = {
    organisationId: "org-1",
    cohorts: [{ month: "2026-10", onboardedLeadCount: 4 }],
    scope: "first_onboarding_timestamp" as const,
    windowMonths: 12 as const,
    attributionNote: "Legacy leads already onboarded before timestamp capture may be excluded.",
  };
  const { invoke, calls } = makeInvoker([response]);
  const api = createGrowthEngineApi(invoke);
  await expect(api.getOnboardingCohortSummary({ organisationId: "org-1" })).resolves.toEqual(response);
  expect(calls).toEqual([{ name: "getOnboardingCohortSummary", payload: { organisationId: "org-1" } }]);
});


it("requests authoritative organisation plan usage without accepting client-supplied counters", async () => {
  const response = {
    organisationId: "org-1",
    status: "authoritative" as const,
    plan: { id: "pilot" as const, displayName: "Pilot", limits: { campaigns: 10, leads: 500, members: 5, monthlyAiSuggestions: 50 } },
    usage: { campaigns: 2, leads: 42, members: 3, monthlyAiSuggestions: 7 },
    remaining: { campaigns: 8, leads: 458, members: 2, monthlyAiSuggestions: 43 },
    aiUsagePeriod: "2026-10",
    message: "Usage is server-maintained.",
  };
  const { invoke, calls } = makeInvoker([response]);
  const api = createGrowthEngineApi(invoke);
  await expect(api.getOrganisationPlanUsage({ organisationId: "org-1" })).resolves.toEqual(response);
  expect(calls).toEqual([{ name: "getOrganisationPlanUsage", payload: { organisationId: "org-1" } }]);
});

it("preserves the legacy reconciliation-required plan usage state", async () => {
  const response = {
    organisationId: "org-legacy",
    status: "reconciliation_required" as const,
    plan: { id: "pilot" as const, displayName: "Pilot", limits: { campaigns: 10, leads: 500, members: 5, monthlyAiSuggestions: 50 } },
    usage: null,
    remaining: null,
    aiUsagePeriod: null,
    message: "Reconcile existing resources before displaying numeric usage.",
  };
  const { invoke } = makeInvoker([response]);
  const api = createGrowthEngineApi(invoke);
  await expect(api.getOrganisationPlanUsage({ organisationId: "org-legacy" })).resolves.toEqual(response);
});
