import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, type QueryDocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { hasCampaignWritePermission, isValidOrganisationId, normaliseOptionalText, normaliseRequiredText } from "./authorization";

initializeApp();
const db = getFirestore();

function requireUid(uid: string | undefined): string {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to continue.");
  return uid;
}

function requireOrganisationId(value: unknown): string {
  if (!isValidOrganisationId(value)) throw new HttpsError("invalid-argument", "A valid organisationId is required.");
  return value;
}

async function requireMembership(organisationId: string, uid: string) {
  const snapshot = await db.doc(`organisations/${organisationId}/members/${uid}`).get();
  if (!snapshot.exists) throw new HttpsError("permission-denied", "You do not have access to this organisation.");
  return snapshot.data() ?? {};
}

export const createOrganisation = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const name = normaliseRequiredText((request.data as { name?: unknown } | undefined)?.name, 100);
  if (!name) throw new HttpsError("invalid-argument", "Organisation name must be 1–100 characters.");

  const organisation = db.collection("organisations").doc();
  const membership = organisation.collection("members").doc(uid);
  await db.runTransaction(async (transaction: Transaction) => {
    transaction.create(organisation, { name, ownerUid: uid, createdAt: FieldValue.serverTimestamp() });
    transaction.create(membership, { uid, role: "owner", createdAt: FieldValue.serverTimestamp() });
  });
  return { organisationId: organisation.id, name, role: "owner" as const };
});

export const createCampaign = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const name = normaliseRequiredText(data.name, 120);
  const category = normaliseRequiredText(data.category, 100);
  const location = normaliseRequiredText(data.location, 160);
  const brand = normaliseRequiredText(data.brand ?? "My business", 100);
  const goal = normaliseOptionalText(data.goal, 500);
  if (!name || !category || !location || !brand || goal === null) {
    throw new HttpsError("invalid-argument", "Campaign fields are missing or exceed their allowed length.");
  }

  const membership = await requireMembership(organisationId, uid);
  if (!hasCampaignWritePermission(membership.role)) {
    throw new HttpsError("permission-denied", "Only organisation owners and admins can create campaigns.");
  }
  const campaign = db.collection("organisations").doc(organisationId).collection("campaigns").doc();
  await campaign.create({ name, category, location, brand, goal, status: "active", createdBy: uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  return { campaignId: campaign.id, organisationId, name, category, location, brand, goal, status: "active" as const };
});

export const listCampaigns = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  await requireMembership(organisationId, uid);
  const snapshot = await db.collection("organisations").doc(organisationId).collection("campaigns").orderBy("createdAt", "desc").limit(100).get();
  return {
    campaigns: snapshot.docs.map((doc: QueryDocumentSnapshot) => {
      const data = doc.data();
      return { id: doc.id, name: data.name, category: data.category, location: data.location, brand: data.brand, goal: data.goal, status: data.status, createdAt: data.createdAt?.toDate?.().toISOString() ?? null };
    }),
  };
});
