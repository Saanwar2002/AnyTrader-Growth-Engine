import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Read-only integrity assertion restricted to the local synthetic-data emulator.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^(127\\.0\\.0\\.1:8080|localhost:8080)$/.test(emulatorHost)) {
  throw new Error("Refusing to inspect security audit events outside the local demo Firestore emulator.");
}
const [organisationId, eventType, expectedCountArg] = process.argv.slice(2);
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validEventType = (value) => typeof value === "string" && /^[a-z][a-z0-9_.-]{2,79}$/.test(value);
if (!validId(organisationId) || !validEventType(eventType) || !/^\\d+$/.test(expectedCountArg ?? "")) {
  throw new Error("Usage: node assert-emulator-audit-event-count.mjs <organisationId> <eventType> <expectedCount>");
}
initializeApp({ projectId });
const db = getFirestore();
const snapshot = await db.collection("organisations").doc(organisationId)
  .collection("securityAuditEvents").where("eventType", "==", eventType).get();
assert.equal(snapshot.size, Number(expectedCountArg), `audit-event count for ${eventType} must match successful mutations only`);
for (const event of snapshot.docs) {
  const value = event.data();
  assert.equal(value.eventType, eventType, "audit event type must match the query");
  assert.equal(value.organisationId, organisationId, "audit event must be scoped to the expected organisation");
  assert.equal(typeof value.actorUid, "string", "audit event must record the authenticated actor");
  assert.equal(value.outcome, "success", "the success-event collection must not contain failed outcomes");
  assert.equal(value.schemaVersion, 1, "audit event must carry schema version 1");
  assert.ok(value.createdAt, "audit event must carry a server timestamp");
}
console.log(`AUDIT_EVENT_COUNT:${eventType}:${snapshot.size}`);
