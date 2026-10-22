import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// This fixture is intentionally restricted to the named local/demo emulator project.
// It must never be used against a configured or production Firebase project.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^127\.0\.0\.1:8080$|^localhost:8080$/.test(emulatorHost)) {
  throw new Error("Refusing to seed memberships unless running against the local demo Firestore emulator.");
}
const [organisationId, uid, role] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{1,128}$/.test(organisationId ?? "")
  || !/^[A-Za-z0-9_-]{1,128}$/.test(uid ?? "")
  || !["member", "viewer", "admin"].includes(role ?? "")) {
  throw new Error("Usage: node seed-emulator-membership.mjs <organisationId> <uid> <member|viewer|admin>");
}
initializeApp({ projectId });
await getFirestore().doc(`organisations/${organisationId}/members/${uid}`).set({
  uid,
  role,
  createdAt: new Date(),
});
console.log(`Seeded emulator-only ${role} membership for ${uid} in ${organisationId}`);
