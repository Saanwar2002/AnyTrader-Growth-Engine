import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// This fixture intentionally creates child collections without creating the parent
// organisation document. It is strictly restricted to the local demo emulator.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^127\.0\.0\.1:8080$|^localhost:8080$/.test(emulatorHost)) {
  throw new Error("Refusing to seed orphaned organisation records outside the local demo Firestore emulator.");
}
const [uid] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid ?? "")) {
  throw new Error("Usage: node seed-emulator-orphaned-organisation.mjs <uid>");
}
initializeApp({ projectId });
const db = getFirestore();
const orphan = db.collection("organisations").doc("orphaned-org");
const createdAt = new Date();
await Promise.all([
  orphan.collection("members").doc(uid).set({ uid, role: "admin", createdAt }),
  orphan.collection("campaigns").doc("orphaned-campaign").set({ name: "Orphaned campaign", createdAt }),
  orphan.collection("leads").doc("orphaned-lead").set({
    campaignId: "orphaned-campaign", businessName: "Orphaned lead", doNotContact: true, createdAt,
  }),
  orphan.collection("outreachDrafts").doc("orphaned-draft").set({
    leadId: "orphaned-lead", campaignId: "orphaned-campaign", subject: "Orphaned draft", createdAt,
  }),
]);
console.log("Seeded emulator-only orphaned organisation subcollection records.");
