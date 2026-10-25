import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { canonicalLeadBusinessLocationKey, canonicalLeadEmailKey, canonicalLeadWebsiteKey } from "../lib/lead-identifiers.js";

const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
if (projectId !== "demo-growth-engine-test" || !/^(127\.0\.0\.1:8080|localhost:8080)$/.test(emulatorHost)) {
  throw new Error("Lead identifier assertion is emulator-only and refuses cloud Firestore projects.");
}
const [organisationId, leadId] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{1,128}$/.test(organisationId ?? "") || !/^[A-Za-z0-9_-]{1,128}$/.test(leadId ?? "")) {
  throw new Error("Usage: node functions/scripts/assert-emulator-lead-identifier-keys.mjs <organisationId> <leadId>");
}
initializeApp({ projectId });
const db = getFirestore();
const leadRef = db.collection("organisations").doc(organisationId).collection("leads").doc(leadId);
const snapshot = await leadRef.get();
assert.ok(snapshot.exists, "lead must exist in the requested organisation");
const lead = snapshot.data() ?? {};
assert.equal(typeof lead.businessName, "string", "persisted lead must have a business name");
const email = typeof lead.email === "string" ? lead.email.trim() : "";
const website = typeof lead.website === "string" ? lead.website.trim() : "";
const location = typeof lead.location === "string" ? lead.location.trim() : "";
const expected = {
  dedupeEmailKey: email ? canonicalLeadEmailKey(email) : "",
  dedupeWebsiteKey: website ? canonicalLeadWebsiteKey(website) : "",
  dedupeBusinessLocationKey: canonicalLeadBusinessLocationKey(lead.businessName, location),
};
for (const [field, value] of Object.entries(expected)) {
  assert.equal(lead[field], value, `persisted ${field} must match shared canonicalization policy`);
}
console.log(`PASS: canonical lead identifier keys are consistent for lead ${leadId}.`);
