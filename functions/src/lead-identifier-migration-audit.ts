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
  if (!Array.isArray(records)) {
    throw new Error("Lead identifier audit requires an array of records.");
  }
  const seenIds = new Set<string>();
  for (const record of records as readonly unknown[]) {
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
    scannedRecords: records.length,
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

  for (const record of records) {
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
