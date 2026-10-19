import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Deliberately malformed fixture, restricted to the local demo emulator.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^127\.0\.0\.1:8080$|^localhost:8080$/.test(emulatorHost)) {
  throw new Error("Refusing to seed malformed membership outside the local demo Firestore emulator.");
}
const [organisationId, uid] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{1,128}$/.test(organisationId ?? "") || !/^[A-Za-z0-9_-]{1,128}$/.test(uid ?? "")) {
  throw new Error("Usage: node seed-emulator-invalid-membership.mjs <organisationId> <uid>");
}
initializeApp({ projectId });
await getFirestore().doc(`organisations/${organisationId}/members/${uid}`).set({
  uid,
  role: "invalid-role",
  createdAt: new Date(),
});
console.log("Seeded emulator-only malformed membership cursor fixture.");
