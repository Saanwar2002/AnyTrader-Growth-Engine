import { describe, expect, it } from "vitest";
import { hasExactAuditMetadataKeys } from "./audit-metadata-shape";

describe("exact event-specific audit metadata shape", () => {
  const allowed = ["followUpDateSet", "leadStatus"];

  it("accepts the complete expected key set regardless of key order", () => {
    expect(hasExactAuditMetadataKeys({ leadStatus: "qualified", followUpDateSet: true }, allowed)).toBe(true);
    expect(hasExactAuditMetadataKeys({ followUpDateSet: false, leadStatus: "new" }, allowed)).toBe(true);
  });

  it("rejects missing required keys even when every present key is allowed", () => {
    expect(hasExactAuditMetadataKeys({ leadStatus: "qualified" }, allowed)).toBe(false);
    expect(hasExactAuditMetadataKeys({}, allowed)).toBe(false);
  });

  it("rejects unexpected keys, duplicate-free extra payloads, and malformed containers", () => {
    expect(hasExactAuditMetadataKeys({ leadStatus: "qualified", followUpDateSet: true, email: "private@example.test" }, allowed)).toBe(false);
    expect(hasExactAuditMetadataKeys(null, allowed)).toBe(false);
    expect(hasExactAuditMetadataKeys([], allowed)).toBe(false);
    expect(hasExactAuditMetadataKeys("metadata", allowed)).toBe(false);
    expect(hasExactAuditMetadataKeys(42, allowed)).toBe(false);
  });

  it("requires all keys when the event contract is empty", () => {
    expect(hasExactAuditMetadataKeys({}, [])).toBe(true);
    expect(hasExactAuditMetadataKeys({ unexpected: true }, [])).toBe(false);
  });
});
