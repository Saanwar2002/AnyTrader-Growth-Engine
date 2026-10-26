import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Read-only integrity assertion restricted to the local synthetic-data emulator.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^(127\.0\.0\.1:8080|localhost:8080)$/.test(emulatorHost)) {
  throw new Error("Refusing to inspect security audit events outside the local demo Firestore emulator.");
}
const allowedMetadataKeys = {
  "organisation.created": [],
  "lead.csv_import.completed": ["importedCount", "duplicatesSkipped"],
  "lead.contact_updated": ["contactChannelsChanged", "contactReviewRevision", "contactReviewStatus", "doNotContact"],
  "lead.contact_restriction_changed": ["doNotContact", "contactReviewRevision", "contactReviewStatus"],
  "lead.created": ["leadStatus"],
  "campaign.created": ["campaignStatus"],
  "campaign.status_changed": ["campaignStatus"],
  "lead.status_changed": ["leadStatus"],
  "lead.notes_changed": ["notesCleared"],
  "lead.follow_up_date_changed": ["followUpDateSet"],
  "outreach_draft.created": ["draftAction"],
  "outreach_draft.updated": ["draftAction"],
  "outreach_draft.deleted": ["draftAction"],
};
const [organisationId, eventType, expectedCountArg, resourceId] = process.argv.slice(2);
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validEventType = (value) => typeof value === "string" && /^[a-z][a-z0-9_.-]{2,79}$/.test(value);
if (!validId(organisationId) || !validEventType(eventType) || !/^\d+$/.test(expectedCountArg ?? "")
  || (resourceId !== undefined && !validId(resourceId))) {
  throw new Error("Usage: node assert-emulator-audit-event-count.mjs <organisationId> <eventType> <expectedCount> [resourceId]");
}
initializeApp({ projectId });
const db = getFirestore();
const snapshot = await db.collection("organisations").doc(organisationId)
  .collection("securityAuditEvents").where("eventType", "==", eventType).get();
const events = snapshot.docs.map((event) => ({ id: event.id, value: event.data() }))
  .filter(({ value }) => resourceId === undefined || value.resourceId === resourceId);
assert.equal(events.length, Number(expectedCountArg), "audit-event count for " + eventType + (resourceId ? " on resource " + resourceId : "") + " must match successful mutations only");
for (const { value } of events) {
  assert.equal(value.eventType, eventType, "audit event type must match the query");
  assert.equal(value.organisationId, organisationId, "audit event must be scoped to the expected organisation");
  assert.equal(typeof value.actorUid, "string", "audit event must record the authenticated actor");
  assert.equal(value.outcome, "success", "the success-event collection must not contain failed outcomes");
  assert.equal(value.schemaVersion, 1, "audit event must carry schema version 1");
  assert.ok(value.createdAt, "audit event must carry a server timestamp");
  assert.ok(value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata),
    "audit metadata must be a bounded object");
  const allowedKeys = allowedMetadataKeys[eventType];
  assert.ok(Array.isArray(allowedKeys), "audit event type must have an explicit metadata allowlist");
  const metadataKeys = Object.keys(value.metadata);
  assert.ok(metadataKeys.every((key) => allowedKeys.includes(key)),
    "audit metadata must contain only allowlisted fields for " + eventType);
  assert.ok(!metadataKeys.some((key) => /email|phone|website|subject|body|notes|businessName|token|secret|message/i.test(key)),
    "audit metadata must not contain contact details, draft content, notes, tokens, or secrets");
  for (const [key, metadataValue] of Object.entries(value.metadata)) {
    assert.ok(["string", "number", "boolean"].includes(typeof metadataValue),
      "audit metadata values must be scalar and bounded");
    if (typeof metadataValue === "string") assert.ok(metadataValue.length <= 80, "audit metadata strings must be bounded");
    if (typeof metadataValue === "number") assert.ok(Number.isSafeInteger(metadataValue), "audit metadata numbers must be safe integers");
  }
  if (resourceId !== undefined) assert.equal(value.resourceId, resourceId, "audit event must reference the expected resource");
}
console.log("AUDIT_EVENT_COUNT:" + eventType + (resourceId ? ":" + resourceId : "") + ":" + events.length);
