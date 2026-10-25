import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
if (projectId !== "demo-growth-engine-test" || !/^(127\.0\.0\.1:8080|localhost:8080)$/.test(emulatorHost)) {
  throw new Error("Onboarding attribution assertion is emulator-only and refuses cloud Firestore projects.");
}
const [organisationId, leadId, expectedStatus, expectedTimestamp] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{1,128}$/.test(organisationId ?? "")
  || !/^[A-Za-z0-9_-]{1,128}$/.test(leadId ?? "")
  || !["onboarded", "rejected"].includes(expectedStatus ?? "")) {
  throw new Error("Usage: node functions/scripts/assert-emulator-onboarding-attribution.mjs <organisationId> <leadId> <onboarded|rejected> [expectedIsoTimestamp]");
}
initializeApp({ projectId });
const db = getFirestore();
const snapshot = await db.collection("organisations").doc(organisationId).collection("leads").doc(leadId).get();
assert.ok(snapshot.exists, "onboarding attribution lead must exist in the requested organisation");
const lead = snapshot.data() ?? {};
assert.equal(lead.status, expectedStatus, "lead lifecycle status must match the expected test phase");
assert.ok(lead.onboardedAt && typeof lead.onboardedAt.toDate === "function", "first onboarding timestamp must be a Firestore timestamp");
const timestamp = lead.onboardedAt.toDate();
assert.ok(Number.isFinite(timestamp.getTime()), "onboarding timestamp must be valid");
const onboardedAt = timestamp.toISOString();
if (expectedTimestamp) assert.equal(onboardedAt, expectedTimestamp, "later lifecycle changes must preserve the original onboarding timestamp");
console.log(JSON.stringify({ leadId, status: lead.status, onboardedAt }));
