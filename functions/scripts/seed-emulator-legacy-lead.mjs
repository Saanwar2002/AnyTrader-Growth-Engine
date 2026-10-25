import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
if (projectId !== "demo-growth-engine-test" || !/^(127\.0\.0\.1:8080|localhost:8080)$/.test(emulatorHost)) {
  throw new Error("This fixture seeder is emulator-only and refuses all cloud Firestore projects.");
}
const [organisationId, leadId] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{1,128}$/.test(organisationId ?? "") || !/^[A-Za-z0-9_-]{1,128}$/.test(leadId ?? "")) {
  throw new Error("Usage: node functions/scripts/seed-emulator-legacy-lead.mjs <organisationId> <leadId>");
}
initializeApp({ projectId });
const db = getFirestore();
const org = await db.collection("organisations").doc(organisationId).get();
if (!org.exists) throw new Error("Organisation not found.");
await org.ref.collection("leads").doc(leadId).set({
  businessName: "Legacy Mixed Case Provider",
  category: "Painters",
  location: "Leeds",
  email: "Legacy.Contact@Example.Test",
  website: "HTTPS://LEGACY.EXAMPLE.TEST/Directory",
  phone: "",
  campaignId: "legacy-migration-fixture",
  status: "new",
  source: "legacy_fixture",
  doNotContact: true,
  contactReviewStatus: "pending",
  contactReviewRevision: 0,
  createdAt: FieldValue.serverTimestamp(),
});
console.log("Seeded one synthetic legacy lead without canonical identifier keys.");
