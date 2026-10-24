import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

// Strictly emulator-only synthetic legacy fixtures. Never seed a configured Firebase project.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^(127\\.0\\.0\\.1:8080|localhost:8080)$/.test(emulatorHost)) {
  throw new Error("Refusing to seed legacy duplicate fixtures outside the local demo Firestore emulator.");
}
const [organisationId, campaignId] = process.argv.slice(2);
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
if (!validId(organisationId) || !validId(campaignId)) {
  throw new Error("Usage: node seed-emulator-legacy-dedupe-leads.mjs <organisationId> <campaignId>");
}
initializeApp({ projectId });
const db = getFirestore();
const leads = db.collection("organisations").doc(organisationId).collection("leads");
const now = FieldValue.serverTimestamp();

// Deliberately omit dedupeEmailKey/dedupeWebsiteKey to model records written before canonical keys existed.
await Promise.all([
  leads.doc("legacy-exact-email-dedupe-fixture").set({
    businessName: "Synthetic Legacy Exact Email Record Ltd",
    category: "Painters",
    location: "Leeds",
    email: "legacy-exact-email@example.test",
    website: "",
    phone: "",
    campaignId,
    status: "new",
    doNotContact: true,
    contactReviewStatus: "pending",
    createdAt: now,
    updatedAt: now,
  }),
  leads.doc("legacy-exact-website-dedupe-fixture").set({
    businessName: "Synthetic Legacy Exact Website Record Ltd",
    category: "Painters",
    location: "Leeds",
    email: "",
    website: "https://legacy-exact.example.test/LegacyPath",
    phone: "",
    campaignId,
    status: "new",
    doNotContact: true,
    contactReviewStatus: "pending",
    createdAt: now,
    updatedAt: now,
  }),
]);
console.log("Seeded two suppressed legacy leads without canonical duplicate keys in the local demo emulator.");
