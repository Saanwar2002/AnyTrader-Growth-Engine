import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Emulator-only fixture: refuse to write outside the named local demo project.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^127\.0\.0\.1:8080$|^localhost:8080$/.test(emulatorHost)) {
  throw new Error("Refusing to seed pagination fixtures outside the local demo Firestore emulator.");
}
const [uid] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid ?? "")) {
  throw new Error("Usage: node seed-emulator-organisation-pagination.mjs <authenticated-owner-uid>");
}
initializeApp({ projectId });
const db = getFirestore();
const batch = db.batch();
for (let i = 0; i < 105; i += 1) {
  const suffix = String(i).padStart(3, "0");
  const organisation = db.doc(`organisations/pagination-fixture-org-${suffix}`);
  const membership = organisation.collection("members").doc(uid);
  batch.set(organisation, {
    name: `Pagination fixture ${suffix}`,
    ownerUid: uid,
    createdAt: new Date(),
  });
  batch.set(membership, {
    uid,
    role: "owner",
    createdAt: new Date(),
  });
}
await batch.commit();
console.log("Seeded 105 emulator-only organisation memberships for pagination testing.");
