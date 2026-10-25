import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Read-only usage assertion restricted to the local synthetic-data emulator.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^(127\.0\.0\.1:8080|localhost:8080)$/.test(emulatorHost)) {
  throw new Error("Refusing to inspect plan usage outside the local demo Firestore emulator.");
}
const [organisationId, expectedArg] = process.argv.slice(2);
if (typeof organisationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(organisationId)
  || !/^\d+$/.test(expectedArg ?? "")) {
  throw new Error("Usage: node assert-emulator-member-usage.mjs <organisationId> <expectedMembers>");
}
initializeApp({ projectId });
const db = getFirestore();
const snapshot = await db.collection("organisations").doc(organisationId).get();
assert.ok(snapshot.exists, "organisation must exist in the local emulator");
const usage = snapshot.data()?.planUsage;
assert.ok(usage && Number.isSafeInteger(usage.members) && usage.members >= 0,
  "authoritative member usage must be a non-negative safe integer");
assert.equal(usage.members, Number(expectedArg), "member usage must match the expected counter");
console.log(`MEMBERS:${usage.members}`);
