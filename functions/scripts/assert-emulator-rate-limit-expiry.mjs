import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// This assertion must never target a non-local or non-demo Firestore instance.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^(127\\.0\\.1|localhost):8080$/.test(emulatorHost)) {
  throw new Error("Refusing to inspect rate-limit state outside the local demo Firestore emulator.");
}
const [organisationId, uid, operation] = process.argv.slice(2);
if (!(organisationId === "global" || /^[A-Za-z0-9_-]{1,128}$/.test(organisationId ?? ""))
  || !/^[A-Za-z0-9_-]{1,128}$/.test(uid ?? "")
  || operation !== "listMyOrganisations") {
  throw new Error("Usage: node assert-emulator-rate-limit-expiry.mjs <global|organisation-id> <authenticated-uid> listMyOrganisations");
}
initializeApp({ projectId });
const db = getFirestore();
const key = createHash("sha256").update(JSON.stringify([organisationId, uid, operation])).digest("hex");
const snapshot = await db.collection("rateLimits").doc(key).get();
assert.equal(snapshot.exists, true, "successful callable should persist its quota document");
const data = snapshot.data();
assert.equal(typeof data.windowStartedAtMs, "number", "quota window start must be persisted");
assert.equal(typeof data.count, "number", "quota count must be persisted as a number");
assert.ok(data.expireAt instanceof Timestamp, "quota expiry must be a Firestore Timestamp");
assert.equal(data.expireAt.toMillis(), data.windowStartedAtMs + 60_000 + 5 * 60_000,
  "expiry must align to the persisted window end plus the five-minute grace period");
console.log("Verified emulator quota expiry matches its persisted window and grace period.");
