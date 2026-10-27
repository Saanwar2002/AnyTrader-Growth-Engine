import { describe, expect, it } from "vitest";
import {
  assertLeadSourceAdapterRunnable,
  validateLeadSourceManifest,
  attributeLeadSourceCandidates,
  validateLeadSourcePageRequest,
  validateLeadSourcePageResult,
  type LeadSourceAdapterManifest,
} from "./lead-source-adapter";
const approvedManifest = (): LeadSourceAdapterManifest => ({
  sourceId: "directory-api-v1", displayName: "Example Directory API", termsUrl: "https://example.test/terms",
  reviewStatus: "approved", reviewedAt: "2026-10-25T09:00:00.000Z", reviewedBy: "review-ticket-123",
  approvalExpiresAt: "2027-01-01T00:00:00.000Z",
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
    const manifest = { ...approvedManifest(), reviewedAt: undefined, reviewedBy: " ", approvalExpiresAt: undefined, permittedPurpose: undefined };
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
    const sparseFields = ["businessName", , "email"] as unknown as LeadSourceAdapterManifest["allowedFields"];
    expect(validateLeadSourceManifest({ ...approvedManifest(), allowedFields: sparseFields }))
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

  it("attaches reviewed provenance and trims allowlisted candidate fields", () => {
    const result = attributeLeadSourceCandidates(approvedManifest(), [{
      businessName: "  Example Builder  ", category: "  Builder ", location: "  Edinburgh ",
      website: " https://example.test ", sourceRecordId: " provider-42 ",
    }], "2026-10-25T10:00:00.000Z");
    expect(result).toEqual([{
      candidate: {
        businessName: "Example Builder", category: "Builder", location: "Edinburgh",
        website: "https://example.test", sourceRecordId: "provider-42",
      },
      provenance: {
        sourceId: "directory-api-v1", sourceName: "Example Directory API",
        termsUrl: "https://example.test/terms", collectedAt: "2026-10-25T10:00:00.000Z",
        sourceRecordId: "provider-42",
      },
    }]);
  });

  it("rejects duplicate provider record identifiers after trimming", () => {
    expect(() => attributeLeadSourceCandidates(
      approvedManifest(),
      [
        { businessName: "Example One", sourceRecordId: " provider-42 " },
        { businessName: "Example Two", sourceRecordId: "provider-42" },
      ],
      "2026-10-25T10:00:00.000Z",
    )).toThrow("duplicate sourceRecordId values");
  });

  it("rejects candidate output over the configured run limit", () => {
    expect(() => attributeLeadSourceCandidates({
      ...approvedManifest(), maxRecordsPerRun: 1,
    }, [{ businessName: "One" }, { businessName: "Two" }], "2026-10-25T10:00:00.000Z"))
      .toThrow("exceeded its configured per-run record limit");
  });

  it("rejects sparse provider result arrays instead of silently skipping missing rows", () => {
    expect(() => attributeLeadSourceCandidates(
      approvedManifest(),
      Array(1),
      "2026-10-25T10:00:00.000Z",
    )).toThrow("must not contain sparse entries");
  });

  it("rejects fields not explicitly allowed by the source manifest", () => {
    expect(() => attributeLeadSourceCandidates(approvedManifest(), [{
      businessName: "Example", internalNote: "unexpected",
    }], "2026-10-25T10:00:00.000Z")).toThrow("outside its manifest allowlist");
  });

  it("rejects a collection timestamp later than the validation clock", () => {
    const now = new Date("2026-10-27T12:00:00.000Z");
    expect(() => attributeLeadSourceCandidates(
      approvedManifest(),
      [{ businessName: "Example" }],
      "2026-10-27T12:00:00.001Z",
      now,
    )).toThrow("collectedAt must not be in the future.");
  });

  it("rejects malformed candidates and invalid provenance timestamps", () => {
    expect(() => attributeLeadSourceCandidates(approvedManifest(), [null], "2026-10-25T10:00:00.000Z"))
      .toThrow("malformed candidate");
    expect(() => attributeLeadSourceCandidates(approvedManifest(), [{ businessName: "Example" }], "not-a-date"))
      .toThrow("collectedAt must be a valid ISO-8601 timestamp");
  });

  it("rejects invalid field values and blank business names", () => {
    expect(() => attributeLeadSourceCandidates(approvedManifest(), [{ businessName: "Example", category: 7 }], "2026-10-25T10:00:00.000Z"))
      .toThrow("invalid category value");
    expect(() => attributeLeadSourceCandidates(approvedManifest(), [{ businessName: "   " }], "2026-10-25T10:00:00.000Z"))
      .toThrow("valid businessName");
  });

  it("does not allow output from an unapproved source to be attributed", () => {
    expect(() => attributeLeadSourceCandidates({
      ...approvedManifest(), reviewStatus: "pending",
    }, [{ businessName: "Example" }], "2026-10-25T10:00:00.000Z")).toThrow("blocked until");
  });

});


describe("lead source bounded page contract", () => {
  const now = new Date("2026-10-26T12:00:00.000Z");
  const manifest = approvedManifest();

  it("rejects an approval review timestamp in the future", () => {
    const futureReviewedAt = { ...manifest, reviewedAt: "2026-10-26T12:00:01.000Z", approvalExpiresAt: "2027-01-01T00:00:00.000Z" };
    expect(validateLeadSourceManifest(futureReviewedAt, now)).toContain("reviewedAt must not be in the future.");
    expect(() => assertLeadSourceAdapterRunnable(futureReviewedAt, now)).toThrow("manifest is invalid");
  });

  it("requires time-bounded approval and rejects expired permission", () => {
    expect(validateLeadSourceManifest({
      ...manifest, approvalExpiresAt: "2026-10-26T11:59:59.000Z",
    }, now)).toContain("Approved source permission has expired or the validation clock is invalid.");
    expect(() => assertLeadSourceAdapterRunnable({
      ...manifest, approvalExpiresAt: "2026-10-26T11:59:59.000Z",
    }, now)).toThrow("manifest is invalid");
  });

  it("trims valid discovery criteria and drops unrelated request properties", () => {
    expect(validateLeadSourcePageRequest({
      category: "  roofers  ", location: "  Edinburgh  ", limit: 50, cursor: "next", injected: "drop",
    }, manifest, now)).toEqual({
      category: "roofers", location: "Edinburgh", limit: 50, cursor: "next",
    });
  });

  it("rejects invalid discovery criteria and page-limit bounds", () => {
    expect(() => validateLeadSourcePageRequest({
      category: "   ", location: "Edinburgh", limit: 1,
    }, manifest, now)).toThrow("category must contain 1 to 120 characters");
    expect(() => validateLeadSourcePageRequest({
      category: "builders", location: "   ", limit: 1,
    }, manifest, now)).toThrow("location must contain 1 to 200 characters");
    expect(() => validateLeadSourcePageRequest({
      category: "builders", location: "Edinburgh", limit: 101,
    }, manifest, now)).toThrow("page limit exceeds the configured bound");
  });

  it("rejects oversized and non-serializable page cursors", () => {
    expect(() => validateLeadSourcePageRequest({
      category: "builders", location: "Edinburgh", limit: 1, cursor: "x".repeat(2049),
    }, manifest, now)).toThrow("cursor must be JSON-serializable and at most 2048 characters");

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => validateLeadSourcePageRequest({
      category: "builders", location: "Edinburgh", limit: 1, cursor: circular,
    }, manifest, now)).toThrow("cursor must be JSON-serializable and at most 2048 characters");
  });

  it("copies bounded page results and allowlists the cursor field", () => {
    const records = [{ businessName: "A" }, { businessName: "B" }];
    const result = validateLeadSourcePageResult({
      records, nextCursor: null, internalDebug: true,
    }, manifest, now);
    expect(result).toEqual({ records, nextCursor: null });
    expect(result.records).not.toBe(records);
    expect("internalDebug" in result).toBe(false);
  });

  it("rejects oversized and non-serializable provider next cursors", () => {
    expect(() => validateLeadSourcePageResult({
      records: [], nextCursor: "x".repeat(2049),
    }, manifest, now)).toThrow("next cursor must be JSON-serializable and at most 2048 characters");

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => validateLeadSourcePageResult({
      records: [], nextCursor: circular,
    }, manifest, now)).toThrow("next cursor must be JSON-serializable and at most 2048 characters");
  });

  it("rejects malformed and oversized page results", () => {
    expect(() => validateLeadSourcePageResult(null, manifest, now))
      .toThrow("page result must be an object");
    expect(() => validateLeadSourcePageResult({ records: "invalid" }, manifest, now))
      .toThrow("records must be an array");
    expect(() => validateLeadSourcePageResult({ records: Array(1) }, manifest, now))
      .toThrow("records must not contain sparse entries");
    expect(() => validateLeadSourcePageResult({
      records: Array.from({ length: 101 }, (_, index) => ({ index })),
    }, manifest, now)).toThrow("exceeds the configured record limit");
  });
});
