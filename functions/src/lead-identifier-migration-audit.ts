import { createHash } from "node:crypto";
import { canonicalLeadEmailKey, canonicalLeadWebsiteKey } from "./lead-identifiers";

export interface LegacyLeadRecord {
  id: string;
  email?: unknown;
  website?: unknown;
  dedupeEmailKey?: unknown;
  dedupeWebsiteKey?: unknown;
}

export interface IdentifierCollision {
  identifierType: "email" | "website";
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
  malformedWebsiteRecords: string[];
  emailCollisions: IdentifierCollision[];
  websiteCollisions: IdentifierCollision[];
}

/**
 * Build a read-only audit report for a bounded page set of lead records.
 *
 * This function never writes to a database and deliberately omits raw contact
 * values from the report. Collision groups contain only a SHA-256 fingerprint.
 * Callers must scope records to one organisation and
 * page through the collection with an explicit limit before invoking it.
 */
export function auditLeadIdentifierRecords(records: readonly LegacyLeadRecord[]): LeadIdentifierAuditReport {
  const report: LeadIdentifierAuditReport = {
    scannedRecords: records.length,
    missingEmailKeys: [],
    staleEmailKeys: [],
    missingWebsiteKeys: [],
    staleWebsiteKeys: [],
    malformedWebsiteRecords: [],
    emailCollisions: [],
    websiteCollisions: [],
  };

  const emailGroups = new Map<string, string[]>();
  const websiteGroups = new Map<string, string[]>();

  for (const record of records) {
    const id = typeof record.id === "string" ? record.id : "";
    const email = typeof record.email === "string" ? record.email.trim() : "";
    const website = typeof record.website === "string" ? record.website.trim() : "";

    if (email) {
      const key = canonicalLeadEmailKey(email);
      if (typeof record.dedupeEmailKey !== "string" || !record.dedupeEmailKey) {
        report.missingEmailKeys.push(id);
      } else if (record.dedupeEmailKey !== key) {
        report.staleEmailKeys.push(id);
      }
      emailGroups.set(key, [...(emailGroups.get(key) ?? []), id]);
    } else if (typeof record.dedupeEmailKey === "string" && record.dedupeEmailKey) {
      report.staleEmailKeys.push(id);
    }

    if (website) {
      try {
        const key = canonicalLeadWebsiteKey(website);
        if (!key) {
          report.missingWebsiteKeys.push(id);
          continue;
        }
        if (typeof record.dedupeWebsiteKey !== "string" || !record.dedupeWebsiteKey) {
          report.missingWebsiteKeys.push(id);
        } else if (record.dedupeWebsiteKey !== key) {
          report.staleWebsiteKeys.push(id);
        }
        websiteGroups.set(key, [...(websiteGroups.get(key) ?? []), id]);
      } catch {
        report.malformedWebsiteRecords.push(id);
      }
    } else if (typeof record.dedupeWebsiteKey === "string" && record.dedupeWebsiteKey) {
      report.staleWebsiteKeys.push(id);
    }
  }

  report.emailCollisions = [...emailGroups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ identifierType: "email" as const, canonicalKeyFingerprint: createHash("sha256").update(key).digest("hex"), leadIds: [...ids].sort() }))
    .sort((a, b) => a.canonicalKeyFingerprint.localeCompare(b.canonicalKeyFingerprint));
  report.websiteCollisions = [...websiteGroups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ identifierType: "website" as const, canonicalKeyFingerprint: createHash("sha256").update(key).digest("hex"), leadIds: [...ids].sort() }))
    .sort((a, b) => a.canonicalKeyFingerprint.localeCompare(b.canonicalKeyFingerprint));

  for (const field of [
    report.missingEmailKeys,
    report.staleEmailKeys,
    report.missingWebsiteKeys,
    report.staleWebsiteKeys,
    report.malformedWebsiteRecords,
  ]) {
    field.sort();
  }

  return report;
}
