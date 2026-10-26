import { describe, expect, it } from "vitest";
import {
  assessLeadSourceAdapterReadiness,
  validateLeadSourceProvenance,
  type LeadSourceAdapterDefinition,
} from "./lead-source-adapter-contract";

const now = new Date("2026-10-26T12:00:00.000Z");
const validApiDefinition: LeadSourceAdapterDefinition = {
  id: "example_places",
  kind: "approved_api",
  maxPageSize: 50,
  approval: {
    providerId: "example_places",
    status: "approved",
    termsUrl: "https://provider.example/terms",
    reviewedAt: "2026-10-01T12:00:00.000Z",
    reviewedBy: "privacy-review",
    permittedUse: "lead_discovery",
    expiresAt: "2027-01-01T00:00:00.000Z",
  },
};

describe("lead source adapter policy contract", () => {
  it("requires explicit provider-specific approval before an API adapter is ready", () => {
    expect(assessLeadSourceAdapterReadiness({
      id: "example_places", kind: "approved_api", maxPageSize: 50,
    }, now)).toEqual({ ready: false, reason: "approval-required" });
    expect(assessLeadSourceAdapterReadiness(validApiDefinition, now)).toEqual({
      ready: true, definition: validApiDefinition,
    });
  });

  it("rejects approval reused for another provider and unsafe terms URLs", () => {
    expect(assessLeadSourceAdapterReadiness({
      ...validApiDefinition,
      id: "different_provider",
    }, now)).toEqual({ ready: false, reason: "approval-provider-mismatch" });
    expect(assessLeadSourceAdapterReadiness({
      ...validApiDefinition,
      approval: { ...validApiDefinition.approval!, termsUrl: "http://provider.example/terms" },
    }, now)).toEqual({ ready: false, reason: "invalid-terms-url" });
    expect(assessLeadSourceAdapterReadiness({
      ...validApiDefinition,
      approval: { ...validApiDefinition.approval!, termsUrl: "https://user:pass@provider.example/terms" },
    }, now)).toEqual({ ready: false, reason: "invalid-terms-url" });
  });

  it("rejects expired, future-dated, and malformed review windows", () => {
    expect(assessLeadSourceAdapterReadiness({
      ...validApiDefinition,
      approval: { ...validApiDefinition.approval!, expiresAt: "2026-10-26T11:59:59.000Z" },
    }, now)).toEqual({ ready: false, reason: "approval-expired" });
    expect(assessLeadSourceAdapterReadiness({
      ...validApiDefinition,
      approval: { ...validApiDefinition.approval!, reviewedAt: "2026-10-27T00:00:00.000Z" },
    }, now)).toEqual({ ready: false, reason: "review-time-in-future" });
    expect(assessLeadSourceAdapterReadiness({
      ...validApiDefinition,
      approval: { ...validApiDefinition.approval!, expiresAt: "not-a-date" },
    }, now)).toEqual({ ready: false, reason: "invalid-review-time" });
  });

  it("enforces bounded page sizes and known adapter kinds", () => {
    expect(assessLeadSourceAdapterReadiness({
      ...validApiDefinition, maxPageSize: 501,
    }, now)).toEqual({ ready: false, reason: "invalid-page-size" });
    expect(assessLeadSourceAdapterReadiness({
      ...validApiDefinition, kind: "scraper" as LeadSourceAdapterDefinition["kind"],
    }, now)).toEqual({ ready: false, reason: "unsupported-kind" });
    expect(assessLeadSourceAdapterReadiness({
      id: "csv_import", kind: "manual_import", maxPageSize: 25,
    }, now).ready).toBe(true);
    expect(assessLeadSourceAdapterReadiness({
      id: "synthetic_demo", kind: "synthetic_demo", maxPageSize: 100,
    }, now).ready).toBe(true);
  });

  it("rejects malformed definitions without throwing implementation details", () => {
    expect(assessLeadSourceAdapterReadiness(null, now)).toEqual({
      ready: false, reason: "invalid-definition",
    });
    expect(assessLeadSourceAdapterReadiness({
      id: "UpperCase", kind: "approved_api", maxPageSize: 10,
    }, now)).toEqual({ ready: false, reason: "invalid-adapter-id" });
  });
});

describe("lead source provenance validation", () => {
  it("returns only validated bounded provenance fields", () => {
    const input = {
      providerId: "example_places",
      sourceRecordId: "record-123",
      retrievedAt: "2026-10-26T11:59:00.000Z",
      sourceUrl: "https://provider.example/business/record-123",
      email: "must-not-be-copied@example.test",
      payload: { secret: "must-not-be-copied" },
    };
    const result = validateLeadSourceProvenance(input, "example_places", now);
    expect(result).toEqual({
      providerId: "example_places",
      sourceRecordId: "record-123",
      retrievedAt: "2026-10-26T11:59:00.000Z",
      sourceUrl: "https://provider.example/business/record-123",
    });
    expect(JSON.stringify(result)).not.toContain("must-not-be-copied");
  });

  it("rejects provider mismatch, malformed IDs, unsafe URLs and future retrieval times", () => {
    const base = {
      providerId: "example_places",
      sourceRecordId: "record-123",
      retrievedAt: "2026-10-26T11:59:00.000Z",
    };
    expect(() => validateLeadSourceProvenance(base, "another_provider", now))
      .toThrow("provider does not match");
    expect(() => validateLeadSourceProvenance({ ...base, sourceRecordId: " " }, "example_places", now))
      .toThrow("bounded source record ID");
    expect(() => validateLeadSourceProvenance({ ...base, sourceUrl: "javascript:alert(1)" }, "example_places", now))
      .toThrow("safe HTTPS URL");
    expect(() => validateLeadSourceProvenance({
      ...base, retrievedAt: "2026-10-27T00:00:00.000Z",
    }, "example_places", now)).toThrow("valid past UTC timestamp");
  });
});
