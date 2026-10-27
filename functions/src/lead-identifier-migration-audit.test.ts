import { describe, expect, it } from "vitest";
import { auditLeadIdentifierRecords, type LegacyLeadRecord } from "./lead-identifier-migration-audit";

describe("read-only lead identifier migration audit", () => {
  it("rejects malformed input records and duplicate IDs before analyzing", () => {
    expect(() => auditLeadIdentifierRecords(null as unknown as never)).toThrow("requires an array");
    expect(() => auditLeadIdentifierRecords([null] as unknown as never)).toThrow("malformed record");
    expect(() => auditLeadIdentifierRecords([{}] as unknown as never)).toThrow("non-empty string ID");
    expect(() => auditLeadIdentifierRecords([{ id: " " }] as unknown as never)).toThrow("non-empty string ID");
    expect(() => auditLeadIdentifierRecords([
      { id: "same", email: "first@example.test" },
      { id: "same", email: "second@example.test" },
    ])).toThrow("duplicate record ID");
  });

  it("rejects accessor-backed audit fields without invoking getters", () => {
    let getterInvoked = false;
    const record = Object.defineProperty({ id: "lead-a" }, "email", {
      enumerable: true,
      get: () => { getterInvoked = true; return "private@example.test"; },
    });
    expect(() => auditLeadIdentifierRecords([record] as unknown as never))
      .toThrow("malformed record");
    expect(getterInvoked).toBe(false);
  });

  it("rejects extended, sparse, symbol-bearing, and non-plain audit inputs", () => {
    expect(() => auditLeadIdentifierRecords([{
      id: "lead-a", email: "private@example.test", unexpected: true,
    }] as unknown as never)).toThrow("malformed record");
    expect(() => auditLeadIdentifierRecords([{
      id: "lead-a", email: "private@example.test", [Symbol("extra")]: true,
    }] as unknown as never)).toThrow("malformed record");
    class LeadRecord { id = "lead-a"; email = "private@example.test"; }
    expect(() => auditLeadIdentifierRecords([new LeadRecord()] as unknown as never))
      .toThrow("malformed record");

    const sparse = new Array(1) as unknown as LegacyLeadRecord[];
    expect(() => auditLeadIdentifierRecords(sparse)).toThrow("malformed records array");
    const extended = Object.assign([{ id: "lead-a" }], { extra: true });
    expect(() => auditLeadIdentifierRecords(extended as unknown as never))
      .toThrow("malformed records array");
  });

  it("reports missing and stale keys without including raw contact data", () => {
    const report = auditLeadIdentifierRecords([
      { id: "lead-a", email: " Sales@Example.com ", website: "https://Example.com/" },
      { id: "lead-b", email: "other@example.com", dedupeEmailKey: "wrong@example.com", website: "not a valid website/path" },
    ]);

    expect(report.scannedRecords).toBe(2);
    expect(report.missingBusinessLocationKeys).toEqual([]);
    expect(report.staleBusinessLocationKeys).toEqual([]);
    expect(report.businessLocationCollisions).toEqual([]);
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
    expect(report.businessLocationCollisions).toHaveLength(0);
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


  it("audits missing, stale, and colliding business/location keys without exposing raw values", () => {
    const report = auditLeadIdentifierRecords([
      { id: "business-a", businessName: "  North Star Plumbing ", location: " Edinburgh ", dedupeBusinessLocationKey: undefined },
      { id: "business-b", businessName: "north star plumbing", location: "edinburgh", dedupeBusinessLocationKey: '["wrong","location"]' },
      { id: "business-c", businessName: "North Star Plumbing", location: "Glasgow", dedupeBusinessLocationKey: '["north star plumbing","glasgow"]' },
      { id: "business-d", businessName: "", location: "", dedupeBusinessLocationKey: '["legacy","value"]' },
    ]);

    expect(report.missingBusinessLocationKeys).toEqual(["business-a"]);
    expect(report.staleBusinessLocationKeys).toEqual(["business-b", "business-d"]);
    expect(report.businessLocationCollisions).toHaveLength(1);
    expect(report.businessLocationCollisions[0]).toMatchObject({
      identifierType: "businessLocation",
      leadIds: ["business-a", "business-b"],
    });
    expect(report.businessLocationCollisions[0].canonicalKeyFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(report)).not.toContain("North Star Plumbing");
    expect(JSON.stringify(report)).not.toContain("Edinburgh");
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
      missingBusinessLocationKeys: [],
      staleBusinessLocationKeys: [],
      emailCollisions: [],
      websiteCollisions: [],
      businessLocationCollisions: [],
    });
  });
});
