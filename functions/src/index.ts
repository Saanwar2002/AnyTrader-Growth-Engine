import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, type QueryDocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  calculateLeadCompleteness,
  canChangeSuppression,
  canCreateServerOutreachDraft,
  canTransitionLeadStatus,
  hasCampaignWritePermission,
  hasLeadWritePermission,
  isValidCampaignStatus,
  isValidDocumentId,
  isValidEmailAddress,
  isValidOrganisationId,
  normaliseOptionalText,
  normaliseRequiredText,
} from "./authorization";

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

function requireDocumentId(value: unknown, label: string): string {
  if (!isValidDocumentId(value)) throw new HttpsError("invalid-argument", `A valid ${label} is required.`);
  return value;
}

async function requireMembership(organisationId: string, uid: string) {
  const snapshot = await db.doc(`organisations/${organisationId}/members/${uid}`).get();
  if (!snapshot.exists) throw new HttpsError("permission-denied", "You do not have access to this organisation.");
  return snapshot.data() ?? {};
}

async function requireLeadEditor(organisationId: string, uid: string) {
  const membership = await requireMembership(organisationId, uid);
  if (!hasLeadWritePermission(membership.role)) {
    throw new HttpsError("permission-denied", "Your organisation role cannot edit leads or outreach drafts.");
  }
  return membership;
}

function normaliseLeadFields(data: Record<string, unknown>) {
  const businessName = normaliseRequiredText(data.businessName, 160);
  const category = normaliseOptionalText(data.category, 100);
  const location = normaliseOptionalText(data.location, 160);
  const website = normaliseOptionalText(data.website, 500);
  const email = normaliseOptionalText(data.email, 254);
  const phone = normaliseOptionalText(data.phone, 80);
  if (!businessName || category === null || location === null || website === null || email === null || phone === null) {
    throw new HttpsError("invalid-argument", "Lead fields are missing or exceed their allowed length.");
  }
  if (email && !isValidEmailAddress(email)) {
    throw new HttpsError("invalid-argument", "Lead email address is not valid.");
  }
  return { businessName, category, location, website, email, phone };
}

export const listMyOrganisations = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const memberships = await db.collectionGroup("members").where("uid", "==", uid).limit(100).get();
  const organisations: Array<{ organisationId: string; name: string; role: "owner" | "admin" | "member" | "viewer" } | null> = await Promise.all(memberships.docs.map(async (membershipDoc: QueryDocumentSnapshot) => {
    const organisationRef = membershipDoc.ref.parent.parent;
    if (!organisationRef || organisationRef.parent.id !== "organisations") return null;
    const organisation = await organisationRef.get();
    if (!organisation.exists) return null;
    const membership = membershipDoc.data();
    const role = membership.role;
    if (role !== "owner" && role !== "admin" && role !== "member" && role !== "viewer") return null;
    return { organisationId: organisation.id, name: organisation.data()?.name ?? "Unnamed organisation", role };
  }));
  return { organisations: organisations.filter((item): item is NonNullable<typeof item> => item !== null) };
});

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

export const updateCampaignStatus = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const campaignId = requireDocumentId(data.campaignId, "campaignId");
  if (!isValidCampaignStatus(data.status)) throw new HttpsError("invalid-argument", "Campaign status is not valid.");
  const membership = await requireMembership(organisationId, uid);
  if (!hasCampaignWritePermission(membership.role)) throw new HttpsError("permission-denied", "Only organisation owners and admins can change campaign status.");
  const campaignRef = db.collection("organisations").doc(organisationId).collection("campaigns").doc(campaignId);
  const campaignSnapshot = await campaignRef.get();
  if (!campaignSnapshot.exists) throw new HttpsError("not-found", "Campaign was not found in this organisation.");
  await campaignRef.update({ status: data.status, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
  return { campaignId, status: data.status };
});

export const listLeads = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  await requireMembership(organisationId, uid);
  const snapshot = await db.collection("organisations").doc(organisationId).collection("leads").orderBy("createdAt", "desc").limit(200).get();
  return {
    leads: snapshot.docs.map((doc: QueryDocumentSnapshot) => {
      const lead = doc.data();
      return {
        id: doc.id, campaignId: lead.campaignId, businessName: lead.businessName,
        category: lead.category, location: lead.location, website: lead.website,
        email: lead.email, phone: lead.phone, source: lead.source, status: lead.status,
        score: lead.score, scoreReasons: lead.scoreReasons, notes: lead.notes,
        doNotContact: lead.doNotContact === true,
        createdAt: lead.createdAt?.toDate?.().toISOString() ?? null,
      };
    }),
  };
});

export const createLead = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const campaignId = requireDocumentId(data.campaignId, "campaignId");
  await requireLeadEditor(organisationId, uid);
  const fields = normaliseLeadFields(data);
  const campaignRef = db.collection("organisations").doc(organisationId).collection("campaigns").doc(campaignId);
  const campaignSnapshot = await campaignRef.get();
  if (!campaignSnapshot.exists) throw new HttpsError("not-found", "Campaign was not found in this organisation.");

  const completeness = calculateLeadCompleteness(fields);
  const lead = db.collection("organisations").doc(organisationId).collection("leads").doc();
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async (transaction: Transaction) => {
    transaction.create(lead, { ...fields, campaignId, status: "new", source: "manual", score: completeness.score, scoreReasons: completeness.reasons, notes: "", doNotContact: false, createdBy: uid, createdAt: now, updatedAt: now });
    transaction.create(activity, { leadId: lead.id, actorUid: uid, message: `Lead created: ${fields.businessName}`, createdAt: now });
  });
  return { leadId: lead.id, organisationId, campaignId, ...fields, status: "new" as const, source: "manual" as const, score: completeness.score, scoreReasons: completeness.reasons, doNotContact: false };
});

export const updateLeadContact = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const leadId = requireDocumentId(data.leadId, "leadId");
  const fields = normaliseLeadFields(data);
  await requireLeadEditor(organisationId, uid);
  const leadRef = db.collection("organisations").doc(organisationId).collection("leads").doc(leadId);
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  const completeness = calculateLeadCompleteness(fields);
  await db.runTransaction(async (transaction: Transaction) => {
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const now = FieldValue.serverTimestamp();
    transaction.update(leadRef, { ...fields, score: completeness.score, scoreReasons: completeness.reasons, updatedAt: now, updatedBy: uid });
    transaction.create(activity, { leadId, actorUid: uid, message: "Lead contact details updated", createdAt: now });
  });
  return { leadId, ...fields, score: completeness.score, scoreReasons: completeness.reasons };
});

export const updateLeadStatus = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const leadId = requireDocumentId(data.leadId, "leadId");
  const status = data.status;
  await requireLeadEditor(organisationId, uid);
  const leadRef = db.collection("organisations").doc(organisationId).collection("leads").doc(leadId);
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  await db.runTransaction(async (transaction: Transaction) => {
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const lead = leadSnapshot.data() ?? {};
    if (!canTransitionLeadStatus(status, lead.doNotContact === true)) {
      throw new HttpsError("failed-precondition", lead.doNotContact === true && status === "contacted" ? "A suppressed lead cannot be marked as contacted." : "Lead status is not valid.");
    }
    const now = FieldValue.serverTimestamp();
    transaction.update(leadRef, { status, updatedAt: now, updatedBy: uid });
    transaction.create(activity, { leadId, actorUid: uid, message: `Lead status changed to ${status}`, createdAt: now });
  });
  return { leadId, status };
});

export const updateLeadNotes = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const leadId = requireDocumentId(data.leadId, "leadId");
  const notes = normaliseOptionalText(data.notes, 4000);
  if (notes === null) throw new HttpsError("invalid-argument", "Lead notes must be text no longer than 4,000 characters.");
  await requireLeadEditor(organisationId, uid);
  const leadRef = db.collection("organisations").doc(organisationId).collection("leads").doc(leadId);
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  await db.runTransaction(async (transaction: Transaction) => {
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const now = FieldValue.serverTimestamp();
    transaction.update(leadRef, { notes, updatedAt: now, updatedBy: uid });
    transaction.create(activity, { leadId, actorUid: uid, message: notes ? "Lead notes updated" : "Lead notes cleared", createdAt: now });
  });
  return { leadId, notes };
});

export const setLeadSuppression = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const leadId = requireDocumentId(data.leadId, "leadId");
  if (typeof data.doNotContact !== "boolean") throw new HttpsError("invalid-argument", "doNotContact must be a boolean.");
  const membership = await requireLeadEditor(organisationId, uid);
  if (!canChangeSuppression(membership.role, data.doNotContact)) {
    throw new HttpsError("permission-denied", data.doNotContact ? "Your organisation role cannot change lead suppression." : "Only organisation owners and admins can remove a contact restriction.");
  }
  const leadRef = db.collection("organisations").doc(organisationId).collection("leads").doc(leadId);
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  await db.runTransaction(async (transaction: Transaction) => {
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const now = FieldValue.serverTimestamp();
    transaction.update(leadRef, { doNotContact: data.doNotContact, updatedAt: now, updatedBy: uid });
    transaction.create(activity, { leadId, actorUid: uid, message: data.doNotContact ? "Lead marked do not contact" : "Lead contact restriction removed", createdAt: now });
  });
  return { leadId, doNotContact: data.doNotContact };
});

export const createOutreachDraft = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const leadId = requireDocumentId(data.leadId, "leadId");
  const subject = normaliseRequiredText(data.subject, 200);
  const body = normaliseRequiredText(data.body, 10000);
  if (!subject || !body) throw new HttpsError("invalid-argument", "Draft subject and body are required and must fit the allowed limits.");
  await requireLeadEditor(organisationId, uid);
  const leadRef = db.collection("organisations").doc(organisationId).collection("leads").doc(leadId);
  const draft = db.collection("organisations").doc(organisationId).collection("outreachDrafts").doc();
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  let campaignId = "";
  await db.runTransaction(async (transaction: Transaction) => {
    // Reading the lead and creating the draft in one transaction prevents a concurrent
    // suppression change from racing past the do-not-contact gate.
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const lead = leadSnapshot.data() ?? {};
    if (!canCreateServerOutreachDraft(lead.doNotContact)) throw new HttpsError("failed-precondition", "This lead is suppressed. Remove the restriction before creating an outreach draft.");
    campaignId = requireDocumentId(lead.campaignId, "lead campaignId");
    const now = FieldValue.serverTimestamp();
    transaction.create(draft, { leadId, campaignId, subject, body, status: "draft", createdBy: uid, createdAt: now, updatedAt: now });
    transaction.create(activity, { leadId, actorUid: uid, message: "Outreach draft created; not sent", createdAt: now });
  });
  return { draftId: draft.id, leadId, campaignId, subject, body, status: "draft" as const, sent: false };
});


export const listOutreachDrafts = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  await requireMembership(organisationId, uid);
  const snapshot = await db.collection("organisations").doc(organisationId).collection("outreachDrafts").orderBy("createdAt", "desc").limit(200).get();
  // Read current lead records so existing drafts reflect later contact restrictions.
  const leadIds = [...new Set(snapshot.docs
    .map((doc: QueryDocumentSnapshot) => doc.data().leadId)
    .filter((leadId: unknown): leadId is string => isValidDocumentId(leadId)))];
  const leadSnapshots = await Promise.all(leadIds.map((leadId) =>
    db.collection("organisations").doc(organisationId).collection("leads").doc(leadId).get()
  ));
  const leadById = new Map(leadIds.map((leadId, index) => [leadId, leadSnapshots[index]]));
  return {
    drafts: snapshot.docs.map((doc: QueryDocumentSnapshot) => {
      const draft = doc.data();
      const leadId = typeof draft.leadId === "string" ? draft.leadId : "";
      const leadSnapshot = leadById.get(leadId);
      const leadExists = leadSnapshot?.exists === true;
      const leadSuppressed = leadExists && leadSnapshot?.data()?.doNotContact === true;
      return {
        id: doc.id, leadId, campaignId: draft.campaignId, subject: draft.subject, body: draft.body,
        status: "draft" as const, leadSuppressed, requiresReview: !leadExists || leadSuppressed,
        reviewReason: !leadExists ? "Lead record is missing; review before use." : leadSuppressed ? "Lead is suppressed; do not contact." : null,
        createdAt: draft.createdAt?.toDate?.().toISOString() ?? null,
      };
    }),
  };
});

export const updateOutreachDraft = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const draftId = requireDocumentId(data.draftId, "draftId");
  const subject = normaliseRequiredText(data.subject, 200);
  const body = normaliseRequiredText(data.body, 10000);
  if (!subject || !body) throw new HttpsError("invalid-argument", "Draft subject and body are required and must fit the allowed limits.");
  await requireLeadEditor(organisationId, uid);
  const draftRef = db.collection("organisations").doc(organisationId).collection("outreachDrafts").doc(draftId);
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  let leadId = "";
  await db.runTransaction(async (transaction: Transaction) => {
    const draftSnapshot = await transaction.get(draftRef);
    if (!draftSnapshot.exists) throw new HttpsError("not-found", "Outreach draft was not found in this organisation.");
    const draft = draftSnapshot.data() ?? {};
    leadId = requireDocumentId(draft.leadId, "draft leadId");
    const leadRef = db.collection("organisations").doc(organisationId).collection("leads").doc(leadId);
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("failed-precondition", "The lead for this draft no longer exists.");
    if (!canCreateServerOutreachDraft(leadSnapshot.data()?.doNotContact)) throw new HttpsError("failed-precondition", "This lead is suppressed. Remove the restriction before editing an outreach draft.");
    const now = FieldValue.serverTimestamp();
    transaction.update(draftRef, { subject, body, updatedAt: now, updatedBy: uid });
    transaction.create(activity, { leadId, actorUid: uid, message: "Outreach draft updated; not sent", createdAt: now });
  });
  return { draftId, leadId, subject, body, status: "draft" as const, sent: false };
});

export const deleteOutreachDraft = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  const draftId = requireDocumentId(data.draftId, "draftId");
  await requireLeadEditor(organisationId, uid);
  const draftRef = db.collection("organisations").doc(organisationId).collection("outreachDrafts").doc(draftId);
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  await db.runTransaction(async (transaction: Transaction) => {
    const draftSnapshot = await transaction.get(draftRef);
    if (!draftSnapshot.exists) throw new HttpsError("not-found", "Outreach draft was not found in this organisation.");
    const leadId = requireDocumentId(draftSnapshot.data()?.leadId, "draft leadId");
    transaction.delete(draftRef);
    transaction.create(activity, { leadId, actorUid: uid, message: "Outreach draft deleted; no message was sent", createdAt: FieldValue.serverTimestamp() });
  });
  return { draftId, deleted: true, sent: false };
});
