import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// This seeder is intentionally restricted to the local demo emulator and one fixed operation.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^(127\.0\.0\.1|localhost):8080$/.test(emulatorHost)) {
  throw new Error("Refusing to seed a rate-limit fixture outside the local demo Firestore emulator.");
}
const [organisationId, uid, operation] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{1,128}$/.test(organisationId ?? "")
  || !/^[A-Za-z0-9_-]{1,128}$/.test(uid ?? "")
  || operation !== "updateLeadNotes") {
  throw new Error("Usage: node seed-emulator-rate-limit.mjs <organisation-id> <authenticated-uid> updateLeadNotes");
}
initializeApp({ projectId });
const db = getFirestore();
const key = createHash("sha256").update(`${organisationId}:${uid}:${operation}`).digest("hex");
const now = Date.now();
await db.collection("rateLimits").doc(key).set({
  windowStartedAtMs: now,
  count: 240,
  updatedAt: new Date(now),
});
console.log("Seeded an emulator-only exhausted updateLeadNotes quota fixture.");
