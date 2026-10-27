import { describe, expect, it } from "vitest";
import { hasExactAuditMetadataKeys, snapshotExactAuditMetadata } from "./audit-metadata-shape";

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

  it("rejects accessor-backed fields without invoking getters", () => {
    let getterInvoked = false;
    const metadata = { leadStatus: "qualified" };
    Object.defineProperty(metadata, "followUpDateSet", {
      enumerable: true,
      get: () => { getterInvoked = true; return true; },
    });

    expect(hasExactAuditMetadataKeys(metadata, allowed)).toBe(false);
    expect(getterInvoked).toBe(false);
  });

  it("rejects symbol keys, hidden fields, class instances, and throwing proxy traps", () => {
    expect(hasExactAuditMetadataKeys({
      leadStatus: "qualified",
      followUpDateSet: true,
      [Symbol("extra")]: "private",
    }, allowed)).toBe(false);

    const hidden = { leadStatus: "qualified", followUpDateSet: true };
    Object.defineProperty(hidden, "hidden", { value: "private", enumerable: false });
    expect(hasExactAuditMetadataKeys(hidden, allowed)).toBe(false);

    class MetadataRecord {
      leadStatus = "qualified";
      followUpDateSet = true;
    }
    expect(hasExactAuditMetadataKeys(new MetadataRecord(), allowed)).toBe(false);

    const hostile = new Proxy({ leadStatus: "qualified", followUpDateSet: true }, {
      ownKeys: () => { throw new Error("sensitive proxy detail"); },
    });
    expect(hasExactAuditMetadataKeys(hostile, allowed)).toBe(false);
  });

  it("snapshots proxy data descriptors without invoking its get trap", () => {
    let getTrapInvoked = false;
    const target = { leadStatus: "qualified", followUpDateSet: true };
    const hostileRead = new Proxy(target, {
      get(_target, key) {
        getTrapInvoked = true;
        if (key === "leadStatus") return "rejected";
        return Reflect.get(_target, key);
      },
    });

    const snapshot = snapshotExactAuditMetadata(hostileRead, allowed);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.leadStatus).toBe("qualified");
    expect(snapshot?.followUpDateSet).toBe(true);
    expect(getTrapInvoked).toBe(false);
  });

  it("returns a detached null-prototype snapshot", () => {
    const original = { leadStatus: "qualified", followUpDateSet: true };
    const snapshot = snapshotExactAuditMetadata(original, allowed);
    expect(snapshot).not.toBeNull();
    expect(Object.getPrototypeOf(snapshot)).toBeNull();
    original.leadStatus = "rejected";
    expect(snapshot?.leadStatus).toBe("qualified");
  });

  it("requires all keys when the event contract is empty", () => {
    expect(hasExactAuditMetadataKeys({}, [])).toBe(true);
    expect(hasExactAuditMetadataKeys({ unexpected: true }, [])).toBe(false);
  });
});
