import { describe, expect, it, vi } from "vitest";
import { generateAiOutreachDraftSuggestion, validateAiOutreachDraftSuggestion, type AiOutreachDraftContext, type AiOutreachDraftOptions } from "./ai-outreach-draft";
const context: AiOutreachDraftContext = { businessName: "North Star Decorators", category: "Decorators", location: "Edinburgh", brand: "AnyTrader", campaignGoal: "Invite local providers to join", organisationName: "Pilot workspace" };
function okResponse(text: string): Response { return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }), { status: 200 }); }
describe("AI outreach draft validation", () => {
  it("validates subject/body and appends the not-sent marker", () => {
    expect(validateAiOutreachDraftSuggestion({ subject: " Provider network invitation ", body: " Hello there. " })).toEqual({ subject: "Provider network invitation", body: "Hello there.\n\nDRAFT ONLY — NOT SENT." });
  });
  it("rejects malformed fields, control characters, HTML, and oversized bodies", () => {
    expect(() => validateAiOutreachDraftSuggestion(null)).toThrow("draft object");
    expect(() => validateAiOutreachDraftSuggestion({ subject: "", body: "Hello" })).toThrow("subject");
    expect(() => validateAiOutreachDraftSuggestion({ subject: "Hello\nInjected", body: "Body" })).toThrow("subject");
    expect(() => validateAiOutreachDraftSuggestion({ subject: "Hello", body: "<script>alert(1)</script>" })).toThrow("plain-text");
    expect(() => validateAiOutreachDraftSuggestion({ subject: "S", body: "x".repeat(10000) })).toThrow("allowed length");
  });
  it("uses a server-only key and schema-constrained output with minimal context", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      expect(request.generationConfig.responseMimeType).toBe("application/json");
      expect(request.generationConfig.responseSchema.required).toEqual(["subject", "body"]);
      expect(request.contents[0].parts[0].text).not.toContain("private@example.test");
      expect(init?.headers).toEqual({ "content-type": "application/json", "x-goog-api-key": "server-only-key" });
      return okResponse(JSON.stringify({ subject: "Join the local network?", body: "May we share details about joining?" }));
    });
    const result = await generateAiOutreachDraftSuggestion(context, { apiKey: "server-only-key", fetcher });
    expect(result.body).toContain("DRAFT ONLY — NOT SENT.");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["businessName", "category", "location", "brand", "campaignGoal", "organisationName"])(
    "rejects non-string context field %s before calling the provider",
    async (field) => {
      const malformed = { ...context, [field]: 42 } as unknown as AiOutreachDraftContext;
      const fetcher = vi.fn<typeof fetch>();
      await expect(generateAiOutreachDraftSuggestion(malformed, { apiKey: "key", fetcher }))
        .rejects.toThrow("AI draft context is invalid");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("caps an oversized configured timeout to 60 seconds", async () => {
    const timerSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      const fetcher = vi.fn<typeof fetch>(async () =>
        okResponse(JSON.stringify({ subject: "Join the network?", body: "May we share details?" })));
      await generateAiOutreachDraftSuggestion(context, {
        apiKey: "key",
        timeoutMs: Number.MAX_SAFE_INTEGER,
        fetcher,
      });
      expect(timerSpy).toHaveBeenCalledWith(expect.any(Function), 60000);
    } finally {
      timerSpy.mockRestore();
    }
  });
  it("rejects malformed runtime options before attempting a provider request", async () => {
    await expect(generateAiOutreachDraftSuggestion(context, null as unknown as AiOutreachDraftOptions))
      .rejects.toThrow("AI draft options are invalid");
    await expect(generateAiOutreachDraftSuggestion(context, { apiKey: "key", model: 42 } as unknown as AiOutreachDraftOptions))
      .rejects.toThrow("model name is invalid");
    await expect(generateAiOutreachDraftSuggestion(context, { apiKey: "key", fetcher: 42 } as unknown as AiOutreachDraftOptions))
      .rejects.toThrow("AI draft fetcher is invalid");
  });
  it("fails closed for missing keys, invalid model names, provider errors, and malformed JSON", async () => {
    await expect(generateAiOutreachDraftSuggestion(context, { apiKey: "" })).rejects.toThrow("not configured");
    await expect(generateAiOutreachDraftSuggestion(context, { apiKey: "key", model: "../unsafe" })).rejects.toThrow("model name is invalid");
    await expect(generateAiOutreachDraftSuggestion(context, { apiKey: "key", fetcher: vi.fn<typeof fetch>(async () => new Response("{}", { status: 503 })) })).rejects.toThrow("API request failed");
    await expect(generateAiOutreachDraftSuggestion(context, { apiKey: "key", fetcher: vi.fn<typeof fetch>(async () => okResponse("not json")) })).rejects.toThrow("valid JSON");
  });
  it.each(["MAX_TOKENS", "RECITATION", "OTHER", undefined])(
    "rejects a candidate with incomplete finish reason %s",
    async (finishReason) => {
      const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify({ subject: "Hello", body: "May we share details?" }) }] } }],
      }), { status: 200 }));
      await expect(generateAiOutreachDraftSuggestion(context, { apiKey: "key", fetcher }))
        .rejects.toThrow("eligible draft candidate");
    },
  );
  it("sanitizes transport failures and reports timeouts without raw provider errors", async () => {
    const networkFailure = vi.fn<typeof fetch>(async () => {
      throw new Error("sensitive DNS and endpoint details");
    });
    await expect(generateAiOutreachDraftSuggestion(context, { apiKey: "key", fetcher: networkFailure }))
      .rejects.toThrowError(new Error("Gemini API request failed."));

    const timeoutFetcher = vi.fn<typeof fetch>(async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("raw transport abort details")), { once: true });
    }));
    await expect(generateAiOutreachDraftSuggestion(context, { apiKey: "key", timeoutMs: 1, fetcher: timeoutFetcher }))
      .rejects.toThrowError(new Error("Gemini API request timed out."));
  });
  it("rejects provider safety blocks", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: "{}" }] } }] }), { status: 200 }));
    await expect(generateAiOutreachDraftSuggestion(context, { apiKey: "key", fetcher })).rejects.toThrow("eligible draft candidate");
  });
});
