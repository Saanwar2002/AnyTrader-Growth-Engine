import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Read-only integrity assertion for synthetic records on the local emulator only.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^(127\.0\.0\.1:8080|localhost:8080)$/.test(emulatorHost)) {
  throw new Error("Refusing to inspect activity logs unless running against the local demo Firestore emulator.");
}
const [organisationId, leadId] = process.argv.slice(2);
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
if (!validId(organisationId) || !validId(leadId)) {
  throw new Error("Usage: node assert-emulator-no-lead-activity.mjs <organisationId> <leadId>");
}
initializeApp({ projectId });
const db = getFirestore();
const activities = await db.collection("organisations").doc(organisationId).collection("leadActivities").where("leadId", "==", leadId).limit(1).get();
assert.equal(activities.empty, true, "rejected contact-review operation must not create an activity-log record");
console.log("Verified rejected contact-review operation created no activity-log entry.");
