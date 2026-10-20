import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, type QueryDocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  calculateLeadCompleteness,
  canChangeSuppression,
  canCreateServerOutreachDraft,
  canMarkLeadContacted,
  canTransitionLeadStatus,
  hasCampaignWritePermission,
  hasLeadWritePermission,
  getOutreachDraftReviewState,
  hasConsistentDraftCampaign,
  isValidCampaignStatus,
  isValidDocumentId,
  isValidEmailAddress,
  isSafeWebsiteAddress,
  isValidOrganisationId,
  isValidOrganisationPageToken,
  isValidOrganisationCollectionPageToken,
  isValidMembershipRecord,
  isValidMembershipForOrganisation,
  isValidFirestoreTimestamp,
  normaliseContactReviewStatus,
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
  const [organisationSnapshot, snapshot] = await Promise.all([
    db.doc(`organisations/${organisationId}`).get(),
    db.doc(`organisations/${organisationId}/members/${uid}`).get(),
  ]);
  const membership = snapshot.data();
  if (!organisationSnapshot.exists || !snapshot.exists || !isValidMembershipForOrganisation(membership, uid, organisationSnapshot.data()?.ownerUid)) {
    throw new HttpsError("permission-denied", "You do not have access to this organisation.");
  }
  return membership ?? {};
}

async function requireLeadEditor(organisationId: string, uid: string) {
  const membership = await requireMembership(organisationId, uid);
  if (!hasLeadWritePermission(membership.role)) {
    throw new HttpsError("permission-denied", "Your organisation role cannot edit leads or outreach drafts.");
  }
  return membership;
}

async function requireTransactionalRole(
  transaction: Transaction,
  organisationId: string,
  uid: string,
  permission: "lead" | "campaign",
) {
  const organisationRef = db.doc(`organisations/${organisationId}`);
  const membershipRef = db.doc(`organisations/${organisationId}/members/${uid}`);
  const [organisationSnapshot, membershipSnapshot] = await Promise.all([
    transaction.get(organisationRef),
    transaction.get(membershipRef),
  ]);
  const membership = membershipSnapshot.data();
  if (!organisationSnapshot.exists || !membershipSnapshot.exists || !membership || !isValidMembershipForOrganisation(membership, uid, organisationSnapshot.data()?.ownerUid)) {
    throw new HttpsError("permission-denied", "You do not have access to this organisation.");
  }
  const allowed = permission === "campaign"
    ? hasCampaignWritePermission(membership.role)
    : hasLeadWritePermission(membership.role);
  if (!allowed) {
    throw new HttpsError("permission-denied", permission === "campaign"
      ? "Only organisation owners and admins can manage campaigns."
      : "Your organisation role cannot edit leads or outreach drafts.");
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
  if (website && !isSafeWebsiteAddress(website)) {
    throw new HttpsError("invalid-argument", "Lead website must be a safe HTTP(S) URL or a plain domain.");
  }
  if (email && !isValidEmailAddress(email)) {
    throw new HttpsError("invalid-argument", "Lead email address is not valid.");
  }
  return { businessName, category, location, website, email, phone };
}

export const listMyOrganisations = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  let cursorSnapshot: QueryDocumentSnapshot | undefined;
  if (data.pageToken !== undefined && data.pageToken !== null && data.pageToken !== "") {
    if (!isValidOrganisationPageToken(data.pageToken, uid)) {
      throw new HttpsError("invalid-argument", "Organisation page token is invalid.");
    }
    const cursor = await db.doc(data.pageToken).get();
    const cursorMembership = cursor.data();
    const cursorOrganisationRef = cursor.ref.parent.parent;
    if (
      !cursor.exists
      || cursor.id !== uid
      || !cursorMembership
      || typeof cursorMembership !== "object"
      || Array.isArray(cursorMembership)
      || cursorMembership.uid !== uid
      || !cursorOrganisationRef
      || cursorOrganisationRef.parent.id !== "organisations"
    ) {
      throw new HttpsError("invalid-argument", "Organisation page token is no longer valid.");
    }
    const cursorOrganisation = await cursorOrganisationRef.get();
    if (!cursorOrganisation.exists) {
      throw new HttpsError("invalid-argument", "Organisation page token is no longer valid.");
    }
    if (!isValidMembershipForOrganisation(cursorMembership, uid, cursorOrganisation.data()?.ownerUid)) {
      throw new HttpsError("invalid-argument", "Organisation page token is no longer valid.");
    }
    cursorSnapshot = cursor as QueryDocumentSnapshot;
  }
  let membershipQuery = db.collectionGroup("members").where("uid", "==", uid);
  if (cursorSnapshot) membershipQuery = membershipQuery.startAfter(cursorSnapshot);
  const memberships = await membershipQuery.limit(101).get();
  const page = memberships.docs.slice(0, 100);
  const organisations: Array<{ organisationId: string; name: string; role: "owner" | "admin" | "member" | "viewer" } | null> = await Promise.all(page.map(async (membershipDoc: QueryDocumentSnapshot) => {
    const organisationRef = membershipDoc.ref.parent.parent;
    if (!organisationRef || organisationRef.parent.id !== "organisations") return null;
    const organisation = await organisationRef.get();
    if (!organisation.exists) return null;
    const membership = membershipDoc.data();
    const role = membership.role;
    if (membershipDoc.id !== uid || !isValidMembershipForOrganisation(membership, uid, organisation.data()?.ownerUid)) return null;
    return { organisationId: organisation.id, name: organisation.data()?.name ?? "Unnamed organisation", role };
  }));
  const hasMoreOrganisations = memberships.size > 100;
  return {
    organisations: organisations.filter((item): item is NonNullable<typeof item> => item !== null),
    hasMoreOrganisations,
    nextPageToken: hasMoreOrganisations ? page[page.length - 1]?.ref.path ?? null : null,
  };
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
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "campaign");
    transaction.create(campaign, { name, category, location, brand, goal, status: "active", createdBy: uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  return { campaignId: campaign.id, organisationId, name, category, location, brand, goal, status: "active" as const };
});

export const listCampaigns = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  await requireMembership(organisationId, uid);
  let cursorSnapshot: QueryDocumentSnapshot | undefined;
  if (data.pageToken !== undefined && data.pageToken !== null && data.pageToken !== "") {
    if (!isValidOrganisationCollectionPageToken(data.pageToken, organisationId, "campaigns")) {
      throw new HttpsError("invalid-argument", "Campaign page token is invalid for this organisation.");
    }
    const cursor = await db.doc(data.pageToken).get();
    if (!cursor.exists || !isValidFirestoreTimestamp(cursor.data()?.createdAt)) {
      throw new HttpsError("invalid-argument", "Campaign page token is no longer valid.");
    }
    cursorSnapshot = cursor as QueryDocumentSnapshot;
  }
  let campaignsQuery = db.collection("organisations").doc(organisationId).collection("campaigns").orderBy("createdAt", "desc");
  if (cursorSnapshot) campaignsQuery = campaignsQuery.startAfter(cursorSnapshot);
  const snapshot = await campaignsQuery.limit(101).get();
  const page = snapshot.docs.slice(0, 100);
  return {
    campaigns: page.map((doc: QueryDocumentSnapshot) => {
      const campaign = doc.data();
      return { id: doc.id, name: campaign.name, category: campaign.category, location: campaign.location, brand: campaign.brand, goal: campaign.goal, status: campaign.status, createdAt: campaign.createdAt?.toDate?.().toISOString() ?? null };
    }),
    hasMoreCampaigns: snapshot.size > 100,
    nextPageToken: snapshot.size > 100 ? page[page.length - 1]?.ref.path ?? null : null,
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
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "campaign");
    const campaignSnapshot = await transaction.get(campaignRef);
    if (!campaignSnapshot.exists) throw new HttpsError("not-found", "Campaign was not found in this organisation.");
    transaction.update(campaignRef, { status: data.status, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
  });
  return { campaignId, status: data.status };
});

export const listLeads = onCall(async (request) => {
  const uid = requireUid(request.auth?.uid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const organisationId = requireOrganisationId(data.organisationId);
  await requireMembership(organisationId, uid);
  let cursorSnapshot: QueryDocumentSnapshot | undefined;
  if (data.pageToken !== undefined && data.pageToken !== null && data.pageToken !== "") {
    if (!isValidOrganisationCollectionPageToken(data.pageToken, organisationId, "leads")) {
      throw new HttpsError("invalid-argument", "Lead page token is invalid for this organisation.");
    }
    const cursor = await db.doc(data.pageToken).get();
    if (!cursor.exists || !isValidFirestoreTimestamp(cursor.data()?.createdAt)) {
      throw new HttpsError("invalid-argument", "Lead page token is no longer valid.");
    }
    cursorSnapshot = cursor as QueryDocumentSnapshot;
  }
  let leadsQuery = db.collection("organisations").doc(organisationId).collection("leads").orderBy("createdAt", "desc");
  if (cursorSnapshot) leadsQuery = leadsQuery.startAfter(cursorSnapshot);
  const snapshot = await leadsQuery.limit(101).get();
  const page = snapshot.docs.slice(0, 100);
  return {
    leads: page.map((doc: QueryDocumentSnapshot) => {
      const lead = doc.data();
      return {
        id: doc.id, campaignId: lead.campaignId, businessName: lead.businessName,
        category: lead.category, location: lead.location, website: lead.website,
        email: lead.email, phone: lead.phone, source: lead.source, status: lead.status,
        score: lead.score, scoreReasons: lead.scoreReasons, notes: lead.notes,
        doNotContact: lead.doNotContact === true || lead.contactReviewStatus === "blocked",
        contactRestrictionVerified: lead.doNotContact === false && (lead.contactReviewStatus === undefined || lead.contactReviewStatus === "cleared"),
        contactReviewStatus: normaliseContactReviewStatus(lead.doNotContact, lead.contactReviewStatus),
        createdAt: lead.createdAt?.toDate?.().toISOString() ?? null,
      };
    }),
    hasMoreLeads: snapshot.size > 100,
    nextPageToken: snapshot.size > 100 ? page[page.length - 1]?.ref.path ?? null : null,
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

  const completeness = calculateLeadCompleteness(fields);
  const lead = db.collection("organisations").doc(organisationId).collection("leads").doc();
  const activity = db.collection("organisations").doc(organisationId).collection("leadActivities").doc();
  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    // Check campaign existence in the same transaction as lead creation so a
    // stale/deleted campaign cannot race past the precondition.
    const campaignSnapshot = await transaction.get(campaignRef);
    if (!campaignSnapshot.exists) throw new HttpsError("not-found", "Campaign was not found in this organisation.");
    transaction.create(lead, { ...fields, campaignId, status: "new", source: "manual", score: completeness.score, scoreReasons: completeness.reasons, notes: "", doNotContact: true, contactReviewStatus: "pending", createdBy: uid, createdAt: now, updatedAt: now });
    transaction.create(activity, { leadId: lead.id, actorUid: uid, message: `Lead created: ${fields.businessName}`, createdAt: now });
  });
  return { leadId: lead.id, organisationId, campaignId, ...fields, status: "new" as const, source: "manual" as const, score: completeness.score, scoreReasons: completeness.reasons, doNotContact: true, contactReviewStatus: "pending" as const };
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
  let contactRestriction: {
    doNotContact: boolean;
    contactReviewStatus: "pending" | "cleared" | "blocked";
    contactRestrictionVerified: boolean;
  } | undefined;
  await db.runTransaction(async (transaction: Transaction) => {
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const now = FieldValue.serverTimestamp();
    const existingLead = leadSnapshot.data() ?? {};
    const contactChannelsChanged = fields.email !== existingLead.email
      || fields.phone !== existingLead.phone
      || fields.website !== existingLead.website;
    const existingReviewStatus = normaliseContactReviewStatus(existingLead.doNotContact, existingLead.contactReviewStatus);
    const restrictionUpdate = contactChannelsChanged
      ? (existingLead.doNotContact === true || existingReviewStatus === "blocked"
        ? { doNotContact: true, contactReviewStatus: "blocked" as const }
        : { doNotContact: true, contactReviewStatus: "pending" as const })
      : {};
    const nextDoNotContact = contactChannelsChanged
      ? true
      : existingLead.doNotContact === true || existingReviewStatus === "blocked";
    const nextReviewStatus = normaliseContactReviewStatus(
      contactChannelsChanged ? nextDoNotContact : existingLead.doNotContact,
      contactChannelsChanged ? restrictionUpdate.contactReviewStatus : existingLead.contactReviewStatus,
    );
    contactRestriction = {
      doNotContact: nextDoNotContact,
      contactReviewStatus: nextReviewStatus,
      contactRestrictionVerified: !contactChannelsChanged
        && existingLead.doNotContact === false
        && (existingLead.contactReviewStatus === undefined || existingLead.contactReviewStatus === "cleared"),
    };
    transaction.update(leadRef, { ...fields, ...restrictionUpdate, score: completeness.score, scoreReasons: completeness.reasons, updatedAt: now, updatedBy: uid });
    transaction.create(activity, { leadId, actorUid: uid, message: "Lead contact details updated", createdAt: now });
  });
  return { leadId, ...fields, score: completeness.score, scoreReasons: completeness.reasons, ...contactRestriction };
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
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const lead = leadSnapshot.data() ?? {};
    if (status === "contacted" && !canMarkLeadContacted(lead.doNotContact, lead.contactReviewStatus)) {
      throw new HttpsError("failed-precondition", lead.doNotContact === true
        ? "A suppressed lead cannot be marked as contacted."
        : "The lead contact restriction is unverified; it cannot be marked as contacted.");
    }
    if (status === "contacted") {
      const campaignId = requireDocumentId(lead.campaignId, "lead campaignId");
      const campaignRef = db.collection("organisations").doc(organisationId).collection("campaigns").doc(campaignId);
      const campaignSnapshot = await transaction.get(campaignRef);
      if (!campaignSnapshot.exists) {
        throw new HttpsError("failed-precondition", "The lead's campaign no longer exists in this organisation.");
      }
    }
    if (!canTransitionLeadStatus(status, lead.doNotContact === true)) {
      throw new HttpsError("failed-precondition", "Lead status is not valid.");
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
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
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
    // Revalidate both the parent organisation and current membership inside
    // the write transaction so orphaned subcollections and stale roles fail closed.
    const currentMembership = await requireTransactionalRole(transaction, organisationId, uid, "lead");
    if (!canChangeSuppression(currentMembership.role, data.doNotContact)) {
      throw new HttpsError("permission-denied", data.doNotContact ? "Your organisation role cannot change lead suppression." : "Only organisation owners and admins can remove a contact restriction.");
    }
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const now = FieldValue.serverTimestamp();
    transaction.update(leadRef, { doNotContact: data.doNotContact, contactReviewStatus: data.doNotContact ? "blocked" : "cleared", updatedAt: now, updatedBy: uid });
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
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    // Reading the lead and creating the draft in one transaction prevents a concurrent
    // suppression change from racing past the do-not-contact gate.
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("not-found", "Lead was not found in this organisation.");
    const lead = leadSnapshot.data() ?? {};
    if (!canCreateServerOutreachDraft(lead.doNotContact, lead.contactReviewStatus)) throw new HttpsError("failed-precondition", lead.doNotContact === true || lead.contactReviewStatus === "blocked"
      ? "This lead is suppressed. Remove the restriction before creating an outreach draft."
      : "The lead contact review is pending or unverified; resolve it before creating an outreach draft.");
    campaignId = requireDocumentId(lead.campaignId, "lead campaignId");
    const campaignRef = db.collection("organisations").doc(organisationId).collection("campaigns").doc(campaignId);
    const campaignSnapshot = await transaction.get(campaignRef);
    if (!campaignSnapshot.exists) throw new HttpsError("failed-precondition", "The lead's campaign no longer exists in this organisation.");
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
  let cursorSnapshot: QueryDocumentSnapshot | undefined;
  if (data.pageToken !== undefined && data.pageToken !== null && data.pageToken !== "") {
    if (!isValidOrganisationCollectionPageToken(data.pageToken, organisationId, "outreachDrafts")) {
      throw new HttpsError("invalid-argument", "Outreach draft page token is invalid for this organisation.");
    }
    const cursor = await db.doc(data.pageToken).get();
    if (!cursor.exists || !isValidFirestoreTimestamp(cursor.data()?.createdAt)) {
      throw new HttpsError("invalid-argument", "Outreach draft page token is no longer valid.");
    }
    cursorSnapshot = cursor as QueryDocumentSnapshot;
  }
  let draftsQuery = db.collection("organisations").doc(organisationId).collection("outreachDrafts").orderBy("createdAt", "desc");
  if (cursorSnapshot) draftsQuery = draftsQuery.startAfter(cursorSnapshot);
  const snapshot = await draftsQuery.limit(101).get();
  const page = snapshot.docs.slice(0, 100);
  // Read current lead records so existing drafts reflect later contact restrictions.
  const leadIds = [...new Set(page
    .map((doc: QueryDocumentSnapshot) => doc.data().leadId)
    .filter((leadId: unknown): leadId is string => isValidDocumentId(leadId)))];
  const leadSnapshots = leadIds.length
    ? await db.getAll(...leadIds.map((leadId) =>
      db.collection("organisations").doc(organisationId).collection("leads").doc(leadId)
    ))
    : [];
  const leadById = new Map(leadIds.map((leadId, index) => [leadId, leadSnapshots[index]]));
  // A matching campaign ID is not enough: legacy drafts must also reference a
  // campaign document that still exists in this organisation.
  const campaignIds = [...new Set(page
    .flatMap((doc: QueryDocumentSnapshot) => {
      const draft = doc.data();
      const leadId = typeof draft.leadId === "string" ? draft.leadId : "";
      const lead = leadById.get(leadId)?.data();
      return [draft.campaignId, lead?.campaignId];
    })
    .filter((campaignId: unknown): campaignId is string => isValidDocumentId(campaignId)))];
  const campaignSnapshots = campaignIds.length
    ? await db.getAll(...campaignIds.map((campaignId) =>
      db.collection("organisations").doc(organisationId).collection("campaigns").doc(campaignId)
    ))
    : [];
  const campaignById = new Map(campaignIds.map((campaignId, index) => [campaignId, campaignSnapshots[index]]));
  return {
    drafts: page.map((doc: QueryDocumentSnapshot) => {
      const draft = doc.data();
      const leadId = typeof draft.leadId === "string" ? draft.leadId : "";
      const leadSnapshot = leadById.get(leadId);
      const leadExists = leadSnapshot?.exists === true;
      const lead = leadSnapshot?.data();
      const campaignId = typeof lead?.campaignId === "string" ? lead.campaignId : "";
      const campaignExists = isValidDocumentId(campaignId) && campaignById.get(campaignId)?.exists === true;
      const draftStatusValid = draft.status === "draft";
      const relationshipValid = leadExists
        && hasConsistentDraftCampaign(draft.campaignId, lead?.campaignId)
        && campaignExists
        && draftStatusValid;
      const review = relationshipValid
        ? getOutreachDraftReviewState(leadExists, lead?.doNotContact, lead?.contactReviewStatus)
        : {
          // Keep an explicit lead restriction visible even when another integrity
          // problem also requires review. Integrity warnings must never mask suppression.
          leadSuppressed: leadExists && (lead?.doNotContact === true || lead?.contactReviewStatus === "blocked"),
          requiresReview: true,
          reviewReason: !draftStatusValid
            ? "Draft status is missing or is not draft; review the record before use."
            : !leadExists
              ? "Lead record is missing; review before use."
              : (lead?.doNotContact === true || lead?.contactReviewStatus === "blocked")
              ? "Lead is suppressed and the draft integrity check failed; do not contact."
              : !hasConsistentDraftCampaign(draft.campaignId, lead?.campaignId)
                ? "Draft campaign does not match its lead; review the record before use."
                : "The lead's campaign record is missing; review before use.",
        };
      return {
        id: doc.id, leadId, campaignId: draft.campaignId, subject: draft.subject, body: draft.body,
        // Preserve the stored status for honest display; unknown/missing values are
        // visibly distinct from a real draft while the review gate remains fail-closed.
        status: typeof draft.status === "string" && draft.status.trim() ? draft.status : "unknown", ...review,
        createdAt: draft.createdAt?.toDate?.().toISOString() ?? null,
      };
    }),
    hasMoreDrafts: snapshot.size > 100,
    nextPageToken: snapshot.size > 100 ? page[page.length - 1]?.ref.path ?? null : null,
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
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    const draftSnapshot = await transaction.get(draftRef);
    if (!draftSnapshot.exists) throw new HttpsError("not-found", "Outreach draft was not found in this organisation.");
    const draft = draftSnapshot.data() ?? {};
    if (draft.status !== "draft") {
      throw new HttpsError("failed-precondition", "Only unsent drafts can be edited; this record requires review.");
    }
    leadId = requireDocumentId(draft.leadId, "draft leadId");
    const leadRef = db.collection("organisations").doc(organisationId).collection("leads").doc(leadId);
    const leadSnapshot = await transaction.get(leadRef);
    if (!leadSnapshot.exists) throw new HttpsError("failed-precondition", "The lead for this draft no longer exists.");
    const lead = leadSnapshot.data() ?? {};
    if (!hasConsistentDraftCampaign(draft.campaignId, lead.campaignId)) {
      throw new HttpsError("failed-precondition", "The draft campaign does not match its lead; review the record before editing.");
    }
    if (!canCreateServerOutreachDraft(lead.doNotContact, lead.contactReviewStatus)) throw new HttpsError("failed-precondition", lead.doNotContact === true || lead.contactReviewStatus === "blocked"
      ? "This lead is suppressed. Remove the restriction before editing an outreach draft."
      : "The lead contact review is pending or unverified; resolve it before editing an outreach draft.");
    const campaignId = requireDocumentId(lead.campaignId, "lead campaignId");
    const campaignRef = db.collection("organisations").doc(organisationId).collection("campaigns").doc(campaignId);
    const campaignSnapshot = await transaction.get(campaignRef);
    if (!campaignSnapshot.exists) throw new HttpsError("failed-precondition", "The lead's campaign no longer exists in this organisation.");
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
    await requireTransactionalRole(transaction, organisationId, uid, "lead");
    const draftSnapshot = await transaction.get(draftRef);
    if (!draftSnapshot.exists) throw new HttpsError("not-found", "Outreach draft was not found in this organisation.");
    // Deletion must remain possible for malformed legacy drafts so an operator
    // can clean up the record instead of being trapped by its invalid lead reference.
    const rawLeadId = draftSnapshot.data()?.leadId;
    const leadId = isValidDocumentId(rawLeadId) ? rawLeadId : null;
    transaction.delete(draftRef);
    transaction.create(activity, {
      ...(leadId ? { leadId } : {}),
      actorUid: uid,
      message: leadId
        ? "Outreach record deleted; this action did not send a message"
        : "Malformed outreach record deleted; this action did not send a message (lead reference was invalid)",
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { draftId, deleted: true, sent: false, messageSentByThisAction: false };
});
