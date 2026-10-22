import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Read-only integrity assertion restricted to the local synthetic-data emulator.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^(127\.0\.0\.1:8080|localhost:8080)$/.test(emulatorHost)) {
  throw new Error("Refusing to inspect security audit events outside the local demo Firestore emulator.");
}
const [organisationId, eventType, expectedCountArg] = process.argv.slice(2);
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
if (!validId(organisationId) || eventType !== "lead.csv_import.completed" || !/^\d+$/.test(expectedCountArg ?? "")) {
  throw new Error("Usage: node assert-emulator-audit-events.mjs <organisationId> lead.csv_import.completed <expectedCount>");
}
initializeApp({ projectId });
const db = getFirestore();
const snapshot = await db.collection("organisations").doc(organisationId)
  .collection("securityAuditEvents").where("eventType", "==", eventType).get();
assert.equal(snapshot.size, Number(expectedCountArg), "audit-event count must match successful first-time imports only");
for (const event of snapshot.docs) {
  const value = event.data();
  assert.equal(value.schemaVersion, 1, "audit event must carry schema version");
  assert.equal(value.outcome, "success", "only successful mutation outcomes belong in this event collection");
  assert.equal(value.resourceType, "campaign", "event resource type is allow-listed");
  assert.equal(typeof value.actorUid, "string", "event records the authenticated actor");
  assert.equal(typeof value.organisationId, "string", "event records the tenant scope");
  assert.ok(Number.isSafeInteger(value.metadata?.importedCount) && value.metadata.importedCount >= 0,
    "audit metadata includes only a bounded import count");
  assert.ok(Number.isSafeInteger(value.metadata?.duplicatesSkipped) && value.metadata.duplicatesSkipped >= 0,
    "audit metadata includes only a bounded duplicate count");
  assert.equal("leads" in value.metadata, false, "audit metadata must not include lead/contact payloads");
}
console.log(`AUDIT_EVENTS:${snapshot.size}`);
