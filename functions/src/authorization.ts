export type OrganisationRole = "owner" | "admin" | "member" | "viewer";

export function normaliseRequiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  if (result.length === 0 || result.length > maxLength) return null;
  return result;
}

export function hasCampaignWritePermission(role: unknown): role is "owner" | "admin" {
  return role === "owner" || role === "admin";
}

export function isValidOrganisationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function normaliseOptionalText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length <= maxLength ? result : null;
}


export type ServerLeadStatus = "new" | "reviewing" | "qualified" | "contacted" | "onboarded" | "rejected";

const SERVER_LEAD_STATUSES: readonly ServerLeadStatus[] = [
  "new", "reviewing", "qualified", "contacted", "onboarded", "rejected",
];

export function hasLeadWritePermission(role: unknown): role is "owner" | "admin" | "member" {
  return role === "owner" || role === "admin" || role === "member";
}

export function isValidDocumentId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function isValidLeadStatus(value: unknown): value is ServerLeadStatus {
  return typeof value === "string" && SERVER_LEAD_STATUSES.includes(value as ServerLeadStatus);
}

export function canTransitionLeadStatus(status: unknown, doNotContact: boolean): status is ServerLeadStatus {
  return isValidLeadStatus(status) && !(doNotContact && status === "contacted");
}

export function calculateLeadCompleteness(input: {
  businessName: string; website: string; email: string; phone: string; location: string; category: string;
}): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (input.businessName.trim().length >= 3) { score += 20; reasons.push("Business name provided (+20)"); }
  if (input.website.trim()) { score += 20; reasons.push("Website listed (+20)"); }
  if (input.email.trim()) { score += 20; reasons.push("Email listed (+20)"); }
  if (input.phone.trim()) { score += 15; reasons.push("Phone listed (+15)"); }
  if (input.location.trim()) { score += 15; reasons.push("Location provided (+15)"); }
  if (input.category.trim()) { score += 10; reasons.push("Service category provided (+10)"); }
  return { score: Math.min(score, 100), reasons };
}


export function canMarkLeadContacted(doNotContact: unknown, contactReviewStatus?: unknown): boolean {
  // Contact history must fail closed for legacy/malformed restrictions and pending reviews.
  return doNotContact === false && (contactReviewStatus === undefined || contactReviewStatus === "cleared");
}

export function canCreateServerOutreachDraft(doNotContact: unknown, contactReviewStatus?: unknown): boolean {
  // Legacy records without a review status are allowed only when the restriction is
  // explicitly false. New records must have an explicitly cleared review status.
  return doNotContact === false && (contactReviewStatus === undefined || contactReviewStatus === "cleared");
}

export type ContactReviewStatus = "pending" | "cleared" | "blocked";

export function normaliseContactReviewStatus(doNotContact: unknown, contactReviewStatus: unknown): ContactReviewStatus {
  // A positive restriction always overrides a contradictory "cleared" status.
  if (doNotContact === true && contactReviewStatus !== "pending") return "blocked";
  if (contactReviewStatus === "blocked") return "blocked";
  if (contactReviewStatus === "pending") return "pending";
  // Review metadata cannot make an absent or malformed authoritative restriction safe.
  if (doNotContact !== false) return "pending";
  if (contactReviewStatus === "cleared") return "cleared";
  if (contactReviewStatus === undefined) return "cleared";
  return "pending";
}

export function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}


export function canChangeSuppression(role: unknown, doNotContact: unknown): boolean {
  if (typeof doNotContact !== "boolean") return false;
  if (doNotContact) return hasLeadWritePermission(role);
  return hasCampaignWritePermission(role);
}


export type ServerCampaignStatus = "draft" | "active" | "paused" | "completed";
const SERVER_CAMPAIGN_STATUSES: readonly ServerCampaignStatus[] = ["draft", "active", "paused", "completed"];
export function isValidCampaignStatus(value: unknown): value is ServerCampaignStatus {
  return typeof value === "string" && SERVER_CAMPAIGN_STATUSES.includes(value as ServerCampaignStatus);
}

export function hasConsistentDraftCampaign(draftCampaignId: unknown, leadCampaignId: unknown): boolean {
  return isValidDocumentId(draftCampaignId)
    && isValidDocumentId(leadCampaignId)
    && draftCampaignId === leadCampaignId;
}


export function getOutreachDraftReviewState(leadExists: boolean, doNotContact: unknown, contactReviewStatus?: unknown): {
  leadSuppressed: boolean;
  requiresReview: boolean;
  reviewReason: string | null;
} {
  if (!leadExists) {
    return { leadSuppressed: false, requiresReview: true, reviewReason: "Lead record is missing; review before use." };
  }
  // The explicit restriction is authoritative, even if review metadata conflicts.
  if (doNotContact === true || contactReviewStatus === "blocked") {
    return { leadSuppressed: true, requiresReview: true, reviewReason: "Lead is suppressed; do not contact." };
  }
  if (contactReviewStatus === "pending") {
    return { leadSuppressed: false, requiresReview: true, reviewReason: "Lead contact review is pending or could not be verified; review before use." };
  }
  if (doNotContact !== false || (contactReviewStatus !== undefined && contactReviewStatus !== "cleared")) {
    return { leadSuppressed: false, requiresReview: true, reviewReason: "Lead contact restriction could not be verified; review before use." };
  }
  return { leadSuppressed: false, requiresReview: false, reviewReason: null };
}


export function isValidOrganisationPageToken(value: unknown, uid: string): value is string {
  if (typeof value !== "string" || value.length > 512) return false;
  const segments = value.split("/");
  return segments.length === 4
    && segments[0] === "organisations"
    && isValidOrganisationId(segments[1])
    && segments[2] === "members"
    && segments[3] === uid;
}


export function isValidMembershipRecord(value: unknown, expectedUid: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const validRole = record.role === "owner" || record.role === "admin" || record.role === "member" || record.role === "viewer";
  return record.uid === expectedUid && validRole;
}

/** Validates membership role integrity against the parent organisation record. */
export function isValidMembershipForOrganisation(
  value: unknown,
  expectedUid: string,
  organisationOwnerUid: unknown,
): boolean {
  if (!isValidMembershipRecord(value, expectedUid)) return false;
  const record = value as Record<string, unknown>;
  // Owner-role membership must match the organisation's authoritative ownerUid.
  // Missing or conflicting ownership metadata must not silently grant owner powers.
  if (record.role === "owner") return typeof organisationOwnerUid === "string" && organisationOwnerUid === expectedUid;
  return true;
}

export function isValidOrganisationCollectionPageToken(value: unknown, organisationId: string, collectionName: "campaigns" | "leads" | "outreachDrafts"): value is string {
  if (typeof value !== "string" || value.length > 512) return false;
  const segments = value.split("/");
  return segments.length === 4
    && segments[0] === "organisations"
    && segments[1] === organisationId
    && segments[2] === collectionName
    && isValidDocumentId(segments[3]);
}


/** True only for a usable Firestore Timestamp value used by ordered pagination. */
export function isValidFirestoreTimestamp(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const timestamp = value as { toMillis?: unknown };
  if (typeof timestamp.toMillis !== "function") return false;
  try {
    const milliseconds = (timestamp.toMillis as () => unknown).call(value);
    return typeof milliseconds === "number" && Number.isFinite(milliseconds);
  } catch {
    return false;
  }
}
