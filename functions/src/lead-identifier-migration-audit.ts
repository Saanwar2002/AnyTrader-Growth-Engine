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

const LEGACY_LEAD_AUDIT_RECORD_KEYS = new Set([
  "id", "email", "website", "businessName", "location",
  "dedupeEmailKey", "dedupeWebsiteKey", "dedupeBusinessLocationKey",
]);

function snapshotLegacyLeadAuditRecord(value: unknown): LegacyLeadRecord {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || !LEGACY_LEAD_AUDIT_RECORD_KEYS.has(key))) throw new Error();
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error();
      snapshot[key as string] = descriptor.value;
    }
    return snapshot as unknown as LegacyLeadRecord;
  } catch {
    throw new Error("Lead identifier audit received a malformed record.");
  }
}

function snapshotLegacyLeadAuditRecords(records: readonly LegacyLeadRecord[]): LegacyLeadRecord[] {
  if (!Array.isArray(records)) {
    throw new Error("Lead identifier audit requires an array of records.");
  }
  try {
    if (Object.getPrototypeOf(records) !== Array.prototype) throw new Error();
    const keys = Reflect.ownKeys(records);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(records, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0
      || keys.length !== lengthDescriptor.value + 1
      || keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\\d*)$/.test(key)))) {
      throw new Error();
    }
    const snapshot: LegacyLeadRecord[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(records, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error();
      snapshot.push(snapshotLegacyLeadAuditRecord(descriptor.value));
    }
    return snapshot;
  } catch (error) {
    if (error instanceof Error && error.message === "Lead identifier audit received a malformed record.") throw error;
    throw new Error("Lead identifier audit received a malformed records array.");
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
  // Keep the pure analyzer defensive even when called outside the bounded
  // pagination coordinator. Firestore adapters and test fixtures are runtime
  // boundaries, so malformed records must fail closed rather than produce a
  // misleading report or crash partway through analysis.
  const safeRecords = snapshotLegacyLeadAuditRecords(records);
  const seenIds = new Set<string>();
  for (const record of safeRecords as readonly unknown[]) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("Lead identifier audit received a malformed record.");
    }
    const id = (record as { id?: unknown }).id;
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("Lead identifier audit record must have a non-empty string ID.");
    }
    if (seenIds.has(id)) {
      throw new Error("Lead identifier audit received a duplicate record ID.");
    }
    seenIds.add(id);
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
