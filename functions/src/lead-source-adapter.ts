/**
 * Provider-neutral contract for future lead-source integrations.
 * No network requests or provider credentials are handled in this module.
 */
export type LeadSourceReviewStatus = "pending" | "approved" | "rejected";
export type LeadSourceField = "businessName" | "category" | "location" | "website" | "email" | "phone";

export interface LeadSourceAdapterManifest {
  sourceId: string;
  displayName: string;
  termsUrl: string;
  reviewStatus: LeadSourceReviewStatus;
  reviewedAt?: string;
  reviewedBy?: string;
  permittedPurpose?: "business_provider_recruitment";
  maxRequestsPerMinute: number;
  maxRecordsPerRun: number;
  allowedFields: LeadSourceField[];
}
export interface LeadSourceCandidate {
  businessName: string;
  category?: string;
  location?: string;
  website?: string;
  email?: string;
  phone?: string;
  sourceRecordId?: string;
}
export interface LeadSourceProvenance {
  sourceId: string;
  sourceName: string;
  termsUrl: string;
  collectedAt: string;
  sourceRecordId?: string;
}
export interface AttributedLeadSourceCandidate {
  candidate: LeadSourceCandidate;
  provenance: LeadSourceProvenance;
}
export interface LeadSourceDiscoveryRequest { category: string; location: string; limit: number; }
/** Implementations must only call a provider through an approved, permitted API. */
export interface LeadSourceAdapter {
  manifest: LeadSourceAdapterManifest;
  discover(request: LeadSourceDiscoveryRequest): Promise<LeadSourceCandidate[]>;
}
const ALLOWED_FIELDS = new Set<LeadSourceField>(["businessName", "category", "location", "website", "email", "phone"]);
function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}
/** Return manifest defects; never infer permission or source scope. */
export function validateLeadSourceManifest(manifest: LeadSourceAdapterManifest): string[] {
  const issues: string[] = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return ["A source adapter manifest is required."];
  if (typeof manifest.sourceId !== "string" || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(manifest.sourceId)) {
    issues.push("sourceId must be a stable 2–64 character lowercase identifier.");
  }
  if (typeof manifest.displayName !== "string" || manifest.displayName.trim().length < 2 || manifest.displayName.trim().length > 100) {
    issues.push("displayName must contain 2–100 characters.");
  }
  try {
    const terms = new URL(manifest.termsUrl);
    if (terms.protocol !== "https:" || terms.username || terms.password) issues.push("termsUrl must be an HTTPS URL without embedded credentials.");
  } catch {
    issues.push("termsUrl must be a valid HTTPS URL.");
  }
  if (!["pending", "approved", "rejected"].includes(manifest.reviewStatus)) issues.push("reviewStatus must be pending, approved, or rejected.");
  if (!Number.isInteger(manifest.maxRequestsPerMinute) || manifest.maxRequestsPerMinute < 1 || manifest.maxRequestsPerMinute > 600) {
    issues.push("maxRequestsPerMinute must be an integer between 1 and 600.");
  }
  if (!Number.isInteger(manifest.maxRecordsPerRun) || manifest.maxRecordsPerRun < 1 || manifest.maxRecordsPerRun > 500) {
    issues.push("maxRecordsPerRun must be an integer between 1 and 500.");
  }
  if (!Array.isArray(manifest.allowedFields) || manifest.allowedFields.length === 0
    || manifest.allowedFields.some((field) => !ALLOWED_FIELDS.has(field))
    || new Set(manifest.allowedFields).size !== manifest.allowedFields.length) {
    issues.push("allowedFields must be a non-empty list of unique supported lead fields.");
  } else if (!manifest.allowedFields.includes("businessName")) {
    issues.push("allowedFields must include businessName.");
  }
  if (manifest.reviewStatus === "approved") {
    if (!isIsoDate(manifest.reviewedAt)) issues.push("Approved sources require a valid ISO-8601 reviewedAt timestamp.");
    if (typeof manifest.reviewedBy !== "string" || !manifest.reviewedBy.trim()) issues.push("Approved sources require a reviewer reference.");
    if (manifest.permittedPurpose !== "business_provider_recruitment") {
      issues.push("Approved sources must explicitly permit the business_provider_recruitment purpose.");
    }
  }
  return issues;
}
/** Fail closed until a human has recorded permission review for this exact purpose. */
export function assertLeadSourceAdapterRunnable(manifest: LeadSourceAdapterManifest): void {
  const issues = validateLeadSourceManifest(manifest);
  if (issues.length) throw new Error(`Lead source adapter manifest is invalid: ${issues.join(" ")}`);
  if (manifest.reviewStatus !== "approved") throw new Error("Lead source adapter is blocked until its terms and permitted use are approved.");
}
