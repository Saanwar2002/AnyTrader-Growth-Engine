import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, FieldValue, Timestamp, getFirestore, type DocumentReference, type Query, type QueryDocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { generateAiOutreachDraftSuggestion } from "./ai-outreach-draft";
import { classifyLeadWithAi } from "./ai-lead-classification";
import { getValidOutreachDraftReplayResult, isPersistedOutreachDraftAvailable } from "./outreach-draft-idempotency";
import { getValidBulkLeadStatusReplayResult } from "./bulk-lead-status-idempotency";
import { snapshotExactAuditMetadata } from "./audit-metadata-shape";
import { getValidCampaignCreationReplayResult, isPersistedCampaignCreationReplayAvailable } from "./campaign-creation-idempotency";
import { getValidOrganisationCreationReplayResult } from "./organisation-creation-idempotency";
import { getValidLeadCreationReplayResult, isPersistedLeadCreationReplayAvailable } from "./lead-creation-idempotency";
import { getValidImportReplayResult, isPersistedImportedLeadReplayAvailable } from "./import-idempotency";
import * as logger from "firebase-functions/logger";
import { canonicalLeadBusinessLocationKey, canonicalLeadEmailKey, canonicalLeadWebsiteKey } from "./lead-identifiers";
import { getValidLeadIdentifierReservationState } from "./lead-identifier-reservation-state";
import { snapshotPersistedSecurityAuditEvent } from "./security-audit-event-shape";
import { getValidSecurityAuditCursorId } from "./security-audit-cursor";
import { getValidMemberRosterCursorUid } from "./member-roster-cursor";
import { createOffboardingPreview, OFFBOARDING_PREVIEW_CATEGORIES } from "./offboarding-preview";
import { PILOT_PLAN, resolvePlanPolicy } from "./entitlements";
import { currentAiUsagePeriod, reservePlanUsage, resolvePlanUsageState, type PlanUsageState } from "./usage-accounting";
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
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// The Functions emulator has no production App Check attestation. Every deployed
// callable requires App Check; only the local emulator receives this explicit bypass.
const callableOptions = { enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" };

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
  | "organisation.settings_updated"
  | "organisation.member_added"
  | "organisation.member_removed"
  | "organisation.member_role_updated"
  | "lead.csv_import.completed"
  | "lead.contact_updated"
  | "lead.contact_restriction_changed"
  | "lead.created"
  | "campaign.created"
  | "campaign.status_changed"
  | "campaign.details_updated"
  | "lead.status_changed"
  | "lead.notes_changed"
  | "lead.follow_up_date_changed"
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
  campaignDetailsChanged?: boolean;
  leadStatus?: string;
  notesCleared?: boolean;
  followUpDateSet?: boolean;
  nameChanged?: boolean;
  draftAction?: "created" | "updated" | "deleted";
  memberRole?: "admin" | "member" | "viewer";
};

const AUDIT_EVENT_RESOURCE_TYPES: Record<SecurityAuditEventType, "organisation" | "campaign" | "lead" | "outreachDraft"> = {
  "organisation.created": "organisation",
  "organisation.settings_updated": "organisation",
  "organisation.member_added": "organisation",
  "organisation.member_removed": "organisation",
  "organisation.member_role_updated": "organisation",
  "lead.csv_import.completed": "campaign",
  "lead.contact_updated": "lead",
  "lead.contact_restriction_changed": "lead",
  "lead.created": "lead",
  "campaign.created": "campaign",
  "campaign.status_changed": "campaign",
  "campaign.details_updated": "campaign",
  "lead.status_changed": "lead",
  "lead.notes_changed": "lead",
  "lead.follow_up_date_changed": "lead",
  "outreach_draft.created": "outreachDraft",
  "outreach_draft.updated": "outreachDraft",
  "outreach_draft.deleted": "outreachDraft",
};

const AUDIT_METADATA_KEYS: Record<SecurityAuditEventType, readonly (keyof SecurityAuditEventMetadata)[]> = {
  "organisation.created": [],
  "organisation.settings_updated": ["nameChanged"],
  "organisation.member_added": ["memberRole"],
  "organisation.member_removed": [],
  "organisation.member_role_updated": ["memberRole"],
  "lead.csv_import.completed": ["importedCount", "duplicatesSkipped"],
  "lead.contact_updated": ["contactChannelsChanged", "contactReviewRevision", "contactReviewStatus", "doNotContact"],
  "lead.contact_restriction_changed": ["doNotContact", "contactReviewRevision", "contactReviewStatus"],
  "lead.created": ["leadStatus"],
  "campaign.created": ["campaignStatus"],
  "campaign.status_changed": ["campaignStatus"],
  "campaign.details_updated": ["campaignDetailsChanged"],
  "lead.status_changed": ["leadStatus"],
  "lead.notes_changed": ["notesCleared"],
  "lead.follow_up_date_changed": ["followUpDateSet"],
  "outreach_draft.created": ["draftAction"],
  "outreach_draft.updated": ["draftAction"],
  "outreach_draft.deleted": ["draftAction"],
};

function normalizeBoundedAuditMetadata(
  eventType: SecurityAuditEventType,
  metadata: SecurityAuditEventMetadata,
): SecurityAuditEventMetadata | null {
  const allowedKeys = AUDIT_METADATA_KEYS[eventType];
  const snapshot = snapshotExactAuditMetadata(metadata, allowedKeys);
  if (!snapshot) return null;
  const record = snapshot as SecurityAuditEventMetadata;
  if (("importedCount" in record && (!Number.isSafeInteger(record.importedCount) || record.importedCount! < 0 || record.importedCount! > 5000))
    || ("duplicatesSkipped" in record && (!Number.isSafeInteger(record.duplicatesSkipped) || record.duplicatesSkipped! < 0 || record.duplicatesSkipped! > 5000))
    || ("contactReviewRevision" in record && (!Number.isSafeInteger(record.contactReviewRevision) || record.contactReviewRevision! < 0))
    || ("contactChannelsChanged" in record && typeof record.contactChannelsChanged !== "boolean")
    || ("doNotContact" in record && typeof record.doNotContact !== "boolean")
    || ("notesCleared" in record && typeof record.notesCleared !== "boolean")
    || ("followUpDateSet" in record && typeof record.followUpDateSet !== "boolean")
    || ("nameChanged" in record && typeof record.nameChanged !== "boolean")
    || ("campaignDetailsChanged" in record && typeof record.campaignDetailsChanged !== "boolean")) return null;
  if ("campaignStatus" in record && !["active", "paused", "completed"].includes(record.campaignStatus ?? "")) return null;
  if ("leadStatus" in record && !["new", "reviewing", "qualified", "contacted", "onboarded", "rejected"].includes(record.leadStatus ?? "")) return null;
  if ("contactReviewStatus" in record && !["pending", "cleared", "blocked"].includes(record.contactReviewStatus ?? "")) return null;
  if ("draftAction" in record && !["created", "updated", "deleted"].includes(record.draftAction ?? "")) return null;
  if ("memberRole" in record && !["admin", "member", "viewer"].includes(record.memberRole ?? "")) return null;
  return record;
}

function isBoundedAuditMetadata(eventType: SecurityAuditEventType, metadata: SecurityAuditEventMetadata): boolean {
  return normalizeBoundedAuditMetadata(eventType, metadata) !== null;
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
  const normalizedMetadata = normalizeBoundedAuditMetadata(eventType, metadata);
  if (AUDIT_EVENT_RESOURCE_TYPES[eventType] !== resourceType || !normalizedMetadata) {
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
    metadata: normalizedMetadata,
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

/**
 * Reserve plan usage for a lead mutation. Legacy organisations without the
 * field remain compatible until reconciliation; present-but-invalid state is
 * rejected rather than treated as zero. The caller persists the returned
 * snapshot in the same transaction as the resource writes.
 */
async function reserveOrganisationPlanUsage(
  transaction: Transaction,
  organisationId: string,
  metric: "leads" | "members" | "monthlyAiSuggestions",
  requested: number,
): Promise<PlanUsageState | null> {
  const organisationRef = db.collection("organisations").doc(organisationId);
  const snapshot = await transaction.get(organisationRef);
  if (!snapshot.exists) throw new HttpsError("not-found", "Organisation was not found.");
  const organisationData = snapshot.data() ?? {};
  if (!Object.prototype.hasOwnProperty.call(organisationData, "planUsage")) return null;

  const planResolution = resolvePlanPolicy(organisationData.planId);
  const usageResolution = resolvePlanUsageState(organisationData.planUsage, new Date());
  if (!planResolution.ok || !usageResolution.ok || usageResolution.source === "initial") {
    throw new HttpsError("failed-precondition", "Organisation usage state is invalid and requires reconciliation.");
  }
  const reservation = reservePlanUsage(planResolution.plan, usageResolution.state, metric, requested);
  if (!reservation.allowed) {
    if (reservation.reason === "limit_exceeded") {
      const label = metric === "leads" ? "Lead" : metric === "members" ? "Organisation member" : "Monthly AI suggestion";
      throw new HttpsError("resource-exhausted", `${label} limit reached for the ${planResolution.plan.displayName} plan (${reservation.limit}).`);
    }
    throw new HttpsError("failed-precondition", "Organisation usage state cannot be safely updated.");
  }
  return reservation.state;
}

function normaliseOptionalSourceRecordId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new HttpsError("invalid-argument", "sourceRecordId must contain 1 to 200 non-whitespace characters.");
  }
  return value.trim();
}

function normaliseLeadFields(data: Record<string, unknown>) {
  const businessName = normaliseRequiredText(data.businessName, 160);
  const category = normaliseOptionalText(data.category, 100);
  const location = normaliseOptionalText(data.location, 160);
  const rawWebsite = normaliseOptionalText(data.website, 500);
  const rawEmail = normaliseOptionalText(data.email, 254);
  const phone = normaliseOptionalText(data.phone, 80);
  if (!businessName || category === null || location === null || rawWebsite === null || rawEmail === null || phone === null) {
    throw new HttpsError("invalid-argument", "Lead fields are missing or exceed their allowed length.");
  }
  if (rawWebsite && !isSafeWebsiteAddress(rawWebsite)) {
    throw new HttpsError("invalid-argument", "Lead website must be a safe HTTP(S) URL or a plain domain.");
  }
  if (rawEmail && !isValidEmailAddress(rawEmail)) {
    throw new HttpsError("invalid-argument", "Lead email address is not valid.");
  }

  // Canonicalise identifiers for new writes. URL host/scheme are case-insensitive,
  // but paths may be case-sensitive and must retain their original casing.
  let website = rawWebsite;
  if (rawWebsite) {
    const hasScheme = rawWebsite.includes("://");
    const parsed = new URL(hasScheme ? rawWebsite : `https://${rawWebsite}`);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    website = `${parsed.protocol}//${parsed.host}${path}${parsed.search}${parsed.hash}`;
    if (!hasScheme && path === "" && !parsed.search && !parsed.hash) website = parsed.hostname;
  }
  const email = rawEmail.toLowerCase();
  // Persist indexed canonical identifiers on every lead write path. Email matching
  // follows this product's case-insensitive policy. Website matching lowercases
  // only scheme/host (above); URL path casing remains significant.
  const dedupeEmailKey = canonicalLeadEmailKey(email);
  const dedupeWebsiteKey = canonicalLeadWebsiteKey(website);
  const dedupeBusinessLocationKey = canonicalLeadBusinessLocationKey(businessName, location);
  return { businessName, category, location, website, email, phone, dedupeEmailKey, dedupeWebsiteKey, dedupeBusinessLocationKey };
}

/**
 * Reject duplicate identifiers for manual creation and contact edits. Every query
 * is tenant-scoped and bounded; exact-value fallbacks cover legacy records only
 * when their stored value exactly matches the normalized incoming value.
 */
async function assertNoDuplicateLeadIdentifiers(
  transaction: Transaction,
  leadsRef: Query,
  fields: ReturnType<typeof normaliseLeadFields>,
  excludedLeadId?: string,
): Promise<void> {
  const queries: Query[] = [];
  if (fields.dedupeEmailKey) {
    queries.push(leadsRef.where("dedupeEmailKey", "==", fields.dedupeEmailKey).limit(2));
    queries.push(leadsRef.where("email", "==", fields.email).limit(2));
  }
  if (fields.dedupeWebsiteKey) {
    queries.push(leadsRef.where("dedupeWebsiteKey", "==", fields.dedupeWebsiteKey).limit(2));
    queries.push(leadsRef.where("website", "==", fields.website).limit(2));
  }
  queries.push(leadsRef.where("dedupeBusinessLocationKey", "==", fields.dedupeBusinessLocationKey).limit(2));
  queries.push(leadsRef.where("businessName", "==", fields.businessName)
    .where("location", "==", fields.location).limit(2));

  const snapshots = await Promise.all(queries.map((query) => transaction.get(query)));
  if (snapshots.some((snapshot) => snapshot.docs.some((document) => document.id !== excludedLeadId))) {
    throw new HttpsError(
      "already-exists",
      "A lead with matching email, website, or business/location already exists in this organisation.",
    );
  }
}

type LeadIdentifierType = "email" | "website" | "businessLocation";
type LeadIdentifierKeys = Pick<ReturnType<typeof normaliseLeadFields>,
  "dedupeEmailKey" | "dedupeWebsiteKey" | "dedupeBusinessLocationKey">;
type LeadIdentifierReservationEntry = {
  type: LeadIdentifierType;
  key: string;
  ref: DocumentReference;
};

/**
 * Reservation documents serialize concurrent writes that use different
 * idempotency keys. Firestore equality queries alone cannot reserve an absent
 * value, so every lead mutation claims each canonical key in its tenant.
 */
function leadIdentifierReservationEntries(
  organisationRef: DocumentReference,
  keys: LeadIdentifierKeys,
): LeadIdentifierReservationEntry[] {
  const collection = organisationRef.collection("leadIdentifierReservations");
  const entries: LeadIdentifierReservationEntry[] = [];
  const add = (type: LeadIdentifierType, key: string) => {
    if (!key) return;
    const reservationId = createHash("sha256").update(JSON.stringify([type, key])).digest("hex");
    entries.push({ type, key, ref: collection.doc(reservationId) });
  };
  add("email", keys.dedupeEmailKey);
  add("website", keys.dedupeWebsiteKey);
  add("businessLocation", keys.dedupeBusinessLocationKey);
  return entries;
}

function persistedLeadIdentifierKeys(existingLead: Record<string, unknown>): LeadIdentifierKeys {
  const email = typeof existingLead.email === "string" ? canonicalLeadEmailKey(existingLead.email) : "";
  let website = "";
  if (typeof existingLead.website === "string" && existingLead.website.trim()) {
    try {
      website = canonicalLeadWebsiteKey(existingLead.website);
    } catch {
      // Malformed legacy URLs do not create a new reservation key.
    }
  }
  const businessName = typeof existingLead.businessName === "string" ? existingLead.businessName : "";
  const location = typeof existingLead.location === "string" ? existingLead.location : "";
  return {
    dedupeEmailKey: typeof existingLead.dedupeEmailKey === "string" && existingLead.dedupeEmailKey
      ? existingLead.dedupeEmailKey : email,
    dedupeWebsiteKey: typeof existingLead.dedupeWebsiteKey === "string" && existingLead.dedupeWebsiteKey
      ? existingLead.dedupeWebsiteKey : website,
    dedupeBusinessLocationKey: typeof existingLead.dedupeBusinessLocationKey === "string" && existingLead.dedupeBusinessLocationKey
      ? existingLead.dedupeBusinessLocationKey
      : (businessName.trim() || location.trim() ? canonicalLeadBusinessLocationKey(businessName, location) : ""),
  };
}

async function readLeadIdentifierReservations(
  transaction: Transaction,
  entries: readonly LeadIdentifierReservationEntry[],
) {
  const snapshots = await Promise.all(entries.map((entry) => transaction.get(entry.ref)));
  return entries.map((entry, index) => ({ ...entry, snapshot: snapshots[index] }));
}

function assertLeadIdentifierReservationsAvailable(
  reservations: ReturnType<typeof readLeadIdentifierReservations> extends Promise<infer T> ? T : never,
  allowedLeadId?: string,
): void {
  for (const reservation of reservations) {
    if (!reservation.snapshot.exists) continue;
    const state = getValidLeadIdentifierReservationState(reservation.snapshot.data(), reservation.type);
    if (!state) {
      throw new HttpsError("failed-precondition", "Lead identifier reservation state is invalid and requires operator review.");
    }
    if (state.leadId !== allowedLeadId) {
      throw new HttpsError("already-exists", "A lead with matching email, website, or business/location already exists in this organisation.");
    }
  }
}

function assertLeadIdentifierReservationsWellFormed(
  reservations: ReturnType<typeof readLeadIdentifierReservations> extends Promise<infer T> ? T : never,
): void {
  for (const reservation of reservations) {
    if (!reservation.snapshot.exists) continue;
    if (!getValidLeadIdentifierReservationState(reservation.snapshot.data(), reservation.type)) {
      throw new HttpsError("failed-precondition", "Lead identifier reservation state is invalid and requires operator review.");
    }
  }
}

function createLeadIdentifierReservations(
  transaction: Transaction,
  reservations: ReturnType<typeof readLeadIdentifierReservations> extends Promise<infer T> ? T : never,
  leadId: string,
  createdAt: unknown,
): void {
  for (const reservation of reservations) {
    if (reservation.snapshot.exists) continue;
    transaction.create(reservation.ref, {
      schemaVersion: 1,
      identifierType: reservation.type,
      leadId,
      createdAt,
    });
  }
}
export const listMyOrganisations = onCall(callableOptions, async (request) => {
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

export const previewOrganisationOffboarding = onCall(
  { enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" },
  async (request) => {
    const uid = requireUid(request.auth?.uid);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const organisationId = requireOrganisationId(data.organisationId);
    const membership = await requireMembership(organisationId, uid);
    if (membership.role !== "owner") {
      throw new HttpsError("permission-denied", "Only the organisation owner can preview offboarding.");
    }
    await consumeReadRateLimit(organisationId, uid, "previewOrganisationOffboarding", 10);

    const preview = await createOffboardingPreview(async (category, afterId, limit) => {
      // category is a compile-time allow-listed literal; never accept collection
      // names from request data.
      if (!(OFFBOARDING_PREVIEW_CATEGORIES as readonly string[]).includes(category)) {
        throw new HttpsError("failed-precondition", "Offboarding preview category is not allow-listed.");
      }
      let query = db.collection("organisations").doc(organisationId)
        .collection(category)
        .orderBy(FieldPath.documentId())
        .limit(limit);
      if (afterId !== null) query = query.startAfter(afterId);
      const page = await query.get();
      return { ids: page.docs.map((document) => document.id) };
    });

    // Recheck access after the inventory read so a mid-preview membership
    // revocation or role change cannot receive the accumulated counts.
    const finalMembership = await requireMembership(organisationId, uid);
    if (finalMembership.role !== "owner") {
      throw new HttpsError("permission-denied", "Only the organisation owner can preview offboarding.");
    }

    return {
      complete: preview.complete,
      destructiveActionPerformed: false,
      maxRecordsPerCategory: preview.maxRecordsPerCategory,
      categories: preview.categories,
    };
  },
);


export const createOrganisation = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const name = normaliseRequiredText(data.name, 100);
  if (!name) throw new HttpsError("invalid-argument", "Organisation name must be 1–100 characters.");
  const idempotencyKey = data.idempotencyKey;
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    throw new HttpsError("invalid-argument", "idempotencyKey must be 16-128 safe characters.");
  }

  const requestHash = createHash("sha256").update(JSON.stringify({ name })).digest("hex");
  const idempotencyDocumentId = createHash("sha256").update(JSON.stringify([uid, idempotencyKey])).digest("hex");
  const idempotencyRef = db.collection("organisationCreationIdempotency").doc(idempotencyDocumentId);
  const organisation = db.collection("organisations").doc();
  const membership = organisation.collection("members").doc(uid);
  const result = { organisationId: organisation.id, name, role: "owner" as const };
  const aiUsagePeriod = currentAiUsagePeriod(new Date());
  if (!aiUsagePeriod) throw new HttpsError("internal", "Could not initialise organisation usage accounting.");

  return db.runTransaction(async (transaction: Transaction) => {
    const idempotencySnapshot = await transaction.get(idempotencyRef);
    if (idempotencySnapshot.exists) {
      const saved = idempotencySnapshot.data() ?? {};
      if (saved.requestHash !== requestHash || saved.actorUid !== uid || !saved.result || typeof saved.result !== "object") {
        throw new HttpsError("already-exists", "This idempotencyKey was already used with a different organisation payload.");
      }
      const savedResult = getValidOrganisationCreationReplayResult(saved, { actorUid: uid, requestHash, name });
      if (!savedResult) {
        throw new HttpsError("failed-precondition", "Saved organisation retry state is invalid and requires operator review.");
      }
      const savedOrganisationRef = db.collection("organisations").doc(savedResult.organisationId);
      const savedMembershipRef = savedOrganisationRef.collection("members").doc(uid);
      const [savedOrganisation, savedMembership] = await Promise.all([
        transaction.get(savedOrganisationRef),
        transaction.get(savedMembershipRef),
      ]);
      if (!savedOrganisation.exists || savedOrganisation.data()?.ownerUid !== uid
        || savedOrganisation.data()?.name !== name
        || !savedMembership.exists
        || !isValidMembershipForOrganisation(savedMembership.data(), uid, savedOrganisation.data()?.ownerUid)
        || savedMembership.data()?.role !== "owner") {
        throw new HttpsError("failed-precondition", "The organisation created by this request is no longer available to its original owner.");
      }
      return savedResult;
    }

    await consumeTransactionalRateLimit(transaction, "global", uid, "createOrganisation", 5, 60 * 60_000);
    transaction.create(organisation, {
      name,
      ownerUid: uid,
      planId: PILOT_PLAN.id,
      planUsage: {
        schemaVersion: 1,
        campaigns: 0,
        leads: 0,
        members: 1,
        monthlyAiSuggestions: 0,
        aiUsagePeriod,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(membership, { uid, role: "owner", createdAt: FieldValue.serverTimestamp() });
    transaction.create(idempotencyRef, {
      requestHash,
      result,
      actorUid: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    writeSecurityAuditEvent(transaction, organisation.id, uid, "organisation.created", "organisation", organisation.id, {});
    return result;
  });
});

export const updateOrganisationSettings = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const name = normaliseRequiredText(data.name, 100);
  if (!name) throw new HttpsError("invalid-argument", "Organisation name must be 1–100 characters.");
  const organisationRef = db.collection("organisations").doc(organisationId);
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "campaign");
    const organisationSnapshot = await transaction.get(organisationRef);
    if (!organisationSnapshot.exists) throw new HttpsError("not-found", "Organisation was not found.");
    const currentName = normaliseRequiredText(organisationSnapshot.data()?.name, 100);
    if (currentName === name) return;
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "updateOrganisationSettings", 10);
    transaction.update(organisationRef, { name, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
    writeSecurityAuditEvent(transaction, organisationId, uid, "organisation.settings_updated", "organisation", organisationId, { nameChanged: true });
  });
  return { organisationId, name };
});

export const addOrganisationMember = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const targetEmail = typeof data.targetEmail === "string" ? data.targetEmail.trim().toLowerCase() : "";
  const role = data.role ?? "member";
  const idempotencyKey = data.idempotencyKey;
  if (targetEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
    throw new HttpsError("invalid-argument", "A valid targetEmail is required.");
  }
  if (role !== "member" && role !== "viewer") {
    throw new HttpsError("invalid-argument", "New members may only be assigned the member or viewer role.");
  }
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    throw new HttpsError("invalid-argument", "idempotencyKey must be 16-128 safe characters.");
  }
  // Authorise before consulting Firebase Auth so non-admins cannot use this callable to probe account IDs.
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "campaign");
  });
  let targetUid: string;
  try {
    targetUid = (await getAuth().getUserByEmail(targetEmail)).uid;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "auth/user-not-found") {
      throw new HttpsError("not-found", "The target account does not exist.");
    }
    logger.error("Could not verify organisation member target account", { organisationId, reason: "auth_lookup_failed" });
    throw new HttpsError("internal", "Could not verify the target account. Please retry.");
  }

  if (targetUid === uid) {
    throw new HttpsError("invalid-argument", "You are already a member of this organisation.");
  }
  const organisationRef = db.collection("organisations").doc(organisationId);
  const targetMembershipRef = organisationRef.collection("members").doc(targetUid);
  const idempotencyDocumentId = createHash("sha256")
    .update(JSON.stringify([organisationId, uid, idempotencyKey]))
    .digest("hex");
  const idempotencyRef = organisationRef.collection("memberAdditionIdempotency").doc(idempotencyDocumentId);
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ organisationId, targetEmail, targetUid, role }))
    .digest("hex");
  const result = { organisationId, uid: targetUid, role, added: true as const };

  return db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "campaign");
    const idempotencySnapshot = await transaction.get(idempotencyRef);
    if (idempotencySnapshot.exists) {
      const saved = idempotencySnapshot.data() ?? {};
      if (saved.actorUid !== uid || saved.requestHash !== requestHash || !saved.result || typeof saved.result !== "object") {
        throw new HttpsError("already-exists", "This idempotencyKey was already used with a different member request.");
      }
      const savedResult = saved.result as Record<string, unknown>;
      if (savedResult.organisationId !== organisationId || savedResult.uid !== targetUid
        || savedResult.role !== role || savedResult.added !== true) {
        throw new HttpsError("failed-precondition", "Saved member request state is invalid and requires operator review.");
      }
      const savedMembership = await transaction.get(targetMembershipRef);
      if (!savedMembership.exists || savedMembership.data()?.uid !== targetUid || savedMembership.data()?.role !== role) {
        throw new HttpsError("failed-precondition", "The member added by this request is no longer available in the organisation.");
      }
      return savedResult as typeof result;
    }

    const [organisationSnapshot, targetMembershipSnapshot] = await Promise.all([
      transaction.get(organisationRef),
      transaction.get(targetMembershipRef),
    ]);
    if (!organisationSnapshot.exists) throw new HttpsError("not-found", "Organisation was not found.");
    if (targetMembershipSnapshot.exists) {
      const existing = targetMembershipSnapshot.data() ?? {};
      if (!isValidMembershipForOrganisation(existing, targetUid, organisationSnapshot.data()?.ownerUid)) {
        throw new HttpsError("failed-precondition", "The existing member record is invalid and requires operator review.");
      }
      return { organisationId, uid: targetUid, role: existing.role, added: false as const };
    }

    // Legacy organisations without planUsage remain compatible until reconciled.
    // Never initialise their usage to zero because doing so could bypass existing usage.
    const reservedPlanUsageState = await reserveOrganisationPlanUsage(transaction, organisationId, "members", 1);
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "addOrganisationMember", 30);
    if (reservedPlanUsageState) transaction.update(organisationRef, { planUsage: reservedPlanUsageState });
    transaction.create(targetMembershipRef, {
      uid: targetUid,
      role,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: uid,
    });
    transaction.create(idempotencyRef, {
      requestHash,
      result,
      actorUid: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    writeSecurityAuditEvent(transaction, organisationId, uid, "organisation.member_added", "organisation", targetUid, { memberRole: role });
    return result;
  });
});

export const listOrganisationSecurityAuditEvents = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const rawPageToken = data.pageToken;
  if (rawPageToken !== undefined && rawPageToken !== null && rawPageToken !== ""
    && (typeof rawPageToken !== "string" || rawPageToken.length > 4096)) {
    throw new HttpsError("invalid-argument", "Security audit page token is invalid.");
  }

  let cursorId: string | undefined;
  if (typeof rawPageToken === "string" && rawPageToken.length > 0) {
    try {
      const decoded: unknown = JSON.parse(Buffer.from(rawPageToken, "base64url").toString("utf8"));
      const validatedCursorId = getValidSecurityAuditCursorId(decoded, organisationId);
      if (!validatedCursorId) throw new Error("Invalid security audit cursor");
      cursorId = validatedCursorId;
    } catch {
      throw new HttpsError("invalid-argument", "Security audit page token is invalid for this organisation.");
    }
  }

  const requireAuditViewer = async () => {
    const membership = await requireMembership(organisationId, uid);
    if (membership.role !== "owner" && membership.role !== "admin") {
      throw new HttpsError("permission-denied", "Only organisation owners and admins can view security audit events.");
    }
  };
  await requireAuditViewer();
  await consumeReadRateLimit(organisationId, uid, "listOrganisationSecurityAuditEvents", 10);

  const auditCollection = db.collection("organisations").doc(organisationId).collection("securityAuditEvents");
  let query = auditCollection.orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");
  if (cursorId) {
    const cursor = await auditCollection.doc(cursorId).get();
    if (!cursor.exists || !isValidFirestoreTimestamp(cursor.get("createdAt"))) {
      throw new HttpsError("invalid-argument", "Security audit page token no longer identifies a valid event.");
    }
    query = query.startAfter(cursor);
  }
  const page = await query.limit(51).get();
  const eventDocuments = page.docs.slice(0, 50);
  const events = eventDocuments.map((document) => {
    const event = snapshotPersistedSecurityAuditEvent(document.data());
    if (!event) {
      throw new HttpsError("failed-precondition", "A security audit event is invalid and requires operator review.");
    }
    const eventType = event.eventType;
    const resourceType = event.resourceType;
    const normalizedMetadata = typeof eventType === "string"
      && Object.prototype.hasOwnProperty.call(AUDIT_EVENT_RESOURCE_TYPES, eventType)
      ? normalizeBoundedAuditMetadata(eventType as SecurityAuditEventType, event.metadata as SecurityAuditEventMetadata)
      : null;
    const createdAt = safeTimestampToIso(event.createdAt);
    if (event.schemaVersion !== 1
      || event.organisationId !== organisationId
      || typeof event.actorUid !== "string" || !isValidDocumentId(event.actorUid)
      || typeof event.resourceId !== "string" || !isValidDocumentId(event.resourceId)
      || typeof eventType !== "string" || !Object.prototype.hasOwnProperty.call(AUDIT_EVENT_RESOURCE_TYPES, eventType)
      || typeof resourceType !== "string"
      || AUDIT_EVENT_RESOURCE_TYPES[eventType as SecurityAuditEventType] !== resourceType
      || event.outcome !== "success"
      || !normalizedMetadata
      || createdAt === null) {
      throw new HttpsError("failed-precondition", "A security audit event is invalid and requires operator review.");
    }
    return {
      id: document.id,
      eventType,
      actorUid: event.actorUid,
      resourceType,
      resourceId: event.resourceId,
      outcome: "success" as const,
      metadata: normalizedMetadata,
      createdAt,
    };
  });

  await requireAuditViewer();
  return {
    organisationId,
    events,
    hasMoreEvents: page.docs.length > 50,
    nextPageToken: page.docs.length > 50 && eventDocuments.length
      ? Buffer.from(JSON.stringify({ scope: "organisation_security_audit", organisationId, lastEventId: eventDocuments[eventDocuments.length - 1].id }), "utf8").toString("base64url")
      : null,
    scope: "organisation_security_audit" as const,
  };
});

export const listOrganisationMembers = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const rawPageToken = data.pageToken;
  if (rawPageToken !== undefined && rawPageToken !== null && rawPageToken !== ""
    && (typeof rawPageToken !== "string" || rawPageToken.length > 4096)) {
    throw new HttpsError("invalid-argument", "Member roster page token is invalid.");
  }
  let cursorUid: string | undefined;
  if (typeof rawPageToken === "string" && rawPageToken.length > 0) {
    try {
      const decoded: unknown = JSON.parse(Buffer.from(rawPageToken, "base64url").toString("utf8"));
      const validatedCursorUid = getValidMemberRosterCursorUid(decoded, organisationId);
      if (!validatedCursorUid) throw new Error("Invalid roster cursor");
      cursorUid = validatedCursorUid;
    } catch {
      throw new HttpsError("invalid-argument", "Member roster page token is invalid for this organisation.");
    }
  }
  const callerMembership = await requireMembership(organisationId, uid);
  if (callerMembership.role !== "owner" && callerMembership.role !== "admin") {
    throw new HttpsError("permission-denied", "Only organisation owners and admins can list members.");
  }
  await consumeReadRateLimit(organisationId, uid, "listOrganisationMembers", 10);

  const organisationRef = db.collection("organisations").doc(organisationId);
  const organisationSnapshot = await organisationRef.get();
  if (!organisationSnapshot.exists) throw new HttpsError("not-found", "Organisation was not found.");
  const ownerUid = organisationSnapshot.data()?.ownerUid;
  if (typeof ownerUid !== "string" || ownerUid.length === 0) {
    throw new HttpsError("failed-precondition", "Organisation owner identity is invalid and requires operator review.");
  }
  let membersQuery = organisationRef.collection("members")
    .orderBy(FieldPath.documentId());
  if (cursorUid) membersQuery = membersQuery.startAfter(cursorUid);
  const page = await membersQuery.limit(21).get();
  const memberDocuments = page.docs.slice(0, 20);
  const members = await Promise.all(memberDocuments.map(async (document) => {
    const member = document.data() ?? {};
    if (!isValidMembershipForOrganisation(member, document.id, ownerUid)) {
      throw new HttpsError("failed-precondition", "A member record is invalid and requires operator review.");
    }
    let email: string | null = null;
    try {
      const userRecord = await getAuth().getUser(document.id);
      email = typeof userRecord.email === "string" && userRecord.email.length <= 254 ? userRecord.email : null;
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "auth/user-not-found")) {
        logger.error("Could not resolve organisation member account", { organisationId, reason: "auth_lookup_failed" });
        throw new HttpsError("internal", "Could not verify all member accounts. Please retry.");
      }
    }
    return {
      uid: document.id,
      email,
      role: member.role as "owner" | "admin" | "member" | "viewer",
      createdAt: safeTimestampToIso(member.createdAt),
    };
  }));
  const finalMembership = await requireMembership(organisationId, uid);
  if (finalMembership.role !== "owner" && finalMembership.role !== "admin") {
    throw new HttpsError("permission-denied", "Only organisation owners and admins can list members.");
  }
  const hasMoreMembers = page.docs.length > 20;
  const lastUid = memberDocuments.at(-1)?.id;
  return {
    organisationId,
    members,
    hasMoreMembers,
    nextPageToken: hasMoreMembers && lastUid
      ? Buffer.from(JSON.stringify({ scope: "organisation_member_roster", organisationId, lastUid }), "utf8").toString("base64url")
      : null,
    scope: "organisation_member_roster" as const,
  };
});

export const removeOrganisationMember = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const targetUid = typeof data.targetUid === "string" ? data.targetUid.trim() : "";
  if (!isValidDocumentId(targetUid)) throw new HttpsError("invalid-argument", "A valid targetUid is required.");
  if (targetUid === uid) throw new HttpsError("failed-precondition", "You cannot remove your own membership.");
  const organisationRef = db.collection("organisations").doc(organisationId);
  const targetMembershipRef = organisationRef.collection("members").doc(targetUid);

  return db.runTransaction(async (transaction: Transaction) => {
    const callerMembership = await requireTransactionalRole(transaction, organisationId, uid, "campaign");
    if (callerMembership.role !== "owner" && callerMembership.role !== "admin") {
      throw new HttpsError("permission-denied", "Only organisation owners and admins can remove members.");
    }
    const [organisationSnapshot, targetSnapshot] = await Promise.all([
      transaction.get(organisationRef),
      transaction.get(targetMembershipRef),
    ]);
    if (!organisationSnapshot.exists) throw new HttpsError("not-found", "Organisation was not found.");
    const organisationData = organisationSnapshot.data() ?? {};
    const ownerUid = organisationData.ownerUid;
    if (typeof ownerUid !== "string" || !ownerUid) {
      throw new HttpsError("failed-precondition", "Organisation owner identity is invalid and requires operator review.");
    }
    if (targetUid === ownerUid) throw new HttpsError("failed-precondition", "The organisation owner cannot be removed.");
    if (!targetSnapshot.exists) return { organisationId, targetUid, removed: false as const };
    const target = targetSnapshot.data() ?? {};
    if (!isValidMembershipForOrganisation(target, targetUid, ownerUid)) {
      throw new HttpsError("failed-precondition", "The target membership is invalid and requires operator review.");
    }
    if (callerMembership.role === "admin" && target.role !== "member" && target.role !== "viewer") {
      throw new HttpsError("permission-denied", "Admins may remove members and viewers, but only the owner may remove admins.");
    }
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "removeOrganisationMember", 30);

    if (Object.prototype.hasOwnProperty.call(organisationData, "planUsage")) {
      const usageResolution = resolvePlanUsageState(organisationData.planUsage, new Date());
      if (!usageResolution.ok || usageResolution.source === "initial" || usageResolution.state.members < 1) {
        throw new HttpsError("failed-precondition", "Organisation member usage cannot be safely decremented; reconciliation is required.");
      }
      transaction.update(organisationRef, {
        planUsage: { ...usageResolution.state, members: usageResolution.state.members - 1 },
      });
    }
    transaction.delete(targetMembershipRef);
    writeSecurityAuditEvent(transaction, organisationId, uid, "organisation.member_removed", "organisation", targetUid, {});
    return { organisationId, targetUid, removed: true as const };
  });
});

export const updateOrganisationMemberRole = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const targetUid = typeof data.targetUid === "string" ? data.targetUid.trim() : "";
  const role = data.role;
  if (!isValidDocumentId(targetUid)) throw new HttpsError("invalid-argument", "A valid targetUid is required.");
  if (role !== "admin" && role !== "member" && role !== "viewer") {
    throw new HttpsError("invalid-argument", "New member role must be admin, member, or viewer; owner role cannot be assigned.");
  }
  const organisationRef = db.collection("organisations").doc(organisationId);
  const targetMembershipRef = organisationRef.collection("members").doc(targetUid);
  return db.runTransaction(async (transaction: Transaction) => {
    const callerMembership = await requireTransactionalRole(transaction, organisationId, uid, "campaign");
    if (callerMembership.role !== "owner") {
      throw new HttpsError("permission-denied", "Only the organisation owner can change member roles.");
    }
    const [organisationSnapshot, targetSnapshot] = await Promise.all([
      transaction.get(organisationRef),
      transaction.get(targetMembershipRef),
    ]);
    if (!organisationSnapshot.exists) throw new HttpsError("not-found", "Organisation was not found.");
    const ownerUid = organisationSnapshot.data()?.ownerUid;
    if (typeof ownerUid !== "string" || !ownerUid) {
      throw new HttpsError("failed-precondition", "Organisation owner identity is invalid and requires operator review.");
    }
    if (targetUid === ownerUid) throw new HttpsError("failed-precondition", "The organisation owner's role cannot be changed.");
    if (!targetSnapshot.exists) throw new HttpsError("not-found", "Organisation member was not found.");
    const target = targetSnapshot.data() ?? {};
    if (!isValidMembershipForOrganisation(target, targetUid, ownerUid)) {
      throw new HttpsError("failed-precondition", "The target membership is invalid and requires operator review.");
    }
    if (target.role === role) return { organisationId, targetUid, role, changed: false as const };
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "updateOrganisationMemberRole", 30);
    transaction.update(targetMembershipRef, { role, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
    writeSecurityAuditEvent(transaction, organisationId, uid, "organisation.member_role_updated", "organisation", targetUid, { memberRole: role });
    return { organisationId, targetUid, role, changed: true as const };
  });
});

export const createCampaign = onCall(callableOptions, async (request) => {
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
  const idempotencyKey = data.idempotencyKey;
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    throw new HttpsError("invalid-argument", "idempotencyKey must be 16-128 safe characters.");
  }
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ organisationId, name, category, location, brand, goal }))
    .digest("hex");
  const organisationRef = db.collection("organisations").doc(organisationId);
  const campaign = organisationRef.collection("campaigns").doc();
  const idempotencyDocumentId = createHash("sha256")
    .update(JSON.stringify([organisationId, uid, idempotencyKey]))
    .digest("hex");
  const idempotencyRef = organisationRef.collection("campaignCreationIdempotency").doc(idempotencyDocumentId);
  const result = {
    campaignId: campaign.id,
    organisationId,
    name,
    category,
    location,
    brand,
    goal,
    status: "active" as const,
  };

  return db.runTransaction(async (transaction: Transaction) => {
    const idempotencySnapshot = await transaction.get(idempotencyRef);
    await requireTransactionalRole(transaction, organisationId, uid, "campaign");
    if (idempotencySnapshot.exists) {
      const saved = idempotencySnapshot.data() ?? {};
      if (saved.requestHash !== requestHash || !saved.result || typeof saved.result !== "object") {
        throw new HttpsError("already-exists", "This idempotencyKey was already used with a different campaign payload.");
      }
      const expectedReplay = { actorUid: uid, requestHash, organisationId, name, category, location, brand, goal };
      const savedResult = getValidCampaignCreationReplayResult(saved, expectedReplay);
      if (!savedResult) {
        throw new HttpsError("failed-precondition", "Saved campaign retry state is invalid and requires operator review.");
      }
      const savedCampaignRef = organisationRef.collection("campaigns").doc(savedResult.campaignId);
      const savedCampaignSnapshot = await transaction.get(savedCampaignRef);
      if (!savedCampaignSnapshot.exists
        || !isPersistedCampaignCreationReplayAvailable(savedCampaignSnapshot.data(), expectedReplay)) {
        throw new HttpsError("failed-precondition", "The campaign created by this request is no longer available to its original creator.");
      }
      return savedResult;
    }

    // New organisations have authoritative planUsage. Enforce and reserve the
    // campaign quota in this transaction so concurrent requests cannot overshoot.
    // Legacy organisations without a usage snapshot remain on the compatibility
    // path until their existing resources have been reconciled; never assume zero.
    const organisationSnapshot = await transaction.get(organisationRef);
    if (!organisationSnapshot.exists) {
      throw new HttpsError("not-found", "Organisation was not found.");
    }
    const organisationData = organisationSnapshot.data() ?? {};
    let planResolutionForQuota: ReturnType<typeof resolvePlanPolicy> | null = null;
    let usageStateForQuota: ReturnType<typeof resolvePlanUsageState> | null = null;
    let reservedPlanUsageState: PlanUsageState | null = null;
    if (Object.prototype.hasOwnProperty.call(organisationData, "planUsage")) {
      planResolutionForQuota = resolvePlanPolicy(organisationData.planId);
      usageStateForQuota = resolvePlanUsageState(organisationData.planUsage, new Date());
      if (!planResolutionForQuota.ok || !usageStateForQuota.ok || usageStateForQuota.source === "initial") {
        throw new HttpsError("failed-precondition", "Organisation usage state is invalid and requires reconciliation.");
      }
      const quotaCheck = reservePlanUsage(planResolutionForQuota.plan, usageStateForQuota.state, "campaigns");
      if (!quotaCheck.allowed) {
        if (quotaCheck.reason === "limit_exceeded") {
          throw new HttpsError("resource-exhausted", `Campaign limit reached for the ${planResolutionForQuota.plan.displayName} plan (${quotaCheck.limit}).`);
        }
        throw new HttpsError("failed-precondition", "Organisation usage state cannot be safely updated.");
      }
      reservedPlanUsageState = quotaCheck.state;
    }

    await consumeTransactionalRateLimit(transaction, organisationId, uid, "createCampaign", 150);
    if (reservedPlanUsageState) {
      // Persist usage atomically with campaign creation after all transaction reads.
      transaction.update(organisationRef, { planUsage: reservedPlanUsageState });
    }
    transaction.create(campaign, {
      name, category, location, brand, goal, status: "active", createdBy: uid,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(idempotencyRef, {
      requestHash,
      result,
      actorUid: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    writeSecurityAuditEvent(transaction, organisationId, uid, "campaign.created", "campaign", campaign.id, { campaignStatus: "active" });
    return result;
  });
});

export const listCampaigns = onCall(callableOptions, async (request) => {
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

export const updateCampaignStatus = onCall(callableOptions, async (request) => {
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

export const updateCampaignDetails = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const campaignId = requireDocumentId(data.campaignId, "campaignId");
  const name = normaliseRequiredText(data.name, 120);
  const brand = normaliseRequiredText(data.brand, 100);
  const category = normaliseRequiredText(data.category, 100);
  const location = normaliseRequiredText(data.location, 160);
  const goal = normaliseOptionalText(data.goal ?? "", 500);
  if (!name || !brand || !category || !location || goal === null) {
    throw new HttpsError("invalid-argument", "Campaign fields are missing or exceed their allowed length.");
  }
  const campaignRef = db.collection("organisations").doc(organisationId).collection("campaigns").doc(campaignId);
  const result = { campaignId, name, brand, category, location, goal };
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "campaign");
    const snapshot = await transaction.get(campaignRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Campaign was not found in this organisation.");
    const current = snapshot.data() ?? {};
    const unchanged = current.name === name && current.brand === brand && current.category === category
      && current.location === location && (current.goal ?? "") === goal;
    if (unchanged) return;
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "updateCampaignDetails", 30);
    transaction.update(campaignRef, { name, brand, category, location, goal, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
    writeSecurityAuditEvent(transaction, organisationId, uid, "campaign.details_updated", "campaign", campaignId, { campaignDetailsChanged: true });
  });
  return result;
});

export const listLeads = onCall(callableOptions, async (request) => {
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
        ...(typeof lead.sourceRecordId === "string" && lead.sourceRecordId.trim().length > 0
          && lead.sourceRecordId.length <= 200
          ? { sourceRecordId: safePersistedText(lead.sourceRecordId, 200) }
          : {}),
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
        onboardedAt: safeTimestampToIso(lead.onboardedAt),
        followUpDate: typeof lead.followUpDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(lead.followUpDate)
          && !Number.isNaN(Date.parse(`${lead.followUpDate}T00:00:00.000Z`))
          && new Date(`${lead.followUpDate}T00:00:00.000Z`).toISOString().slice(0, 10) === lead.followUpDate
          ? lead.followUpDate : null,
        createdAt: safeTimestampToIso(lead.createdAt),
      };
    }),
    hasMoreLeads: snapshot.size > 100,
    nextPageToken: snapshot.size > 100 ? page[page.length - 1]?.ref.path ?? null : null,
  };
});


/**
 * Return a bounded, privacy-minimised timeline for one tenant-owned lead.
 * Actor identifiers and contact values are intentionally not returned.
 */
export const getLeadActivityTimeline = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const leadId = requireDocumentId(data.leadId, "leadId");
  await requireMembership(organisationId, uid);
  await consumeReadRateLimit(organisationId, uid, "getLeadActivityTimeline", 30);

  const organisationRef = db.collection("organisations").doc(organisationId);
  const leadRef = organisationRef.collection("leads").doc(leadId);
  const leadSnapshot = await leadRef.get();
  if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");

  const snapshot = await organisationRef.collection("leadActivities")
    .where("leadId", "==", leadId)
    .orderBy("createdAt", "desc")
    .limit(21)
    .get();
  const latestActivities = snapshot.docs.slice(0, 20);
  return {
    organisationId,
    leadId,
    activities: latestActivities.map((document) => {
      const activity = document.data() ?? {};
      return {
        id: document.id,
        message: safePersistedText(activity.message, 240),
        createdAt: safeTimestampToIso(activity.createdAt),
      };
    }),
    scope: "latest_20_lead_activity_events" as const,
    hasMoreHistory: snapshot.size > 20,
  };
});

/**
 * Return privacy-minimised campaign funnel counts across all stored lead pages.
 * Firestore aggregation queries avoid loading an unbounded lead collection into
 * memory; every query is scoped to the caller's organisation and campaign.
 */
export const getCampaignFunnelSummary = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const campaignId = requireDocumentId(data.campaignId, "campaignId");
  await requireMembership(organisationId, uid);
  await consumeReadRateLimit(organisationId, uid, "getCampaignFunnelSummary", 30);

  const organisationRef = db.collection("organisations").doc(organisationId);
  const campaignRef = organisationRef.collection("campaigns").doc(campaignId);
  const campaignSnapshot = await campaignRef.get();
  if (!campaignSnapshot.exists) {
    throw new HttpsError("not-found", "Campaign was not found in this organisation.");
  }

  const leadsRef = organisationRef.collection("leads");
  const countForStatus = async (status?: "qualified" | "contacted" | "onboarded"): Promise<number> => {
    let query = leadsRef.where("campaignId", "==", campaignId);
    if (status) query = query.where("status", "==", status);
    const result = await query.count().get();
    const count = result.data().count;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new HttpsError("failed-precondition", "Campaign analytics count is invalid and requires operator review.");
    }
    return count;
  };
  const [totalLeadCount, qualifiedLeadCount, contactedLeadCount, onboardedLeadCount] = await Promise.all([
    countForStatus(),
    countForStatus("qualified"),
    countForStatus("contacted"),
    countForStatus("onboarded"),
  ]);
  const rate = (count: number) => totalLeadCount
    ? Math.round((count / totalLeadCount) * 1000) / 10
    : 0;
  return {
    organisationId,
    campaignId,
    totalLeadCount,
    qualifiedLeadCount,
    contactedLeadCount,
    onboardedLeadCount,
    qualifiedRatePercent: rate(qualifiedLeadCount),
    onboardedRatePercent: rate(onboardedLeadCount),
    scope: "all_stored_campaign_leads" as const,
  };
});

/**
 * Aggregate source attribution across every stored lead without loading lead PII.
 * Unknown and legacy source values are retained in an explicit "unknown" bucket.
 */
export const getLeadSourceFunnelSummary = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  await requireMembership(organisationId, uid);
  await consumeReadRateLimit(organisationId, uid, "getLeadSourceFunnelSummary", 10);

  const leadsRef = db.collection("organisations").doc(organisationId).collection("leads");
  const knownSources = ["manual", "csv_import", "linkedin_csv", "google_places_manual", "other_approved"] as const;
  const countQuery = async (source?: string, status?: "qualified" | "onboarded"): Promise<number> => {
    let query: Query = leadsRef;
    if (source !== undefined) query = query.where("source", "==", source);
    if (status !== undefined) query = query.where("status", "==", status);
    const result = await query.count().get();
    const count = result.data().count;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new HttpsError("failed-precondition", "Source analytics count is invalid and requires operator review.");
    }
    return count;
  };

  const [totalLeadCount, totalQualified, totalOnboarded, ...knownCounts] = await Promise.all([
    countQuery(),
    countQuery(undefined, "qualified"),
    countQuery(undefined, "onboarded"),
    ...knownSources.flatMap((source) => [
      countQuery(source),
      countQuery(source, "qualified"),
      countQuery(source, "onboarded"),
    ]),
  ]);
  const rows: Array<{ source: string; totalLeadCount: number; qualifiedLeadCount: number; onboardedLeadCount: number }> = knownSources.map((source, index) => ({
    source,
    totalLeadCount: knownCounts[index * 3],
    qualifiedLeadCount: knownCounts[index * 3 + 1],
    onboardedLeadCount: knownCounts[index * 3 + 2],
  }));
  const knownTotal = rows.reduce((sum, row) => sum + row.totalLeadCount, 0);
  const knownQualified = rows.reduce((sum, row) => sum + row.qualifiedLeadCount, 0);
  const knownOnboarded = rows.reduce((sum, row) => sum + row.onboardedLeadCount, 0);
  if (knownTotal > totalLeadCount || knownQualified > totalQualified || knownOnboarded > totalOnboarded) {
    throw new HttpsError("failed-precondition", "Source attribution aggregates are inconsistent and require operator review.");
  }
  rows.push({
    source: "unknown",
    totalLeadCount: totalLeadCount - knownTotal,
    qualifiedLeadCount: totalQualified - knownQualified,
    onboardedLeadCount: totalOnboarded - knownOnboarded,
  });
  return {
    organisationId,
    sourceSummaries: rows.map((row) => ({
      ...row,
      qualifiedRatePercent: row.totalLeadCount ? Math.round((row.qualifiedLeadCount / row.totalLeadCount) * 1000) / 10 : 0,
      onboardedRatePercent: row.totalLeadCount ? Math.round((row.onboardedLeadCount / row.totalLeadCount) * 1000) / 10 : 0,
    })),
    scope: "all_stored_organisation_leads" as const,
    attributionNote: "Source values are self-declared; unknown includes missing and unrecognised legacy values.",
  };
});

/**
 * Return authoritative plan limits and usage to organisation owners/admins.
 * Legacy organisations without a usage snapshot are reported as needing
 * reconciliation; the endpoint never invents zero usage.
 */
export const getOrganisationPlanUsage = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const membership = await requireMembership(organisationId, uid);
  if (!hasCampaignWritePermission(membership.role)) {
    throw new HttpsError("permission-denied", "Only organisation owners and admins can view plan usage.");
  }
  await consumeReadRateLimit(organisationId, uid, "getOrganisationPlanUsage", 5);

  const organisationSnapshot = await db.doc(`organisations/${organisationId}`).get();
  if (!organisationSnapshot.exists) throw new HttpsError("not-found", "Organisation was not found.");
  const organisationData = organisationSnapshot.data() ?? {};
  const planResolution = resolvePlanPolicy(organisationData.planId);
  if (!planResolution.ok) {
    throw new HttpsError("failed-precondition", "Organisation plan is unknown and requires operator review.");
  }
  const plan = planResolution.plan;
  if (!Object.prototype.hasOwnProperty.call(organisationData, "planUsage")) {
    return {
      organisationId,
      status: "reconciliation_required" as const,
      plan: { id: plan.id, displayName: plan.displayName, limits: plan.limits },
      usage: null,
      remaining: null,
      aiUsagePeriod: null,
      message: "Usage counters are not authoritative for this legacy organisation. Reconcile existing resources before enforcing or displaying numeric usage.",
    };
  }

  const usageResolution = resolvePlanUsageState(organisationData.planUsage, new Date());
  if (!usageResolution.ok || usageResolution.source === "initial") {
    throw new HttpsError("failed-precondition", "Organisation usage state is invalid and requires reconciliation.");
  }
  const usage = usageResolution.state;
  return {
    organisationId,
    status: "authoritative" as const,
    plan: { id: plan.id, displayName: plan.displayName, limits: plan.limits },
    usage: {
      campaigns: usage.campaigns,
      leads: usage.leads,
      members: usage.members,
      monthlyAiSuggestions: usage.monthlyAiSuggestions,
    },
    remaining: {
      campaigns: Math.max(0, plan.limits.campaigns - usage.campaigns),
      leads: Math.max(0, plan.limits.leads - usage.leads),
      members: Math.max(0, plan.limits.members - usage.members),
      monthlyAiSuggestions: Math.max(0, plan.limits.monthlyAiSuggestions - usage.monthlyAiSuggestions),
    },
    aiUsagePeriod: usage.aiUsagePeriod,
    message: "Usage is server-maintained. Monthly AI suggestions reset by UTC calendar month; other counters are lifetime totals.",
  };
});

/**
 * Compare authoritative plan resource counters with live resource document counts.
 * This is a read-only diagnostic; it never repairs counters or infers AI usage.
 */
export const getOrganisationPlanUsageReconciliation = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const membership = await requireMembership(organisationId, uid);
  if (!hasCampaignWritePermission(membership.role)) {
    throw new HttpsError("permission-denied", "Only organisation owners and admins can inspect plan usage reconciliation.");
  }
  await consumeReadRateLimit(organisationId, uid, "getOrganisationPlanUsageReconciliation", 3);

  const organisationSnapshot = await db.doc(`organisations/${organisationId}`).get();
  if (!organisationSnapshot.exists) throw new HttpsError("not-found", "Organisation was not found.");
  const organisationData = organisationSnapshot.data() ?? {};
  const [campaignResult, leadResult, memberResult] = await Promise.all([
    db.collection(`organisations/${organisationId}/campaigns`).count().get(),
    db.collection(`organisations/${organisationId}/leads`).count().get(),
    db.collection(`organisations/${organisationId}/members`).count().get(),
  ]);
  const actual = {
    campaigns: campaignResult.data().count,
    leads: leadResult.data().count,
    members: memberResult.data().count,
  };
  if (Object.values(actual).some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new HttpsError("failed-precondition", "Resource inventory count is invalid and requires operator review.");
  }

  const hasUsage = Object.prototype.hasOwnProperty.call(organisationData, "planUsage");
  const rawUsage = organisationData.planUsage;
  const resolvedUsage = hasUsage ? resolvePlanUsageState(rawUsage, new Date()) : null;
  const usageStateStatus = !hasUsage ? "missing" as const
    : !resolvedUsage || !resolvedUsage.ok || resolvedUsage.source === "initial" ? "invalid" as const
      : "present" as const;
  const storedRecord = usageStateStatus === "present" && rawUsage && typeof rawUsage === "object"
    ? rawUsage as Record<string, unknown>
    : null;
  const stored = storedRecord ? {
    campaigns: storedRecord.campaigns as number,
    leads: storedRecord.leads as number,
    members: storedRecord.members as number,
    monthlyAiSuggestions: storedRecord.monthlyAiSuggestions as number,
    aiUsagePeriod: storedRecord.aiUsagePeriod as string,
  } : null;
  const mismatchedMetrics = stored
    ? (["campaigns", "leads", "members"] as const).filter((metric) => stored[metric] !== actual[metric])
    : [];
  const notes = usageStateStatus === "missing"
    ? ["Legacy usage snapshot missing; do not initialise counters to zero without reconciliation."]
    : usageStateStatus === "invalid"
      ? ["Stored usage snapshot is malformed; operator review required."]
      : [
          "Historical AI suggestion usage cannot be inferred from resource counts; verify the stored monthly counter and period separately.",
          ...(mismatchedMetrics.length ? ["Stored resource counters differ from current document counts."] : []),
        ];
  return {
    organisationId,
    status: usageStateStatus,
    actual,
    stored,
    mismatchedMetrics,
    aiUsageReviewRequired: true as const,
    currentAiUsagePeriod: currentAiUsagePeriod(new Date()),
    notes,
    destructiveActionPerformed: false as const,
  };
});

/**
 * Return monthly cohorts based on the immutable first-onboarding timestamp.
 * Legacy leads without a trustworthy onboardedAt timestamp are intentionally
 * excluded rather than assigned an invented historical month.
 */
export const getOnboardingCohortSummary = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  await requireMembership(organisationId, uid);
  await consumeReadRateLimit(organisationId, uid, "getOnboardingCohortSummary", 5);

  const now = new Date();
  const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const cohorts: Array<{ month: string; onboardedLeadCount: number }> = [];
  const leadsRef = db.collection("organisations").doc(organisationId).collection("leads");
  const queries = Array.from({ length: 12 }, (_, index) => {
    const start = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - (11 - index), 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return { month: start.toISOString().slice(0, 7), start, end };
  });
  const counts = await Promise.all(queries.map(async ({ start, end }) => {
    const result = await leadsRef
      .where("onboardedAt", ">=", Timestamp.fromDate(start))
      .where("onboardedAt", "<", Timestamp.fromDate(end))
      .count()
      .get();
    const count = result.data().count;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new HttpsError("failed-precondition", "Onboarding cohort count is invalid and requires operator review.");
    }
    return count;
  }));
  queries.forEach(({ month }, index) => cohorts.push({ month, onboardedLeadCount: counts[index] }));
  return {
    organisationId,
    cohorts,
    scope: "first_onboarding_timestamp" as const,
    windowMonths: 12 as const,
    attributionNote: "Counts use the first server-recorded onboarding timestamp. Legacy leads already onboarded before timestamp capture may be excluded; source labels remain self-declared.",
  };
});

/**
 * Import a bounded CSV-mapped batch through the trusted server path.
 * This callable persists only validated rows and leaves every new contact suppressed
 * until an authorised reviewer explicitly clears the contact restriction.
 */
/**
 * Aggregate the age of open leads across the whole organisation without returning
 * lead records. Age is measured from creation, not the last activity/status change.
 */
export const getOpenLeadAgingSummary = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  await requireMembership(organisationId, uid);
  await consumeReadRateLimit(organisationId, uid, "getOpenLeadAgingSummary", 10);

  const leadsRef = db.collection("organisations").doc(organisationId).collection("leads");
  const openStatuses = ["new", "reviewing", "qualified", "contacted"];
  const openLeads = leadsRef.where("status", "in", openStatuses);
  const now = Date.now();
  const sevenDaysAgo = Timestamp.fromMillis(now - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = Timestamp.fromMillis(now - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = Timestamp.fromMillis(now - 90 * 24 * 60 * 60 * 1000);
  const countQuery = async (query: Query): Promise<number> => {
    const snapshot = await query.count().get();
    const count = snapshot.data().count;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new HttpsError("failed-precondition", "Open-lead aging aggregate is invalid and requires operator review.");
    }
    return count;
  };
  const [totalOpenLeadCount, createdWithinSevenDays, createdEightToThirtyDaysAgo, createdThirtyOneToNinetyDaysAgo, createdOverNinetyDaysAgo] = await Promise.all([
    countQuery(openLeads),
    countQuery(openLeads.where("createdAt", ">=", sevenDaysAgo)),
    countQuery(openLeads.where("createdAt", ">=", thirtyDaysAgo).where("createdAt", "<", sevenDaysAgo)),
    countQuery(openLeads.where("createdAt", ">=", ninetyDaysAgo).where("createdAt", "<", thirtyDaysAgo)),
    countQuery(openLeads.where("createdAt", "<", ninetyDaysAgo)),
  ]);
  const classifiedCount = createdWithinSevenDays + createdEightToThirtyDaysAgo
    + createdThirtyOneToNinetyDaysAgo + createdOverNinetyDaysAgo;
  if (classifiedCount > totalOpenLeadCount) {
    throw new HttpsError("failed-precondition", "Open-lead aging totals are inconsistent and require operator review.");
  }
  return {
    organisationId,
    totalOpenLeadCount,
    createdWithinSevenDays,
    createdEightToThirtyDaysAgo,
    createdThirtyOneToNinetyDaysAgo,
    createdOverNinetyDaysAgo,
    missingOrUnclassifiedCreatedAtCount: totalOpenLeadCount - classifiedCount,
    scope: "all_stored_open_leads" as const,
    note: "Includes new, reviewing, qualified, and contacted leads across all stored pages. Age is measured from createdAt, not last activity or last status change. Missing or invalid creation timestamps are unclassified. This report does not authorise contact.",
  };
});

export const getFullCampaignReadinessSummary = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  await requireMembership(organisationId, uid);
  await consumeReadRateLimit(organisationId, uid, "getFullCampaignReadinessSummary", 3);

  const organisationRef = db.collection("organisations").doc(organisationId);
  const campaignSnapshot = await organisationRef.collection("campaigns")
    .orderBy(FieldPath.documentId(), "asc")
    .limit(21)
    .get();
  const hasMoreCampaigns = campaignSnapshot.docs.length > 20;
  const campaignDocs = campaignSnapshot.docs.slice(0, 20);
  const countQuery = async (query: Query): Promise<number> => {
    const snapshot = await query.count().get();
    const count = snapshot.data().count;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new HttpsError("failed-precondition", "Campaign readiness aggregate is invalid and requires operator review.");
    }
    return count;
  };

  const campaigns = await Promise.all(campaignDocs.map(async (doc) => {
    const campaign = doc.data();
    const leadsRef = organisationRef.collection("leads").where("campaignId", "==", doc.id);
    const draftsRef = organisationRef.collection("outreachDrafts").where("campaignId", "==", doc.id);
    const [
      totalLeadCount,
      sourcePresentCount,
      knownContactReviewCount,
      pendingOrBlockedLeadCount,
      suppressedLeadCount,
      draftsAwaitingReview,
    ] = await Promise.all([
      countQuery(leadsRef),
      countQuery(leadsRef.where("source", "!=", "")),
      countQuery(leadsRef.where("contactReviewStatus", "in", ["pending", "cleared", "blocked"])),
      countQuery(leadsRef.where("contactReviewStatus", "in", ["pending", "blocked"])),
      countQuery(leadsRef.where("doNotContact", "==", true)),
      countQuery(draftsRef.where("requiresReview", "==", true)),
    ]);
    if (sourcePresentCount > totalLeadCount || knownContactReviewCount > totalLeadCount
      || pendingOrBlockedLeadCount > knownContactReviewCount) {
      throw new HttpsError("failed-precondition", "Campaign readiness totals are inconsistent and require operator review.");
    }
    const legacyReviewStatusLeadCount = totalLeadCount - knownContactReviewCount;
    const sourceAttributionMissingCount = totalLeadCount - sourcePresentCount;
    const missingConfigurationFields = ([
      ["name", campaign.name],
      ["brand", campaign.brand],
      ["category", campaign.category],
      ["location", campaign.location],
    ] as const).filter(([, value]) => typeof value !== "string" || !value.trim()).map(([field]) => field);
    const hasBlockingIssues = missingConfigurationFields.length > 0 || totalLeadCount === 0
      || pendingOrBlockedLeadCount > 0 || suppressedLeadCount > 0 || legacyReviewStatusLeadCount > 0;
    const hasReviewIssues = draftsAwaitingReview > 0 || sourceAttributionMissingCount > 0;
    const status = hasMoreCampaigns ? "incomplete" as const
      : hasBlockingIssues ? "blocked" as const
        : hasReviewIssues ? "review_required" as const
          : "ready_for_manual_review" as const;
    return {
      campaignId: doc.id,
      campaignName: safePersistedText(campaign.name, 160),
      campaignStatus: safePersistedText(campaign.status, 20),
      status,
      totalLeadCount,
      pendingOrBlockedLeadCount,
      suppressedLeadCount,
      legacyReviewStatusLeadCount,
      draftsAwaitingReview,
      sourceAttributionMissingCount,
      missingConfigurationFields,
    };
  }));

  return {
    organisationId,
    campaigns,
    hasMoreCampaigns,
    campaignLimit: 20 as const,
    scope: "server_counted_campaign_readiness" as const,
    note: "Lead and draft counts are server-side for each returned campaign. At most 20 campaigns are included; if more exist, every row is marked incomplete. Missing or empty source labels are counted, but source labels remain self-declared and unverified. Pending, blocked, suppressed, and legacy/unclassified contact-review records require human review. This report never authorises or sends outreach.",
  };
});

export const getLeadCompletenessSummary = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  await requireMembership(organisationId, uid);
  await consumeReadRateLimit(organisationId, uid, "getLeadCompletenessSummary", 10);

  const leadsRef = db.collection("organisations").doc(organisationId).collection("leads");
  const countQuery = async (query: Query): Promise<number> => {
    const snapshot = await query.count().get();
    const count = snapshot.data().count;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new HttpsError("failed-precondition", "Lead completeness aggregate is invalid and requires operator review.");
    }
    return count;
  };
  const [totalLeadCount, lowCount, mediumCount, highCount] = await Promise.all([
    countQuery(leadsRef),
    countQuery(leadsRef.where("score", ">=", 0).where("score", "<=", 39)),
    countQuery(leadsRef.where("score", ">=", 40).where("score", "<=", 69)),
    countQuery(leadsRef.where("score", ">=", 70).where("score", "<=", 100)),
  ]);
  const classifiedCount = lowCount + mediumCount + highCount;
  if (classifiedCount > totalLeadCount) {
    throw new HttpsError("failed-precondition", "Lead completeness totals are inconsistent and require operator review.");
  }
  return {
    organisationId, totalLeadCount, lowCount, mediumCount, highCount,
    unclassifiedCount: totalLeadCount - classifiedCount,
    scope: "all_stored_leads" as const,
    note: "Bands use stored completeness scores only: low 0–39, medium 40–69, high 70–100. Unclassified includes legacy or invalid scores; completeness is not a quality, consent, or contactability guarantee.",
  };
});

export const getContactReviewQueueSummary = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  await requireMembership(organisationId, uid);
  await consumeReadRateLimit(organisationId, uid, "getContactReviewQueueSummary", 10);

  const leadsRef = db.collection("organisations").doc(organisationId).collection("leads");
  const countForStatus = async (status: "pending" | "cleared" | "blocked"): Promise<number> => {
    const result = await leadsRef.where("contactReviewStatus", "==", status).count().get();
    const count = result.data().count;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new HttpsError("failed-precondition", "Contact-review aggregate is invalid and requires operator review.");
    }
    return count;
  };
  const [totalLeadCount, pendingCount, clearedCount, blockedCount] = await Promise.all([
    leadsRef.count().get().then((result) => result.data().count),
    countForStatus("pending"),
    countForStatus("cleared"),
    countForStatus("blocked"),
  ]);
  const explicitTotal = pendingCount + clearedCount + blockedCount;
  if (![totalLeadCount, pendingCount, clearedCount, blockedCount].every((count) => Number.isSafeInteger(count) && count >= 0)
    || explicitTotal > totalLeadCount) {
    throw new HttpsError("failed-precondition", "Contact-review aggregate is inconsistent and requires operator review.");
  }
  return {
    organisationId,
    totalLeadCount,
    pendingCount,
    clearedCount,
    blockedCount,
    legacyOrUnclassifiedCount: totalLeadCount - explicitTotal,
    scope: "all_stored_organisation_leads" as const,
    attributionNote: "Counts use the stored contactReviewStatus field. Older records without an explicit status are reported as legacy or unclassified rather than guessed from partial fields.",
  };
});

/**
 * Read-only bounded inventory of onboarding timestamp coverage.
 * This lets owners estimate legacy backfill scope without exposing lead records or writing data.
 */
export const getOnboardingCohortCoverage = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const membership = await requireMembership(organisationId, uid);
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new HttpsError("permission-denied", "Only organisation owners and admins can inspect onboarding timestamp coverage.");
  }
  await consumeReadRateLimit(organisationId, uid, "getOnboardingCohortCoverage", 2);

  const result = await db.collection("organisations").doc(organisationId).collection("leads")
    .where("status", "==", "onboarded")
    .orderBy(FieldPath.documentId())
    .select("onboardedAt")
    .limit(1001)
    .get();
  if (result.docs.length > 1000) {
    throw new HttpsError("resource-exhausted", "Onboarding timestamp coverage preview is limited to 1,000 onboarded leads. No partial result was returned.");
  }

  let timestampedOnboardedLeadCount = 0;
  let missingOrInvalidOnboardedTimestampCount = 0;
  for (const document of result.docs) {
    const onboardedAt = document.get("onboardedAt");
    if (onboardedAt instanceof Timestamp && Number.isFinite(onboardedAt.toMillis())) {
      timestampedOnboardedLeadCount += 1;
    } else {
      missingOrInvalidOnboardedTimestampCount += 1;
    }
  }
  return {
    organisationId,
    totalOnboardedLeadCount: result.docs.length,
    timestampedOnboardedLeadCount,
    missingOrInvalidOnboardedTimestampCount,
    scanLimit: 1000 as const,
    scope: "onboarded_leads_only" as const,
    note: "Read-only estimate. Missing or invalid timestamps are counted but never assigned an inferred date; review records and policy before any backfill.",
  };
});

export const importLeads = onCall(callableOptions, async (request) => {
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
    const sourceRecordId = row.sourceRecordId;
    if (sourceRecordId !== undefined
      && (typeof sourceRecordId !== "string" || !sourceRecordId.trim() || sourceRecordId.length > 200)) {
      throw new HttpsError("invalid-argument", `Lead row ${index + 1} has an invalid sourceRecordId.`);
    }
    return {
      fields: normaliseLeadFields(row),
      index,
      ...(typeof sourceRecordId === "string" ? { sourceRecordId: sourceRecordId.trim() } : {}),
    };
  });
  await requireLeadEditor(organisationId, uid);
  const sourceLabel = data.sourceLabel === undefined ? "csv_import" : data.sourceLabel;
  const allowedSourceLabels = new Set(["csv_import", "linkedin_csv", "google_places_manual", "other_approved"]);
  if (typeof sourceLabel !== "string" || !allowedSourceLabels.has(sourceLabel)) {
    throw new HttpsError("invalid-argument", "sourceLabel must be one of csv_import, linkedin_csv, google_places_manual, or other_approved.");
  }
  const requestHashPayload: Record<string, unknown> = {
    organisationId, campaignId,
    leads: rows.map(({ fields, sourceRecordId }) =>
      sourceRecordId === undefined ? fields : { ...fields, sourceRecordId }),
  };
  // Preserve the legacy hash for default CSV imports so uncertain retries from older
  // clients remain idempotent after this optional attribution field is introduced.
  if (sourceLabel !== "csv_import") requestHashPayload.sourceLabel = sourceLabel;
  const requestHash = createHash("sha256").update(JSON.stringify(requestHashPayload)).digest("hex");
  const idempotencyDocumentId = createHash("sha256")
    .update(JSON.stringify([organisationId, uid, idempotencyKey]))
    .digest("hex");
  const organisationRef = db.collection("organisations").doc(organisationId);
  const campaignRef = organisationRef.collection("campaigns").doc(campaignId);
  const leadsRef = organisationRef.collection("leads");
  const idempotencyRef = organisationRef.collection("importIdempotency").doc(idempotencyDocumentId);
  // Duplicate decisions are made in transaction order below, after checking
  // persisted records. Do not pre-mark rows as duplicates here: an earlier row
  // may itself be skipped due to a persisted duplicate and therefore must not
  // reserve its otherwise-new identifiers against later valid rows.
  const prepared = rows.map(({ fields, sourceRecordId }) => ({
    fields,
    ...(sourceRecordId !== undefined ? { sourceRecordId } : {}),
    emailKey: fields.dedupeEmailKey,
    websiteKey: fields.dedupeWebsiteKey,
    businessKey: canonicalLeadBusinessLocationKey(fields.businessName, fields.location),
  }));

  return db.runTransaction(async (transaction: Transaction) => {
    // A replay returns the committed result without consuming quota or creating new records.
    // Concurrent requests with the same key serialize on this document; Firestore retries
    // the loser, which then observes and returns the winner's result.
    const idempotencySnapshot = await transaction.get(idempotencyRef);
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    if (idempotencySnapshot.exists) {
      const saved = idempotencySnapshot.data() ?? {};
      if (saved.requestHash !== requestHash) {
        throw new HttpsError("already-exists", "This idempotencyKey was already used with a different import payload.");
      }
      const expectedReplay = { actorUid: uid, requestHash, organisationId, campaignId, received: prepared.length };
      const savedResult = getValidImportReplayResult(saved, expectedReplay);
      if (!savedResult) {
        throw new HttpsError("failed-precondition", "Saved import retry state is invalid and requires operator review.");
      }
      const replayCampaignSnapshot = await transaction.get(campaignRef);
      if (!replayCampaignSnapshot.exists) {
        throw new HttpsError("failed-precondition", "The campaign for this import retry is no longer available.");
      }
      const replayLeadSnapshots = await Promise.all(savedResult.leads.map((lead) =>
        transaction.get(leadsRef.doc(lead.leadId))));
      const allPersistedLeadsMatch = replayLeadSnapshots.every((snapshot, index) =>
        snapshot.exists && isPersistedImportedLeadReplayAvailable(snapshot.data(), {
          actorUid: uid, campaignId, businessName: savedResult.leads[index].businessName, sourceLabel,
          ...(savedResult.leads[index].sourceRecordId !== undefined
            ? { sourceRecordId: savedResult.leads[index].sourceRecordId }
            : {}),
        }));
      if (!allPersistedLeadsMatch) {
        throw new HttpsError("failed-precondition", "Saved import retry state no longer matches its authoritative lead records.");
      }
      return savedResult;
    }

    const campaignSnapshot = await transaction.get(campaignRef);
    if (!campaignSnapshot.exists) throw new HttpsError("not-found", "Campaign was not found in this organisation.");

    // Query only supplied identifiers; never scan an unbounded tenant collection.
    // Canonical-key queries cover records written by this version. Exact-value
    // fallback preserves compatibility for legacy records until the backfill runs.
    const emails = [...new Set(prepared.filter((row) => row.emailKey).map((row) => row.emailKey))];
    const websites = [...new Set(prepared.filter((row) => row.websiteKey).map((row) => row.websiteKey))];
    const existingEmailDocs = await Promise.all(emails.map((email) => Promise.all([
      transaction.get(leadsRef.where("dedupeEmailKey", "==", email).limit(1)),
      transaction.get(leadsRef.where("email", "==", email).limit(1)),
    ])));
    const existingWebsiteDocs = await Promise.all(websites.map((website) => Promise.all([
      transaction.get(leadsRef.where("dedupeWebsiteKey", "==", website).limit(1)),
      transaction.get(leadsRef.where("website", "==", website).limit(1)),
    ])));
    const businesses = [...new Map(prepared.map((row) => [row.businessKey, row] as const)).values()];
    const existingBusinessDocs = await Promise.all(businesses.map((row) => Promise.all([
      transaction.get(leadsRef.where("dedupeBusinessLocationKey", "==", row.businessKey).limit(1)),
      // Exact-value fallback supports legacy records until the canonical-key backfill is verified.
      transaction.get(leadsRef.where("businessName", "==", row.fields.businessName)
        .where("location", "==", row.fields.location).limit(1)),
    ])));
    const existingEmails = new Set(emails.filter((_, index) => existingEmailDocs[index].some((snapshot) => !snapshot.empty)));
    const existingWebsites = new Set(websites.filter((_, index) => existingWebsiteDocs[index].some((snapshot) => !snapshot.empty)));
    const sourceRecordIds = [...new Set(prepared
      .filter((row) => row.sourceRecordId !== undefined)
      .map((row) => row.sourceRecordId as string))];
    const existingSourceRecordDocs = await Promise.all(sourceRecordIds.map((sourceRecordId) =>
      transaction.get(leadsRef
        .where("sourceRecordId", "==", sourceRecordId)
        .where("source", "==", sourceLabel)
        .where("campaignId", "==", campaignId)
        .limit(1))));
    const sourceRecordKey = (sourceRecordId: string) => JSON.stringify([sourceLabel, sourceRecordId]);
    const existingSourceRecordKeys = new Set(sourceRecordIds
      .filter((_, index) => !existingSourceRecordDocs[index].empty)
      .map(sourceRecordKey));
    const existingBusinesses = new Set(businesses
      .filter((row, index) => existingBusinessDocs[index].some((snapshot) => !snapshot.empty))
      .map((row) => row.businessKey));
    const preparedReservationEntries = prepared.flatMap((row) =>
      leadIdentifierReservationEntries(organisationRef, row.fields));
    const uniquePreparedReservationEntries = [...new Map(
      preparedReservationEntries.map((entry) => [entry.ref.path, entry] as const),
    ).values()];
    const preparedReservations = await readLeadIdentifierReservations(transaction, uniquePreparedReservationEntries);
    assertLeadIdentifierReservationsWellFormed(preparedReservations);
    const reservationByPath = new Map(preparedReservations.map((reservation) => [reservation.ref.path, reservation] as const));
    for (const reservation of preparedReservations) {
      if (!reservation.snapshot.exists) continue;
      if (reservation.type === "email") existingEmails.add(reservation.key);
      else if (reservation.type === "website") existingWebsites.add(reservation.key);
      else existingBusinesses.add(reservation.key);
    }
    const rowsToImport: typeof prepared = [];
    let duplicateCount = 0;
    for (const row of prepared) {
      if ((row.emailKey && existingEmails.has(row.emailKey))
        || (row.websiteKey && existingWebsites.has(row.websiteKey))
        || existingBusinesses.has(row.businessKey)
        || (row.sourceRecordId !== undefined && existingSourceRecordKeys.has(sourceRecordKey(row.sourceRecordId)))) {
        duplicateCount += 1;
        continue;
      }
      rowsToImport.push(row);
      if (row.emailKey) existingEmails.add(row.emailKey);
      if (row.websiteKey) existingWebsites.add(row.websiteKey);
      existingBusinesses.add(row.businessKey);
      if (row.sourceRecordId !== undefined) existingSourceRecordKeys.add(sourceRecordKey(row.sourceRecordId));
    }
    const reservedPlanUsageState = rowsToImport.length > 0
      ? await reserveOrganisationPlanUsage(transaction, organisationId, "leads", rowsToImport.length)
      : null;
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "importLeads", 10);

    if (reservedPlanUsageState) {
      transaction.update(organisationRef, { planUsage: reservedPlanUsageState });
    }
    const newLeads: Array<{ leadId: string; businessName: string; sourceRecordId?: string }> = [];
    for (const row of rowsToImport) {
      const completeness = calculateLeadCompleteness(row.fields);
      const leadRef = leadsRef.doc();
      const activityRef = organisationRef.collection("leadActivities").doc();
      const now = FieldValue.serverTimestamp();
      transaction.create(leadRef, {
        ...row.fields,
        ...(row.sourceRecordId !== undefined ? { sourceRecordId: row.sourceRecordId } : {}),
        campaignId,
        status: "new",
        source: sourceLabel,
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
      const rowReservations = leadIdentifierReservationEntries(organisationRef, row.fields)
        .map((entry) => reservationByPath.get(entry.ref.path))
        .filter((reservation): reservation is NonNullable<typeof reservation> => reservation !== undefined);
      assertLeadIdentifierReservationsAvailable(rowReservations);
      createLeadIdentifierReservations(transaction, rowReservations, leadRef.id, now);
      transaction.create(activityRef, {
        leadId: leadRef.id,
        actorUid: uid,
        message: `Lead imported: ${row.fields.businessName}`,
        createdAt: now,
      });
      newLeads.push({
        leadId: leadRef.id,
        businessName: row.fields.businessName,
        ...(row.sourceRecordId !== undefined ? { sourceRecordId: row.sourceRecordId } : {}),
      });
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

export const createLead = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const campaignId = requireDocumentId(data.campaignId, "campaignId");
  // Preserve authorization-denial semantics for non-editors before validating mutation details.
  await requireLeadEditor(organisationId, uid);
  const idempotencyKey = data.idempotencyKey;
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    throw new HttpsError("invalid-argument", "idempotencyKey must be 16-128 safe characters.");
  }
  const fields = normaliseLeadFields(data);
  const sourceRecordId = normaliseOptionalSourceRecordId(data.sourceRecordId);
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ organisationId, campaignId, fields, ...(sourceRecordId !== undefined ? { sourceRecordId } : {}) }))
    .digest("hex");
  const organisationRef = db.collection("organisations").doc(organisationId);
  const campaignRef = organisationRef.collection("campaigns").doc(campaignId);
  const idempotencyDocumentId = createHash("sha256")
    .update(JSON.stringify([organisationId, uid, idempotencyKey]))
    .digest("hex");
  const idempotencyRef = organisationRef.collection("leadCreationIdempotency").doc(idempotencyDocumentId);
  const completeness = calculateLeadCompleteness(fields);

  return db.runTransaction(async (transaction: Transaction) => {
    // The organisation/user-scoped key serializes concurrent retries. A replay
    // returns the committed response before consuming quota or writing activity.
    const idempotencySnapshot = await transaction.get(idempotencyRef);
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    if (idempotencySnapshot.exists) {
      const saved = idempotencySnapshot.data() ?? {};
      if (saved.requestHash !== requestHash) {
        throw new HttpsError("already-exists", "This idempotencyKey was already used with a different lead payload.");
      }
      const expectedReplay = { actorUid: uid, requestHash, organisationId, campaignId, ...fields, ...(sourceRecordId !== undefined ? { sourceRecordId } : {}) };
      const savedResult = getValidLeadCreationReplayResult(saved, expectedReplay);
      if (!savedResult) {
        throw new HttpsError("failed-precondition", "Saved lead retry state is invalid and requires operator review.");
      }
      const replayLeadRef = organisationRef.collection("leads").doc(savedResult.leadId);
      const [replayLeadSnapshot, replayCampaignSnapshot] = await Promise.all([
        transaction.get(replayLeadRef),
        transaction.get(campaignRef),
      ]);
      if (!replayLeadSnapshot.exists || !replayCampaignSnapshot.exists
        || !isPersistedLeadCreationReplayAvailable(replayLeadSnapshot.data(), expectedReplay, savedResult)) {
        throw new HttpsError("failed-precondition", "Saved lead retry state no longer matches its authoritative records.");
      }
      return savedResult;
    }

    // Check campaign existence in the same transaction as lead creation so a
    // stale/deleted campaign cannot race past the precondition.
    const campaignSnapshot = await transaction.get(campaignRef);
    if (!campaignSnapshot.exists) throw new HttpsError("not-found", "Campaign was not found in this organisation.");
    await assertNoDuplicateLeadIdentifiers(transaction, organisationRef.collection("leads"), fields);
    const createReservations = await readLeadIdentifierReservations(
      transaction, leadIdentifierReservationEntries(organisationRef, fields),
    );
    assertLeadIdentifierReservationsAvailable(createReservations);
    const reservedPlanUsageState = await reserveOrganisationPlanUsage(transaction, organisationId, "leads", 1);
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "createLead", 200);

    const lead = organisationRef.collection("leads").doc();
    const activity = organisationRef.collection("leadActivities").doc();
    const now = FieldValue.serverTimestamp();
    const result = {
      leadId: lead.id,
      organisationId,
      campaignId,
      ...fields,
      ...(sourceRecordId !== undefined ? { sourceRecordId } : {}),
      status: "new" as const,
      source: "manual" as const,
      score: completeness.score,
      scoreReasons: completeness.reasons,
      doNotContact: true as const,
      contactReviewStatus: "pending" as const,
      contactReviewRevision: 0 as const,
    };
    if (reservedPlanUsageState) {
      transaction.update(organisationRef, { planUsage: reservedPlanUsageState });
    }
    transaction.create(lead, {
      ...fields, ...(sourceRecordId !== undefined ? { sourceRecordId } : {}), campaignId, status: "new", source: "manual", score: completeness.score,
      scoreReasons: completeness.reasons, notes: "", doNotContact: true,
      contactReviewStatus: "pending", contactReviewRevision: 0, createdBy: uid,
      createdAt: now, updatedAt: now,
    });
    createLeadIdentifierReservations(transaction, createReservations, lead.id, now);
    transaction.create(activity, { leadId: lead.id, actorUid: uid, message: `Lead created: ${fields.businessName}`, createdAt: now });
    transaction.create(idempotencyRef, {
      requestHash,
      result,
      actorUid: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    writeSecurityAuditEvent(transaction, organisationId, uid, "lead.created", "lead", lead.id, { leadStatus: "new" });
    return result;
  });
});

export const updateLeadContact = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const leadId = requireDocumentId(data.leadId, "leadId");
  const fields = normaliseLeadFields(data);
  await requireLeadEditor(organisationId, uid);
  const organisationRef = db.collection("organisations").doc(organisationId);
  const leadsRef = organisationRef.collection("leads");
  const leadRef = leadsRef.doc(leadId);
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
    await assertNoDuplicateLeadIdentifiers(transaction, leadsRef, fields, leadId);
    const now = FieldValue.serverTimestamp();
    const existingLead = leadSnapshot.data() ?? {};
    const oldReservationEntries = leadIdentifierReservationEntries(organisationRef, persistedLeadIdentifierKeys(existingLead));
    const newReservationEntries = leadIdentifierReservationEntries(organisationRef, fields);
    const combinedReservationEntries = [...new Map(
      [...oldReservationEntries, ...newReservationEntries].map((entry) => [entry.ref.path, entry] as const),
    ).values()];
    const contactReservations = await readLeadIdentifierReservations(transaction, combinedReservationEntries);
    const reservationsByPath = new Map(contactReservations.map((reservation) => [reservation.ref.path, reservation] as const));
    const newReservationPaths = new Set(newReservationEntries.map((entry) => entry.ref.path));
    const newReservations = newReservationEntries.map((entry) => reservationsByPath.get(entry.ref.path))
      .filter((reservation): reservation is NonNullable<typeof reservation> => reservation !== undefined);
    assertLeadIdentifierReservationsAvailable(newReservations, leadId);
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
    for (const oldReservation of oldReservationEntries) {
      if (newReservationPaths.has(oldReservation.ref.path)) continue;
      const reservation = reservationsByPath.get(oldReservation.ref.path);
      if (reservation?.snapshot.exists && reservation.snapshot.data()?.leadId === leadId) {
        transaction.delete(oldReservation.ref);
      }
    }
    createLeadIdentifierReservations(transaction, newReservations, leadId, now);
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

export const bulkUpdateLeadStatus = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const rawLeadIds = data.leadIds;
  const status = data.status;
  const idempotencyKey = data.idempotencyKey;
  if (!Array.isArray(rawLeadIds) || rawLeadIds.length < 1 || rawLeadIds.length > 25) {
    throw new HttpsError("invalid-argument", "leadIds must contain between 1 and 25 leads.");
  }
  const leadIds = rawLeadIds.map((value) => requireDocumentId(value, "leadId"));
  if (new Set(leadIds).size !== leadIds.length) {
    throw new HttpsError("invalid-argument", "leadIds must not contain duplicates.");
  }
  const allowedStatuses = new Set(["new", "reviewing", "qualified", "contacted", "onboarded", "rejected"]);
  if (typeof status !== "string" || !allowedStatuses.has(status)) {
    throw new HttpsError("invalid-argument", "A valid lead status is required.");
  }
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    throw new HttpsError("invalid-argument", "idempotencyKey must be 16-128 safe characters.");
  }
  await requireLeadEditor(organisationId, uid);
  const organisationRef = db.collection("organisations").doc(organisationId);
  const leadsRef = organisationRef.collection("leads");
  const idempotencyId = createHash("sha256").update(JSON.stringify([organisationId, uid, idempotencyKey])).digest("hex");
  const idempotencyRef = organisationRef.collection("leadBulkStatusIdempotency").doc(idempotencyId);
  const requestHash = createHash("sha256").update(JSON.stringify({ organisationId, leadIds: [...leadIds].sort(), status })).digest("hex");

  return db.runTransaction(async (transaction: Transaction) => {
    const idempotencySnapshot = await transaction.get(idempotencyRef);
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    if (idempotencySnapshot.exists) {
      const saved = idempotencySnapshot.data() ?? {};
      if (saved.requestHash !== requestHash || saved.actorUid !== uid) {
        throw new HttpsError("already-exists", "This idempotencyKey was already used with a different bulk status request.");
      }
      const savedResult = getValidBulkLeadStatusReplayResult(saved.result, { organisationId, status, leadIds });
      if (!savedResult) {
        throw new HttpsError("failed-precondition", "Saved bulk status retry state is invalid and requires operator review.");
      }
      return savedResult;
    }

    const leadRefs = leadIds.map((leadId) => leadsRef.doc(leadId));
    const snapshots = await Promise.all(leadRefs.map((ref) => transaction.get(ref)));
    const leads = snapshots.map((snapshot, index) => {
      if (!snapshot.exists) throw new HttpsError("not-found", "A selected lead was not found in this organisation; no statuses were changed.");
      return { leadId: leadIds[index], ref: leadRefs[index], data: snapshot.data() ?? {} };
    });
    const campaignIds = new Set<string>();
    if (status === "contacted") {
      for (const lead of leads) {
        if (!canMarkLeadContacted(lead.data.doNotContact, lead.data.contactReviewStatus)) {
          throw new HttpsError("failed-precondition", "A selected lead has an unresolved contact restriction; no statuses were changed.");
        }
        campaignIds.add(requireDocumentId(lead.data.campaignId, "lead campaignId"));
      }
    }
    const campaignSnapshots = await Promise.all([...campaignIds].map((campaignId) =>
      transaction.get(organisationRef.collection("campaigns").doc(campaignId))));
    if (campaignSnapshots.some((snapshot) => !snapshot.exists)) {
      throw new HttpsError("failed-precondition", "A selected lead's campaign no longer exists; no statuses were changed.");
    }
    for (const lead of leads) {
      if (!canTransitionLeadStatus(status, lead.data.doNotContact === true)) {
        throw new HttpsError("failed-precondition", "The selected status is not valid for one or more leads; no statuses were changed.");
      }
    }

    await consumeTransactionalRateLimit(transaction, organisationId, uid, "bulkUpdateLeadStatus", 30);
    const now = FieldValue.serverTimestamp();
    let updatedCount = 0;
    const changedLeadIds: string[] = [];
    for (const lead of leads) {
      if (lead.data.status === status) continue;
      const leadUpdate: Record<string, unknown> = { status, updatedAt: now, updatedBy: uid };
      if (status === "onboarded" && lead.data.status !== "onboarded" && !isValidFirestoreTimestamp(lead.data.onboardedAt)) {
        leadUpdate.onboardedAt = now;
      }
      transaction.update(lead.ref, leadUpdate);
      const activityRef = organisationRef.collection("leadActivities").doc();
      transaction.create(activityRef, {
        leadId: lead.leadId,
        actorUid: uid,
        message: `Lead status changed to ${status} (bulk update)`,
        createdAt: now,
      });
      writeSecurityAuditEvent(transaction, organisationId, uid, "lead.status_changed", "lead", lead.leadId, { leadStatus: status });
      changedLeadIds.push(lead.leadId);
      updatedCount += 1;
    }
    const result = {
      organisationId,
      status,
      updatedCount,
      unchangedCount: leads.length - updatedCount,
      leadIds: changedLeadIds,
    };
    transaction.create(idempotencyRef, {
      requestHash,
      actorUid: uid,
      result,
      createdAt: now,
    });
    return result;
  });
});

export const updateLeadStatus = onCall(callableOptions, async (request) => {
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
    // A retry of an already-applied status must not duplicate activity/audit events.
    // Contact restrictions and campaign existence are still checked above for "contacted".
    if (status === lead.status) return;
    const now = FieldValue.serverTimestamp();
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "updateLeadStatus", 240);
    const leadUpdate: Record<string, unknown> = { status, updatedAt: now, updatedBy: uid };
    // Capture first onboarding time once; never overwrite it on later status changes.
    // Legacy records already marked onboarded without this field remain null rather
    // than receiving a misleading timestamp for a historical event.
    if (status === "onboarded" && lead.status !== "onboarded" && !isValidFirestoreTimestamp(lead.onboardedAt)) {
      leadUpdate.onboardedAt = now;
    }
    transaction.update(leadRef, leadUpdate);
    transaction.create(activity, { leadId, actorUid: uid, message: `Lead status changed to ${status}`, createdAt: now });
    writeSecurityAuditEvent(transaction, organisationId, uid, "lead.status_changed", "lead", leadId, { leadStatus: status });
  });
  return { leadId, status };
});

export const updateLeadNotes = onCall(callableOptions, async (request) => {
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
    const currentNotes = leadSnapshot.data()?.notes;
    if (currentNotes === notes || (currentNotes === undefined && notes === "")) return;
    const now = FieldValue.serverTimestamp();
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "updateLeadNotes", 240);
    transaction.update(leadRef, { notes, updatedAt: now, updatedBy: uid });
    transaction.create(activity, { leadId, actorUid: uid, message: notes ? "Lead notes updated" : "Lead notes cleared", createdAt: now });
    writeSecurityAuditEvent(transaction, organisationId, uid, "lead.notes_changed", "lead", leadId, { notesCleared: notes.length === 0 });
  });
  return { leadId, notes };
});

export const updateLeadFollowUpDate = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const leadId = requireDocumentId(data.leadId, "leadId");
  const followUpDate = data.followUpDate;
  if (followUpDate !== null && (typeof followUpDate !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(followUpDate)
    || Number.isNaN(Date.parse(`${followUpDate}T00:00:00.000Z`))
    || new Date(`${followUpDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== followUpDate)) {
    throw new HttpsError("invalid-argument", "followUpDate must be a real UTC calendar date in YYYY-MM-DD format or null.");
  }
  await requireLeadEditor(organisationId, uid);
  const leadRef = db.collection("organisations").doc(organisationId).collection("leads").doc(leadId);
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const currentFollowUpDate = leadSnapshot.data()?.followUpDate;
    if (currentFollowUpDate === followUpDate || (currentFollowUpDate === undefined && followUpDate === null)) return;
    const now = FieldValue.serverTimestamp();
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "updateLeadFollowUpDate", 240);
    transaction.update(leadRef, { followUpDate, updatedAt: now, updatedBy: uid });
    transaction.create(activity, {
      leadId,
      actorUid: uid,
      message: followUpDate ? `Follow-up date set to ${followUpDate}` : "Follow-up date cleared",
      createdAt: now,
    });
    writeSecurityAuditEvent(transaction, organisationId, uid, "lead.follow_up_date_changed", "lead", leadId, { followUpDateSet: followUpDate !== null });
  });
  return { leadId, followUpDate };
});

export const setLeadSuppression = onCall(callableOptions, async (request) => {
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

export const createOutreachDraft = onCall(callableOptions, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const leadId = requireDocumentId(data.leadId, "leadId");
  const subject = normaliseRequiredText(data.subject, 200);
  const body = normaliseRequiredText(data.body, 10000);
  const idempotencyKey = data.idempotencyKey;
  if (!subject || !body) throw new HttpsError("invalid-argument", "Draft subject and body are required and must fit the allowed limits.");
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    throw new HttpsError("invalid-argument", "idempotencyKey must be 16-128 safe characters.");
  }
  await requireLeadEditor(organisationId, uid);
  const organisationRef = db.collection("organisations").doc(organisationId);
  const leadRef = organisationRef.collection("leads").doc(leadId);
  const draft = organisationRef.collection("outreachDrafts").doc();
  const activity = organisationRef.collection("leadActivities").doc();
  const requestHash = createHash("sha256").update(JSON.stringify({ organisationId, leadId, subject, body })).digest("hex");
  const idempotencyDocumentId = createHash("sha256").update(JSON.stringify([organisationId, uid, idempotencyKey])).digest("hex");
  const idempotencyRef = organisationRef.collection("outreachDraftCreationIdempotency").doc(idempotencyDocumentId);
  return db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    // Always re-check suppression/review before a replay. A retry must never reopen
    // a draft-creation path while the lead is suppressed or contact review is pending.
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const lead = leadSnapshot.data() ?? {};
    if (!canCreateServerOutreachDraft(lead.doNotContact, lead.contactReviewStatus)) throw new HttpsError("failed-precondition", lead.doNotContact === true || lead.contactReviewStatus === "blocked"
      ? "This lead is suppressed. Remove the restriction before creating an outreach draft."
      : "The lead contact review is pending or unverified; resolve it before creating an outreach draft.");
    const campaignId = requireDocumentId(lead.campaignId, "lead campaignId");
    const campaignRef = organisationRef.collection("campaigns").doc(campaignId);
    const campaignSnapshot = await transaction.get(campaignRef);
    if (!campaignSnapshot.exists) throw new HttpsError("failed-precondition", "The lead's campaign no longer exists in this organisation.");

    const idempotencySnapshot = await transaction.get(idempotencyRef);
    if (idempotencySnapshot.exists) {
      const saved = idempotencySnapshot.data() ?? {};
      if (saved.requestHash !== requestHash) {
        throw new HttpsError("already-exists", "This idempotencyKey was already used with a different draft payload.");
      }
      const expectedReplay = { actorUid: uid, requestHash, leadId, campaignId, subject, body };
      const savedResult = getValidOutreachDraftReplayResult(saved, expectedReplay);
      if (!savedResult) {
        throw new HttpsError("failed-precondition", "Saved draft retry state is invalid and requires operator review.");
      }
      const savedDraftRef = organisationRef.collection("outreachDrafts").doc(savedResult.draftId);
      const savedDraftSnapshot = await transaction.get(savedDraftRef);
      if (!savedDraftSnapshot.exists || !isPersistedOutreachDraftAvailable(savedDraftSnapshot.data(), expectedReplay)) {
        throw new HttpsError("failed-precondition", "The draft created by this request is no longer available to retry.");
      }
      return savedResult;
    }

    const now = FieldValue.serverTimestamp();
    await consumeTransactionalRateLimit(transaction, organisationId, uid, "createOutreachDraft", 200);
    const result = { draftId: draft.id, leadId, campaignId, subject, body, status: "draft" as const, sent: false as const };
    transaction.create(draft, { leadId, campaignId, subject, body, status: "draft", sent: false, createdBy: uid, createdAt: now, updatedAt: now });
    transaction.create(activity, { leadId, actorUid: uid, message: "Outreach draft created; not sent", createdAt: now });
    transaction.create(idempotencyRef, { requestHash, result, actorUid: uid, createdAt: FieldValue.serverTimestamp() });
    writeSecurityAuditEvent(transaction, organisationId, uid, "outreach_draft.created", "outreachDraft", draft.id, { draftAction: "created" });
    return result;
  });
});

export const suggestOutreachDraft = onCall({ enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true", secrets: [geminiApiKey], timeoutSeconds: 30 }, async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const leadId = requireDocumentId(data.leadId, "leadId");
  await requireLeadEditor(organisationId, uid);
  let apiKey = "";
  try { apiKey = geminiApiKey.value(); } catch { /* secret is not configured in this environment */ }
  if (!apiKey.trim()) throw new HttpsError("failed-precondition", "AI draft assistance is not configured. An operator must configure the GEMINI_API_KEY secret.");

  const organisationRef = db.collection("organisations").doc(organisationId);
  const [organisationSnapshot, leadSnapshot] = await Promise.all([
    organisationRef.get(), organisationRef.collection("leads").doc(leadId).get(),
  ]);
  if (!organisationSnapshot.exists || !leadSnapshot.exists) throw new HttpsError("not-found", "Lead or organisation was not found.");
  const lead = leadSnapshot.data() ?? {};
  if (!canCreateServerOutreachDraft(lead.doNotContact, lead.contactReviewStatus)) {
    throw new HttpsError("failed-precondition", lead.doNotContact === true || lead.contactReviewStatus === "blocked"
      ? "This lead is suppressed. Resolve the restriction before requesting an AI draft."
      : "The lead contact review is pending or unverified; resolve it before requesting an AI draft.");
  }
  const campaignId = requireDocumentId(lead.campaignId, "lead campaignId");
  const campaignSnapshot = await organisationRef.collection("campaigns").doc(campaignId).get();
  if (!campaignSnapshot.exists) throw new HttpsError("failed-precondition", "The lead's campaign no longer exists in this organisation.");
  const campaign = campaignSnapshot.data() ?? {};
  const businessName = safePersistedText(lead.businessName, 160).trim();
  if (!businessName) throw new HttpsError("failed-precondition", "The lead has no valid business name for draft generation.");
  await consumeReadRateLimit(organisationId, uid, "suggestOutreachDraft", 10);
  // Reserve the monthly AI allowance atomically before calling the external model.
  // Attempts that fail after reservation still consume quota, preventing retries
  // from bypassing the provider-cost limit under concurrency.
  await db.runTransaction(async (transaction: Transaction) => {
    const reservedPlanUsageState = await reserveOrganisationPlanUsage(
      transaction, organisationId, "monthlyAiSuggestions", 1,
    );
    if (reservedPlanUsageState) {
      transaction.update(organisationRef, { planUsage: reservedPlanUsageState });
    }
  });
  try {
    const suggestion = await generateAiOutreachDraftSuggestion({
      businessName, category: safePersistedText(lead.category, 100), location: safePersistedText(lead.location, 160),
      brand: safePersistedText(campaign.brand, 100), campaignGoal: safePersistedText(campaign.goal, 300),
      organisationName: safePersistedText(organisationSnapshot.data()?.name, 100),
    }, { apiKey, model: process.env.GEMINI_MODEL || "gemini-3.8-flash", timeoutMs: 15000 });
    return { ...suggestion, sent: false as const };
  } catch (error) {
    logger.warn("AI outreach draft suggestion failed", {
      operation: "suggestOutreachDraft", organisationId, actorUid: uid,
      reason: error instanceof Error ? error.name : "unknown",
    });
    throw new HttpsError("unavailable", "AI draft assistance is temporarily unavailable. You can create a manual draft instead.");
  }
});

export const classifyLeadForAcquisition = onCall(
  { enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true", secrets: [geminiApiKey], timeoutSeconds: 30 },
  async (request) => {
    const uid = requireUid(request.auth?.uid);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const organisationId = requireOrganisationId(data.organisationId);
    const leadId = requireDocumentId(data.leadId, "leadId");
    await requireLeadEditor(organisationId, uid);
    let apiKey = "";
    try { apiKey = geminiApiKey.value(); } catch { /* secret is not configured in this environment */ }
    if (!apiKey.trim()) {
      throw new HttpsError("failed-precondition", "AI classification is not configured. An operator must configure the GEMINI_API_KEY secret.");
    }

    const organisationRef = db.collection("organisations").doc(organisationId);
    const [organisationSnapshot, leadSnapshot] = await Promise.all([
      organisationRef.get(),
      organisationRef.collection("leads").doc(leadId).get(),
    ]);
    if (!organisationSnapshot.exists || !leadSnapshot.exists) {
      throw new HttpsError("not-found", "Lead or organisation was not found.");
    }
    const lead = leadSnapshot.data() ?? {};
    const businessName = safePersistedText(lead.businessName, 160).trim();
    const currentCategory = safePersistedText(lead.category, 100).trim();
    const location = safePersistedText(lead.location, 160).trim();
    if (!businessName || !currentCategory || !location) {
      throw new HttpsError("failed-precondition", "The lead needs a business name, category, and location before AI classification.");
    }
    await consumeReadRateLimit(organisationId, uid, "classifyLeadForAcquisition", 10);
    // Reserve the existing monthly AI allowance before any external provider call.
    // Failed provider attempts consume the reservation to prevent retry-based quota bypass.
    await db.runTransaction(async (transaction: Transaction) => {
      const reservedPlanUsageState = await reserveOrganisationPlanUsage(
        transaction, organisationId, "monthlyAiSuggestions", 1,
      );
      if (reservedPlanUsageState) transaction.update(organisationRef, { planUsage: reservedPlanUsageState });
    });
    try {
      return await classifyLeadWithAi(
        { businessName, currentCategory, location },
        { apiKey, model: process.env.GEMINI_MODEL || "gemini-3.8-flash", timeoutMs: 15000 },
      );
    } catch (error) {
      logger.warn("AI lead classification failed", {
        operation: "classifyLeadForAcquisition", organisationId, actorUid: uid,
        reason: error instanceof Error ? error.name : "unknown",
      });
      throw new HttpsError("unavailable", "AI classification is temporarily unavailable. Review the lead manually instead.");
    }
  },
);

export const listOutreachDrafts = onCall(callableOptions, async (request) => {
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
      const draftStatusValid = draft.status === "draft" && draft.sent === false;
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

export const updateOutreachDraft = onCall(callableOptions, async (request) => {
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
    if (draft.status !== "draft" || draft.sent !== false) {
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

export const deleteOutreachDraft = onCall(callableOptions, async (request) => {
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
