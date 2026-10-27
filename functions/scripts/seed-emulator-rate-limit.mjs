import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// This seeder is intentionally restricted to the local demo emulator and one fixed operation.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^(127\.0\.0\.1|localhost):8080$/.test(emulatorHost)) {
  throw new Error("Refusing to seed a rate-limit fixture outside the local demo Firestore emulator.");
}
const [organisationId, uid, operation, state = "exhausted"] = process.argv.slice(2);
if (!(organisationId === "global" || /^[A-Za-z0-9_-]{1,128}$/.test(organisationId ?? ""))
  || !/^[A-Za-z0-9_-]{1,128}$/.test(uid ?? "")
  || !["createOrganisation", "updateLeadNotes", "updateOutreachDraft", "importLeads", "listLeads", "listCampaigns", "listOutreachDrafts", "listMyOrganisations"].includes(operation)
  || !["exhausted", "invalid", "boundary", "expired", "reset"].includes(state)
  || (state === "expired" && !["createOrganisation", "listMyOrganisations"].includes(operation))
  || (state === "reset" && !["importLeads", "listLeads", "listCampaigns", "listOutreachDrafts"].includes(operation))) {
  throw new Error("Usage: node seed-emulator-rate-limit.mjs <organisation-id|global> <authenticated-uid> <createOrganisation|updateLeadNotes|updateOutreachDraft|listLeads|listCampaigns|listOutreachDrafts|listMyOrganisations> [exhausted|invalid|boundary|expired|reset]");
}
initializeApp({ projectId });
const db = getFirestore();
const key = createHash("sha256").update(JSON.stringify([organisationId, uid, operation])).digest("hex");
const now = Date.now();
const windowMs = operation === "createOrganisation" ? 60 * 60_000 : 60_000;
const windowStartedAtMs = state === "expired" ? now - windowMs - 1000 : now;
await db.collection("rateLimits").doc(key).set({
  windowStartedAtMs,
  count: state === "reset" ? 0 : state === "invalid" ? "corrupt" : state === "exhausted"
    ? (operation === "createOrganisation" ? 5 : operation === "updateLeadNotes" ? 240 : operation === "updateOutreachDraft" ? 120 : operation === "listOutreachDrafts" ? 60 : operation === "importLeads" ? 10 : 120)
    : state === "boundary"
      ? (operation === "createOrganisation" ? 4 : operation === "updateLeadNotes" ? 239 : operation === "updateOutreachDraft" ? 119 : operation === "listOutreachDrafts" ? 59 : operation === "importLeads" ? 9 : 119)
      : (operation === "createOrganisation" ? 5 : operation === "importLeads" ? 10 : 120),
  updatedAt: new Date(now),
  expireAt: new Date(windowStartedAtMs + windowMs + 5 * 60_000),
});
console.log(`Seeded an emulator-only ${state} ${operation} quota fixture.`);
