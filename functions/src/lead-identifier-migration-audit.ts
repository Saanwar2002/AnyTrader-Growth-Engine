import { createHash } from "node:crypto";
import { canonicalLeadBusinessLocationKey, canonicalLeadEmailKey, canonicalLeadWebsiteKey } from "./lead-identifiers";

export interface LegacyLeadRecord {
  id: string;
  email?: unknown;
  website?: unknown;
  businessName?: unknown;
  location?: unknown;
  dedupeEmailKey?: unknown;
  dedupeWebsiteKey?: unknown;
  dedupeBusinessLocationKey?: unknown;
}

export interface IdentifierCollision {
  identifierType: "email" | "website" | "businessLocation";
  /** SHA-256 fingerprint of the canonical identifier; never contains contact data. */
  canonicalKeyFingerprint: string;
  leadIds: string[];
}

export interface LeadIdentifierAuditReport {
  scannedRecords: number;
  missingEmailKeys: string[];
  staleEmailKeys: string[];
  missingWebsiteKeys: string[];
  staleWebsiteKeys: string[];
  missingBusinessLocationKeys: string[];
  staleBusinessLocationKeys: string[];
  malformedWebsiteRecords: string[];
  emailCollisions: IdentifierCollision[];
  websiteCollisions: IdentifierCollision[];
  businessLocationCollisions: IdentifierCollision[];
}

const RECORD_KEYS = new Set([
  "id", "email", "website", "businessName", "location",
  "dedupeEmailKey", "dedupeWebsiteKey", "dedupeBusinessLocationKey",
]);

/** Snapshot untrusted array and record values through own data descriptors only. */
function snapshotAuditRecords(value: unknown): LegacyLeadRecord[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const keys = Reflect.ownKeys(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) return null;
    const length = lengthDescriptor.value as number;
    if (keys.length !== length + 1 || !keys.includes("length")) return null;

    const records: LegacyLeadRecord[] = [];
    for (let index = 0; index < length; index += 1) {
      if (!keys.includes(String(index))) return null;
      const itemDescriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!itemDescriptor || !itemDescriptor.enumerable || !("value" in itemDescriptor)) return null;
      const item = itemDescriptor.value;
      if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) return null;
      const itemKeys = Reflect.ownKeys(item);
      const snapshot: Record<string, unknown> = Object.create(null);
      for (const key of itemKeys) {
        if (typeof key !== "string" || !RECORD_KEYS.has(key)) return null;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
        snapshot[key] = descriptor.value;
      }
      if (typeof snapshot.id !== "string" || !snapshot.id.trim()) return null;
      records.push(snapshot as unknown as LegacyLeadRecord);
    }
    return records;
  } catch {
    return null;
  }
}

/**
 * Build a read-only audit report for a bounded page set of lead records.
 *
 * This function never writes to a database and deliberately omits raw contact
 * values from the report. Collision groups contain only a SHA-256 fingerprint.
 * Callers must scope records to one organisation and page through the
 * collection with an explicit limit before invoking it.
 */
export function auditLeadIdentifierRecords(records: readonly LegacyLeadRecord[]): LeadIdentifierAuditReport {
  // Snapshot runtime inputs before any field reads. This function is also used
  // directly in tests and tools, outside the bounded pagination coordinator.
  const safeRecords = snapshotAuditRecords(records);
  if (!safeRecords) {
    throw new Error("Lead identifier audit requires a dense array of plain data records with non-empty IDs.");
  }

  const seenIds = new Set<string>();
  for (const record of safeRecords) {
    if (seenIds.has(record.id)) {
      throw new Error("Lead identifier audit received a duplicate record ID.");
    }
    seenIds.add(record.id);
  }

  const report: LeadIdentifierAuditReport = {
    scannedRecords: safeRecords.length,
    missingEmailKeys: [],
    staleEmailKeys: [],
    missingWebsiteKeys: [],
    staleWebsiteKeys: [],
    missingBusinessLocationKeys: [],
    staleBusinessLocationKeys: [],
    malformedWebsiteRecords: [],
    emailCollisions: [],
    websiteCollisions: [],
    businessLocationCollisions: [],
  };

  const emailGroups = new Map<string, string[]>();
  const websiteGroups = new Map<string, string[]>();
  const businessLocationGroups = new Map<string, string[]>();
  const addRecordToGroup = (groups: Map<string, string[]>, key: string, id: string): void => {
    const group = groups.get(key);
    if (group) group.push(id);
    else groups.set(key, [id]);
  };

  for (const record of safeRecords) {
    const id = record.id;
    const email = typeof record.email === "string" ? record.email.trim() : "";
    const website = typeof record.website === "string" ? record.website.trim() : "";
    const businessName = typeof record.businessName === "string" ? record.businessName.trim() : "";
    const location = typeof record.location === "string" ? record.location.trim() : "";

    if (email) {
      const key = canonicalLeadEmailKey(email);
      if (typeof record.dedupeEmailKey !== "string" || !record.dedupeEmailKey) {
        report.missingEmailKeys.push(id);
      } else if (record.dedupeEmailKey !== key) {
        report.staleEmailKeys.push(id);
      }
      addRecordToGroup(emailGroups, key, id);
    } else if (typeof record.dedupeEmailKey === "string" && record.dedupeEmailKey) {
      report.staleEmailKeys.push(id);
    }

    if (website) {
      try {
        const key = canonicalLeadWebsiteKey(website);
        if (!key) {
          report.missingWebsiteKeys.push(id);
        } else {
          if (typeof record.dedupeWebsiteKey !== "string" || !record.dedupeWebsiteKey) {
            report.missingWebsiteKeys.push(id);
          } else if (record.dedupeWebsiteKey !== key) {
            report.staleWebsiteKeys.push(id);
          }
          addRecordToGroup(websiteGroups, key, id);
        }
      } catch {
        report.malformedWebsiteRecords.push(id);
      }
    } else if (typeof record.dedupeWebsiteKey === "string" && record.dedupeWebsiteKey) {
      report.staleWebsiteKeys.push(id);
    }

    if (businessName || location) {
      const key = canonicalLeadBusinessLocationKey(businessName, location);
      if (typeof record.dedupeBusinessLocationKey !== "string" || !record.dedupeBusinessLocationKey) {
        report.missingBusinessLocationKeys.push(id);
      } else if (record.dedupeBusinessLocationKey !== key) {
        report.staleBusinessLocationKeys.push(id);
      }
      addRecordToGroup(businessLocationGroups, key, id);
    } else if (typeof record.dedupeBusinessLocationKey === "string" && record.dedupeBusinessLocationKey) {
      report.staleBusinessLocationKeys.push(id);
    }
  }

  const collisions = (groups: Map<string, string[]>, identifierType: IdentifierCollision["identifierType"]): IdentifierCollision[] =>
    [...groups.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([key, ids]) => ({
        identifierType,
        canonicalKeyFingerprint: createHash("sha256").update(key).digest("hex"),
        leadIds: [...ids].sort(),
      }))
      .sort((a, b) => a.canonicalKeyFingerprint.localeCompare(b.canonicalKeyFingerprint));

  report.emailCollisions = collisions(emailGroups, "email");
  report.websiteCollisions = collisions(websiteGroups, "website");
  report.businessLocationCollisions = collisions(businessLocationGroups, "businessLocation");

  for (const field of [
    report.missingEmailKeys,
    report.staleEmailKeys,
    report.missingWebsiteKeys,
    report.staleWebsiteKeys,
    report.missingBusinessLocationKeys,
    report.staleBusinessLocationKeys,
    report.malformedWebsiteRecords,
  ]) {
    field.sort();
  }

  return report;
}
