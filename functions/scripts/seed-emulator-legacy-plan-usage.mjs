import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Emulator-only fixture: preserves the legacy-organisation compatibility path.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== "demo-growth-engine-test" || !emulatorHost || !/^127\.0\.0\.1:8080$|^localhost:8080$/.test(emulatorHost)) {
  throw new Error("Refusing to modify plan usage unless running against the local demo Firestore emulator.");
}
const [organisationId] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{1,128}$/.test(organisationId ?? "")) {
  throw new Error("Usage: node seed-emulator-legacy-plan-usage.mjs <organisationId>");
}
initializeApp({ projectId });
await getFirestore().doc(`organisations/${organisationId}`).update({
  planUsage: FieldValue.delete(),
});
console.log(`Removed planUsage from emulator-only organisation ${organisationId} to exercise legacy compatibility.`);
