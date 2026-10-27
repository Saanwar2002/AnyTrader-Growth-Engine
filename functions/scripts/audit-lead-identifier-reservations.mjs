import { initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { auditLeadIdentifierReservations } from "../lib/lead-identifier-reservation-audit.js";

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

const organisationId = readOption("--organisation-id", "");
const pageSize = Number(readOption("--page-size", "100"));
const maxRecords = Number(readOption("--max-records", "5000"));
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";

if (projectId !== "demo-growth-engine-test" || !/^(127\.0\.0\.1:8080|localhost:8080)$/.test(emulatorHost)) {
  throw new Error("This reservation audit is emulator-only and refuses all cloud Firestore projects.");
}
if (!/^[A-Za-z0-9_-]{1,128}$/.test(organisationId)) {
  throw new Error("Usage: node functions/scripts/audit-lead-identifier-reservations.mjs --organisation-id <id> [--page-size 100] [--max-records 5000]");
}
if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 200) {
  throw new Error("--page-size must be an integer from 1 to 200.");
}
if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 20000) {
  throw new Error("--max-records must be an integer from 1 to 20000.");
}

initializeApp({ projectId });
const db = getFirestore();
const organisationRef = db.collection("organisations").doc(organisationId);
const organisation = await organisationRef.get();
if (!organisation.exists) throw new Error("Organisation was not found; refusing to audit an orphaned tenant subcollection.");

async function scanCollection(collectionRef, budget) {
  const records = [];
  let cursor;
  let truncated = false;
  while (records.length < budget) {
    const requested = Math.min(pageSize, budget - records.length);
    let query = collectionRef.orderBy(FieldPath.documentId()).limit(requested);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    records.push(...page.docs);
    if (page.size < requested) break;
    cursor = page.docs[page.docs.length - 1];
    if (records.length >= budget) {
      // A full final page is conservatively incomplete until a larger-budget
      // scan proves there is no additional document.
      truncated = true;
      break;
    }
  }
  return { records, truncated };
}

const reservationBudget = Math.min(60000, maxRecords * 3);
const [leadScan, reservationScan] = await Promise.all([
  scanCollection(organisationRef.collection("leads"), maxRecords),
  scanCollection(organisationRef.collection("leadIdentifierReservations"), reservationBudget),
]);
const complete = !leadScan.truncated && !reservationScan.truncated;
const audit = complete
  ? auditLeadIdentifierReservations(
    leadScan.records.map((snapshot) => ({ ...snapshot.data(), id: snapshot.id })),
    reservationScan.records.map((snapshot) => ({ ...snapshot.data(), id: snapshot.id })),
  )
  : null;

const sample = (values) => values.slice(0, 100);
const report = {
  mode: "read-only",
  projectId,
  organisationId,
  complete,
  leadScan: { scannedRecords: leadScan.records.length, truncated: leadScan.truncated, maxRecords },
  reservationScan: { scannedRecords: reservationScan.records.length, truncated: reservationScan.truncated, maxRecords: reservationBudget },
  findings: audit ? {
    scannedLeadCount: audit.scannedLeadCount,
    scannedReservationCount: audit.scannedReservationCount,
    expectedReservationCount: audit.expectedReservationCount,
    missingReservationCount: audit.missingReservationIds.length,
    orphanReservationCount: audit.orphanReservationIds.length,
    unverifiableReservationCount: audit.unverifiableReservationIds.length,
    mismatchedReservationCount: audit.mismatchedReservationIds.length,
    malformedLeadCount: audit.malformedLeadIds.length,
    malformedReservationCount: audit.malformedReservationIds.length,
    duplicateIdentifierGroupCount: audit.duplicateIdentifierGroups.length,
    missingReservationIds: sample(audit.missingReservationIds),
    orphanReservationIds: sample(audit.orphanReservationIds),
    unverifiableReservationIds: sample(audit.unverifiableReservationIds),
    mismatchedReservationIds: sample(audit.mismatchedReservationIds),
    malformedLeadIds: sample(audit.malformedLeadIds),
    malformedReservationIds: sample(audit.malformedReservationIds),
    duplicateIdentifierGroups: sample(audit.duplicateIdentifierGroups),
  } : null,
  writePerformed: false,
  rawContactValuesIncluded: false,
};
console.log(JSON.stringify(report, null, 2));
if (!complete) process.exitCode = 2;
