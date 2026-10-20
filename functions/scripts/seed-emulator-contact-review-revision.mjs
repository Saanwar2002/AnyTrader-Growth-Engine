import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Deliberately corrupt a synthetic contact-review revision on the local emulator only.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^(127\.0\.0\.1:8080|localhost:8080)$/.test(emulatorHost)) {
  throw new Error("Refusing to corrupt contact-review revisions outside the local demo Firestore emulator.");
}
const [organisationId, leadId] = process.argv.slice(2);
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
if (!validId(organisationId) || !validId(leadId)) {
  throw new Error("Usage: node seed-emulator-contact-review-revision.mjs <organisationId> <leadId>");
}
initializeApp({ projectId });
const db = getFirestore();
const leadRef = db.doc(`organisations/${organisationId}/leads/${leadId}`);
const lead = await leadRef.get();
if (!lead.exists) throw new Error("Refusing to corrupt a missing synthetic lead.");
await leadRef.set({ contactReviewRevision: "corrupt-revision-fixture" }, { merge: true });
console.log("Seeded malformed contact-review revision on local emulator synthetic lead.");
