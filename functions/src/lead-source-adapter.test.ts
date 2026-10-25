import { describe, expect, it } from "vitest";
import { assertLeadSourceAdapterRunnable, validateLeadSourceManifest, type LeadSourceAdapterManifest } from "./lead-source-adapter";
const approvedManifest = (): LeadSourceAdapterManifest => ({
  sourceId: "directory-api-v1", displayName: "Example Directory API", termsUrl: "https://example.test/terms",
  reviewStatus: "approved", reviewedAt: "2026-10-25T09:00:00.000Z", reviewedBy: "review-ticket-123",
  permittedPurpose: "business_provider_recruitment", maxRequestsPerMinute: 30, maxRecordsPerRun: 100,
  allowedFields: ["businessName", "category", "location", "website"],
});
describe("lead source adapter permission contract", () => {
  it("accepts a reviewed, bounded HTTPS source manifest", () => {
    expect(validateLeadSourceManifest(approvedManifest())).toEqual([]);
    expect(() => assertLeadSourceAdapterRunnable(approvedManifest())).not.toThrow();
  });
  it.each(["pending", "rejected"] as const)("blocks a source with review status %s", (reviewStatus) => {
    expect(() => assertLeadSourceAdapterRunnable({ ...approvedManifest(), reviewStatus })).toThrow("blocked until");
  });
  it("requires reviewer, timestamp, and purpose for approval", () => {
    const manifest = { ...approvedManifest(), reviewedAt: undefined, reviewedBy: " ", permittedPurpose: undefined };
    const issues = validateLeadSourceManifest(manifest);
    expect(issues.join(" ")).toContain("reviewedAt");
    expect(issues.join(" ")).toContain("reviewer reference");
    expect(issues.join(" ")).toContain("permit");
    expect(() => assertLeadSourceAdapterRunnable(manifest)).toThrow("manifest is invalid");
  });
  it("rejects insecure terms URLs and embedded URL credentials", () => {
    expect(validateLeadSourceManifest({ ...approvedManifest(), termsUrl: "http://example.test/terms" }))
      .toContain("termsUrl must be an HTTPS URL without embedded credentials.");
    expect(validateLeadSourceManifest({ ...approvedManifest(), termsUrl: "https://user:pass@example.test/terms" }))
      .toContain("termsUrl must be an HTTPS URL without embedded credentials.");
  });
  it("rejects unbounded request or record limits", () => {
    const issues = validateLeadSourceManifest({ ...approvedManifest(), maxRequestsPerMinute: 601, maxRecordsPerRun: 501 });
    expect(issues).toContain("maxRequestsPerMinute must be an integer between 1 and 600.");
    expect(issues).toContain("maxRecordsPerRun must be an integer between 1 and 500.");
  });
  it("requires businessName and rejects unsupported or duplicate fields", () => {
    expect(validateLeadSourceManifest({ ...approvedManifest(), allowedFields: ["email"] })).toContain("allowedFields must include businessName.");
    expect(validateLeadSourceManifest({ ...approvedManifest(), allowedFields: ["businessName", "email", "email"] }))
      .toContain("allowedFields must be a non-empty list of unique supported lead fields.");
  });
  it("requires the exact reviewed purpose", () => {
    const manifest = { ...approvedManifest(), permittedPurpose: "general_marketing" } as unknown as LeadSourceAdapterManifest;
    expect(() => assertLeadSourceAdapterRunnable(manifest)).toThrow("permit");
  });
  it("rejects malformed identifiers and display names", () => {
    const issues = validateLeadSourceManifest({ ...approvedManifest(), sourceId: "UPPERCASE ID", displayName: "x" });
    expect(issues).toContain("sourceId must be a stable 2–64 character lowercase identifier.");
    expect(issues).toContain("displayName must contain 2–100 characters.");
  });
});
