import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

// Strictly emulator-only legacy-record fixture. Never seed a configured Firebase project.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^127\.0\.0\.1:8080$|^localhost:8080$/.test(emulatorHost)) {
  throw new Error("Refusing to seed legacy drafts unless running against the local demo Firestore emulator.");
}
const [organisationId, validLeadId, validCampaignId] = process.argv.slice(2);
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
if (!validId(organisationId) || !validId(validLeadId) || !validId(validCampaignId)) {
  throw new Error("Usage: node seed-emulator-legacy-drafts.mjs <organisationId> <validLeadId> <validCampaignId>");
}
initializeApp({ projectId });
const db = getFirestore();
const drafts = db.collection("organisations").doc(organisationId).collection("outreachDrafts");
const now = FieldValue.serverTimestamp();
// Corrupt persisted list fields deliberately to verify list APIs return safe bounded values.
await Promise.all([
  db.collection("organisations").doc(organisationId).collection("campaigns").doc("legacy-malformed-campaign-fields").set({
    name: { unexpected: "object" }, category: 42, location: ["unexpected"], brand: null,
    goal: { unexpected: true }, status: { invalid: "status" }, createdAt: now,
  }),
  db.collection("organisations").doc(organisationId).collection("leads").doc("legacy-malformed-list-fields").set({
    campaignId: { unexpected: "object" },
    businessName: { unexpected: "object" }, category: 42, location: ["unexpected"],
    website: { unsafe: true }, email: 123, phone: null, source: { unexpected: true },
    status: { invalid: "status" }, score: { unexpected: true },
    scoreReasons: "not-an-array", notes: ["unexpected"], doNotContact: true,
    contactReviewStatus: "blocked", createdAt: now, updatedAt: now,
  }),
]);
// Model a legacy lead whose campaign reference points to a deleted campaign.
await db.collection("organisations").doc(organisationId).collection("leads").doc("legacy-missing-campaign-lead").set({
  businessName: "Synthetic Missing Campaign Lead",
  category: "Painter and decorator",
  location: "Test location",
  website: "",
  email: "",
  phone: "",
  campaignId: "legacy-missing-campaign",
  status: "new",
  doNotContact: false,
  contactReviewStatus: "cleared",
  createdAt: now,
  updatedAt: now,
});
// Exercise fail-closed handling for missing and malformed legacy contact restrictions.
await Promise.all([
  db.collection("organisations").doc(organisationId).collection("leads").doc("legacy-missing-restriction-lead").set({
    businessName: "Synthetic Missing Restriction Lead",
    category: "Painter and decorator",
    location: "Test location",
    campaignId: validCampaignId,
    status: "new",
    contactReviewStatus: "cleared",
    createdAt: now,
    updatedAt: now,
  }),
  db.collection("organisations").doc(organisationId).collection("leads").doc("legacy-malformed-restriction-lead").set({
    businessName: "Synthetic Malformed Restriction Lead",
    category: "Painter and decorator",
    location: "Test location",
    campaignId: validCampaignId,
    status: "new",
    doNotContact: "false",
    contactReviewStatus: "cleared",
    createdAt: now,
    updatedAt: now,
  }),
]);
await Promise.all([
  drafts.doc("legacy-orphan-draft").set({
    leadId: "legacy-missing-lead", campaignId: validCampaignId,
    subject: "Legacy orphan fixture", body: "Synthetic test only", status: "draft",
    createdAt: now,
  }),
  drafts.doc("legacy-mismatched-campaign-draft").set({
    leadId: validLeadId, campaignId: "legacy-other-campaign",
    subject: "Legacy mismatched campaign fixture", body: "Synthetic test only", status: "draft",
    createdAt: now,
  }),
  drafts.doc("legacy-missing-campaign-record-draft").set({
    leadId: "legacy-missing-campaign-lead", campaignId: "legacy-missing-campaign",
    subject: "Legacy missing campaign record fixture", body: "Synthetic test only", status: "draft",
    createdAt: now,
  }),
  drafts.doc("legacy-non-draft-status").set({
    leadId: validLeadId, campaignId: validCampaignId,
    subject: "Legacy non-draft status fixture", body: "Synthetic test only", status: "sent",
    createdAt: now,
  }),
  drafts.doc("legacy-missing-status").set({
    leadId: validLeadId, campaignId: validCampaignId,
    subject: "Legacy missing status fixture", body: "Synthetic test only",
    createdAt: now,
  }),
  drafts.doc("legacy-missing-restriction-draft").set({
    leadId: "legacy-missing-restriction-lead", campaignId: validCampaignId,
    subject: "Legacy missing restriction fixture", body: "Synthetic test only", status: "draft",
    createdAt: now,
  }),
  drafts.doc("legacy-malformed-restriction-draft").set({
    leadId: "legacy-malformed-restriction-lead", campaignId: validCampaignId,
    subject: "Legacy malformed restriction fixture", body: "Synthetic test only", status: "draft",
    createdAt: now,
  }),
  drafts.doc("legacy-malformed-content-draft").set({
    leadId: validLeadId, campaignId: validCampaignId,
    subject: { unexpected: "object instead of string" }, body: 12345, status: "draft",
    createdAt: now,
  }),
  drafts.doc("legacy-malformed-timestamp-draft").set({
    leadId: validLeadId, campaignId: validCampaignId,
    subject: "Legacy malformed timestamp fixture", body: "Synthetic test only", status: "draft",
    createdAt: { toDate: "not-a-function" },
  }),
]);
console.log("Seeded emulator-only orphan, mismatched-campaign, missing-campaign, and non-draft-status and missing-status legacy draft fixtures.");
