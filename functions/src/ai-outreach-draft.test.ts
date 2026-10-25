import { describe, expect, it, vi } from "vitest";
import { generateAiOutreachDraftSuggestion, validateAiOutreachDraftSuggestion, type AiOutreachDraftContext } from "./ai-outreach-draft";
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
  it("fails closed for missing keys, invalid model names, provider errors, and malformed JSON", async () => {
    await expect(generateAiOutreachDraftSuggestion(context, { apiKey: "" })).rejects.toThrow("not configured");
    await expect(generateAiOutreachDraftSuggestion(context, { apiKey: "key", model: "../unsafe" })).rejects.toThrow("model name is invalid");
    await expect(generateAiOutreachDraftSuggestion(context, { apiKey: "key", fetcher: vi.fn<typeof fetch>(async () => new Response("{}", { status: 503 })) })).rejects.toThrow("API request failed");
    await expect(generateAiOutreachDraftSuggestion(context, { apiKey: "key", fetcher: vi.fn<typeof fetch>(async () => okResponse("not json")) })).rejects.toThrow("valid JSON");
  });
  it("rejects provider safety blocks", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: "{}" }] } }] }), { status: 200 }));
    await expect(generateAiOutreachDraftSuggestion(context, { apiKey: "key", fetcher })).rejects.toThrow("eligible draft candidate");
  });
});
