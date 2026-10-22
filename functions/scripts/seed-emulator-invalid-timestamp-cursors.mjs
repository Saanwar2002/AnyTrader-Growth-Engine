import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Strictly emulator-only malformed-cursor fixtures. Never seed a configured Firebase project.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^127\.0\.0\.1:8080$|^localhost:8080$/.test(emulatorHost)) {
  throw new Error("Refusing to seed malformed cursor records outside the local demo Firestore emulator.");
}
const [organisationId] = process.argv.slice(2);
if (typeof organisationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(organisationId)) {
  throw new Error("Usage: node seed-emulator-invalid-timestamp-cursors.mjs <organisationId>");
}
initializeApp({ projectId });
const db = getFirestore();
const organisation = db.collection("organisations").doc(organisationId);
await Promise.all([
  organisation.collection("campaigns").doc("invalid-timestamp-campaign").set({ name: "Synthetic malformed cursor", createdAt: "not-a-timestamp" }),
  organisation.collection("leads").doc("invalid-timestamp-lead").set({ businessName: "Synthetic malformed cursor", createdAt: "not-a-timestamp" }),
  organisation.collection("outreachDrafts").doc("invalid-timestamp-draft").set({ subject: "Synthetic malformed cursor", createdAt: "not-a-timestamp" }),
]);
console.log("Seeded emulator-only malformed createdAt cursor records for campaigns, leads, and outreach drafts.");
