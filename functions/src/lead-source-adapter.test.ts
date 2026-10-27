import { describe, expect, it } from "vitest";
import {
  assertLeadSourceAdapterRunnable,
  validateLeadSourceManifest,
  attributeLeadSourceCandidates,
  validateLeadSourcePageRequest,
  validateLeadSourcePageResult,
  validateAndAttributeLeadSourcePage,
  LeadSourceAdapterRunGuard,
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

  it("uses the validated manifest snapshot when the caller-owned manifest changes during inspection", () => {
    const target = approvedManifest();
    const manifest = new Proxy(target, {
      getOwnPropertyDescriptor(object, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
        if (key === "maxRecordsPerRun" && descriptor && "value" in descriptor) {
          // Simulate caller-owned state changing after its descriptor was read.
          Reflect.set(object, "maxRecordsPerRun", 1);
        }
        return descriptor;
      },
    });

    const attributed = attributeLeadSourceCandidates(
      manifest,
      [{ businessName: "Example One" }, { businessName: "Example Two" }],
      "2026-10-27T10:00:00.000Z",
      new Date("2026-10-27T12:00:00.000Z"),
    );

    expect(attributed).toHaveLength(2);
    expect(target.maxRecordsPerRun).toBe(1);
  });

  it("rejects unsafe manifest shapes without invoking accessors", () => {
    let getterInvoked = false;
    const accessorManifest = Object.defineProperty(approvedManifest(), "sourceId", {
      enumerable: true,
      configurable: true,
      get: () => { getterInvoked = true; return "directory-api-v1"; },
    });
    const symbolManifest = { ...approvedManifest(), [Symbol("hidden")]: "unexpected" };
    const unknownFieldManifest = { ...approvedManifest(), internalOverride: true };
    class ManifestRecord {
      sourceId = "directory-api-v1";
    }

    for (const candidate of [
      accessorManifest,
      symbolManifest,
      unknownFieldManifest,
      new ManifestRecord(),
    ]) {
      expect(validateLeadSourceManifest(candidate as unknown as LeadSourceAdapterManifest))
        .toContain("A source adapter manifest must be a plain data object with only supported own fields.");
    }
    expect(getterInvoked).toBe(false);
  });

  it("rejects accessor-backed and symbol-extended allowedFields arrays without invoking getters", () => {
    let getterInvoked = false;
    const accessorFields: unknown[] = [];
    Object.defineProperty(accessorFields, "0", {
      enumerable: true,
      configurable: true,
      get: () => { getterInvoked = true; return "businessName"; },
    });
    accessorFields.length = 1;
    const symbolFields = ["businessName", "category"] as unknown as LeadSourceAdapterManifest["allowedFields"];
    Object.defineProperty(symbolFields, Symbol("hidden"), { value: true, enumerable: true });

    expect(validateLeadSourceManifest({
      ...approvedManifest(), allowedFields: accessorFields as LeadSourceAdapterManifest["allowedFields"],
    })).toContain("A source adapter manifest must be a plain data object with only supported own fields.");
    expect(validateLeadSourceManifest({
      ...approvedManifest(), allowedFields: symbolFields,
    })).toContain("A source adapter manifest must be a plain data object with only supported own fields.");
    expect(getterInvoked).toBe(false);
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

  it("rejects accessor, symbol, and overridden-method candidate batches without invoking getters", () => {
    let getterInvoked = false;
    const accessorBatch: unknown[] = [];
    Object.defineProperty(accessorBatch, "0", {
      enumerable: true,
      configurable: true,
      get: () => { getterInvoked = true; return { businessName: "Unexpected Builder" }; },
    });
    accessorBatch.length = 1;
    const symbolBatch = [{ businessName: "Symbol Builder" }] as unknown[] & { [key: symbol]: unknown };
    Object.defineProperty(symbolBatch, Symbol("hidden"), { value: true, enumerable: true });
    const overriddenMapBatch = [{ businessName: "Original Builder" }] as unknown[] & { map: unknown };
    overriddenMapBatch.map = () => [{ businessName: "Bypass Builder" }];

    for (const candidates of [accessorBatch, symbolBatch, overriddenMapBatch]) {
      expect(() => attributeLeadSourceCandidates(
        approvedManifest(),
        candidates,
        "2026-10-25T10:00:00.000Z",
        new Date("2026-10-25T12:00:00.000Z"),
      )).toThrow("only indexed data properties");
    }
    expect(getterInvoked).toBe(false);
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

  it("rejects unsafe request envelope shapes without invoking getters", () => {
    let getterInvoked = false;
    const accessorRequest = Object.defineProperty({
      location: "Edinburgh", limit: 1,
    }, "category", {
      enumerable: true,
      get: () => { getterInvoked = true; return "builders"; },
    });
    const symbolRequest = {
      category: "builders", location: "Edinburgh", limit: 1, [Symbol("hidden")]: true,
    };
    class RequestRecord {
      category = "builders";
      location = "Edinburgh";
      limit = 1;
    }

    for (const request of [accessorRequest, symbolRequest, new RequestRecord()]) {
      expect(() => validateLeadSourcePageRequest(request, manifest, now))
        .toThrow("page request must be a plain data object");
    }
    expect(getterInvoked).toBe(false);
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

  it("rejects oversized, cyclic, lossy, and non-JSON page cursors", () => {
    const accessorCursor = Object.defineProperty({}, "token", { enumerable: true, get: () => "next" });
    const symbolCursor = { token: "next", [Symbol("hidden")]: true };
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, "0", { enumerable: true, configurable: true, get: () => "next" });
    accessorArray.length = 1;
    const invalidCursors: unknown[] = [
      "x".repeat(2049),
      { token: undefined },
      { token: Number.NaN },
      new Date("2026-10-27T00:00:00.000Z"),
      Array(1),
      accessorCursor,
      symbolCursor,
      accessorArray,
    ];
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    invalidCursors.push(circular);

    for (const cursor of invalidCursors) {
      expect(() => validateLeadSourcePageRequest({
        category: "builders", location: "Edinburgh", limit: 1, cursor,
      }, manifest, now)).toThrow("cursor must be JSON-serializable and at most 2048 characters");
    }
  });

  it("normalizes page cursors to detached JSON-safe values", () => {
    const cursor = { page: 2, nested: { token: "next" } };
    const request = validateLeadSourcePageRequest({
      category: "builders", location: "Edinburgh", limit: 1, cursor,
    }, manifest, now);
    cursor.nested.token = "mutated";
    expect(request.cursor).toEqual({ page: 2, nested: { token: "next" } });
    expect(request.cursor).not.toBe(cursor);
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

  it("rejects unsafe result envelopes and accessor-backed record arrays without invoking getters", () => {
    let getterInvoked = false;
    const accessorResult = Object.defineProperty({}, "records", {
      enumerable: true,
      get: () => { getterInvoked = true; return []; },
    });
    const symbolResult = { records: [], [Symbol("hidden")]: true };
    class ResultRecord {
      records = [];
    }
    const accessorRecords: unknown[] = [];
    Object.defineProperty(accessorRecords, "0", {
      enumerable: true,
      configurable: true,
      get: () => { getterInvoked = true; return { businessName: "Unexpected" }; },
    });
    accessorRecords.length = 1;

    for (const result of [accessorResult, symbolResult, new ResultRecord()]) {
      expect(() => validateLeadSourcePageResult(result, manifest, now))
        .toThrow("page result must be a plain data object");
    }
    expect(() => validateLeadSourcePageResult({ records: accessorRecords }, manifest, now))
      .toThrow("page records must contain only indexed data properties");
    expect(getterInvoked).toBe(false);
  });

  it("rejects oversized, cyclic, lossy, and non-JSON provider next cursors", () => {
    const accessorCursor = Object.defineProperty({}, "token", { enumerable: true, get: () => "next" });
    const symbolCursor = { token: "next", [Symbol("hidden")]: true };
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, "0", { enumerable: true, configurable: true, get: () => "next" });
    accessorArray.length = 1;
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const nextCursor of [
      "x".repeat(2049),
      { token: undefined },
      { token: Number.POSITIVE_INFINITY },
      new Date("2026-10-27T00:00:00.000Z"),
      Array(1),
      accessorCursor,
      symbolCursor,
      accessorArray,
      circular,
    ]) {
      expect(() => validateLeadSourcePageResult({
        records: [], nextCursor,
      }, manifest, now)).toThrow("next cursor must be JSON-serializable and at most 2048 characters");
    }
  });

  it("normalizes provider next cursors to detached JSON-safe values", () => {
    const nextCursor = { page: 3, nested: ["next"] };
    const result = validateLeadSourcePageResult({ records: [], nextCursor }, manifest, now);
    nextCursor.nested[0] = "mutated";
    expect(result.nextCursor).toEqual({ page: 3, nested: ["next"] });
    expect(result.nextCursor).not.toBe(nextCursor);
  });

  it("validates and attributes every provider record before returning a page", () => {
    const result = validateAndAttributeLeadSourcePage({
      records: [
        { businessName: "  Example Builder ", category: " Builder ", sourceRecordId: " provider-1 " },
      ],
      nextCursor: { page: 2 },
      internalDebug: "drop",
    }, manifest, "2026-10-26T11:00:00.000Z", now);

    expect(result).toEqual({
      records: [{
        candidate: { businessName: "Example Builder", category: "Builder", sourceRecordId: "provider-1" },
        provenance: {
          sourceId: manifest.sourceId,
          sourceName: manifest.displayName,
          termsUrl: manifest.termsUrl,
          collectedAt: "2026-10-26T11:00:00.000Z",
          sourceRecordId: "provider-1",
        },
      }],
      nextCursor: { page: 2 },
    });
    expect("internalDebug" in result).toBe(false);
  });

  it("rejects malformed provider candidates before returning an attributed page", () => {
    expect(() => validateAndAttributeLeadSourcePage({
      records: [{ businessName: "Example Builder", internalNote: "must not pass" }],
    }, manifest, "2026-10-26T11:00:00.000Z", now)).toThrow("outside its manifest allowlist");

    expect(() => validateAndAttributeLeadSourcePage({
      records: [{ businessName: "   " }],
    }, manifest, "2026-10-26T11:00:00.000Z", now)).toThrow("requires a valid businessName");
  });

  it("rejects accessor, symbol-keyed, and non-plain provider candidate records without invoking getters", () => {
    let getterInvoked = false;
    const accessorCandidate = Object.defineProperty({}, "businessName", {
      enumerable: true,
      get: () => { getterInvoked = true; return "Unexpected Builder"; },
    });
    const symbolCandidate = { businessName: "Symbol Builder", [Symbol("hidden")]: "unexpected" };
    class CandidateRecord {
      businessName = "Class Builder";
    }

    for (const candidate of [accessorCandidate, symbolCandidate, new CandidateRecord()]) {
      expect(() => validateAndAttributeLeadSourcePage({
        records: [candidate],
      }, manifest, "2026-10-26T11:00:00.000Z", now)).toThrow();
    }
    expect(getterInvoked).toBe(false);
  });

  it("enforces the total record budget across pages in one run", () => {
    const guard = new LeadSourceAdapterRunGuard<string>({ ...manifest, maxRecordsPerRun: 2 });
    expect(guard.acceptPage({
      records: [{ businessName: "One", sourceRecordId: "one" }], nextCursor: "page-2",
    }, "2026-10-26T11:00:00.000Z", now).records).toHaveLength(1);
    expect(guard.acceptPage({
      records: [{ businessName: "Two", sourceRecordId: "two" }], nextCursor: "page-3",
    }, "2026-10-26T11:00:00.000Z", now).records).toHaveLength(1);
    expect(guard.recordsAccepted).toBe(2);
    expect(() => guard.acceptPage({
      records: [{ businessName: "Three", sourceRecordId: "three" }], nextCursor: null,
    }, "2026-10-26T11:00:00.000Z", now)).toThrow("total record limit");
    expect(guard.recordsAccepted).toBe(2);
  });

  it("snapshots run limits and allowed fields so caller mutation cannot expand them", () => {
    const limitedManifest = { ...manifest, maxRecordsPerRun: 1, allowedFields: [...manifest.allowedFields] };
    const budgetGuard = new LeadSourceAdapterRunGuard<string>(limitedManifest);
    limitedManifest.maxRecordsPerRun = 10;
    budgetGuard.acceptPage({
      records: [{ businessName: "First" }], nextCursor: "page-2",
    }, "2026-10-26T11:00:00.000Z", now);
    expect(() => budgetGuard.acceptPage({
      records: [{ businessName: "Second" }], nextCursor: null,
    }, "2026-10-26T11:00:00.000Z", now)).toThrow("total record limit");

    const fieldsManifest = { ...manifest, allowedFields: [...manifest.allowedFields] };
    const fieldsGuard = new LeadSourceAdapterRunGuard<string>(fieldsManifest);
    fieldsManifest.allowedFields.push("email");
    expect(() => fieldsGuard.acceptPage({
      records: [{ businessName: "Email Builder", email: "builder@example.test" }],
    }, "2026-10-26T11:00:00.000Z", now)).toThrow("outside its manifest allowlist");
  });

  it("rejects duplicate provider record IDs across pages without accepting the page", () => {
    const guard = new LeadSourceAdapterRunGuard<string>(manifest);
    guard.acceptPage({
      records: [{ businessName: "First", sourceRecordId: "provider-1" }], nextCursor: "page-2",
    }, "2026-10-26T11:00:00.000Z", now);
    expect(() => guard.acceptPage({
      records: [{ businessName: "Duplicate", sourceRecordId: "provider-1" }], nextCursor: null,
    }, "2026-10-26T11:00:00.000Z", now)).toThrow("duplicate sourceRecordId values across pages");
    expect(guard.recordsAccepted).toBe(1);
  });

  it("rejects repeated pagination cursors without accepting the repeated page", () => {
    const guard = new LeadSourceAdapterRunGuard<string>(manifest);
    guard.acceptPage({
      records: [{ businessName: "First" }], nextCursor: "page-2",
    }, "2026-10-26T11:00:00.000Z", now);
    expect(() => guard.acceptPage({
      records: [{ businessName: "Second" }], nextCursor: "page-2",
    }, "2026-10-26T11:00:00.000Z", now)).toThrow("repeated a next cursor");
    expect(guard.recordsAccepted).toBe(1);
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
