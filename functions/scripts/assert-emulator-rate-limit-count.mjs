import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Read-only rate-limit assertion restricted to the local synthetic-data emulator.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^(127\.0\.0\.1:8080|localhost:8080)$/.test(emulatorHost)) {
  throw new Error("Refusing to inspect rate-limit counters outside the local demo Firestore emulator.");
}
const [organisationId, uid, operation, expectedArg] = process.argv.slice(2);
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const allowedOperations = new Set(["setLeadSuppression", "updateLeadContact", "updateLeadStatus", "updateLeadNotes", "updateCampaignStatus", "updateOutreachDraft", "deleteOutreachDraft"]);
if (!validId(organisationId) || !validId(uid) || !allowedOperations.has(operation)
  || (expectedArg !== undefined && !/^\d+$/.test(expectedArg))) {
  throw new Error("Usage: node assert-emulator-rate-limit-count.mjs <organisationId> <uid> <setLeadSuppression|updateLeadContact|updateLeadStatus|updateLeadNotes|updateCampaignStatus|updateOutreachDraft|deleteOutreachDraft> [expectedCount]");
}
initializeApp({ projectId });
const db = getFirestore();
const key = createHash("sha256").update(JSON.stringify([organisationId, uid, operation])).digest("hex");
const snapshot = await db.collection("rateLimits").doc(key).get();
const count = snapshot.exists ? snapshot.data()?.count : 0;
assert.ok(Number.isSafeInteger(count) && count >= 0, "persisted rate-limit count must be a non-negative safe integer");
if (expectedArg !== undefined) assert.equal(count, Number(expectedArg), "rate-limit counter must match expected value");
console.log(`COUNT:${count}`);
