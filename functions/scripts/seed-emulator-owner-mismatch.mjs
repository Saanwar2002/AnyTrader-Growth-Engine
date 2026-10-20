import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Synthetic owner-role mismatch fixture; strictly local demo emulator only.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^127\.0\.0\.1:8080$|^localhost:8080$/.test(emulatorHost)) {
  throw new Error("Refusing to seed owner mismatch outside the local demo Firestore emulator.");
}
const [uid] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid ?? "")) {
  throw new Error("Usage: node seed-emulator-owner-mismatch.mjs <uid>");
}
initializeApp({ projectId });
const db = getFirestore();
await db.doc("organisations/owner-mismatch-org").set({
  name: "Synthetic owner mismatch fixture",
  ownerUid: "different-owner",
  createdAt: new Date(),
});
await db.doc(`organisations/owner-mismatch-org/members/${uid}`).set({
  uid,
  role: "owner",
  createdAt: new Date(),
});
await db.doc("organisations/owner-mismatch-org/campaigns/fixture-campaign").set({
  name: "Synthetic campaign",
  status: "active",
  createdAt: new Date(),
});
console.log("Seeded emulator-only owner mismatch fixture.");
