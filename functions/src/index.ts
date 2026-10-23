import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore, type QueryDocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {
  calculateLeadCompleteness,
  canChangeSuppression,
  canCreateServerOutreachDraft,
  canMarkLeadContacted,
  canTransitionLeadStatus,
  hasCampaignWritePermission,
  hasLeadWritePermission,
  getOutreachDraftReviewState,
  hasConsistentDraftCampaign,
  isValidCampaignStatus,
  isValidLeadStatus,
  isValidDocumentId,
  isValidEmailAddress,
  isSafeWebsiteAddress,
  evaluateRateLimit,
  createRateLimitDocumentId,
  isValidOrganisationId,
  isValidOrganisationPageToken,
  isValidOrganisationCollectionPageToken,
  isValidMembershipRecord,
  isValidMembershipForOrganisation,
  isValidFirestoreTimestamp,
  normaliseContactReviewStatus,
  normaliseOptionalText,
  normaliseRequiredText,
  safeTimestampToIso,
} from "./authorization";

initializeApp();
const db = getFirestore();

// Persisted records can predate current validation rules or be corrupted by manual
// imports. Keep list responses JSON-safe and bounded rather than trusting Firestore shape.
function safePersistedText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function safePersistedStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
}

type SecurityAuditEventType =
  | "organisation.created"
  | "lead.csv_import.completed"
  | "lead.contact_updated"
  | "lead.contact_restriction_changed"
  | "lead.created"
  | "campaign.created"
  | "campaign.status_changed"
  | "lead.status_changed"
  | "lead.notes_changed"
  | "outreach_draft.created"
  | "outreach_draft.updated"
  | "outreach_draft.deleted";

type SecurityAuditEventMetadata = {
  importedCount?: number;
  duplicatesSkipped?: number;
  contactChannelsChanged?: boolean;
  contactReviewRevision?: number;
  doNotContact?: boolean;
  contactReviewStatus?: "pending" | "cleared" | "blocked";
  campaignStatus?: "active" | "paused" | "completed";
  leadStatus?: string;
  notesCleared?: boolean;
  draftAction?: "created" | "updated" | "deleted";
};

const AUDIT_EVENT_RESOURCE_TYPES: Record<SecurityAuditEventType, "organisation" | "campaign" | "lead" | "outreachDraft"> = {
  "organisation.created": "organisation",
  "lead.csv_import.completed": "campaign",
  "lead.contact_updated": "lead",
  "lead.contact_restriction_changed": "lead",
  "lead.created": "lead",
  "campaign.created": "campaign",
  "campaign.status_changed": "campaign",
  "lead.status_changed": "lead",
  "lead.notes_changed": "lead",
  "outreach_draft.created": "outreachDraft",
  "outreach_draft.updated": "outreachDraft",
  "outreach_draft.deleted": "outreachDraft",
};

const AUDIT_METADATA_KEYS: Record<SecurityAuditEventType, readonly (keyof SecurityAuditEventMetadata)[]> = {
  "organisation.created": [],
  "lead.csv_import.completed": ["importedCount", "duplicatesSkipped"],
  "lead.contact_updated": ["contactChannelsChanged", "contactReviewRevision", "contactReviewStatus", "doNotContact"],
  "lead.contact_restriction_changed": ["doNotContact", "contactReviewRevision", "contactReviewStatus"],
  "lead.created": ["leadStatus"],
  "campaign.created": ["campaignStatus"],
  "campaign.status_changed": ["campaignStatus"],
  "lead.status_changed": ["leadStatus"],
  "lead.notes_changed": ["notesCleared"],
  "outreach_draft.created": ["draftAction"],
  "outreach_draft.updated": ["draftAction"],
  "outreach_draft.deleted": ["draftAction"],
};

function isBoundedAuditMetadata(eventType: SecurityAuditEventType, metadata: SecurityAuditEventMetadata): boolean {
  const allowedKeys = AUDIT_METADATA_KEYS[eventType];
  if (Object.keys(metadata).some((key) => !allowedKeys.includes(key as keyof SecurityAuditEventMetadata))) return false;
  if (("importedCount" in metadata && (!Number.isSafeInteger(metadata.importedCount) || metadata.importedCount! < 0 || metadata.importedCount! > 5000))
    || ("duplicatesSkipped" in metadata && (!Number.isSafeInteger(metadata.duplicatesSkipped) || metadata.duplicatesSkipped! < 0 || metadata.duplicatesSkipped! > 5000))
    || ("contactReviewRevision" in metadata && (!Number.isSafeInteger(metadata.contactReviewRevision) || metadata.contactReviewRevision! < 0))
    || ("contactChannelsChanged" in metadata && typeof metadata.contactChannelsChanged !== "boolean")
    || ("doNotContact" in metadata && typeof metadata.doNotContact !== "boolean")
    || ("notesCleared" in metadata && typeof metadata.notesCleared !== "boolean")) return false;
  if ("campaignStatus" in metadata && !["active", "paused", "completed"].includes(metadata.campaignStatus ?? "")) return false;
  if ("leadStatus" in metadata && !["new", "reviewing", "qualified", "contacted", "onboarded", "rejected"].includes(metadata.leadStatus ?? "")) return false;
  if ("contactReviewStatus" in metadata && !["pending", "cleared", "blocked"].includes(metadata.contactReviewStatus ?? "")) return false;
  if ("draftAction" in metadata && !["created", "updated", "deleted"].includes(metadata.draftAction ?? "")) return false;
  return true;
}

function writeSecurityAuditEvent(
  transaction: Transaction,
  organisationId: string,
  actorUid: string,
  eventType: SecurityAuditEventType,
  resourceType: "organisation" | "campaign" | "lead" | "outreachDraft",
  resourceId: string,
  metadata: SecurityAuditEventMetadata,
): void {
  if (AUDIT_EVENT_RESOURCE_TYPES[eventType] !== resourceType || !isBoundedAuditMetadata(eventType, metadata)) {
    throw new Error("Invalid security audit event resource or metadata contract.");
  }
  const eventRef = db.collection("organisations").doc(organisationId).collection("securityAuditEvents").doc();
  transaction.create(eventRef, {
    schemaVersion: 1,
    eventType,
    organisationId,
    actorUid,
    resourceType,
    resourceId,
    outcome: "success",
    metadata,
    createdAt: FieldValue.serverTimestamp(),
  });
}

const RATE_LIMIT_WINDOW_MS = 60000;
// Keep expired quota buckets briefly for incident review, then allow optional Firestore TTL cleanup.
const RATE_LIMIT_TTL_GRACE_MS = 5 * 60 * 1000;

/** Consume a per-user, per-organisation quota in the protected mutation transaction. */
async function consumeTransactionalRateLimit(transaction: Transaction, organisationId: string, uid: string, operation: string, maxRequests: number, windowMs = RATE_LIMIT_WINDOW_MS): Promise<void> {
  const key = createRateLimitDocumentId(organisationId, uid, operation);
  const ref = db.collection("rateLimits").doc(key);
  const snapshot = await transaction.get(ref);
  const evaluation = evaluateRateLimit(snapshot.exists ? snapshot.data() : undefined, Date.now(), maxRequests, windowMs);
  if (evaluation.invalidState) {
    logger.error("Rate-limit state validation failed", {
      operation,
      quotaKey: key,
      reason: "invalid_persisted_state_or_configuration",
    });
    throw new HttpsError("failed-precondition", "Rate-limit state is invalid and requires operator review.");
  }
  if (!evaluation.allowed || !evaluation.nextState) {
    const seconds = Math.max(1, Math.ceil(evaluation.retryAfterMs / 1000));
    logger.warn("Rate limit exceeded", {
      operation,
      quotaKey: key,
      retryAfterSeconds: seconds,
      maxRequests,
      windowMs,
    });
    throw new HttpsError("resource-exhausted", `Too many ${operation} requests. Try again in about ${seconds} seconds.`);
  }
  transaction.set(ref, {
    ...evaluation.nextState,
    updatedAt: FieldValue.serverTimestamp(),
    // TTL is storage cleanup only; the evaluator remains authoritative for quota enforcement.
    expireAt: Timestamp.fromMillis(evaluation.nextState.windowStartedAtMs + windowMs + RATE_LIMIT_TTL_GRACE_MS),
  });
}

 
/** Consume a quota for a read callable in its own transaction before the read query runs. */
async function consumeReadRateLimit(organisationId: string, uid: string, operation: string, maxRequests: number): Promise<void> {
  await db.runTransaction(async (transaction: Transaction) => {
    await consumeTransactionalRateLimit(transaction, organisationId, uid, operation, maxRequests);
  });
}


function requireUid(uid: string | undefined): string {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to continue.");
  return uid;
}

function requireOrganisationId(value: unknown): string {
  if (!isValidOrganisationId(value)) throw new HttpsError("invalid-argument", "A valid organisationId is required.");
  return value;
}

function requireDocumentId(value: unknown, label: string): string {
  if (!isValidDocumentId(value)) throw new HttpsError("invalid-argument", `A valid ${label} is required.`);
  return value;
}

async function requireMembership(organisationId: string, uid: string) {
  const [organisationSnapshot, snapshot] = await Promise.all([
    db.doc(`organisations/${organisationId}`).get(),
    db.doc(`organisations/${organisationId}/members/${uid}`).get(),
  ]);
  const membership = snapshot.data();
  if (!organisationSnapshot.exists || !snapshot.exists || !isValidMembershipForOrganisation(membership, uid, organisationSnapshot.data()?.ownerUid)) {
    throw new HttpsError("permission-denied", "You do not have access to this organisation.");
  }
  return membership ?? {};
}

async function requireLeadEditor(organisationId: string, uid: string) {
  const membership = await requireMembership(organisationId, uid);
  if (!hasLeadWritePermission(membership.role)) {
    throw new HttpsError("permission-denied", "Your organisation role cannot edit leads or outreach drafts.");
  }
  return membership;
}

async function requireTransactionalRole(
  transaction: Transaction,
  organisationId: string,
  uid: string,
  permission: "lead" | "campaign",
) {
  const organisationRef = db.doc(`organisations/${organisationId}`);
  const membershipRef = db.doc(`organisations/${organisationId}/members/${uid}`);
  const [organisationSnapshot, membershipSnapshot] = await Promise.all([
    transaction.get(organisationRef),
    transaction.get(membershipRef),
  ]);
  const membership = membershipSnapshot.data();
  if (!organisationSnapshot.exists || !membershipSnapshot.exists || !membership || !isValidMembershipForOrganisation(membership, uid, organisationSnapshot.data()?.ownerUid)) {
    throw new HttpsError("permission-denied", "You do not have access to this organisation.");
  }
  const allowed = permission === "campaign"
    ? hasCampaignWritePermission(membership.role)
    : hasLeadWritePermission(membership.role);
  if (!allowed) {
    throw new HttpsError("permission-denied", permission === "campaign"
      ? "Only organisation owners and admins can manage campaigns."
      : "Your organisation role cannot edit leads or outreach drafts.");
  }
  return membership;
}

function normaliseLeadFields(data: Record<string, unknown>) {
  const businessName = normaliseRequiredText(data.businessName, 160);
  const category = normaliseOptionalText(data.category, 100);
  const location = normaliseOptionalText(data.location, 160);
  const website = normaliseOptionalText(data.website, 500);
  const email = normaliseOptionalText(data.email, 254);
  const phone = normaliseOptionalText(data.phone, 80);
  if (!businessName || category === null || location === null || website === null || email === null || phone === null) {
    throw new HttpsError("invalid-argument", "Lead fields are missing or exceed their allowed length.");
  }
  if (website && !isSafeWebsiteAddress(website)) {
    throw new HttpsError("invalid-argument", "Lead website must be a safe HTTP(S) URL or a plain domain.");
  }
  if (email && !isValidEmailAddress(email)) {
    throw new HttpsError("invalid-argument", "Lead email address is not valid.");
  }
  return { businessName, category, location, website, email, phone };
}

export const listMyOrganisations = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  await consumeReadRateLimit("global", uid, "listMyOrganisations", 120);
  const data = (request.data ?? {}) as Record<string, unknown>;
  let cursorSnapshot: QueryDocumentSnapshot | undefined;
  if (data.pageToken !== undefined && data.pageToken !== null && data.pageToken !== "") {
    if (!isValidOrganisationPageToken(data.pageToken, uid)) {
      throw new HttpsError("invalid-argument", "Organisation page token is invalid.");
    }
    const cursor = await db.doc(data.pageToken).get();
    const cursorMembership = cursor.data();
    const cursorOrganisationRef = cursor.ref.parent.parent;
    if (
      !cursor.exists
      || cursor.id !== uid
      || !cursorMembership
      || typeof cursorMembership !== "object"
      || Array.isArray(cursorMembership)
      || cursorMembership.uid !== uid
      || !cursorOrganisationRef
      || cursorOrganisationRef.parent.id !== "organisations"
    ) {
      throw new HttpsError("invalid-argument", "Organisation page token is no longer valid.");
    }
    const cursorOrganisation = await cursorOrganisationRef.get();
    if (!cursorOrganisation.exists) {
      throw new HttpsError("invalid-argument", "Organisation page token is no longer valid.");
    }
    if (!isValidMembershipForOrganisation(cursorMembership, uid, cursorOrganisation.data()?.ownerUid)) {
      throw new HttpsError("invalid-argument", "Organisation page token is no longer valid.");
    }
    cursorSnapshot = cursor as QueryDocumentSnapshot;
  }
  let membershipQuery = db.collectionGroup("members").where("uid", "==", uid);
  if (cursorSnapshot) membershipQuery = membershipQuery.startAfter(cursorSnapshot);
  const memberships = await membershipQuery.limit(101).get();
  const page = memberships.docs.slice(0, 100);
  const organisations: Array<{ organisationId: string; name: string; role: "owner" | "admin" | "member" | "viewer" } | null> = await Promise.all(page.map(async (membershipDoc: QueryDocumentSnapshot) => {
    const organisationRef = membershipDoc.ref.parent.parent;
    if (!organisationRef || organisationRef.parent.id !== "organisations") return null;
    const organisation = await organisationRef.get();
    if (!organisation.exists) return null;
    const membership = membershipDoc.data();
    const role = membership.role;
    if (membershipDoc.id !== uid || !isValidMembershipForOrganisation(membership, uid, organisation.data()?.ownerUid)) return null;
    return { organisationId: organisation.id, name: organisation.data()?.name ?? "Unnamed organisation", role };
  }));
  const hasMoreOrganisations = memberships.size > 100;
  return {
    organisations: organisations.filter((item): item is NonNullable<typeof item> => item !== null),
    hasMoreOrganisations,
    nextPageToken: hasMoreOrganisations ? page[page.length - 1]?.ref.path ?? null : null,
  };
});

export const createOrganisation = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const name = normaliseRequiredText((request.data as { name?: unknown } | undefined)?.name, 100);
  if (!name) throw new HttpsError("invalid-argument", "Organisation name must be 1–100 characters.");

  const organisation = db.collection("organisations").doc();
  const membership = organisation.collection("members").doc(uid);
  await db.runTransaction(async (transaction: Transaction) => {
    await consumeTransactionalRateLimit(transaction, "global", uid, "createOrganisation", 5, 60 * 60_000);
    transaction.create(organisation, { name, ownerUid: uid, createdAt: FieldValue.serverTimestamp() });
    transaction.create(membership, { uid, role: "owner", createdAt: FieldValue.serverTimestamp() });
    writeSecurityAuditEvent(transaction, organisation.id, uid, "organisation.created", "organisation", organisation.id, {});
  });
  return { organisationId: organisation.id, name, role: "owner" as const };
});

export const createCampaign = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const name = normaliseRequiredText(data.name, 120);
  const category = normaliseRequiredText(data.category, 100);
  const location = normaliseRequiredText(data.location, 160);
  const brand = normaliseRequiredText(data.brand ?? "My business", 100);
  const goal = normaliseOptionalText(data.goal, 500);
  if (!name || !category || !location || !brand || goal === null) {
    throw new HttpsError("invalid-argument", "Campaign fields are missing or exceed their allowed length.");
  }

  const membership = await requireMembership(organisationId, uid);
  if (!hasCampaignWritePermission(membership.role)) {
    throw new HttpsError("permission-denied", "Only organisation owners and admins can create campaigns.");
  }
  const campaign = db.collection("organisations").doc(organisationId).collection("campaigns").doc();
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "campaign");
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "createCampaign", 150);
    transaction.create(campaign, { name, category, location, brand, goal, status: "active", createdBy: uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    writeSecurityAuditEvent(transaction, organisationId, uid, "campaign.created", "campaign", campaign.id, { campaignStatus: "active" });
  });
  return { campaignId: campaign.id, organisationId, name, category, location, brand, goal, status: "active" as const };
});

export const listCampaigns = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  await requireMembership(organisationId, uid);
  await consumeReadRateLimit(organisationId, uid, "listCampaigns", 120);
  let cursorSnapshot: QueryDocumentSnapshot | undefined;
  if (data.pageToken !== undefined && data.pageToken !== null && data.pageToken !== "") {
    if (!isValidOrganisationCollectionPageToken(data.pageToken, organisationId, "campaigns")) {
      throw new HttpsError("invalid-argument", "Campaign page token is invalid for this organisation.");
    }
    const cursor = await db.doc(data.pageToken).get();
    if (!cursor.exists || !isValidFirestoreTimestamp(cursor.data()?.createdAt)) {
      throw new HttpsError("invalid-argument", "Campaign page token is no longer valid.");
    }
    cursorSnapshot = cursor as QueryDocumentSnapshot;
  }
  let campaignsQuery = db.collection("organisations").doc(organisationId).collection("campaigns").orderBy("createdAt", "desc");
  if (cursorSnapshot) campaignsQuery = campaignsQuery.startAfter(cursorSnapshot);
  const snapshot = await campaignsQuery.limit(101).get();
  const page = snapshot.docs.slice(0, 100);
  return {
    campaigns: page.map((doc: QueryDocumentSnapshot) => {
      const campaign = doc.data();
      return {
        id: doc.id,
        name: safePersistedText(campaign.name, 160),
        category: safePersistedText(campaign.category, 100),
        location: safePersistedText(campaign.location, 160),
        brand: safePersistedText(campaign.brand, 160),
        goal: safePersistedText(campaign.goal, 500),
        status: isValidCampaignStatus(campaign.status) ? campaign.status : "unknown",
        createdAt: safeTimestampToIso(campaign.createdAt),
      };
    }),
    hasMoreCampaigns: snapshot.size > 100,
    nextPageToken: snapshot.size > 100 ? page[page.length - 1]?.ref.path ?? null : null,
  };
});

export const updateCampaignStatus = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const campaignId = requireDocumentId(data.campaignId, "campaignId");
  if (!isValidCampaignStatus(data.status)) throw new HttpsError("invalid-argument", "Campaign status is not valid.");
  const status = data.status as "active" | "paused" | "completed";
  const membership = await requireMembership(organisationId, uid);
  if (!hasCampaignWritePermission(membership.role)) throw new HttpsError("permission-denied", "Only organisation owners and admins can change campaign status.");
  const campaignRef = db.collection("organisations").doc(organisationId).collection("campaigns").doc(campaignId);
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "campaign");
    const campaignSnapshot = await transaction.get(campaignRef);
    if (!campaignSnapshot.exists) throw new HttpsError("not-found", "Campaign was not found in this organisation.");
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "updateCampaignStatus", 30);
    transaction.update(campaignRef, { status, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
    writeSecurityAuditEvent(transaction, organisationId, uid, "campaign.status_changed", "campaign", campaignId, { campaignStatus: status });
  });
  return { campaignId, status };
});

export const listLeads = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  await requireMembership(organisationId, uid);
  await consumeReadRateLimit(organisationId, uid, "listLeads", 120);
  let cursorSnapshot: QueryDocumentSnapshot | undefined;
  if (data.pageToken !== undefined && data.pageToken !== null && data.pageToken !== "") {
    if (!isValidOrganisationCollectionPageToken(data.pageToken, organisationId, "leads")) {
      throw new HttpsError("invalid-argument", "Lead page token is invalid for this organisation.");
    }
    const cursor = await db.doc(data.pageToken).get();
    if (!cursor.exists || !isValidFirestoreTimestamp(cursor.data()?.createdAt)) {
      throw new HttpsError("invalid-argument", "Lead page token is no longer valid.");
    }
    cursorSnapshot = cursor as QueryDocumentSnapshot;
  }
  let leadsQuery = db.collection("organisations").doc(organisationId).collection("leads").orderBy("createdAt", "desc");
  if (cursorSnapshot) leadsQuery = leadsQuery.startAfter(cursorSnapshot);
  const snapshot = await leadsQuery.limit(101).get();
  const page = snapshot.docs.slice(0, 100);
  return {
    leads: page.map((doc: QueryDocumentSnapshot) => {
      const lead = doc.data();
      return {
        id: doc.id,
        campaignId: isValidDocumentId(lead.campaignId) ? lead.campaignId : "",
        businessName: safePersistedText(lead.businessName, 160),
        category: safePersistedText(lead.category, 100),
        location: safePersistedText(lead.location, 160),
        website: safePersistedText(lead.website, 500),
        email: safePersistedText(lead.email, 254),
        phone: safePersistedText(lead.phone, 80),
        source: safePersistedText(lead.source, 80),
        status: isValidLeadStatus(lead.status) ? lead.status : "unknown",
        score: typeof lead.score === "number" && Number.isFinite(lead.score)
          ? Math.min(100, Math.max(0, lead.score))
          : 0,
        scoreReasons: safePersistedStringArray(lead.scoreReasons, 12, 160),
        notes: safePersistedText(lead.notes, 5000),
        doNotContact: lead.doNotContact === true || lead.contactReviewStatus === "blocked",
        contactRestrictionVerified: lead.doNotContact === false && (lead.contactReviewStatus === undefined || lead.contactReviewStatus === "cleared"),
        contactReviewStatus: normaliseContactReviewStatus(lead.doNotContact, lead.contactReviewStatus),
        contactReviewRevision: typeof lead.contactReviewRevision === "number" && Number.isSafeInteger(lead.contactReviewRevision) && lead.contactReviewRevision >= 0 ? lead.contactReviewRevision : 0,
        createdAt: safeTimestampToIso(lead.createdAt),
      };
    }),
    hasMoreLeads: snapshot.size > 100,
    nextPageToken: snapshot.size > 100 ? page[page.length - 1]?.ref.path ?? null : null,
  };
});

/**
 * Import a bounded CSV-mapped batch through the trusted server path.
 * This callable persists only validated rows and leaves every new contact suppressed
 * until an authorised reviewer explicitly clears the contact restriction.
 */
export const importLeads = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const campaignId = requireDocumentId(data.campaignId, "campaignId");
  const idempotencyKey = data.idempotencyKey;
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    throw new HttpsError("invalid-argument", "idempotencyKey must be 16-128 safe characters.");
  }
  if (!Array.isArray(data.leads) || data.leads.length < 1 || data.leads.length > 25) {
    throw new HttpsError("invalid-argument", "leads must contain between 1 and 25 records per import batch.");
  }

  // Validate the complete payload before any writes: malformed batches are all-or-nothing.
  const rows = data.leads.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new HttpsError("invalid-argument", `Lead row ${index + 1} must be an object.`);
    }
    const row = value as Record<string, unknown>;
    return { fields: normaliseLeadFields(row), index };
  });
  await requireLeadEditor(organisationId, uid);

  const requestHash = createHash("sha256")
    .update(JSON.stringify({ organisationId, campaignId, leads: rows.map(({ fields }) => fields) }))
    .digest("hex");
  const idempotencyDocumentId = createHash("sha256")
    .update(JSON.stringify([organisationId, uid, idempotencyKey]))
    .digest("hex");
  const organisationRef = db.collection("organisations").doc(organisationId);
  const campaignRef = organisationRef.collection("campaigns").doc(campaignId);
  const leadsRef = organisationRef.collection("leads");
  const idempotencyRef = organisationRef.collection("importIdempotency").doc(idempotencyDocumentId);
  const seenEmails = new Set<string>();
  const seenWebsites = new Set<string>();
  const seenBusinesses = new Set<string>();
  const prepared = rows.map(({ fields }) => {
    const emailKey = fields.email.toLowerCase();
    const websiteKey = fields.website.toLowerCase().replace(/\/$/, "");
    const businessKey = `${fields.businessName.toLowerCase()}|${fields.location.toLowerCase()}`;
    const duplicateInBatch = Boolean(
      (emailKey && seenEmails.has(emailKey))
      || (websiteKey && seenWebsites.has(websiteKey))
      || seenBusinesses.has(businessKey),
    );
    if (emailKey) seenEmails.add(emailKey);
    if (websiteKey) seenWebsites.add(websiteKey);
    seenBusinesses.add(businessKey);
    return { fields, emailKey, websiteKey, duplicateInBatch };
  });

  return db.runTransaction(async (transaction: Transaction) => {
    // A replay returns the committed result without consuming quota or creating new records.
    // Concurrent requests with the same key serialize on this document; Firestore retries
    // the loser, which then observes and returns the winner's result.
    const idempotencySnapshot = await transaction.get(idempotencyRef);
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    if (idempotencySnapshot.exists) {
      const saved = idempotencySnapshot.data() ?? {};
      if (saved.requestHash !== requestHash || !saved.result || typeof saved.result !== "object") {
        throw new HttpsError("already-exists", "This idempotencyKey was already used with a different import payload.");
      }
      return saved.result as {
        organisationId: string;
        campaignId: string;
        received: number;
        imported: number;
        duplicatesSkipped: number;
        leads: Array<{ leadId: string; businessName: string }>;
        sent: false;
        messageSentByThisAction: false;
      };
    }

    const campaignSnapshot = await transaction.get(campaignRef);
    if (!campaignSnapshot.exists) throw new HttpsError("not-found", "Campaign was not found in this organisation.");

    // Query only by supplied contact identifiers; never scan an unbounded tenant collection.
    const emails = [...new Set(prepared.filter((row) => row.emailKey && !row.duplicateInBatch).map((row) => row.emailKey))];
    const websites = [...new Set(prepared.filter((row) => row.websiteKey && !row.duplicateInBatch).map((row) => row.websiteKey))];
    const existingEmailDocs = await Promise.all(emails.map((email) => transaction.get(leadsRef.where("email", "==", email).limit(1))));
    const existingWebsiteDocs = await Promise.all(websites.map((website) => transaction.get(leadsRef.where("website", "==", website).limit(1))));
    const existingEmails = new Set(emails.filter((_, index) => !existingEmailDocs[index].empty));
    const existingWebsites = new Set(websites.filter((_, index) => !existingWebsiteDocs[index].empty));
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "importLeads", 10);

    const newLeads: Array<{ leadId: string; businessName: string }> = [];
    let duplicateCount = 0;
    for (const row of prepared) {
      if (row.duplicateInBatch || (row.emailKey && existingEmails.has(row.emailKey)) || (row.websiteKey && existingWebsites.has(row.websiteKey))) {
        duplicateCount += 1;
        continue;
      }
      const completeness = calculateLeadCompleteness(row.fields);
      const leadRef = leadsRef.doc();
      const activityRef = organisationRef.collection("leadActivities").doc();
      const now = FieldValue.serverTimestamp();
      transaction.create(leadRef, {
        ...row.fields,
        campaignId,
        status: "new",
        source: "csv_import",
        score: completeness.score,
        scoreReasons: completeness.reasons,
        notes: "",
        doNotContact: true,
        contactReviewStatus: "pending",
        contactReviewRevision: 0,
        createdBy: uid,
        createdAt: now,
        updatedAt: now,
      });
      transaction.create(activityRef, {
        leadId: leadRef.id,
        actorUid: uid,
        message: `Lead imported: ${row.fields.businessName}`,
        createdAt: now,
      });
      newLeads.push({ leadId: leadRef.id, businessName: row.fields.businessName });
      if (row.emailKey) existingEmails.add(row.emailKey);
      if (row.websiteKey) existingWebsites.add(row.websiteKey);
    }

    const result = {
      organisationId,
      campaignId,
      received: prepared.length,
      imported: newLeads.length,
      duplicatesSkipped: duplicateCount,
      leads: newLeads,
      sent: false as const,
      messageSentByThisAction: false as const,
    };
    transaction.create(idempotencyRef, {
      requestHash,
      result,
      actorUid: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    // Record only the successful first execution; idempotent replays return above.
    writeSecurityAuditEvent(transaction, organisationId, uid, "lead.csv_import.completed", "campaign", campaignId, {
      importedCount: newLeads.length,
      duplicatesSkipped: duplicateCount,
    });
    return result;
  });
});

export const createLead = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const campaignId = requireDocumentId(data.campaignId, "campaignId");
  await requireLeadEditor(organisationId, uid);
  const fields = normaliseLeadFields(data);
  const campaignRef = db.collection("organisations").doc(organisationId).collection("campaigns").doc(campaignId);

  const completeness = calculateLeadCompleteness(fields);
  const lead = db.collection("organisations").doc(organisationId).collection("leads").doc();
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    // Check campaign existence in the same transaction as lead creation so a
    // stale/deleted campaign cannot race past the precondition.
    const campaignSnapshot = await transaction.get(campaignRef);
    if (!campaignSnapshot.exists) throw new HttpsError("not-found", "Campaign was not found in this organisation.");
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "createLead", 200);
    transaction.create(lead, { ...fields, campaignId, status: "new", source: "manual", score: completeness.score, scoreReasons: completeness.reasons, notes: "", doNotContact: true, contactReviewStatus: "pending", contactReviewRevision: 0, createdBy: uid, createdAt: now, updatedAt: now });
    transaction.create(activity, { leadId: lead.id, actorUid: uid, message: `Lead created: ${fields.businessName}`, createdAt: now });
    writeSecurityAuditEvent(transaction, organisationId, uid, "lead.created", "lead", lead.id, { leadStatus: "new" });
  });
  return { leadId: lead.id, organisationId, campaignId, ...fields, status: "new" as const, source: "manual" as const, score: completeness.score, scoreReasons: completeness.reasons, doNotContact: true, contactReviewStatus: "pending" as const, contactReviewRevision: 0 };
});

export const updateLeadContact = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const leadId = requireDocumentId(data.leadId, "leadId");
  const fields = normaliseLeadFields(data);
  await requireLeadEditor(organisationId, uid);
  const leadRef = db.collection("organisations").doc(organisationId).collection("leads").doc(leadId);
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  const completeness = calculateLeadCompleteness(fields);
  let contactRestriction: {
    doNotContact: boolean;
    contactReviewStatus: "pending" | "cleared" | "blocked";
    contactRestrictionVerified: boolean;
    contactReviewRevision: number;
  } | undefined;
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const now = FieldValue.serverTimestamp();
    const existingLead = leadSnapshot.data() ?? {};
    const storedContactReviewRevision = existingLead.contactReviewRevision;
    if (storedContactReviewRevision !== undefined
      && (typeof storedContactReviewRevision !== "number" || !Number.isSafeInteger(storedContactReviewRevision) || storedContactReviewRevision < 0)) {
      throw new HttpsError("failed-precondition", "Lead contact-review revision is invalid and requires operator review.");
    }
    const currentContactReviewRevision = storedContactReviewRevision === undefined ? 0 : storedContactReviewRevision as number;
    const contactChannelsChanged = fields.email !== existingLead.email
      || fields.phone !== existingLead.phone
      || fields.website !== existingLead.website;
    if (contactChannelsChanged && currentContactReviewRevision >= Number.MAX_SAFE_INTEGER) {
      throw new HttpsError("failed-precondition", "Lead contact-review revision cannot be incremented safely.");
    }
    const nextContactReviewRevision = currentContactReviewRevision + (contactChannelsChanged ? 1 : 0);
    const existingReviewStatus = normaliseContactReviewStatus(existingLead.doNotContact, existingLead.contactReviewStatus);
    const restrictionUpdate = contactChannelsChanged
      ? (existingReviewStatus === "blocked"
        ? { doNotContact: true, contactReviewStatus: "blocked" as const }
        : { doNotContact: true, contactReviewStatus: "pending" as const })
      : {};
    const nextDoNotContact = contactChannelsChanged
      ? true
      : existingLead.doNotContact === true || existingReviewStatus === "blocked";
    const nextReviewStatus = normaliseContactReviewStatus(
      contactChannelsChanged ? nextDoNotContact : existingLead.doNotContact,
      contactChannelsChanged ? restrictionUpdate.contactReviewStatus : existingLead.contactReviewStatus,
    );
    contactRestriction = {
      doNotContact: nextDoNotContact,
      contactReviewStatus: nextReviewStatus,
      contactRestrictionVerified: !contactChannelsChanged
        && existingLead.doNotContact === false
        && (existingLead.contactReviewStatus === undefined || existingLead.contactReviewStatus === "cleared"),
      contactReviewRevision: nextContactReviewRevision,
    };
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "updateLeadContact", 120);
    transaction.update(leadRef, { ...fields, ...restrictionUpdate, contactReviewRevision: nextContactReviewRevision, score: completeness.score, scoreReasons: completeness.reasons, updatedAt: now, updatedBy: uid });
    transaction.create(activity, { leadId, actorUid: uid, message: "Lead contact details updated", createdAt: now });
    writeSecurityAuditEvent(transaction, organisationId, uid, "lead.contact_updated", "lead", leadId, {
      contactChannelsChanged,
      contactReviewRevision: nextContactReviewRevision,
      contactReviewStatus: nextReviewStatus,
      doNotContact: nextDoNotContact,
    });
  });
  return { leadId, ...fields, score: completeness.score, scoreReasons: completeness.reasons, ...contactRestriction };
});

export const updateLeadStatus = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const leadId = requireDocumentId(data.leadId, "leadId");
  const status = data.status;
  await requireLeadEditor(organisationId, uid);
  const leadRef = db.collection("organisations").doc(organisationId).collection("leads").doc(leadId);
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const lead = leadSnapshot.data() ?? {};
    if (status === "contacted" && !canMarkLeadContacted(lead.doNotContact, lead.contactReviewStatus)) {
      throw new HttpsError("failed-precondition", lead.doNotContact === true
        ? "A suppressed lead cannot be marked as contacted."
        : "The lead contact restriction is unverified; it cannot be marked as contacted.");
    }
    if (status === "contacted") {
      const campaignId = requireDocumentId(lead.campaignId, "lead campaignId");
      const campaignRef = db.collection("organisations").doc(organisationId).collection("campaigns").doc(campaignId);
      const campaignSnapshot = await transaction.get(campaignRef);
      if (!campaignSnapshot.exists) {
        throw new HttpsError("failed-precondition", "The lead's campaign no longer exists in this organisation.");
      }
    }
    if (!canTransitionLeadStatus(status, lead.doNotContact === true)) {
      throw new HttpsError("failed-precondition", "Lead status is not valid.");
    }
    const now = FieldValue.serverTimestamp();
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "updateLeadStatus", 240);
    transaction.update(leadRef, { status, updatedAt: now, updatedBy: uid });
    transaction.create(activity, { leadId, actorUid: uid, message: `Lead status changed to ${status}`, createdAt: now });
    writeSecurityAuditEvent(transaction, organisationId, uid, "lead.status_changed", "lead", leadId, { leadStatus: status });
  });
  return { leadId, status };
});

export const updateLeadNotes = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const leadId = requireDocumentId(data.leadId, "leadId");
  const notes = normaliseOptionalText(data.notes, 4000);
  if (notes === null) throw new HttpsError("invalid-argument", "Lead notes must be text no longer than 4,000 characters.");
  await requireLeadEditor(organisationId, uid);
  const leadRef = db.collection("organisations").doc(organisationId).collection("leads").doc(leadId);
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const now = FieldValue.serverTimestamp();
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "updateLeadNotes", 240);
    transaction.update(leadRef, { notes, updatedAt: now, updatedBy: uid });
    transaction.create(activity, { leadId, actorUid: uid, message: notes ? "Lead notes updated" : "Lead notes cleared", createdAt: now });
    writeSecurityAuditEvent(transaction, organisationId, uid, "lead.notes_changed", "lead", leadId, { notesCleared: notes.length === 0 });
  });
  return { leadId, notes };
});

export const setLeadSuppression = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const leadId = requireDocumentId(data.leadId, "leadId");
  if (typeof data.doNotContact !== "boolean") throw new HttpsError("invalid-argument", "doNotContact must be a boolean.");
  if (!data.doNotContact && (typeof data.contactReviewRevision !== "number" || !Number.isSafeInteger(data.contactReviewRevision) || data.contactReviewRevision < 0)) {
    throw new HttpsError("invalid-argument", "A valid contactReviewRevision is required to clear a contact restriction.");
  }
  const membership = await requireLeadEditor(organisationId, uid);
  if (!canChangeSuppression(membership.role, data.doNotContact)) {
    throw new HttpsError("permission-denied", data.doNotContact ? "Your organisation role cannot change lead suppression." : "Only organisation owners and admins can remove a contact restriction.");
  }
  const leadRef = db.collection("organisations").doc(organisationId).collection("leads").doc(leadId);
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  await db.runTransaction(async (transaction: Transaction) => {
    // Revalidate both the parent organisation and current membership inside
    // the write transaction so orphaned subcollections and stale roles fail closed.
    const currentMembership = await requireTransactionalRole(transaction, organisationId, uid, "lead");
    if (!canChangeSuppression(currentMembership.role, data.doNotContact)) {
      throw new HttpsError("permission-denied", data.doNotContact ? "Your organisation role cannot change lead suppression." : "Only organisation owners and admins can remove a contact restriction.");
    }
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const lead = leadSnapshot.data() ?? {};
    const storedRevision = lead.contactReviewRevision;
    if (!data.doNotContact && storedRevision !== undefined
      && (typeof storedRevision !== "number" || !Number.isSafeInteger(storedRevision) || storedRevision < 0)) {
      throw new HttpsError("failed-precondition", "Lead contact-review revision is invalid and requires operator review.");
    }
    const currentRevision = typeof storedRevision === "number" && Number.isSafeInteger(storedRevision) && storedRevision >= 0
      ? storedRevision
      : 0;
    if (!data.doNotContact && data.contactReviewRevision !== currentRevision) {
      throw new HttpsError("failed-precondition", "Contact details changed after review began. Refresh the lead and review the current contact details before clearing the restriction.");
    }
    const now = FieldValue.serverTimestamp();
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "setLeadSuppression", 120);
    transaction.update(leadRef, {
      doNotContact: data.doNotContact as boolean,
      contactReviewStatus: data.doNotContact ? "blocked" : "cleared",
      ...(!data.doNotContact ? { contactReviewRevision: currentRevision } : {}),
      updatedAt: now,
      updatedBy: uid,
    });
    transaction.create(activity, { leadId, actorUid: uid, message: data.doNotContact ? "Lead marked do not contact" : "Lead contact restriction removed", createdAt: now });
    writeSecurityAuditEvent(transaction, organisationId, uid, "lead.contact_restriction_changed", "lead", leadId, {
      doNotContact: data.doNotContact as boolean,
      contactReviewStatus: data.doNotContact ? "blocked" : "cleared",
      contactReviewRevision: currentRevision,
    });
  });
  return { leadId, doNotContact: data.doNotContact };
});

export const createOutreachDraft = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const leadId = requireDocumentId(data.leadId, "leadId");
  const subject = normaliseRequiredText(data.subject, 200);
  const body = normaliseRequiredText(data.body, 10000);
  if (!subject || !body) throw new HttpsError("invalid-argument", "Draft subject and body are required and must fit the allowed limits.");
  await requireLeadEditor(organisationId, uid);
  const leadRef = db.collection("organisations").doc(organisationId).collection("leads").doc(leadId);
  const draft = db.collection("organisations").doc(organisationId).collection("outreachDrafts").doc();
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  let campaignId = "";
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    // Reading the lead and creating the draft in one transaction prevents a concurrent
    // suppression change from racing past the do-not-contact gate.
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const lead = leadSnapshot.data() ?? {};
    if (!canCreateServerOutreachDraft(lead.doNotContact, lead.contactReviewStatus)) throw new HttpsError("failed-precondition", lead.doNotContact === true || lead.contactReviewStatus === "blocked"
      ? "This lead is suppressed. Remove the restriction before creating an outreach draft."
      : "The lead contact review is pending or unverified; resolve it before creating an outreach draft.");
    campaignId = requireDocumentId(lead.campaignId, "lead campaignId");
    const campaignRef = db.collection("organisations").doc(organisationId).collection("campaigns").doc(campaignId);
    const campaignSnapshot = await transaction.get(campaignRef);
    if (!campaignSnapshot.exists) throw new HttpsError("failed-precondition", "The lead's campaign no longer exists in this organisation.");
    const now = FieldValue.serverTimestamp();
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "createOutreachDraft", 200);
    transaction.create(draft, { leadId, campaignId, subject, body, status: "draft", sent: false, createdBy: uid, createdAt: now, updatedAt: now });
    transaction.create(activity, { leadId, actorUid: uid, message: "Outreach draft created; not sent", createdAt: now });
    writeSecurityAuditEvent(transaction, organisationId, uid, "outreach_draft.created", "outreachDraft", draft.id, { draftAction: "created" });
  });
  return { draftId: draft.id, leadId, campaignId, subject, body, status: "draft" as const, sent: false };
});


export const listOutreachDrafts = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  await requireMembership(organisationId, uid);
  await consumeReadRateLimit(organisationId, uid, "listOutreachDrafts", 60);
  let cursorSnapshot: QueryDocumentSnapshot | undefined;
  if (data.pageToken !== undefined && data.pageToken !== null && data.pageToken !== "") {
    if (!isValidOrganisationCollectionPageToken(data.pageToken, organisationId, "outreachDrafts")) {
      throw new HttpsError("invalid-argument", "Outreach draft page token is invalid for this organisation.");
    }
    const cursor = await db.doc(data.pageToken).get();
    if (!cursor.exists || !isValidFirestoreTimestamp(cursor.data()?.createdAt)) {
      throw new HttpsError("invalid-argument", "Outreach draft page token is no longer valid.");
    }
    cursorSnapshot = cursor as QueryDocumentSnapshot;
  }
  let draftsQuery = db.collection("organisations").doc(organisationId).collection("outreachDrafts").orderBy("createdAt", "desc");
  if (cursorSnapshot) draftsQuery = draftsQuery.startAfter(cursorSnapshot);
  const snapshot = await draftsQuery.limit(101).get();
  const page = snapshot.docs.slice(0, 100);
  // Read current lead records so existing drafts reflect later contact restrictions.
  const leadIds = [...new Set(page
    .map((doc: QueryDocumentSnapshot) => doc.data().leadId)
    .filter((leadId: unknown): leadId is string => isValidDocumentId(leadId)))];
  const leadSnapshots = leadIds.length
    ? await db.getAll(...leadIds.map((leadId) =>
      db.collection("organisations").doc(organisationId).collection("leads").doc(leadId)
    ))
    : [];
  const leadById = new Map(leadIds.map((leadId, index) => [leadId, leadSnapshots[index]]));
  // A matching campaign ID is not enough: legacy drafts must also reference a
  // campaign document that still exists in this organisation.
  const campaignIds = [...new Set(page
    .flatMap((doc: QueryDocumentSnapshot) => {
      const draft = doc.data();
      const leadId = typeof draft.leadId === "string" ? draft.leadId : "";
      const lead = leadById.get(leadId)?.data();
      return [draft.campaignId, lead?.campaignId];
    })
    .filter((campaignId: unknown): campaignId is string => isValidDocumentId(campaignId)))];
  const campaignSnapshots = campaignIds.length
    ? await db.getAll(...campaignIds.map((campaignId) =>
      db.collection("organisations").doc(organisationId).collection("campaigns").doc(campaignId)
    ))
    : [];
  const campaignById = new Map(campaignIds.map((campaignId, index) => [campaignId, campaignSnapshots[index]]));
  return {
    drafts: page.map((doc: QueryDocumentSnapshot) => {
      const draft = doc.data();
      const leadId = typeof draft.leadId === "string" ? draft.leadId : "";
      const leadSnapshot = leadById.get(leadId);
      const leadExists = leadSnapshot?.exists === true;
      const lead = leadSnapshot?.data();
      const campaignId = typeof lead?.campaignId === "string" ? lead.campaignId : "";
      const campaignExists = isValidDocumentId(campaignId) && campaignById.get(campaignId)?.exists === true;
      const draftStatusValid = draft.status === "draft" && draft.sent !== true;
      const draftContentValid = typeof draft.subject === "string"
        && draft.subject.trim().length > 0
        && draft.subject.length <= 200
        && typeof draft.body === "string"
        && draft.body.trim().length > 0
        && draft.body.length <= 10000;
      const relationshipValid = leadExists
        && hasConsistentDraftCampaign(draft.campaignId, lead?.campaignId)
        && campaignExists
        && draftStatusValid
        && draftContentValid;
      const review = relationshipValid
        ? getOutreachDraftReviewState(leadExists, lead?.doNotContact, lead?.contactReviewStatus)
        : {
          // Keep an explicit lead restriction visible even when another integrity
          // problem also requires review. Integrity warnings must never mask suppression.
          leadSuppressed: leadExists && (lead?.doNotContact === true || lead?.contactReviewStatus === "blocked"),
          requiresReview: true,
          reviewReason: !draftStatusValid
            ? "Draft status or sent flag is inconsistent; review the record before use."
            : !leadExists
              ? "Lead record is missing; review before use."
              : (lead?.doNotContact === true || lead?.contactReviewStatus === "blocked")
              ? "Lead is suppressed and the draft integrity check failed; do not contact."
              : !draftContentValid
                ? "Draft subject or body is missing or malformed; review the record before use."
                : !hasConsistentDraftCampaign(draft.campaignId, lead?.campaignId)
                  ? "Draft campaign does not match its lead; review the record before use."
                  : "The lead's campaign record is missing; review before use.",
        };
      return {
        id: doc.id, leadId, campaignId: draft.campaignId,
        // Legacy/corrupt Firestore values must not leak non-string values into UI rendering.
        subject: typeof draft.subject === "string" ? draft.subject.slice(0, 200) : "",
        body: typeof draft.body === "string" ? draft.body.slice(0, 10000) : "",
        // Preserve the stored status for honest display; unknown/missing values are
        // visibly distinct from a real draft while the review gate remains fail-closed.
        status: typeof draft.status === "string" && draft.status.trim() ? draft.status : "unknown", ...review,
        createdAt: safeTimestampToIso(draft.createdAt),
      };
    }),
    hasMoreDrafts: snapshot.size > 100,
    nextPageToken: snapshot.size > 100 ? page[page.length - 1]?.ref.path ?? null : null,
  };
});

export const updateOutreachDraft = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const draftId = requireDocumentId(data.draftId, "draftId");
  const subject = normaliseRequiredText(data.subject, 200);
  const body = normaliseRequiredText(data.body, 10000);
  if (!subject || !body) throw new HttpsError("invalid-argument", "Draft subject and body are required and must fit the allowed limits.");
  await requireLeadEditor(organisationId, uid);
  const draftRef = db.collection("organisations").doc(organisationId).collection("outreachDrafts").doc(draftId);
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  let leadId = "";
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    const draftSnapshot = await transaction.get(draftRef);
    if (!draftSnapshot.exists) throw new HttpsError("not-found", "Outreach draft was not found in this organisation.");
    const draft = draftSnapshot.data() ?? {};
    if (draft.status !== "draft" || draft.sent === true) {
      throw new HttpsError("failed-precondition", "Only unsent drafts can be edited; this record requires review.");
    }
    leadId = requireDocumentId(draft.leadId, "draft leadId");
    const leadRef = db.collection("organisations").doc(organisationId).collection("leads").doc(leadId);
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("failed-precondition", "The lead for this draft no longer exists.");
    const lead = leadSnapshot.data() ?? {};
    if (!hasConsistentDraftCampaign(draft.campaignId, lead.campaignId)) {
      throw new HttpsError("failed-precondition", "The draft campaign does not match its lead; review the record before editing.");
    }
    if (!canCreateServerOutreachDraft(lead.doNotContact, lead.contactReviewStatus)) throw new HttpsError("failed-precondition", lead.doNotContact === true || lead.contactReviewStatus === "blocked"
      ? "This lead is suppressed. Remove the restriction before editing an outreach draft."
      : "The lead contact review is pending or unverified; resolve it before editing an outreach draft.");
    const campaignId = requireDocumentId(lead.campaignId, "lead campaignId");
    const campaignRef = db.collection("organisations").doc(organisationId).collection("campaigns").doc(campaignId);
    const campaignSnapshot = await transaction.get(campaignRef);
    if (!campaignSnapshot.exists) throw new HttpsError("failed-precondition", "The lead's campaign no longer exists in this organisation.");
    const now = FieldValue.serverTimestamp();
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "updateOutreachDraft", 120);
    transaction.update(draftRef, { subject, body, updatedAt: now, updatedBy: uid });
    transaction.create(activity, { leadId, actorUid: uid, message: "Outreach draft updated; not sent", createdAt: now });
    writeSecurityAuditEvent(transaction, organisationId, uid, "outreach_draft.updated", "outreachDraft", draftId, { draftAction: "updated" });
  });
  return { draftId, leadId, subject, body, status: "draft" as const, sent: false };
});

export const deleteOutreachDraft = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const draftId = requireDocumentId(data.draftId, "draftId");
  await requireLeadEditor(organisationId, uid);
  const draftRef = db.collection("organisations").doc(organisationId).collection("outreachDrafts").doc(draftId);
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    const draftSnapshot = await transaction.get(draftRef);
    if (!draftSnapshot.exists) throw new HttpsError("not-found", "Outreach draft was not found in this organisation.");
    // Deletion must remain possible for malformed legacy drafts so an operator
    // can clean up the record instead of being trapped by its invalid lead reference.
    const rawLeadId = draftSnapshot.data()?.leadId;
    const leadId = isValidDocumentId(rawLeadId) ? rawLeadId : null;
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "deleteOutreachDraft", 120);
    transaction.delete(draftRef);
    writeSecurityAuditEvent(transaction, organisationId, uid, "outreach_draft.deleted", "outreachDraft", draftId, { draftAction: "deleted" });
    transaction.create(activity, {
      ...(leadId ? { leadId } : {}),
      actorUid: uid,
      message: leadId
        ? "Outreach record deleted; this action did not send a message"
        : "Malformed outreach record deleted; this action did not send a message (lead reference was invalid)",
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { draftId, deleted: true, sent: false, messageSentByThisAction: false };
});
