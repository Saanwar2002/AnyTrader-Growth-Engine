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
});
