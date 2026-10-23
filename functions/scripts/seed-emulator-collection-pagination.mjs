import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Strictly emulator-only pagination fixtures. Never seed a configured Firebase project.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^127\.0\.0\.1:8080$|^localhost:8080$/.test(emulatorHost)) {
  throw new Error("Refusing to seed collection pagination fixtures outside the local demo Firestore emulator.");
}
const [organisationId] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{1,128}$/.test(organisationId ?? "")) {
  throw new Error("Usage: node seed-emulator-collection-pagination.mjs <organisationId>");
}
initializeApp({ projectId });
const db = getFirestore();
const organisation = db.collection("organisations").doc(organisationId);
const batch = db.batch();

for (let i = 0; i < 105; i += 1) {
  const suffix = String(i).padStart(3, "0");
  const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, i));
  const campaignId = `pagination-fixture-campaign-${suffix}`;
  const leadId = `pagination-fixture-lead-${suffix}`;
  const draftId = `pagination-fixture-draft-${suffix}`;
  batch.set(organisation.collection("campaigns").doc(campaignId), {
    name: `Pagination fixture campaign ${suffix}`,
    brand: "Synthetic fixture",
    category: "Test providers",
    location: "Test location",
    goal: "Pagination integration test",
    status: "active",
    createdAt,
  });
  batch.set(organisation.collection("leads").doc(leadId), {
    campaignId,
    businessName: `Pagination fixture business ${suffix}`,
    category: "Test providers",
    location: "Test location",
    website: "",
    email: `pagination-${suffix}@example.test`,
    phone: "",
    source: "synthetic-test",
    status: "new",
    score: 0,
    scoreReasons: [],
    notes: "",
    doNotContact: false,
    contactReviewStatus: "cleared",
    createdAt,
    updatedAt: createdAt,
  });
  batch.set(organisation.collection("outreachDrafts").doc(draftId), {
    leadId,
    campaignId,
    subject: `Synthetic pagination draft ${suffix}`,
    body: "Emulator test only; never send.",
    status: "draft",
    sent: false,
    createdAt,
  });
}
await batch.commit();
console.log("Seeded 105 synthetic campaigns, leads, and draft records for emulator pagination tests.");
