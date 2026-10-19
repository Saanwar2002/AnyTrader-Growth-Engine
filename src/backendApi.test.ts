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
    const result = await api.createOutreachDraft({ organisationId: "org-1", leadId: "lead-1", subject: "Hello", body: "Please review" });
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
});
