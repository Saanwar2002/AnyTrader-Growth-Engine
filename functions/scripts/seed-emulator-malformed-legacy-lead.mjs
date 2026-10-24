import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

// Synthetic malformed legacy fixture; refuse all non-local/non-demo environments.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^(127\.0\.0\.1:8080|localhost:8080)$/.test(emulatorHost)) {
  throw new Error("Refusing to seed malformed legacy records outside the local demo Firestore emulator.");
}
const [organisationId, campaignId] = process.argv.slice(2);
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
if (!validId(organisationId) || !validId(campaignId)) {
  throw new Error("Usage: node seed-emulator-malformed-legacy-lead.mjs <organisationId> <campaignId>");
}
initializeApp({ projectId });
const db = getFirestore();
const now = FieldValue.serverTimestamp();
await db.collection("organisations").doc(organisationId).collection("leads")
  .doc("legacy-malformed-contact-fixture").set({
    businessName: "Synthetic Malformed Legacy Contact Record Ltd",
    category: "Painters",
    location: "Leeds",
    // Intentionally wrong types model corrupt/legacy persisted data.
    email: { invalid: "not-an-email" },
    website: 42,
    dedupeEmailKey: { invalid: true },
    dedupeWebsiteKey: ["not-a-canonical-key"],
    phone: { invalid: true },
    campaignId,
    status: "new",
    doNotContact: true,
    contactReviewStatus: "pending",
    createdAt: now,
    updatedAt: now,
  });
console.log("Seeded one suppressed malformed legacy lead in the local demo emulator.");
