import { describe, expect, it, vi } from "vitest";
import { classifyLeadWithAi, type AiLeadClassificationContext } from "./ai-lead-classification";

const context: AiLeadClassificationContext = {
  businessName: "North Star Decorators",
  currentCategory: "General",
  location: "Edinburgh",
};
function response(text: string): Response {
  return new Response(JSON.stringify({
    candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
  }), { status: 200 });
}
const valid = JSON.stringify({
  suggestedCategory: "Painters and decorators",
  fitSummary: "The business name and current category suggest a decorating service.",
  reviewFlags: ["Verify the services offered from an approved source."],
});

describe("AI lead classification", () => {
  it("returns a bounded advisory result using minimal business context", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      expect(request.generationConfig.candidateCount).toBe(1);
      expect(request.contents[0].parts[0].text).toContain(context.businessName);
      expect(request.systemInstruction.parts[0].text).toContain("Do not infer consent");
      expect(init?.headers).toEqual({ "content-type": "application/json", "x-goog-api-key": "server-key" });
      return response(valid);
    });
    await expect(classifyLeadWithAi(context, { apiKey: " server-key ", fetcher })).resolves.toEqual(JSON.parse(valid));
  });

  it("rejects malformed and unsafe context before calling the provider", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(classifyLeadWithAi({ ...context, location: "x".repeat(161) }, { apiKey: "key", fetcher }))
      .rejects.toThrow("context fields are invalid");
    await expect(classifyLeadWithAi({ ...context, hidden: "unexpected" } as unknown as AiLeadClassificationContext, { apiKey: "key", fetcher }))
      .rejects.toThrow("context is invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects accessor-backed context without invoking its getter", async () => {
    let invoked = false;
    const unsafe = Object.defineProperty({ ...context }, "businessName", {
      enumerable: true, get: () => { invoked = true; return context.businessName; },
    });
    const fetcher = vi.fn<typeof fetch>();
    await expect(classifyLeadWithAi(unsafe as unknown as AiLeadClassificationContext, { apiKey: "key", fetcher }))
      .rejects.toThrow("context is invalid");
    expect(invoked).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects invalid model responses and ambiguous candidates", async () => {
    const malformed = vi.fn<typeof fetch>(async () => response(JSON.stringify({
      suggestedCategory: "Painters", fitSummary: "<script>bad</script>", reviewFlags: [],
    })));
    await expect(classifyLeadWithAi(context, { apiKey: "key", fetcher: malformed })).rejects.toThrow("fit summary");
    const ambiguous = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: valid }] } },
        { finishReason: "STOP", content: { parts: [{ text: valid }] } },
      ],
    }), { status: 200 }));
    await expect(classifyLeadWithAi(context, { apiKey: "key", fetcher: ambiguous }))
      .rejects.toThrow("ambiguous result");
  });

  it("fails closed for missing keys and provider failures", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(classifyLeadWithAi(context, { apiKey: "", fetcher })).rejects.toThrow("not configured");
    await expect(classifyLeadWithAi(context, { apiKey: "key", fetcher: vi.fn(async () => new Response("{}", { status: 503 })) }))
      .rejects.toThrow("provider request failed");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
