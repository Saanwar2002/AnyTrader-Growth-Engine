import { describe, expect, it } from "vitest";
import { auditLeadIdentifierRecords } from "./lead-identifier-migration-audit";

describe("read-only lead identifier migration audit", () => {
  it("reports missing and stale keys without including raw contact data", () => {
    const report = auditLeadIdentifierRecords([
      { id: "lead-a", email: " Sales@Example.com ", website: "https://Example.com/" },
      { id: "lead-b", email: "other@example.com", dedupeEmailKey: "wrong@example.com", website: "not a valid website/path" },
    ]);

    expect(report.scannedRecords).toBe(2);
    expect(report.missingEmailKeys).toEqual(["lead-a"]);
    expect(report.staleEmailKeys).toEqual(["lead-b"]);
    expect(report.missingWebsiteKeys).toEqual(["lead-a"]);
    expect(report.malformedWebsiteRecords).toEqual(["lead-b"]);
    expect(JSON.stringify(report)).not.toContain("Sales@Example.com");
    expect(JSON.stringify(report)).not.toContain("other@example.com");
    expect(JSON.stringify(report)).not.toContain("Example.com");
  });

  it("detects email and website collisions while preserving URL path distinctions", () => {
    const report = auditLeadIdentifierRecords([
      { id: "lead-b", email: "TEAM@example.com", website: "https://example.com/Directory" },
      { id: "lead-a", email: " team@EXAMPLE.com ", website: "HTTPS://EXAMPLE.COM/Directory" },
      { id: "lead-c", email: "team@example.com", website: "https://example.com/directory" },
      { id: "lead-d", email: "unique@example.com", website: "https://example.com/Directory/" },
    ]);

    expect(report.emailCollisions).toHaveLength(1);
    expect(report.emailCollisions[0].leadIds).toEqual(["lead-a", "lead-b", "lead-c"]);
    expect(report.emailCollisions[0].canonicalKeyFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(report.websiteCollisions).toHaveLength(1);
    expect(report.websiteCollisions[0].leadIds).toEqual(["lead-a", "lead-b"]);
    expect(JSON.stringify(report)).not.toContain("team@example.com");
    expect(JSON.stringify(report)).not.toContain("https://example.com");
  });

  it("flags populated keys when their source contact field is empty", () => {
    const report = auditLeadIdentifierRecords([
      { id: "lead-a", email: " ", dedupeEmailKey: "legacy@example.com", website: "", dedupeWebsiteKey: "https://legacy.example" },
    ]);

    expect(report.staleEmailKeys).toEqual(["lead-a"]);
    expect(report.staleWebsiteKeys).toEqual(["lead-a"]);
    expect(report.emailCollisions).toEqual([]);
    expect(report.websiteCollisions).toEqual([]);
  });

  it("returns deterministic sorted record identifiers and an empty report for no records", () => {
    const report = auditLeadIdentifierRecords([
      { id: "z", email: "z@example.com" },
      { id: "a", email: "a@example.com" },
    ]);
    expect(report.missingEmailKeys).toEqual(["a", "z"]);
    expect(auditLeadIdentifierRecords([])).toEqual({
      scannedRecords: 0,
      missingEmailKeys: [],
      staleEmailKeys: [],
      missingWebsiteKeys: [],
      staleWebsiteKeys: [],
      malformedWebsiteRecords: [],
      emailCollisions: [],
      websiteCollisions: [],
    });
  });
});
