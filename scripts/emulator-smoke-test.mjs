import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { initializeApp, deleteApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signOut } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { connectFirestoreEmulator, doc, getDoc, getFirestore } from "firebase/firestore";

const projectId = "demo-growth-engine-test";
const firebaseConfig = { apiKey: "demo-api-key", authDomain: "localhost", projectId, appId: "demo-app-id" };
const apps = [];
function connectClient(app) {
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  return { app, auth, functions, firestore };
}
async function expectCallableFailure(promise, expectedCode, label) {
  try { await promise; } catch (error) {
    assert.equal(error.code, expectedCode, `${label}: unexpected error code ${error.code}`);
    return;
  }
  assert.fail(`${label}: expected ${expectedCode} but the call succeeded`);
}
try {
  const first = connectClient(initializeApp(firebaseConfig, "tenant-one"));
  apps.push(first.app);
  await createUserWithEmailAndPassword(first.auth, "tenant-one@example.test", "testing-password-one");
  const callOne = (name, payload = {}) => (async () => {
    console.log(`CALL ${name} (tenant one)`);
    const response = await httpsCallable(first.functions, name, { timeout: 30000 })(payload);
    console.log(`OK ${name} (tenant one)`);
    return response.data;
  })();

  const initialOrgs = await callOne("listMyOrganisations");
  assert.deepEqual(initialOrgs.organisations, []);
  // A successful read must persist a server-managed TTL timestamp aligned to the quota window.
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-rate-limit-expiry.mjs",
    "global", first.auth.currentUser.uid, "listMyOrganisations",
  ], { stdio: "inherit" });
  // An expired persisted bucket must reset transactionally even if its stale document remains.
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-rate-limit.mjs",
    "global", first.auth.currentUser.uid, "listMyOrganisations", "expired",
  ], { stdio: "inherit" });
  const afterExpiredQuota = await callOne("listMyOrganisations");
  assert.deepEqual(afterExpiredQuota.organisations, [], "expired quota reset does not alter organisation data");
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-rate-limit-expiry.mjs",
    "global", first.auth.currentUser.uid, "listMyOrganisations", "fresh-window",
  ], { stdio: "inherit" });
  const orgOne = await callOne("createOrganisation", { name: "Tenant One" });
  assert.equal(orgOne.role, "owner");
  async function currentContactReviewRevision(leadId) {
    const result = await callOne("listLeads", { organisationId: orgOne.organisationId });
    const lead = result.leads.find((item) => item.id === leadId);
    assert.ok(lead, `synthetic lead ${leadId} must exist before contact review`);
    assert.ok(Number.isSafeInteger(lead.contactReviewRevision) && lead.contactReviewRevision >= 0,
      "lead listing exposes a valid contact-review revision");
    return lead.contactReviewRevision;
  }
  async function clearLeadRestriction(leadId, caller = callOne) {
    const contactReviewRevision = await currentContactReviewRevision(leadId);
    return caller("setLeadSuppression", {
      organisationId: orgOne.organisationId, leadId, doNotContact: false, contactReviewRevision,
    });
  }
  function currentQuotaCount(operation = "setLeadSuppression", uid = first.auth.currentUser.uid) {
    const output = execFileSync(process.execPath, [
      "functions/scripts/assert-emulator-rate-limit-count.mjs",
      orgOne.organisationId,
      uid,
      operation,
    ], { encoding: "utf8" });
    const match = output.match(/COUNT:(\d+)/);
    assert.ok(match, `emulator quota assertion returns the current ${operation} count`);
    return Number(match[1]);
  }
  // A successful mutation must also persist expiry metadata using its one-hour quota window.
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-rate-limit-expiry.mjs",
    "global", first.auth.currentUser.uid, "createOrganisation",
  ], { stdio: "inherit" });
  const campaignOne = await callOne("createCampaign", { organisationId: orgOne.organisationId, name: "Painter pilot", brand: "Example", category: "Painters", location: "Manchester", goal: "Recruit providers" });
  const pausedCampaign = await callOne("updateCampaignStatus", {
    organisationId: orgOne.organisationId,
    campaignId: campaignOne.campaignId,
    status: "paused",
  });
  assert.equal(pausedCampaign.status, "paused", "campaign status update returns the new state");
  const campaignAfterPause = await callOne("listCampaigns", { organisationId: orgOne.organisationId });
  assert.equal(campaignAfterPause.campaigns.find((campaign) => campaign.id === campaignOne.campaignId)?.status, "paused",
    "campaign status update is persisted");
  const reactivatedCampaign = await callOne("updateCampaignStatus", {
    organisationId: orgOne.organisationId,
    campaignId: campaignOne.campaignId,
    status: "active",
  });
  assert.equal(reactivatedCampaign.status, "active", "campaign can be reactivated by an owner");
  await expectCallableFailure(callOne("createLead", {
    organisationId: orgOne.organisationId, campaignId: campaignOne.campaignId,
    businessName: "Invalid Email Test", email: "not-an-email",
  }), "functions/invalid-argument", "server rejects malformed lead email");
  await expectCallableFailure(callOne("createLead", {
    organisationId: orgOne.organisationId, campaignId: campaignOne.campaignId,
    businessName: "X".repeat(161),
  }), "functions/invalid-argument", "server rejects oversized business name");
  const leadOne = await callOne("createLead", { organisationId: orgOne.organisationId, campaignId: campaignOne.campaignId, businessName: "Synthetic Test Painting Ltd", category: "Painters", location: "Manchester", email: "hello@example.test" });
  assert.equal(leadOne.doNotContact, true, "new leads must remain blocked pending review");
  assert.equal(leadOne.contactReviewStatus, "pending", "new leads must expose a distinct pending-review state");
  const statusBeforeRejectedUpdates = (await callOne("listLeads", { organisationId: orgOne.organisationId }))
    .leads.find((lead) => lead.id === leadOne.leadId)?.status;
  const quotaBeforeRejectedLeadStatusUpdates = currentQuotaCount("updateLeadStatus");
  await expectCallableFailure(callOne("updateLeadStatus", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, status: "contacted" }), "functions/failed-precondition", "pending review contacted-status gate");
  await expectCallableFailure(callOne("updateLeadStatus", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, status: "sent" }), "functions/failed-precondition", "unknown lead lifecycle status rejected");
  assert.equal(currentQuotaCount("updateLeadStatus"), quotaBeforeRejectedLeadStatusUpdates,
    "rejected lead status transitions do not consume status-update quota");
  for (const status of ["contacted", "sent"]) {
    execFileSync(process.execPath, [
      "functions/scripts/assert-emulator-no-lead-activity.mjs",
      orgOne.organisationId,
      leadOne.leadId,
      `Lead status changed to ${status}`,
    ], { stdio: "inherit" });
  }
  const afterRejectedLeadStatusUpdates = await callOne("listLeads", { organisationId: orgOne.organisationId });
  assert.equal(afterRejectedLeadStatusUpdates.leads.find((lead) => lead.id === leadOne.leadId)?.status,
    statusBeforeRejectedUpdates, "rejected lead status transitions preserve the stored lifecycle status");
  await expectCallableFailure(callOne("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    businessName: "Synthetic Test Painting Ltd",
    category: "Painters",
    location: "Manchester",
    email: "not-an-email",
  }), "functions/invalid-argument", "lead contact update rejects malformed email");
  const invalidContactEditLead = await callOne("createLead", {
    organisationId: orgOne.organisationId,
    campaignId: campaignOne.campaignId,
    businessName: "Synthetic Invalid Contact Edit Guard Ltd",
    category: "Painters",
    location: "Manchester",
    email: "before-edit@example.test",
  });
  await expectCallableFailure(callOne("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: invalidContactEditLead.leadId,
    businessName: "Synthetic Invalid Contact Edit Guard Ltd",
    category: "Painters",
    location: "Manchester",
    email: "malformed-address",
  }), "functions/invalid-argument", "invalid contact edit fails before mutation");
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-no-lead-activity.mjs",
    orgOne.organisationId,
    invalidContactEditLead.leadId,
    "Lead contact details updated",
  ], { stdio: "inherit" });
  const afterInvalidContactEditList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const afterInvalidContactEdit = afterInvalidContactEditList.leads.find((lead) => lead.id === invalidContactEditLead.leadId);
  assert.equal(afterInvalidContactEdit?.email, "before-edit@example.test", "invalid contact edit preserves the stored email");
  assert.equal(afterInvalidContactEdit?.doNotContact, true, "invalid contact edit preserves the default contact restriction");
  assert.equal(afterInvalidContactEdit?.contactReviewStatus, "pending", "invalid contact edit preserves pending review state");

  const unsafeWebsiteLead = await callOne("createLead", {
    organisationId: orgOne.organisationId,
    campaignId: campaignOne.campaignId,
    businessName: "Synthetic Unsafe Website Guard Ltd",
    category: "Painters",
    location: "Manchester",
    website: "https://before-edit.example.test",
  });
  const quotaBeforeUnsafeWebsiteEdits = currentQuotaCount("updateLeadContact");
  for (const [label, unsafeWebsite] of [
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,unsafe"],
    ["protocol-relative URL", "//evil.example.test/path"],
    ["URL credentials", "https://user:password@example.test/path"],
    ["backslash URL", "https:\\\\evil.example.test/path"],
    ["embedded whitespace", "https://evil.example.test/unsafe path"],
  ]) {
    await expectCallableFailure(callOne("updateLeadContact", {
      organisationId: orgOne.organisationId,
      leadId: unsafeWebsiteLead.leadId,
      businessName: "Synthetic Unsafe Website Guard Ltd",
      category: "Painters",
      location: "Manchester",
      website: unsafeWebsite,
    }), "functions/invalid-argument", `unsafe website edit rejected: ${label}`);
  }
  assert.equal(currentQuotaCount("updateLeadContact"), quotaBeforeUnsafeWebsiteEdits,
    "rejected unsafe website edits do not consume contact-edit quota");
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-no-lead-activity.mjs",
    orgOne.organisationId,
    unsafeWebsiteLead.leadId,
    "Lead contact details updated",
  ], { stdio: "inherit" });
  const afterUnsafeWebsiteEditList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const afterUnsafeWebsiteEdit = afterUnsafeWebsiteEditList.leads.find((lead) => lead.id === unsafeWebsiteLead.leadId);
  assert.equal(afterUnsafeWebsiteEdit?.website, "https://before-edit.example.test",
    "unsafe website edit preserves the original website");
  assert.equal(afterUnsafeWebsiteEdit?.doNotContact, true,
    "unsafe website edit preserves the default contact restriction");
  assert.equal(afterUnsafeWebsiteEdit?.contactReviewStatus, "pending",
    "unsafe website edit preserves pending review");
  console.log("PASS: six unsafe website edit variants fail without changing contact details, restrictions, or activity history.");

  // Contact-review mutations require a real boolean; coercible values must
  // never be interpreted as a request to block or clear a contact restriction.
  for (const [label, invalidFlag] of [
    ["string false", "false"],
    ["number zero", 0],
    ["object", { value: false }],
    ["array", [false]],
    ["null", null],
  ]) {
    await expectCallableFailure(callOne("setLeadSuppression", {
      organisationId: orgOne.organisationId,
      leadId: invalidContactEditLead.leadId,
      doNotContact: invalidFlag,
    }), "functions/invalid-argument", `${label} contact-review flag rejected`);
  }
  for (const message of ["Lead marked do not contact", "Lead contact restriction removed"]) {
    execFileSync(process.execPath, [
      "functions/scripts/assert-emulator-no-lead-activity.mjs",
      orgOne.organisationId,
      invalidContactEditLead.leadId,
      message,
    ], { stdio: "inherit" });
  }
  const afterInvalidReviewFlagList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const afterInvalidReviewFlag = afterInvalidReviewFlagList.leads.find((lead) => lead.id === invalidContactEditLead.leadId);
  assert.equal(afterInvalidReviewFlag?.doNotContact, true, "invalid review flags preserve suppression");
  assert.equal(afterInvalidReviewFlag?.contactReviewStatus, "pending", "invalid review flags preserve pending review");
  const campaignQuotaBeforeInvalidStatus = currentQuotaCount("updateCampaignStatus");
  await expectCallableFailure(callOne("updateCampaignStatus", {
    organisationId: orgOne.organisationId,
    campaignId: campaignOne.campaignId,
    status: "sent",
  }), "functions/invalid-argument", "unknown campaign lifecycle status rejected");
  assert.equal(currentQuotaCount("updateCampaignStatus"), campaignQuotaBeforeInvalidStatus,
    "invalid campaign status does not consume status-update quota");
  const campaignAfterInvalidStatus = await callOne("listCampaigns", { organisationId: orgOne.organisationId });
  assert.equal(campaignAfterInvalidStatus.campaigns.find((campaign) => campaign.id === campaignOne.campaignId)?.status,
    "active", "invalid campaign status preserves the stored campaign state");
  const campaignQuotaBeforeMissingTarget = currentQuotaCount("updateCampaignStatus");
  await expectCallableFailure(callOne("updateCampaignStatus", {
    organisationId: orgOne.organisationId,
    campaignId: "missing-campaign-target",
    status: "paused",
  }), "functions/not-found", "campaign status update rejects a missing target");
  assert.equal(currentQuotaCount("updateCampaignStatus"), campaignQuotaBeforeMissingTarget,
    "missing campaign target does not consume status-update quota");
  const campaignsAfterMissingTarget = await callOne("listCampaigns", { organisationId: orgOne.organisationId });
  assert.equal(campaignsAfterMissingTarget.campaigns.find((campaign) => campaign.id === campaignOne.campaignId)?.status,
    "active", "missing campaign target does not alter other campaign state");
  await expectCallableFailure(callOne("createOutreachDraft", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, subject: "Blocked before review", body: "Must not be created" }), "functions/failed-precondition", "new lead draft gate before contact review");
  await callOne("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: true });
  // Updating ordinary contact fields must never silently clear a do-not-contact restriction.
  await callOne("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    businessName: "Synthetic Test Painting Ltd (contact edit while suppressed)",
    category: "Painters",
    location: "Manchester",
    email: "hello@example.test",
  });
  const stillSuppressed = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const suppressedLeadAfterContactEdit = stillSuppressed.leads.find((lead) => lead.id === leadOne.leadId);
  assert.equal(suppressedLeadAfterContactEdit?.doNotContact, true, "contact-detail edits preserve do-not-contact restriction");
  assert.equal(suppressedLeadAfterContactEdit?.contactReviewStatus, "blocked", "contact-detail edits preserve blocked review state");
  await expectCallableFailure(callOne("createOutreachDraft", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, subject: "Blocked", body: "Must not be created" }), "functions/failed-precondition", "suppressed lead draft gate after contact edit");
  await expectCallableFailure(callOne("updateLeadStatus", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, status: "contacted" }), "functions/failed-precondition", "suppressed lead contacted status gate");
  await clearLeadRestriction(leadOne.leadId);
  const clearedLeadList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  assert.equal(clearedLeadList.leads.find((lead) => lead.id === leadOne.leadId)?.contactReviewStatus, "cleared");

  // Editing non-contact business metadata must not discard a still-valid review.
  const clearedLeadBeforeMetadataEdit = clearedLeadList.leads.find((lead) => lead.id === leadOne.leadId);
  const metadataEditResponse = await callOne("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    businessName: "Synthetic Test Painting Ltd (metadata-only edit)",
    category: "Painters",
    location: "Manchester",
    email: clearedLeadBeforeMetadataEdit?.email ?? "",
    phone: clearedLeadBeforeMetadataEdit?.phone ?? "",
    website: clearedLeadBeforeMetadataEdit?.website ?? "",
  });
  assert.equal(metadataEditResponse.doNotContact, false, "metadata-only edit response preserves contact restriction");
  assert.equal(metadataEditResponse.contactReviewStatus, "cleared", "metadata-only edit response returns review state");
  assert.equal(metadataEditResponse.contactRestrictionVerified, true, "metadata-only edit response exposes verified state");
  const metadataEditedLeadList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const metadataEditedLead = metadataEditedLeadList.leads.find((lead) => lead.id === leadOne.leadId);
  assert.equal(metadataEditedLead?.doNotContact, false, "metadata-only edits preserve the explicit contact-review decision");
  assert.equal(metadataEditedLead?.contactReviewStatus, "cleared", "metadata-only edits do not unnecessarily reset contact review");
  assert.equal(metadataEditedLead?.contactRestrictionVerified, true, "metadata-only edits preserve verified restriction state");

  // A clearance decision tied to an old contact revision must not clear a newer channel edit.
  const revisionBeforeEmailChange = await currentContactReviewRevision(leadOne.leadId);
  // Changing a contact channel invalidates the previous review clearance.
  const changedEmailResponse = await callOne("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    businessName: "Synthetic Test Painting Ltd (new email requires review)",
    category: "Painters",
    location: "Manchester",
    email: "new-contact@example.test",
  });
  assert.equal(changedEmailResponse.doNotContact, true, "contact-channel edit response requires fresh review");
  assert.equal(changedEmailResponse.contactReviewStatus, "pending", "contact-channel edit response returns pending review");
  assert.equal(changedEmailResponse.contactRestrictionVerified, false, "contact-channel edit response marks restriction unverified");
  const changedContactLeadList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const changedContactLead = changedContactLeadList.leads.find((lead) => lead.id === leadOne.leadId);
  assert.equal(changedContactLead?.doNotContact, true, "changing a contact channel re-applies the contact restriction");
  assert.equal(changedContactLead?.contactReviewStatus, "pending", "changing a contact channel requires fresh review");
  assert.equal(changedContactLead?.contactReviewRevision, revisionBeforeEmailChange + 1,
    "changing an email increments the contact-review revision");
  await expectCallableFailure(callOne("setLeadSuppression", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    doNotContact: false,
    contactReviewRevision: revisionBeforeEmailChange,
  }), "functions/failed-precondition", "stale review revision cannot clear a changed contact channel");
  const afterStaleClearAttempt = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const leadAfterStaleClear = afterStaleClearAttempt.leads.find((lead) => lead.id === leadOne.leadId);
  assert.equal(leadAfterStaleClear?.doNotContact, true, "stale clearance leaves the lead suppressed");
  assert.equal(leadAfterStaleClear?.contactReviewStatus, "pending", "stale clearance leaves review pending");

  // Use a fresh synthetic lead to prove stale clearance creates no activity at all,
  // rather than merely avoiding a duplicate entry on a lead with prior review history.
  const staleClearSideEffectLead = await callOne("createLead", {
    organisationId: orgOne.organisationId,
    campaignId: campaignOne.campaignId,
    businessName: "Synthetic Stale Clearance Side Effect Guard Ltd",
    category: "Painters",
    location: "Manchester",
    email: "stale-before@example.test",
  });
  const staleClearInitialRevision = await currentContactReviewRevision(staleClearSideEffectLead.leadId);
  await callOne("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: staleClearSideEffectLead.leadId,
    businessName: "Synthetic Stale Clearance Side Effect Guard Ltd",
    category: "Painters",
    location: "Manchester",
    email: "stale-after@example.test",
  });
  const suppressionQuotaBeforeStaleClear = currentQuotaCount();
  await expectCallableFailure(callOne("setLeadSuppression", {
    organisationId: orgOne.organisationId,
    leadId: staleClearSideEffectLead.leadId,
    doNotContact: false,
    contactReviewRevision: staleClearInitialRevision,
  }), "functions/failed-precondition", "fresh lead stale clearance is rejected");
  assert.equal(currentQuotaCount(), suppressionQuotaBeforeStaleClear,
    "rejected stale clearance does not consume suppression quota");
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-no-lead-activity.mjs",
    orgOne.organisationId,
    staleClearSideEffectLead.leadId,
    "Lead contact restriction removed",
  ], { stdio: "inherit" });
  const staleClearSideEffectList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const staleClearSideEffectState = staleClearSideEffectList.leads.find((lead) => lead.id === staleClearSideEffectLead.leadId);
  assert.equal(staleClearSideEffectState?.doNotContact, true, "rejected stale clearance preserves suppression");
  assert.equal(staleClearSideEffectState?.contactReviewStatus, "pending", "rejected stale clearance preserves pending review");
  assert.equal(staleClearSideEffectState?.contactReviewRevision, staleClearInitialRevision + 1,
    "rejected stale clearance preserves the newer contact revision");

  // A malformed persisted revision must fail closed during clearance and create no activity.
  const malformedRevisionLead = await callOne("createLead", {
    organisationId: orgOne.organisationId,
    campaignId: campaignOne.campaignId,
    businessName: "Synthetic Malformed Review Revision Guard Ltd",
    category: "Painters",
    location: "Manchester",
    email: "malformed-revision@example.test",
  });
  const revisionBeforeCorruption = await currentContactReviewRevision(malformedRevisionLead.leadId);
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-contact-review-revision.mjs",
    orgOne.organisationId,
    malformedRevisionLead.leadId,
  ], { stdio: "inherit" });
  const suppressionQuotaBeforeMalformedRevision = currentQuotaCount();
  await expectCallableFailure(callOne("setLeadSuppression", {
    organisationId: orgOne.organisationId,
    leadId: malformedRevisionLead.leadId,
    doNotContact: false,
    contactReviewRevision: revisionBeforeCorruption,
  }), "functions/failed-precondition", "malformed persisted review revision fails closed");
  assert.equal(currentQuotaCount(), suppressionQuotaBeforeMalformedRevision,
    "rejected malformed revision does not consume suppression quota");
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-no-lead-activity.mjs",
    orgOne.organisationId,
    malformedRevisionLead.leadId,
    "Lead contact restriction removed",
  ], { stdio: "inherit" });
  const malformedRevisionStateList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const malformedRevisionState = malformedRevisionStateList.leads.find((lead) => lead.id === malformedRevisionLead.leadId);
  assert.equal(malformedRevisionState?.doNotContact, true, "malformed revision preserves suppression");
  assert.equal(malformedRevisionState?.contactReviewStatus, "pending", "malformed revision preserves pending review");

  // A malformed revision must also block contact-channel edits; failed attempts must not
  // consume the edit quota, overwrite contact data, or append a success activity.
  const contactEditQuotaBeforeMalformedRevision = currentQuotaCount("updateLeadContact");
  await expectCallableFailure(callOne("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: malformedRevisionLead.leadId,
    businessName: "Synthetic Malformed Review Revision Guard Ltd",
    category: "Painters",
    location: "Manchester",
    email: "attempted-change@example.test",
  }), "functions/failed-precondition", "malformed persisted revision blocks contact-channel edit");
  assert.equal(currentQuotaCount("updateLeadContact"), contactEditQuotaBeforeMalformedRevision,
    "rejected malformed revision does not consume contact-edit quota");
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-no-lead-activity.mjs",
    orgOne.organisationId,
    malformedRevisionLead.leadId,
    "Lead contact details updated",
  ], { stdio: "inherit" });
  const afterMalformedRevisionEditList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const afterMalformedRevisionEdit = afterMalformedRevisionEditList.leads.find((lead) => lead.id === malformedRevisionLead.leadId);
  assert.equal(afterMalformedRevisionEdit?.email, "malformed-revision@example.test",
    "rejected malformed revision preserves the original contact channel");
  assert.equal(afterMalformedRevisionEdit?.doNotContact, true,
    "rejected malformed revision preserves the contact restriction");

  // A stricter block action remains available even when review metadata is corrupt.
  // It must leave the lead blocked, and the outreach gate must continue to reject drafts.
  await callOne("setLeadSuppression", {
    organisationId: orgOne.organisationId,
    leadId: malformedRevisionLead.leadId,
    doNotContact: true,
  });
  const blockedMalformedRevisionList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const blockedMalformedRevision = blockedMalformedRevisionList.leads.find((lead) => lead.id === malformedRevisionLead.leadId);
  assert.equal(blockedMalformedRevision?.doNotContact, true,
    "stricter suppression action keeps a malformed-revision lead suppressed");
  assert.equal(blockedMalformedRevision?.contactReviewStatus, "blocked",
    "stricter suppression action records blocked status despite malformed revision");
  await expectCallableFailure(callOne("createOutreachDraft", {
    organisationId: orgOne.organisationId,
    leadId: malformedRevisionLead.leadId,
    subject: "Synthetic blocked lead test",
    body: "This draft must be rejected for a blocked synthetic lead.",
  }), "functions/failed-precondition", "blocked malformed-revision lead cannot create outreach draft");

  // Applying a block must not repair or silently reset corrupt review metadata:
  // subsequent clearance must still require operator remediation.
  const blockedRevisionBeforeClearAttempt = await currentContactReviewRevision(malformedRevisionLead.leadId);
  const blockedClearQuotaBefore = currentQuotaCount();
  await expectCallableFailure(callOne("setLeadSuppression", {
    organisationId: orgOne.organisationId,
    leadId: malformedRevisionLead.leadId,
    doNotContact: false,
    contactReviewRevision: blockedRevisionBeforeClearAttempt,
  }), "functions/failed-precondition", "blocked malformed-revision lead cannot be cleared using a fallback revision");
  assert.equal(currentQuotaCount(), blockedClearQuotaBefore,
    "rejected clearance after stricter block does not consume suppression quota");
  const afterBlockedClearAttemptList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const afterBlockedClearAttempt = afterBlockedClearAttemptList.leads.find((lead) => lead.id === malformedRevisionLead.leadId);
  assert.equal(afterBlockedClearAttempt?.doNotContact, true,
    "failed clearance preserves the stricter suppression");
  assert.equal(afterBlockedClearAttempt?.contactReviewStatus, "blocked",
    "failed clearance preserves blocked status");
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-no-lead-activity.mjs",
    orgOne.organisationId,
    malformedRevisionLead.leadId,
    "Lead contact restriction removed",
  ], { stdio: "inherit" });

  // A valid but exhausted revision counter must not overflow when contact channels change.
  const maxRevisionLead = await callOne("createLead", {
    organisationId: orgOne.organisationId,
    campaignId: campaignOne.campaignId,
    businessName: "Synthetic Maximum Review Revision Guard Ltd",
    category: "Painters",
    location: "Manchester",
    email: "max-revision@example.test",
  });
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-contact-review-revision.mjs",
    orgOne.organisationId,
    maxRevisionLead.leadId,
    "max-safe-integer",
  ], { stdio: "inherit" });
  const editQuotaBeforeRevisionOverflow = currentQuotaCount("updateLeadContact");
  await expectCallableFailure(callOne("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: maxRevisionLead.leadId,
    businessName: "Synthetic Maximum Review Revision Guard Ltd",
    category: "Painters",
    location: "Manchester",
    email: "attempted-overflow-change@example.test",
  }), "functions/failed-precondition", "maximum safe contact-review revision cannot overflow");
  assert.equal(currentQuotaCount("updateLeadContact"), editQuotaBeforeRevisionOverflow,
    "revision overflow rejection does not consume contact-edit quota");
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-no-lead-activity.mjs",
    orgOne.organisationId,
    maxRevisionLead.leadId,
    "Lead contact details updated",
  ], { stdio: "inherit" });
  const maxRevisionStateList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const maxRevisionState = maxRevisionStateList.leads.find((lead) => lead.id === maxRevisionLead.leadId);
  assert.equal(maxRevisionState?.email, "max-revision@example.test",
    "revision overflow rejection preserves original contact data");
  assert.equal(maxRevisionState?.doNotContact, true,
    "revision overflow rejection preserves suppression");

  // Non-channel edits remain available at the revision ceiling, but must not
  // alter the revision counter or relax an existing suppression.
  const maxRevisionNonContactEdit = await callOne("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: maxRevisionLead.leadId,
    businessName: "Synthetic Maximum Review Revision Guard Updated Ltd",
    category: "Painters",
    location: "Manchester",
    website: "",
    email: "max-revision@example.test",
    phone: "",
  });
  assert.equal(maxRevisionNonContactEdit.businessName, "Synthetic Maximum Review Revision Guard Updated Ltd",
    "non-channel edits remain possible at the revision ceiling");
  assert.equal(maxRevisionNonContactEdit.contactReviewRevision, Number.MAX_SAFE_INTEGER,
    "non-channel edit does not increment the revision ceiling");
  assert.equal(maxRevisionNonContactEdit.doNotContact, true,
    "non-channel edit cannot clear existing suppression");
  const afterMaxRevisionNonContactEdit = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const maxRevisionAfterNonContactEdit = afterMaxRevisionNonContactEdit.leads.find((lead) => lead.id === maxRevisionLead.leadId);
  assert.equal(maxRevisionAfterNonContactEdit?.businessName, "Synthetic Maximum Review Revision Guard Updated Ltd",
    "non-channel edit persists the updated business name");
  assert.equal(maxRevisionAfterNonContactEdit?.contactReviewRevision, Number.MAX_SAFE_INTEGER,
    "persisted revision remains the maximum safe integer");
  assert.equal(maxRevisionAfterNonContactEdit?.doNotContact, true,
    "persisted suppression remains enabled after non-channel edit");
  console.log("PASS: non-contact-channel edits preserve the maximum revision and cannot relax suppression.");

  await expectCallableFailure(callOne("createOutreachDraft", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    subject: "Stale clearance must not permit a draft",
    body: "Contact details changed after review",
  }), "functions/failed-precondition", "changed contact channel invalidates old clearance");

  // Race draft creation against a contact-channel edit. Either the draft transaction
  // observes the edit and rejects, or it commits first; in the latter case the subsequent
  // channel edit must leave the lead pending and the existing draft flagged for review.
  const concurrentReviewLead = await callOne("createLead", {
    organisationId: orgOne.organisationId,
    campaignId: campaignOne.campaignId,
    businessName: "Synthetic Concurrent Contact Review Ltd",
    category: "Painters",
    location: "Manchester",
    email: "before-race@example.test",
  });
  await clearLeadRestriction(concurrentReviewLead.leadId);
  const concurrentDraftAttempt = callOne("createOutreachDraft", {
    organisationId: orgOne.organisationId,
    leadId: concurrentReviewLead.leadId,
    subject: "Concurrent review test",
    body: "This is a draft only and must never be sent automatically.",
  });
  const concurrentContactEdit = callOne("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: concurrentReviewLead.leadId,
    businessName: "Synthetic Concurrent Contact Review Ltd",
    category: "Painters",
    location: "Manchester",
    email: "after-race@example.test",
  });
  const [concurrentDraftResult] = await Promise.allSettled([concurrentDraftAttempt, concurrentContactEdit]);
  const concurrentContactResult = await concurrentContactEdit;
  assert.equal(concurrentContactResult.doNotContact, true, "concurrent contact-channel edit must reapply suppression");
  assert.equal(concurrentContactResult.contactReviewStatus, "pending", "concurrent contact-channel edit must require fresh review");
  const concurrentReviewLeadList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const concurrentReviewLeadAfter = concurrentReviewLeadList.leads.find((lead) => lead.id === concurrentReviewLead.leadId);
  assert.equal(concurrentReviewLeadAfter?.doNotContact, true, "final concurrent lead state remains suppressed");
  assert.equal(concurrentReviewLeadAfter?.contactReviewStatus, "pending", "final concurrent lead state remains pending review");
  if (concurrentDraftResult.status === "fulfilled") {
    const concurrentDraftList = await callOne("listOutreachDrafts", { organisationId: orgOne.organisationId });
    const racedDraft = concurrentDraftList.drafts.find((item) => item.id === concurrentDraftResult.value.draftId);
    assert.ok(racedDraft, "a draft created before the contact edit remains visible for review");
    assert.equal(racedDraft.requiresReview, true, "draft created before a concurrent contact edit is flagged for review");
    assert.equal(racedDraft.leadSuppressed, true, "draft created before a concurrent contact edit reflects current suppression");
  } else {
    assert.equal(concurrentDraftResult.reason?.code, "functions/failed-precondition",
      "draft creation that loses the race to contact edit is rejected by the contact-review gate");
  }
  console.log("PASS: concurrent contact edits and draft creation leave the lead suppressed; any earlier draft is flagged for review.");

  // Explicitly re-review the updated contact details before lifecycle tests continue.
  await clearLeadRestriction(leadOne.leadId);

  // Phone and website changes must invalidate clearance just like email changes.
  for (const [channel, value] of [
    ["phone", "+44 161 555 0123"],
    ["website", "https://example.test/business"],
  ]) {
    const currentLeadList = await callOne("listLeads", { organisationId: orgOne.organisationId });
    const currentLead = currentLeadList.leads.find((lead) => lead.id === leadOne.leadId);
    await callOne("updateLeadContact", {
      organisationId: orgOne.organisationId,
      leadId: leadOne.leadId,
      businessName: "Synthetic Test Painting Ltd (contact channel review)",
      category: "Painters",
      location: "Manchester",
      email: currentLead?.email ?? "",
      phone: channel === "phone" ? value : currentLead?.phone ?? "",
      website: channel === "website" ? value : currentLead?.website ?? "",
    });
    const updatedChannelList = await callOne("listLeads", { organisationId: orgOne.organisationId });
    const updatedChannelLead = updatedChannelList.leads.find((lead) => lead.id === leadOne.leadId);
    assert.equal(updatedChannelLead?.doNotContact, true, `changing ${channel} re-applies the contact restriction`);
    assert.equal(updatedChannelLead?.contactReviewStatus, "pending", `changing ${channel} requires fresh review`);
    await expectCallableFailure(callOne("createOutreachDraft", {
      organisationId: orgOne.organisationId,
      leadId: leadOne.leadId,
      subject: "Changed contact channel requires review",
      body: `A ${channel} change must not retain old clearance`,
    }), "functions/failed-precondition", `changed ${channel} invalidates old clearance`);
    await clearLeadRestriction(leadOne.leadId);
  }

  // A reviewed lead may advance through lifecycle states; verify the server persists each update.
  const qualifiedLead = await callOne("updateLeadStatus", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, status: "qualified" });
  assert.equal(qualifiedLead.status, "qualified", "reviewed lead can be qualified");
  const qualifiedLeadList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  assert.equal(qualifiedLeadList.leads.find((lead) => lead.id === leadOne.leadId)?.status, "qualified", "qualified status persists in list results");
  const contactedLead = await callOne("updateLeadStatus", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, status: "contacted" });
  assert.equal(contactedLead.status, "contacted", "explicitly cleared lead can be marked contacted");
  const contactedLeadList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  assert.equal(contactedLeadList.leads.find((lead) => lead.id === leadOne.leadId)?.status, "contacted", "contacted status persists in list results");

  // Seed non-owner roles through a separate Admin SDK process that refuses to run
  // outside the local demo Firestore emulator. Exercise real callable authorization.
  function seedRole(uid, role) {
    execFileSync(process.execPath, [
      "functions/scripts/seed-emulator-membership.mjs",
      orgOne.organisationId,
      uid,
      role,
    ], { stdio: "inherit", env: process.env });
  }

  const member = connectClient(initializeApp(firebaseConfig, "role-member"));
  apps.push(member.app);
  await createUserWithEmailAndPassword(member.auth, "member@example.test", "testing-password-member");
  seedRole(member.auth.currentUser.uid, "member");
  const memberCall = (name, payload = {}) => httpsCallable(member.functions, name, { timeout: 30000 })(payload).then((response) => response.data);
  await memberCall("updateLeadNotes", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, notes: "Updated by member role integration test" });
  await memberCall("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: true });
  await expectCallableFailure(memberCall("setLeadSuppression", {
    organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: false,
    contactReviewRevision: await currentContactReviewRevision(leadOne.leadId),
  }), "functions/permission-denied", "member cannot clear lead suppression");
  await expectCallableFailure(memberCall("createCampaign", { organisationId: orgOne.organisationId, name: "Member denied campaign", brand: "Example", category: "Painters", location: "Manchester", goal: "Role test" }), "functions/permission-denied", "member cannot create campaign");

  const admin = connectClient(initializeApp(firebaseConfig, "role-admin"));
  apps.push(admin.app);
  await createUserWithEmailAndPassword(admin.auth, "admin@example.test", "testing-password-admin");
  seedRole(admin.auth.currentUser.uid, "admin");
  const adminCall = (name, payload = {}) => httpsCallable(admin.functions, name, { timeout: 30000 })(payload).then((response) => response.data);
  const adminCampaign = await adminCall("createCampaign", { organisationId: orgOne.organisationId, name: "Admin role campaign", brand: "Example", category: "Painters", location: "Manchester", goal: "Role test" });
  assert.equal(adminCampaign.status, "active", "admin can create a campaign");
  await adminCall("updateCampaignStatus", { organisationId: orgOne.organisationId, campaignId: adminCampaign.campaignId, status: "paused" });
  await clearLeadRestriction(leadOne.leadId, adminCall);
  const adminClearedLeadList = await adminCall("listLeads", { organisationId: orgOne.organisationId });
  assert.equal(adminClearedLeadList.leads.find((lead) => lead.id === leadOne.leadId)?.contactReviewStatus, "cleared", "admin can clear lead suppression");

  const viewer = connectClient(initializeApp(firebaseConfig, "role-viewer"));
  apps.push(viewer.app);
  await createUserWithEmailAndPassword(viewer.auth, "viewer@example.test", "testing-password-viewer");
  seedRole(viewer.auth.currentUser.uid, "viewer");
  const viewerCall = (name, payload = {}) => httpsCallable(viewer.functions, name, { timeout: 30000 })(payload).then((response) => response.data);
  const viewerLeads = await viewerCall("listLeads", { organisationId: orgOne.organisationId });
  assert.ok(viewerLeads.leads.some((lead) => lead.id === leadOne.leadId), "viewer can read leads within their organisation");
  await expectCallableFailure(viewerCall("createLead", { organisationId: orgOne.organisationId, campaignId: campaignOne.campaignId, businessName: "Viewer denied lead" }), "functions/permission-denied", "viewer cannot create lead");
  const viewerNotesLead = await callOne("createLead", {
    organisationId: orgOne.organisationId,
    campaignId: campaignOne.campaignId,
    businessName: "Synthetic Viewer Notes Guard Ltd",
    category: "Security regression",
    location: "Manchester",
  });
  const leadBeforeViewerNotesEdit = (await callOne("listLeads", { organisationId: orgOne.organisationId }))
    .leads.find((lead) => lead.id === viewerNotesLead.leadId);
  assert.ok(leadBeforeViewerNotesEdit, "dedicated target lead exists before viewer notes-edit attempt");
  const viewerNotesQuotaBefore = currentQuotaCount("updateLeadNotes", viewer.auth.currentUser.uid);
  await expectCallableFailure(viewerCall("updateLeadNotes", {
    organisationId: orgOne.organisationId, leadId: viewerNotesLead.leadId, notes: "Viewer must not edit",
  }), "functions/permission-denied", "viewer cannot edit lead notes");
  assert.equal(currentQuotaCount("updateLeadNotes", viewer.auth.currentUser.uid), viewerNotesQuotaBefore,
    "role-denied lead notes edit does not consume the viewer's quota");
  const leadAfterViewerNotesEdit = (await callOne("listLeads", { organisationId: orgOne.organisationId }))
    .leads.find((lead) => lead.id === viewerNotesLead.leadId);
  assert.equal(leadAfterViewerNotesEdit?.notes, leadBeforeViewerNotesEdit.notes,
    "role-denied lead notes edit preserves stored notes");
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-no-lead-activity.mjs",
    orgOne.organisationId,
    viewerNotesLead.leadId,
    "Lead notes updated",
  ], { stdio: "inherit" });
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-no-lead-activity.mjs",
    orgOne.organisationId,
    viewerNotesLead.leadId,
    "Lead notes cleared",
  ], { stdio: "inherit" });
  await expectCallableFailure(viewerCall("createCampaign", { organisationId: orgOne.organisationId, name: "Viewer denied campaign", brand: "Example", category: "Painters", location: "Manchester", goal: "Role test" }), "functions/permission-denied", "viewer cannot create campaign");
  const campaignStatusBeforeViewerAttempt = (await callOne("listCampaigns", { organisationId: orgOne.organisationId }))
    .campaigns.find((campaign) => campaign.id === campaignOne.campaignId)?.status;
  const viewerCampaignQuotaBefore = currentQuotaCount("updateCampaignStatus", viewer.auth.currentUser.uid);
  await expectCallableFailure(viewerCall("updateCampaignStatus", {
    organisationId: orgOne.organisationId, campaignId: campaignOne.campaignId, status: "paused",
  }), "functions/permission-denied", "viewer cannot change campaign status");
  assert.equal(currentQuotaCount("updateCampaignStatus", viewer.auth.currentUser.uid), viewerCampaignQuotaBefore,
    "role-denied campaign status update does not consume the viewer's quota");
  const campaignStatusAfterViewerAttempt = (await callOne("listCampaigns", { organisationId: orgOne.organisationId }))
    .campaigns.find((campaign) => campaign.id === campaignOne.campaignId)?.status;
  assert.equal(campaignStatusAfterViewerAttempt, campaignStatusBeforeViewerAttempt,
    "role-denied campaign status update leaves the campaign unchanged");
  const viewerContactEditLead = await callOne("createLead", {
    organisationId: orgOne.organisationId,
    campaignId: campaignOne.campaignId,
    businessName: "Synthetic Viewer Contact Edit Guard Ltd",
    category: "Painters",
    location: "Manchester",
    email: "original@example.test",
  });
  const leadBeforeViewerContactEdit = (await callOne("listLeads", { organisationId: orgOne.organisationId }))
    .leads.find((lead) => lead.id === viewerContactEditLead.leadId);
  assert.ok(leadBeforeViewerContactEdit, "dedicated target lead exists before viewer contact-edit attempt");
  const viewerContactQuotaBefore = currentQuotaCount("updateLeadContact", viewer.auth.currentUser.uid);
  await expectCallableFailure(viewerCall("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: viewerContactEditLead.leadId,
    businessName: "Viewer must not change this name",
    category: leadBeforeViewerContactEdit.category,
    location: leadBeforeViewerContactEdit.location,
    email: "viewer-change@example.test",
  }), "functions/permission-denied", "viewer cannot edit lead contact details");
  assert.equal(currentQuotaCount("updateLeadContact", viewer.auth.currentUser.uid), viewerContactQuotaBefore,
    "role-denied lead contact edit does not consume the viewer's quota");
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-no-lead-activity.mjs",
    orgOne.organisationId,
    viewerContactEditLead.leadId,
    "Lead contact details updated",
  ], { stdio: "inherit" });
  const leadAfterViewerContactEdit = (await callOne("listLeads", { organisationId: orgOne.organisationId }))
    .leads.find((lead) => lead.id === viewerContactEditLead.leadId);
  assert.equal(leadAfterViewerContactEdit?.businessName, leadBeforeViewerContactEdit.businessName,
    "role-denied lead contact edit preserves the business name");
  assert.equal(leadAfterViewerContactEdit?.email, leadBeforeViewerContactEdit.email,
    "role-denied lead contact edit preserves the email");
  assert.equal(leadAfterViewerContactEdit?.contactReviewRevision, leadBeforeViewerContactEdit.contactReviewRevision,
    "role-denied lead contact edit preserves the contact-review revision");
  const viewerSuppressionLead = await callOne("createLead", {
    organisationId: orgOne.organisationId,
    campaignId: campaignOne.campaignId,
    businessName: "Synthetic Viewer Suppression Guard Ltd",
    category: "Painters",
    location: "Manchester",
  });
  await expectCallableFailure(viewerCall("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: viewerSuppressionLead.leadId, doNotContact: true }), "functions/permission-denied", "viewer cannot suppress a lead");
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-no-lead-activity.mjs",
    orgOne.organisationId,
    viewerSuppressionLead.leadId,
    "Lead marked do not contact",
  ], { stdio: "inherit" });
  const afterViewerSuppressionAttempt = await callOne("listLeads", { organisationId: orgOne.organisationId });
  assert.equal(afterViewerSuppressionAttempt.leads.find((lead) => lead.id === viewerSuppressionLead.leadId)?.doNotContact, true, "denied viewer suppression attempt leaves the new lead's default contact restriction unchanged");
  await expectCallableFailure(viewerCall("setLeadSuppression", {
    organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: false,
    contactReviewRevision: await currentContactReviewRevision(leadOne.leadId),
  }), "functions/permission-denied", "viewer cannot clear suppression");
  await expectCallableFailure(viewerCall("createOutreachDraft", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, subject: "Viewer denied", body: "Must not be created" }), "functions/permission-denied", "viewer cannot create outreach draft");

  const draft = await callOne("createOutreachDraft", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, subject: "Test draft", body: "Review before use" });
  assert.equal(draft.sent, false);

  // Confirm member lifecycle permissions and viewer denial on existing records.
  await memberCall("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    businessName: "Synthetic Test Painting Ltd (member verified)",
    category: "Painters",
    location: "Manchester",
    email: "hello@example.test",
  });
  const memberEditedLeadList = await memberCall("listLeads", { organisationId: orgOne.organisationId });
  const memberEditedLead = memberEditedLeadList.leads.find((lead) => lead.id === leadOne.leadId);
  assert.equal(memberEditedLead?.doNotContact, true, "member contact-channel edits require fresh review");
  assert.equal(memberEditedLead?.contactReviewStatus, "pending", "member contact-channel edits invalidate old clearance");
  await expectCallableFailure(memberCall("createOutreachDraft", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    subject: "Fresh review required",
    body: "Must not be created after contact details change",
  }), "functions/failed-precondition", "member cannot draft after contact-channel edit until re-reviewed");
  await clearLeadRestriction(leadOne.leadId, adminCall);
  const memberStatus = await memberCall("updateLeadStatus", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    status: "qualified",
  });
  assert.equal(memberStatus.status, "qualified", "member can update lead lifecycle status");

  const memberDraft = await memberCall("createOutreachDraft", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    subject: "Member-owned test draft",
    body: "Draft only; never sent.",
  });
  const editedMemberDraft = await memberCall("updateOutreachDraft", {
    organisationId: orgOne.organisationId,
    draftId: memberDraft.draftId,
    subject: "Member-edited test draft",
    body: "Updated draft only; never sent.",
  });
  assert.equal(editedMemberDraft.subject, "Member-edited test draft", "member can edit a draft");
  const deletedMemberDraft = await memberCall("deleteOutreachDraft", {
    organisationId: orgOne.organisationId,
    draftId: memberDraft.draftId,
  });
  assert.equal(deletedMemberDraft.deleted, true, "member can delete a draft");

  await expectCallableFailure(viewerCall("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    businessName: "Viewer must not edit",
    category: "Painters",
    location: "Manchester",
  }), "functions/permission-denied", "viewer cannot edit lead contact details");
  const viewerStatusLead = await callOne("createLead", {
    organisationId: orgOne.organisationId,
    campaignId: campaignOne.campaignId,
    businessName: "Synthetic Viewer Status Guard Ltd",
    category: "Security regression",
    location: "Manchester",
  });
  const viewerStatusLeadBefore = (await callOne("listLeads", { organisationId: orgOne.organisationId }))
    .leads.find((lead) => lead.id === viewerStatusLead.leadId);
  assert.ok(viewerStatusLeadBefore, "dedicated target lead exists before viewer status attempt");
  const viewerStatusQuotaBefore = currentQuotaCount("updateLeadStatus", viewer.auth.currentUser.uid);
  await expectCallableFailure(viewerCall("updateLeadStatus", {
    organisationId: orgOne.organisationId,
    leadId: viewerStatusLead.leadId,
    status: "qualified",
  }), "functions/permission-denied", "viewer cannot change lead status");
  assert.equal(currentQuotaCount("updateLeadStatus", viewer.auth.currentUser.uid), viewerStatusQuotaBefore,
    "role-denied lead status change does not consume the viewer's quota");
  const viewerStatusLeadAfter = (await callOne("listLeads", { organisationId: orgOne.organisationId }))
    .leads.find((lead) => lead.id === viewerStatusLead.leadId);
  assert.equal(viewerStatusLeadAfter?.status, viewerStatusLeadBefore.status,
    "role-denied lead status change preserves stored status");
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-no-lead-activity.mjs",
    orgOne.organisationId,
    viewerStatusLead.leadId,
    "Lead status changed to qualified",
  ], { stdio: "inherit" });
  const viewerDraftBefore = (await callOne("listOutreachDrafts", {
    organisationId: orgOne.organisationId,
  })).drafts.find((item) => item.id === draft.draftId);
  assert.ok(viewerDraftBefore, "owner-created draft exists before viewer mutation attempts");
  const viewerDraftEditQuotaBefore = currentQuotaCount("updateOutreachDraft", viewer.auth.currentUser.uid);
  await expectCallableFailure(viewerCall("updateOutreachDraft", {
    organisationId: orgOne.organisationId,
    draftId: draft.draftId,
    subject: "Viewer must not edit",
    body: "Must remain unchanged.",
  }), "functions/permission-denied", "viewer cannot edit an outreach draft");
  assert.equal(currentQuotaCount("updateOutreachDraft", viewer.auth.currentUser.uid), viewerDraftEditQuotaBefore,
    "role-denied draft edit does not consume the viewer's quota");
  const viewerDraftAfterEditAttempt = (await callOne("listOutreachDrafts", {
    organisationId: orgOne.organisationId,
  })).drafts.find((item) => item.id === draft.draftId);
  assert.equal(viewerDraftAfterEditAttempt?.subject, viewerDraftBefore.subject,
    "role-denied draft edit preserves stored subject");
  assert.equal(viewerDraftAfterEditAttempt?.body, viewerDraftBefore.body,
    "role-denied draft edit preserves stored body");
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-no-lead-activity.mjs",
    orgOne.organisationId,
    leadOne.leadId,
    "Outreach draft updated; not sent",
  ], { stdio: "inherit" });

  const viewerDraftDeleteQuotaBefore = currentQuotaCount("deleteOutreachDraft", viewer.auth.currentUser.uid);
  await expectCallableFailure(viewerCall("deleteOutreachDraft", {
    organisationId: orgOne.organisationId,
    draftId: draft.draftId,
  }), "functions/permission-denied", "viewer cannot delete an outreach draft");
  assert.equal(currentQuotaCount("deleteOutreachDraft", viewer.auth.currentUser.uid), viewerDraftDeleteQuotaBefore,
    "role-denied draft deletion does not consume the viewer's quota");
  const viewerDraftAfterDeleteAttempt = (await callOne("listOutreachDrafts", {
    organisationId: orgOne.organisationId,
  })).drafts.find((item) => item.id === draft.draftId);
  assert.ok(viewerDraftAfterDeleteAttempt, "role-denied draft deletion preserves the draft record");
  assert.equal(viewerDraftAfterDeleteAttempt?.subject, viewerDraftBefore.subject,
    "role-denied draft deletion preserves stored subject");
  assert.equal(viewerDraftAfterDeleteAttempt?.body, viewerDraftBefore.body,
    "role-denied draft deletion preserves stored body");

  // Cursor tokens are untrusted client input. Reject wrong JSON types and oversized strings
  // consistently before attempting to resolve a Firestore document path.
  for (const [callableName, payload] of [
    ["listMyOrganisations", {}],
    ["listCampaigns", { organisationId: orgOne.organisationId }],
    ["listLeads", { organisationId: orgOne.organisationId }],
    ["listOutreachDrafts", { organisationId: orgOne.organisationId }],
  ]) {
    await expectCallableFailure(
      callOne(callableName, { ...payload, pageToken: { path: "organisations/forged/path" } }),
      "functions/invalid-argument",
      `${callableName} rejects an object page token`,
    );
    await expectCallableFailure(
      callOne(callableName, { ...payload, pageToken: "x".repeat(513) }),
      "functions/invalid-argument",
      `${callableName} rejects an oversized page token`,
    );
  }

  // Existing malformed and cross-collection paths must also fail closed.
  await expectCallableFailure(callOne("listMyOrganisations", { pageToken: "organisations/org-1/leads/lead-1" }), "functions/invalid-argument", "invalid organisation cursor");
  await expectCallableFailure(callOne("listCampaigns", { organisationId: orgOne.organisationId, pageToken: `organisations/${orgOne.organisationId}/leads/${leadOne.leadId}` }), "functions/invalid-argument", "campaign cursor from another collection");
  await expectCallableFailure(callOne("listLeads", { organisationId: orgOne.organisationId, pageToken: `organisations/${orgOne.organisationId}/outreachDrafts/not-a-lead` }), "functions/invalid-argument", "lead cursor from another collection");
  await expectCallableFailure(callOne("listOutreachDrafts", { organisationId: orgOne.organisationId, pageToken: `organisations/${orgOne.organisationId}/campaigns/not-a-draft` }), "functions/invalid-argument", "draft cursor from another collection");
  await expectCallableFailure(callOne("listCampaigns", { organisationId: orgOne.organisationId, pageToken: `organisations/${orgOne.organisationId}/campaigns/missing-campaign` }), "functions/invalid-argument", "campaign cursor whose document no longer exists");
  await expectCallableFailure(callOne("listLeads", { organisationId: orgOne.organisationId, pageToken: `organisations/${orgOne.organisationId}/leads/missing-lead` }), "functions/invalid-argument", "lead cursor whose document no longer exists");
  await expectCallableFailure(callOne("listOutreachDrafts", { organisationId: orgOne.organisationId, pageToken: `organisations/${orgOne.organisationId}/outreachDrafts/missing-draft` }), "functions/invalid-argument", "draft cursor whose document no longer exists");

  // Existing cursor paths are still invalid if their stored ordering field is malformed.
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-invalid-timestamp-cursors.mjs",
    orgOne.organisationId,
  ], { stdio: "inherit" });
  await expectCallableFailure(
    callOne("listCampaigns", { organisationId: orgOne.organisationId, pageToken: `organisations/${orgOne.organisationId}/campaigns/invalid-timestamp-campaign` }),
    "functions/invalid-argument",
    "campaign cursor with malformed createdAt",
  );
  await expectCallableFailure(
    callOne("listLeads", { organisationId: orgOne.organisationId, pageToken: `organisations/${orgOne.organisationId}/leads/invalid-timestamp-lead` }),
    "functions/invalid-argument",
    "lead cursor with malformed createdAt",
  );
  await expectCallableFailure(
    callOne("listOutreachDrafts", { organisationId: orgOne.organisationId, pageToken: `organisations/${orgOne.organisationId}/outreachDrafts/invalid-timestamp-draft` }),
    "functions/invalid-argument",
    "draft cursor with malformed createdAt",
  );

  // A pagination cursor must reference a valid membership and parent organisation.
  // Malformed memberships are rejected as cursors and can never grant organisation access.
  // The fixture is restricted to the guarded local emulator project.
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-invalid-membership.mjs",
    "cursor-fixture-org",
    first.auth.currentUser.uid,
  ], { stdio: "inherit" });
  await expectCallableFailure(
    callOne("listMyOrganisations", {
      pageToken: `organisations/cursor-fixture-org/members/${first.auth.currentUser.uid}`,
    }),
    "functions/invalid-argument",
    "organisation cursor whose membership record is malformed",
  );

  // A corrupt owner-role membership must not override the parent organisation's ownerUid.
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-owner-mismatch.mjs",
    first.auth.currentUser.uid,
  ], { stdio: "inherit" });
  await expectCallableFailure(
    callOne("listMyOrganisations", { pageToken: `organisations/owner-mismatch-org/members/${first.auth.currentUser.uid}` }),
    "functions/invalid-argument",
    "organisation cursor whose owner membership conflicts with parent ownerUid",
  );
  await expectCallableFailure(
    callOne("listCampaigns", { organisationId: "owner-mismatch-org" }),
    "functions/permission-denied",
    "owner membership that conflicts with parent ownerUid",
  );
  const ownerMismatchOrganisations = await callOne("listMyOrganisations", {});
  assert.equal(
    ownerMismatchOrganisations.organisations.some((item) => item.organisationId === "owner-mismatch-org"),
    false,
    "owner membership conflicting with parent ownerUid is omitted",
  );

  // Owner-role membership must also fail closed when authoritative ownerUid metadata is absent.
  await expectCallableFailure(
    callOne("listCampaigns", { organisationId: "owner-missing-metadata-org" }),
    "functions/permission-denied",
    "owner membership when parent ownerUid metadata is missing",
  );
  const missingOwnerMetadataOrganisations = await callOne("listMyOrganisations", {});
  assert.equal(
    missingOwnerMetadataOrganisations.organisations.some((item) => item.organisationId === "owner-missing-metadata-org"),
    false,
    "owner membership without parent ownerUid metadata is omitted",
  );

  // The same corrupt owner membership must not authorise writes through either
  // the campaign or lead mutation paths, even though the child campaign exists.
  await expectCallableFailure(callOne("createCampaign", {
    organisationId: "owner-mismatch-org",
    name: "Must be denied",
    category: "Painters",
    location: "Manchester",
  }), "functions/permission-denied", "campaign creation with owner membership conflicting with parent ownerUid");
  await expectCallableFailure(callOne("updateCampaignStatus", {
    organisationId: "owner-mismatch-org",
    campaignId: "fixture-campaign",
    status: "paused",
  }), "functions/permission-denied", "campaign update with owner membership conflicting with parent ownerUid");
  await expectCallableFailure(callOne("createLead", {
    organisationId: "owner-mismatch-org",
    campaignId: "fixture-campaign",
    businessName: "Must be denied",
    category: "Painters",
    location: "Manchester",
  }), "functions/permission-denied", "lead creation with owner membership conflicting with parent ownerUid");
  await expectCallableFailure(callOne("setLeadSuppression", {
    organisationId: "owner-mismatch-org",
    leadId: "fixture-lead",
    doNotContact: true,
  }), "functions/permission-denied", "suppression update with owner membership conflicting with parent ownerUid");
  await expectCallableFailure(callOne("updateLeadContact", {
    organisationId: "owner-mismatch-org",
    leadId: "fixture-lead",
    businessName: "Must be denied",
    category: "Painters",
    location: "Manchester",
  }), "functions/permission-denied", "lead contact update with owner membership conflicting with parent ownerUid");
  await expectCallableFailure(callOne("updateLeadNotes", {
    organisationId: "owner-mismatch-org",
    leadId: "fixture-lead",
    notes: "Must be denied",
  }), "functions/permission-denied", "lead notes update with owner membership conflicting with parent ownerUid");
  await expectCallableFailure(callOne("updateLeadStatus", {
    organisationId: "owner-mismatch-org",
    leadId: "fixture-lead",
    status: "qualified",
  }), "functions/permission-denied", "lead status update with owner membership conflicting with parent ownerUid");
  await expectCallableFailure(callOne("createOutreachDraft", {
    organisationId: "owner-mismatch-org",
    leadId: "fixture-lead",
    subject: "Must be denied",
    body: "Must not be created",
  }), "functions/permission-denied", "draft creation with owner membership conflicting with parent ownerUid");
  await expectCallableFailure(callOne("updateOutreachDraft", {
    organisationId: "owner-mismatch-org",
    draftId: "fixture-draft",
    subject: "Must be denied",
    body: "Must not be updated",
  }), "functions/permission-denied", "draft update with owner membership conflicting with parent ownerUid");
  await expectCallableFailure(callOne("deleteOutreachDraft", {
    organisationId: "owner-mismatch-org",
    draftId: "fixture-draft",
  }), "functions/permission-denied", "draft deletion with owner membership conflicting with parent ownerUid");

  // Orphaned subcollections must not remain accessible after the organisation parent is deleted.
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-orphaned-organisation.mjs",
    first.auth.currentUser.uid,
  ], { stdio: "inherit" });
  await expectCallableFailure(
    callOne("listCampaigns", { organisationId: "orphaned-org" }),
    "functions/permission-denied",
    "campaign listing under deleted organisation parent",
  );
  await expectCallableFailure(
    callOne("listLeads", { organisationId: "orphaned-org" }),
    "functions/permission-denied",
    "lead listing under deleted organisation parent",
  );
  await expectCallableFailure(
    callOne("listOutreachDrafts", { organisationId: "orphaned-org" }),
    "functions/permission-denied",
    "draft listing under deleted organisation parent",
  );
  await expectCallableFailure(
    callOne("createLead", {
      organisationId: "orphaned-org",
      campaignId: "orphaned-campaign",
      businessName: "Must not persist",
      category: "Painters",
      location: "Manchester",
    }),
    "functions/permission-denied",
    "lead creation under deleted organisation parent",
  );
  await expectCallableFailure(
    callOne("setLeadSuppression", {
      organisationId: "orphaned-org",
      leadId: "orphaned-lead",
      doNotContact: false,
      contactReviewRevision: 0,
    }),
    "functions/permission-denied",
    "suppression update under deleted organisation parent",
  );

  // A restriction added after draft creation must be reflected by list and enforced by update.
  await callOne("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: true });
  const blockedBeforeContactEditList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const blockedBeforeContactEdit = blockedBeforeContactEditList.leads.find((lead) => lead.id === leadOne.leadId);
  await callOne("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    businessName: "Synthetic Test Painting Ltd (blocked contact edit)",
    category: "Painters",
    location: "Manchester",
    email: "blocked-review-change@example.test",
    phone: blockedBeforeContactEdit?.phone ?? "",
    website: blockedBeforeContactEdit?.website ?? "",
  });
  const blockedAfterContactEditList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const blockedAfterContactEdit = blockedAfterContactEditList.leads.find((lead) => lead.id === leadOne.leadId);
  assert.equal(blockedAfterContactEdit?.doNotContact, true, "changing a blocked lead's contact channel cannot clear the restriction");
  assert.equal(blockedAfterContactEdit?.contactReviewStatus, "blocked", "changing a blocked lead's contact channel preserves the blocked review state");
  const suppressedDraftList = await callOne("listOutreachDrafts", { organisationId: orgOne.organisationId });
  const suppressedDraft = suppressedDraftList.drafts.find((item) => item.id === draft.draftId);
  assert.ok(suppressedDraft, "the original draft remains present after the lead restriction changes");
  assert.equal(suppressedDraft.leadSuppressed, true);
  assert.equal(suppressedDraft.requiresReview, true);
  await expectCallableFailure(callOne("updateOutreachDraft", { organisationId: orgOne.organisationId, draftId: draft.draftId, subject: "Blocked update", body: "Must not be edited" }), "functions/failed-precondition", "suppression added after draft creation");
  await expectCallableFailure(callOne("createOutreachDraft", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, subject: "Blocked new draft", body: "Must not be created while suppressed" }), "functions/failed-precondition", "suppressed lead cannot create a new draft");
  await callOne("updateLeadNotes", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, notes: "Administrative note while contact is restricted" });
  const suppressedLeadAfterNotes = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const restrictedLeadAfterNotes = suppressedLeadAfterNotes.leads.find((lead) => lead.id === leadOne.leadId);
  assert.equal(restrictedLeadAfterNotes?.doNotContact, true, "editing notes cannot clear do-not-contact");
  assert.equal(restrictedLeadAfterNotes?.contactReviewStatus, "blocked", "editing notes preserves blocked review status");
  await expectCallableFailure(callOne("updateLeadStatus", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, status: "contacted" }), "functions/failed-precondition", "suppressed lead cannot be marked contacted");
  await expectCallableFailure(callOne("createOutreachDraft", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, subject: "Still blocked after note edit", body: "Must remain blocked" }), "functions/failed-precondition", "notes edit cannot reopen outreach eligibility");

  await clearLeadRestriction(leadOne.leadId);
  await callOne("updateOutreachDraft", { organisationId: orgOne.organisationId, draftId: draft.draftId, subject: "Updated test draft", body: "Still draft only" });
  const draftList = await callOne("listOutreachDrafts", { organisationId: orgOne.organisationId });
  const updatedDraft = draftList.drafts.find((item) => item.id === draft.draftId);
  assert.ok(updatedDraft, "the updated original draft remains present");
  assert.equal(updatedDraft.subject, "Updated test draft");
  assert.equal(updatedDraft.sent, undefined);

  // Exercise real server-side pagination beyond the 100-record page size.
  // Each lead is synthetic and remains blocked pending contact review.
  for (let index = 0; index < 100; index += 1) {
    await callOne("createLead", {
      organisationId: orgOne.organisationId,
      campaignId: campaignOne.campaignId,
      businessName: `Synthetic Pagination Lead ${String(index + 1).padStart(3, "0")}`,
      category: "Painters",
      location: "Manchester",
    });
  }
  const firstLeadPage = await callOne("listLeads", { organisationId: orgOne.organisationId });
  assert.equal(firstLeadPage.leads.length, 100, "lead pagination returns a maximum of 100 records");
  assert.equal(firstLeadPage.hasMoreLeads, true, "lead pagination signals another page");
  assert.ok(firstLeadPage.nextPageToken, "lead pagination supplies a cursor");
  const secondLeadPage = await callOne("listLeads", {
    organisationId: orgOne.organisationId,
    pageToken: firstLeadPage.nextPageToken,
  });
  assert.ok(secondLeadPage.leads.length > 0, "the second lead page returns remaining records");
  assert.equal(secondLeadPage.hasMoreLeads, false, "the final lead page has no further cursor");
  assert.equal(secondLeadPage.nextPageToken, null);
  const paginatedLeadIds = [...firstLeadPage.leads, ...secondLeadPage.leads].map((lead) => lead.id);
  assert.equal(new Set(paginatedLeadIds).size, paginatedLeadIds.length, "lead pages do not duplicate records");
  assert.ok(paginatedLeadIds.length > 100, "lead pagination returns records beyond the first page");

  // Exercise campaign pagination beyond the same 100-record page boundary.
  // Add enough synthetic campaigns to cross the page boundary; existing setup
  // may create additional records, so assertions below avoid fixed totals.
  for (let index = 0; index < 99; index += 1) {
    await callOne("createCampaign", {
      organisationId: orgOne.organisationId,
      name: `Synthetic Pagination Campaign ${String(index + 1).padStart(3, "0")}`,
      brand: "Example",
      category: "Painters",
      location: "Manchester",
      goal: "Pagination integration test",
    });
  }
  const firstCampaignPage = await callOne("listCampaigns", { organisationId: orgOne.organisationId });
  assert.equal(firstCampaignPage.campaigns.length, 100, "campaign pagination returns a maximum of 100 records");
  assert.equal(firstCampaignPage.hasMoreCampaigns, true, "campaign pagination signals another page");
  assert.ok(firstCampaignPage.nextPageToken, "campaign pagination supplies a cursor");
  const secondCampaignPage = await callOne("listCampaigns", {
    organisationId: orgOne.organisationId,
    pageToken: firstCampaignPage.nextPageToken,
  });
  assert.ok(secondCampaignPage.campaigns.length > 0, "the second campaign page returns remaining records");
  assert.equal(secondCampaignPage.hasMoreCampaigns, false, "the final campaign page has no further cursor");
  assert.equal(secondCampaignPage.nextPageToken, null);
  const paginatedCampaignIds = [...firstCampaignPage.campaigns, ...secondCampaignPage.campaigns].map((campaign) => campaign.id);
  assert.equal(new Set(paginatedCampaignIds).size, paginatedCampaignIds.length, "campaign pages do not duplicate records");
  assert.ok(paginatedCampaignIds.length > 100, "campaign pagination returns records beyond the first page");

  // Exercise draft pagination beyond the 100-record page boundary. Reuse the cleared
  // synthetic lead so this specifically tests paging rather than contact-gate setup.
  for (let index = 0; index < 100; index += 1) {
    await callOne("createOutreachDraft", {
      organisationId: orgOne.organisationId,
      leadId: leadOne.leadId,
      subject: `Synthetic Pagination Draft ${String(index + 1).padStart(3, "0")}`,
      body: "Synthetic draft pagination integration test; not sent.",
    });
  }
  const firstDraftPage = await callOne("listOutreachDrafts", { organisationId: orgOne.organisationId });
  assert.equal(firstDraftPage.drafts.length, 100, "draft pagination returns a maximum of 100 records");
  assert.equal(firstDraftPage.hasMoreDrafts, true, "draft pagination signals another page");
  assert.ok(firstDraftPage.nextPageToken, "draft pagination supplies a cursor");
  const secondDraftPage = await callOne("listOutreachDrafts", {
    organisationId: orgOne.organisationId,
    pageToken: firstDraftPage.nextPageToken,
  });
  assert.ok(secondDraftPage.drafts.length > 0, "the second draft page returns remaining records");
  assert.equal(secondDraftPage.hasMoreDrafts, false, "the final draft page has no further cursor");
  assert.equal(secondDraftPage.nextPageToken, null);
  const paginatedDraftIds = [...firstDraftPage.drafts, ...secondDraftPage.drafts].map((item) => item.id);
  assert.equal(new Set(paginatedDraftIds).size, paginatedDraftIds.length, "draft pages do not duplicate records");
  assert.ok(paginatedDraftIds.length > 100, "draft pagination returns records beyond the first page");
  assert.ok([...firstDraftPage.drafts, ...secondDraftPage.drafts].every((item) => item.sent !== true), "all generated drafts remain unsent");

  await expectCallableFailure(getDoc(doc(first.firestore, `organisations/${orgOne.organisationId}`)), "permission-denied", "direct client Firestore read denial");

  const second = connectClient(initializeApp(firebaseConfig, "tenant-two"));
  apps.push(second.app);
  await createUserWithEmailAndPassword(second.auth, "tenant-two@example.test", "testing-password-two");
  const callTwo = (name, payload = {}) => (async () => {
    console.log(`CALL ${name} (tenant two)`);
    const response = await httpsCallable(second.functions, name, { timeout: 30000 })(payload);
    console.log(`OK ${name} (tenant two)`);
    return response.data;
  })();
  await expectCallableFailure(callTwo("listLeads", { organisationId: orgOne.organisationId }), "functions/permission-denied", "cross-tenant lead listing denial");
  const orgTwo = await callTwo("createOrganisation", { name: "Tenant Two" });
  // A cursor scoped to another tenant must be rejected before its target document is read.
  await expectCallableFailure(callOne("listCampaigns", { organisationId: orgOne.organisationId, pageToken: `organisations/${orgTwo.organisationId}/campaigns/cursor-only` }), "functions/invalid-argument", "campaign cursor from another organisation");
  await expectCallableFailure(callOne("listLeads", { organisationId: orgOne.organisationId, pageToken: `organisations/${orgTwo.organisationId}/leads/cursor-only` }), "functions/invalid-argument", "lead cursor from another organisation");
  await expectCallableFailure(callOne("listOutreachDrafts", { organisationId: orgOne.organisationId, pageToken: `organisations/${orgTwo.organisationId}/outreachDrafts/cursor-only` }), "functions/invalid-argument", "draft cursor from another organisation");
  await expectCallableFailure(callTwo("listCampaigns", { organisationId: orgOne.organisationId }), "functions/permission-denied", "cross-tenant campaign listing denial");
  await expectCallableFailure(callTwo("listOutreachDrafts", { organisationId: orgOne.organisationId }), "functions/permission-denied", "cross-tenant outreach draft listing denial");
  await expectCallableFailure(callTwo("createLead", { organisationId: orgTwo.organisationId, campaignId: campaignOne.campaignId, businessName: "Cross Tenant Attempt" }), "functions/not-found", "cross-tenant campaign reference denial");
  await expectCallableFailure(callTwo("createOutreachDraft", { organisationId: orgTwo.organisationId, leadId: leadOne.leadId, subject: "Cross tenant", body: "Must not be created" }), "functions/not-found", "cross-tenant lead reference denial");
  await expectCallableFailure(callTwo("updateOutreachDraft", { organisationId: orgTwo.organisationId, draftId: draft.draftId, subject: "Cross tenant", body: "Must not be updated" }), "functions/not-found", "cross-tenant draft update denial");
  await expectCallableFailure(callTwo("deleteOutreachDraft", { organisationId: orgTwo.organisationId, draftId: draft.draftId }), "functions/not-found", "cross-tenant draft delete denial");

  // Create a fresh victim draft after the pagination fixtures so the owner-list
  // verification below is guaranteed to find it on the first page.
  const victimDraft = await callOne("createOutreachDraft", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    subject: "Cross-tenant victim draft",
    body: "Synthetic integrity fixture; not sent.",
  });
  // Explicitly target the victim tenant on every campaign/draft write path.
  // These checks complement foreign-record-ID checks by exercising membership denial
  // before any tenant-owned record is read or mutated.
  await expectCallableFailure(callTwo("createCampaign", {
    organisationId: orgOne.organisationId,
    name: "Cross-tenant campaign creation attempt",
    brand: "Example",
    category: "Painters",
    location: "Manchester",
    goal: "Must be denied",
  }), "functions/permission-denied", "cross-tenant campaign creation denial");
  await expectCallableFailure(callTwo("createOutreachDraft", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    subject: "Cross-tenant draft creation attempt",
    body: "Must be denied",
  }), "functions/permission-denied", "cross-tenant draft creation denial");
  await expectCallableFailure(callTwo("updateOutreachDraft", {
    organisationId: orgOne.organisationId,
    draftId: victimDraft.draftId,
    subject: "Cross-tenant draft edit attempt",
    body: "Must be denied",
  }), "functions/permission-denied", "cross-tenant draft update against victim tenant denial");
  await expectCallableFailure(callTwo("deleteOutreachDraft", {
    organisationId: orgOne.organisationId,
    draftId: victimDraft.draftId,
  }), "functions/permission-denied", "cross-tenant draft deletion against victim tenant denial");
  const victimCampaignsAfterDeniedWrites = await callOne("listCampaigns", { organisationId: orgOne.organisationId });
  assert.equal(
    victimCampaignsAfterDeniedWrites.campaigns.some((item) => item.name === "Cross-tenant campaign creation attempt"),
    false,
    "denied cross-tenant campaign creation leaves no campaign",
  );
  const victimDraftsAfterDeniedWrites = await callOne("listOutreachDrafts", { organisationId: orgOne.organisationId });
  assert.equal(victimDraftsAfterDeniedWrites.drafts.find((item) => item.id === victimDraft.draftId)?.subject, victimDraft.subject,
    "denied cross-tenant draft edit leaves subject unchanged");
  assert.ok(victimDraftsAfterDeniedWrites.drafts.some((item) => item.id === victimDraft.draftId),
    "denied cross-tenant draft deletion leaves original draft present");

  // Mutation endpoints must independently enforce tenant membership, not merely
  // rely on the UI or on read/list authorization.
  await expectCallableFailure(callTwo("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    businessName: "Cross-tenant mutation attempt",
    category: "Painters",
    location: "Manchester",
  }), "functions/permission-denied", "cross-tenant lead contact mutation denial");
  await expectCallableFailure(callTwo("updateLeadNotes", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    notes: "Cross-tenant mutation attempt",
  }), "functions/permission-denied", "cross-tenant lead notes mutation denial");
  await expectCallableFailure(callTwo("updateLeadStatus", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    status: "qualified",
  }), "functions/permission-denied", "cross-tenant lead status mutation denial");
  await expectCallableFailure(callTwo("setLeadSuppression", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    doNotContact: true,
  }), "functions/permission-denied", "cross-tenant suppression mutation denial");
  await expectCallableFailure(callTwo("updateCampaignStatus", {
    organisationId: orgOne.organisationId,
    campaignId: campaignOne.campaignId,
    status: "paused",
  }), "functions/permission-denied", "cross-tenant campaign status mutation denial");

  // Missing or deleted records must return controlled not-found/precondition
  // errors instead of accidentally updating a different tenant's record.
  const missingLeadId = "missing-lead-record";
  const missingCampaignId = "missing-campaign-record";
  const missingDraftId = "missing-draft-record";
  await expectCallableFailure(callOne("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: missingLeadId,
    businessName: "Missing lead test",
    category: "Painters",
    location: "Manchester",
  }), "functions/not-found", "updating a missing lead");
  await expectCallableFailure(callOne("updateLeadNotes", {
    organisationId: orgOne.organisationId,
    leadId: missingLeadId,
    notes: "Must not create a missing lead",
  }), "functions/not-found", "updating notes on a missing lead");
  await expectCallableFailure(callOne("updateLeadStatus", {
    organisationId: orgOne.organisationId,
    leadId: missingLeadId,
    status: "qualified",
  }), "functions/not-found", "changing status on a missing lead");
  await expectCallableFailure(callOne("setLeadSuppression", {
    organisationId: orgOne.organisationId,
    leadId: missingLeadId,
    doNotContact: true,
  }), "functions/not-found", "changing suppression on a missing lead");
  // Failed contact-review attempts must not leave an activity-log entry.
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-no-lead-activity.mjs",
    orgOne.organisationId,
    missingLeadId,
  ], { stdio: "inherit" });
  await expectCallableFailure(callOne("updateCampaignStatus", {
    organisationId: orgOne.organisationId,
    campaignId: missingCampaignId,
    status: "paused",
  }), "functions/not-found", "updating a missing campaign");
  await expectCallableFailure(callOne("createLead", {
    organisationId: orgOne.organisationId,
    campaignId: missingCampaignId,
    businessName: "Missing campaign lead test",
    category: "Painters",
    location: "Manchester",
  }), "functions/not-found", "creating a lead for a missing campaign");
  await expectCallableFailure(callOne("updateOutreachDraft", {
    organisationId: orgOne.organisationId,
    draftId: missingDraftId,
    subject: "Missing draft",
    body: "Must not create a missing draft",
  }), "functions/not-found", "updating a missing draft");
  await expectCallableFailure(callOne("deleteOutreachDraft", {
    organisationId: orgOne.organisationId,
    draftId: missingDraftId,
  }), "functions/not-found", "deleting a missing draft");
  await expectCallableFailure(callOne("createOutreachDraft", {
    organisationId: orgOne.organisationId,
    leadId: missingLeadId,
    subject: "Missing lead",
    body: "Must not create a draft without a lead",
  }), "functions/not-found", "creating a draft for a missing lead");

  // Inject malformed legacy records using a guarded Admin SDK fixture; callable
  // reads must flag them for review, updates must fail closed, and deletion must
  // remain available so operators can clean up an orphaned record.
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-legacy-drafts.mjs",
    orgOne.organisationId,
    leadOne.leadId,
    campaignOne.campaignId,
  ], { stdio: "inherit", env: process.env });
  const legacyDraftList = await callOne("listOutreachDrafts", { organisationId: orgOne.organisationId });
  const malformedCampaignFields = (await callOne("listCampaigns", { organisationId: orgOne.organisationId }))
    .campaigns.find((item) => item.id === "legacy-malformed-campaign-fields");
  assert.ok(malformedCampaignFields, "malformed legacy campaign remains visible for review");
  for (const field of ["name", "category", "location", "brand", "goal"]) {
    assert.equal(typeof malformedCampaignFields[field], "string", `malformed campaign ${field} is serialized as a string`);
  }
  assert.equal(malformedCampaignFields.name, "", "non-string campaign name is not exposed");
  assert.equal(malformedCampaignFields.status, "unknown", "invalid campaign status is not exposed as a trusted status");
  const malformedLeadFields = (await callOne("listLeads", { organisationId: orgOne.organisationId }))
    .leads.find((item) => item.id === "legacy-malformed-list-fields");
  assert.ok(malformedLeadFields, "malformed legacy lead remains visible for review");
  for (const field of ["campaignId", "businessName", "category", "location", "website", "email", "phone", "source", "status", "notes"]) {
    assert.equal(typeof malformedLeadFields[field], "string", `malformed lead ${field} is serialized as a string`);
  }
  assert.equal(malformedLeadFields.businessName, "", "non-string lead business name is not exposed");
  assert.equal(malformedLeadFields.campaignId, "", "invalid campaign reference is not exposed");
  assert.equal(malformedLeadFields.status, "unknown", "invalid lead status is not exposed as a trusted status");
  assert.equal(malformedLeadFields.score, 0, "non-numeric lead score falls back to zero");
  assert.deepEqual(malformedLeadFields.scoreReasons, [], "non-array score reasons are not exposed");
  assert.equal(malformedLeadFields.doNotContact, true, "malformed lead remains suppressed");
  assert.equal(malformedLeadFields.contactRestrictionVerified, false, "malformed lead is not marked contact-verified");
  const orphanLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-orphan-draft");
  const mismatchedLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-mismatched-campaign-draft");
  // Even a legacy lead marked internally cleared must not get a new draft if its campaign record is gone.
  await expectCallableFailure(callOne("createOutreachDraft", {
    organisationId: orgOne.organisationId,
    leadId: "legacy-missing-campaign-lead",
    subject: "Missing campaign must block draft",
    body: "Must not be created without the referenced campaign",
  }), "functions/failed-precondition", "draft creation for a cleared legacy lead with a missing campaign");
  const missingCampaignLeadBefore = (await callOne("listLeads", {
    organisationId: orgOne.organisationId,
  })).leads.find((item) => item.id === "legacy-missing-campaign-lead");
  assert.ok(missingCampaignLeadBefore, "legacy lead with a missing campaign exists before the rejected status update");
  await expectCallableFailure(callOne("updateLeadStatus", {
    organisationId: orgOne.organisationId,
    leadId: "legacy-missing-campaign-lead",
    status: "contacted",
  }), "functions/failed-precondition", "marking a cleared legacy lead contacted when its campaign is missing");
  const missingCampaignLeadAfter = (await callOne("listLeads", {
    organisationId: orgOne.organisationId,
  })).leads.find((item) => item.id === "legacy-missing-campaign-lead");
  assert.equal(missingCampaignLeadAfter?.status, missingCampaignLeadBefore.status,
    "failed status update for a lead with a missing campaign leaves lead status unchanged");
  const missingCampaignLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-missing-campaign-record-draft");
  const nonDraftStatusLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-non-draft-status");
  const missingStatusLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-missing-status");
  const missingRestrictionLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-missing-restriction-draft");
  const malformedRestrictionLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-malformed-restriction-draft");
  const malformedContentLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-malformed-content-draft");
  const malformedTimestampLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-malformed-timestamp-draft");
  await expectCallableFailure(callOne("createOutreachDraft", {
    organisationId: orgOne.organisationId,
    leadId: "legacy-missing-restriction-lead",
    subject: "Missing restriction must block",
    body: "Must not be created without a verified restriction",
  }), "functions/failed-precondition", "draft creation for a lead with a missing doNotContact value");
  await expectCallableFailure(callOne("createOutreachDraft", {
    organisationId: orgOne.organisationId,
    leadId: "legacy-malformed-restriction-lead",
    subject: "Malformed restriction must block",
    body: "Must not be created with a malformed restriction",
  }), "functions/failed-precondition", "draft creation for a lead with a malformed doNotContact value");
  await expectCallableFailure(callOne("updateLeadStatus", {
    organisationId: orgOne.organisationId,
    leadId: "legacy-missing-restriction-lead",
    status: "contacted",
  }), "functions/failed-precondition", "marking a lead with a missing doNotContact value contacted");
  await expectCallableFailure(callOne("updateLeadStatus", {
    organisationId: orgOne.organisationId,
    leadId: "legacy-malformed-restriction-lead",
    status: "contacted",
  }), "functions/failed-precondition", "marking a lead with a malformed doNotContact value contacted");
  assert.ok(missingRestrictionLegacyDraft, "legacy draft with missing contact restriction remains visible for review");
  assert.equal(missingRestrictionLegacyDraft.requiresReview, true, "missing contact restriction requires review");
  assert.match(missingRestrictionLegacyDraft.reviewReason, /restriction could not be verified/i);
  assert.ok(malformedRestrictionLegacyDraft, "legacy draft with malformed contact restriction remains visible for review");
  assert.equal(malformedRestrictionLegacyDraft.requiresReview, true, "malformed contact restriction requires review");
  assert.match(malformedRestrictionLegacyDraft.reviewReason, /restriction could not be verified/i);
  assert.ok(malformedContentLegacyDraft, "legacy draft with malformed subject/body remains visible for review");
  assert.equal(malformedContentLegacyDraft.subject, "", "malformed non-string subject is not exposed to the UI");
  assert.equal(malformedContentLegacyDraft.body, "", "malformed non-string body is not exposed to the UI");
  assert.equal(malformedContentLegacyDraft.requiresReview, true, "malformed draft content requires review");
  assert.match(malformedContentLegacyDraft.reviewReason, /subject or body is missing or malformed/i);
  assert.ok(malformedTimestampLegacyDraft, "legacy draft with malformed timestamp remains visible");
  assert.equal(malformedTimestampLegacyDraft.createdAt, null, "malformed persisted timestamp serializes as null instead of failing the list");
  const legacyRestrictionLeads = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const missingRestrictionLead = legacyRestrictionLeads.leads.find((item) => item.id === "legacy-missing-restriction-lead");
  const malformedRestrictionLead = legacyRestrictionLeads.leads.find((item) => item.id === "legacy-malformed-restriction-lead");
  assert.ok(missingRestrictionLead, "lead with missing restriction remains visible");
  assert.equal(missingRestrictionLead.contactRestrictionVerified, false, "missing restriction is not presented as verified");
  assert.equal(missingRestrictionLead.contactReviewStatus, "pending", "missing restriction is normalised to pending review");
  assert.ok(malformedRestrictionLead, "lead with malformed restriction remains visible");
  assert.equal(malformedRestrictionLead.contactRestrictionVerified, false, "malformed restriction is not presented as verified");
  assert.equal(malformedRestrictionLead.contactReviewStatus, "pending", "malformed restriction is normalised to pending review");

  // Ordinary contact and notes edits must not implicitly repair an absent or malformed
  // authoritative contact restriction on legacy records.
  await callOne("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: "legacy-missing-restriction-lead",
    businessName: "Synthetic Missing Restriction Lead (edited)",
    category: "Painter and decorator",
    location: "Test location",
    email: "review@example.test",
  });
  await callOne("updateLeadNotes", {
    organisationId: orgOne.organisationId,
    leadId: "legacy-missing-restriction-lead",
    notes: "Reviewed fields; restriction remains unverified.",
  });
  await callOne("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: "legacy-malformed-restriction-lead",
    businessName: "Synthetic Malformed Restriction Lead (edited)",
    category: "Painter and decorator",
    location: "Test location",
    email: "review@example.test",
  });
  await callOne("updateLeadNotes", {
    organisationId: orgOne.organisationId,
    leadId: "legacy-malformed-restriction-lead",
    notes: "Reviewed fields; restriction remains unverified.",
  });
  const legacyRestrictionLeadsAfterEdits = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const missingRestrictionAfterEdits = legacyRestrictionLeadsAfterEdits.leads.find((item) => item.id === "legacy-missing-restriction-lead");
  const malformedRestrictionAfterEdits = legacyRestrictionLeadsAfterEdits.leads.find((item) => item.id === "legacy-malformed-restriction-lead");
  assert.equal(missingRestrictionAfterEdits?.contactRestrictionVerified, false, "ordinary edits cannot verify a missing restriction");
  assert.equal(missingRestrictionAfterEdits?.contactReviewStatus, "pending", "ordinary edits preserve pending review for missing restriction");
  assert.equal(malformedRestrictionAfterEdits?.contactRestrictionVerified, false, "ordinary edits cannot verify a malformed restriction");
  assert.equal(malformedRestrictionAfterEdits?.contactReviewStatus, "pending", "ordinary edits preserve pending review for malformed restriction");
  await expectCallableFailure(callOne("updateOutreachDraft", {
    organisationId: orgOne.organisationId, draftId: "legacy-missing-restriction-draft",
    subject: "Must remain blocked", body: "Missing restriction remains unverified",
  }), "functions/failed-precondition", "editing a draft whose lead has a missing doNotContact value");
  await expectCallableFailure(callOne("updateOutreachDraft", {
    organisationId: orgOne.organisationId, draftId: "legacy-malformed-restriction-draft",
    subject: "Must remain blocked", body: "Malformed restriction remains unverified",
  }), "functions/failed-precondition", "editing a draft whose lead has a malformed doNotContact value");
  assert.ok(orphanLegacyDraft, "orphan legacy draft is visible for operator review");
  assert.equal(orphanLegacyDraft.requiresReview, true, "orphan legacy draft requires review");
  assert.match(orphanLegacyDraft.reviewReason, /Lead record is missing/i);
  assert.ok(mismatchedLegacyDraft, "campaign-mismatched legacy draft is visible for operator review");
  assert.equal(mismatchedLegacyDraft.requiresReview, true, "campaign-mismatched legacy draft requires review");
  assert.match(mismatchedLegacyDraft.reviewReason, /campaign does not match/i);
  assert.ok(missingCampaignLegacyDraft, "legacy draft referencing a missing campaign remains visible for review");
  assert.equal(missingCampaignLegacyDraft.requiresReview, true, "missing campaign record requires review");
  assert.match(missingCampaignLegacyDraft.reviewReason, /campaign record is missing/i);
  assert.ok(nonDraftStatusLegacyDraft, "legacy record with a non-draft status remains visible for review");
  assert.equal(nonDraftStatusLegacyDraft.requiresReview, true, "legacy record with a non-draft status requires review");
  assert.equal(nonDraftStatusLegacyDraft.status, "sent", "legacy sent status is displayed honestly rather than normalised to draft");
  assert.ok(missingStatusLegacyDraft, "legacy record with a missing status remains visible for review");
  assert.equal(missingStatusLegacyDraft.requiresReview, true, "legacy record with a missing status requires review");
  assert.equal(missingStatusLegacyDraft.status, "unknown", "missing legacy status is displayed as unknown rather than draft");
  assert.match(nonDraftStatusLegacyDraft.reviewReason, /status is missing or is not draft/i);
  await expectCallableFailure(callOne("updateOutreachDraft", {
    organisationId: orgOne.organisationId, draftId: "legacy-non-draft-status",
    subject: "Must not reopen a sent record", body: "Status must remain blocked",
  }), "functions/failed-precondition", "editing a legacy outreach record whose status is not draft");
  await expectCallableFailure(callOne("updateOutreachDraft", {
    organisationId: orgOne.organisationId, draftId: "legacy-missing-status",
    subject: "Must not infer draft status", body: "Missing status remains untrusted",
  }), "functions/failed-precondition", "editing a legacy outreach record with missing status");
  const legacyDraftsAfterRejectedEdits = (await callOne("listOutreachDrafts", {
    organisationId: orgOne.organisationId,
  })).drafts;
  const sentRecordAfterRejectedEdit = legacyDraftsAfterRejectedEdits.find((item) => item.id === "legacy-non-draft-status");
  assert.equal(sentRecordAfterRejectedEdit?.status, "sent", "rejected edit preserves the legacy sent status");
  assert.equal(sentRecordAfterRejectedEdit?.subject, "Legacy non-draft status fixture", "rejected edit preserves the sent record subject");
  assert.equal(sentRecordAfterRejectedEdit?.body, "Synthetic test only", "rejected edit preserves the sent record body");
  const missingStatusAfterRejectedEdit = legacyDraftsAfterRejectedEdits.find((item) => item.id === "legacy-missing-status");
  assert.equal(missingStatusAfterRejectedEdit?.status, "unknown", "rejected edit does not normalise missing status to draft");
  assert.equal(missingStatusAfterRejectedEdit?.subject, "Legacy missing status fixture", "rejected edit preserves the missing-status record content");
  // A rejected edit of an untrusted legacy record must not consume the final
  // quota slot or create an activity event; the valid draft edit should still succeed.
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-rate-limit.mjs",
    orgOne.organisationId,
    first.auth.currentUser.uid,
    "updateOutreachDraft",
    "boundary",
  ], { stdio: "inherit", env: process.env });
  await expectCallableFailure(callOne("updateOutreachDraft", {
    organisationId: orgOne.organisationId,
    draftId: "legacy-missing-status",
    subject: "Rejected before quota consumption",
    body: "Must remain blocked",
  }), "functions/failed-precondition", "missing-status draft rejection preserves final edit quota slot");
  const finalDraftEdit = await callOne("updateOutreachDraft", {
    organisationId: orgOne.organisationId,
    draftId: draft.draftId,
    subject: "Final quota slot used by valid draft",
    body: "Only a valid draft edit should consume this slot.",
  });
  assert.equal(finalDraftEdit.subject, "Final quota slot used by valid draft",
    "valid draft edit succeeds after rejected legacy draft edit");
  const nonDraftStatusCleanup = await callOne("deleteOutreachDraft", {
    organisationId: orgOne.organisationId, draftId: "legacy-non-draft-status",
  });
  assert.equal(nonDraftStatusCleanup.deleted, true, "non-draft legacy record remains deletable for cleanup");
  assert.equal(nonDraftStatusCleanup.sent, false, "cleanup does not send outreach");
  assert.equal(nonDraftStatusCleanup.messageSentByThisAction, false, "cleanup response explicitly states this action did not send a message");
  await expectCallableFailure(callOne("updateOutreachDraft", {
    organisationId: orgOne.organisationId, draftId: "legacy-missing-status",
    subject: "Must not reopen an unknown-status record", body: "Status must remain blocked",
  }), "functions/failed-precondition", "editing a legacy outreach record whose status is missing");
  const missingStatusCleanup = await callOne("deleteOutreachDraft", {
    organisationId: orgOne.organisationId, draftId: "legacy-missing-status",
  });
  assert.equal(missingStatusCleanup.deleted, true, "missing-status legacy record remains deletable for cleanup");
  assert.equal(missingStatusCleanup.sent, false, "missing-status cleanup does not send outreach");
  assert.equal(missingStatusCleanup.messageSentByThisAction, false, "missing-status cleanup explicitly confirms this action did not send a message");
  await expectCallableFailure(callOne("updateOutreachDraft", {
    organisationId: orgOne.organisationId, draftId: "legacy-orphan-draft",
    subject: "Should remain blocked", body: "Do not update an orphan",
  }), "functions/failed-precondition", "editing an orphan legacy draft");
  await expectCallableFailure(callOne("updateOutreachDraft", {
    organisationId: orgOne.organisationId, draftId: "legacy-mismatched-campaign-draft",
    subject: "Should remain blocked", body: "Do not update a campaign-mismatched draft",
  }), "functions/failed-precondition", "editing a campaign-mismatched legacy draft");
  await expectCallableFailure(callOne("updateOutreachDraft", {
    organisationId: orgOne.organisationId, draftId: "legacy-missing-campaign-record-draft",
    subject: "Should remain blocked", body: "Do not update a draft with a missing campaign",
  }), "functions/failed-precondition", "editing a legacy draft whose campaign record is missing");
  const missingCampaignCleanup = await callOne("deleteOutreachDraft", {
    organisationId: orgOne.organisationId, draftId: "legacy-missing-campaign-record-draft",
  });
  assert.equal(missingCampaignCleanup.deleted, true, "missing-campaign legacy draft remains deletable for cleanup");
  assert.equal(missingCampaignCleanup.sent, false, "missing-campaign cleanup never sends outreach");
  const orphanCleanup = await callOne("deleteOutreachDraft", {
    organisationId: orgOne.organisationId, draftId: "legacy-orphan-draft",
  });
  assert.equal(orphanCleanup.deleted, true, "orphan legacy draft remains deletable for cleanup");
  assert.equal(orphanCleanup.sent, false, "legacy cleanup never sends outreach");
  const legacyCleanupList = await callOne("listOutreachDrafts", { organisationId: orgOne.organisationId });
  assert.equal(legacyCleanupList.drafts.some((item) => item.id === "legacy-orphan-draft"), false, "deleted orphan no longer appears in the list");

  await callOne("deleteOutreachDraft", { organisationId: orgOne.organisationId, draftId: draft.draftId });

  // Exercise organisation pagination with more than 100 memberships for one caller.
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-organisation-pagination.mjs",
    first.auth.currentUser.uid,
  ], { stdio: "inherit" });
  const seenOrganisationIds = new Set();
  let organisationPage = await callOne("listMyOrganisations", {});
  let organisationPageCount = 0;
  while (true) {
    organisationPageCount += 1;
    for (const organisation of organisationPage.organisations) {
      if (organisation.organisationId.startsWith("pagination-fixture-org-")) {
        assert.equal(organisation.role, "owner", "pagination fixture membership retains its validated owner role");
        seenOrganisationIds.add(organisation.organisationId);
      }
    }
    if (!organisationPage.hasMoreOrganisations) {
      assert.equal(organisationPage.nextPageToken, null, "last organisation page has no continuation token");
      break;
    }
    assert.ok(organisationPage.nextPageToken, "organisation page with more results includes a cursor");
    organisationPage = await callOne("listMyOrganisations", { pageToken: organisationPage.nextPageToken });
    assert.ok(organisationPageCount < 5, "pagination terminates within a bounded number of pages");
  }
  assert.ok(organisationPageCount >= 2, "more than 100 memberships require multiple pages");
  assert.equal(seenOrganisationIds.size, 105, "all 105 synthetic organisations appear exactly once across pages");


  // Exercise all tenant-scoped collection pagers beyond 100 records using emulator-only fixtures.
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-collection-pagination.mjs",
    orgOne.organisationId,
  ], { stdio: "inherit" });

  async function collectFixturePages({ callableName, tokenField, itemsField, fixturePrefix, pageToken = undefined }) {
    const seen = new Set();
    let page = await callOne(callableName, {
      organisationId: orgOne.organisationId,
      ...(pageToken ? { pageToken } : {}),
    });
    let pageCount = 0;
    while (true) {
      pageCount += 1;
      for (const item of page[itemsField]) {
        if (!item.id.startsWith(fixturePrefix)) continue;
        assert.equal(seen.has(item.id), false, `${callableName} pagination must not duplicate ${item.id}`);
        seen.add(item.id);
        if (callableName === "listLeads") {
          assert.equal(item.contactRestrictionVerified, true, "pagination fixtures are explicitly marked as reviewed");
        }
        if (callableName === "listOutreachDrafts") {
          assert.equal(item.requiresReview, false, "valid pagination draft fixtures do not require review");
        }
      }
      const hasMoreKey = callableName === "listCampaigns" ? "hasMoreCampaigns"
        : callableName === "listLeads" ? "hasMoreLeads" : "hasMoreDrafts";
      if (!page[hasMoreKey]) {
        assert.equal(page.nextPageToken, null, `${callableName} final page has no continuation token`);
        break;
      }
      assert.ok(page.nextPageToken, `${callableName} page with more results includes a cursor`);
      page = await callOne(callableName, { organisationId: orgOne.organisationId, pageToken: page.nextPageToken });
      assert.ok(pageCount < 5, `${callableName} pagination terminates within a bounded number of pages`);
    }
    assert.ok(pageCount >= 2, `${callableName} fixtures require multiple pages`);
    assert.equal(seen.size, 105, `${callableName} returns all 105 fixture records exactly once`);
  }

  await collectFixturePages({
    callableName: "listCampaigns",
    itemsField: "campaigns",
    fixturePrefix: "pagination-fixture-campaign-",
  });
  await collectFixturePages({
    callableName: "listLeads",
    itemsField: "leads",
    fixturePrefix: "pagination-fixture-lead-",
  });
  await collectFixturePages({
    callableName: "listOutreachDrafts",
    itemsField: "drafts",
    fixturePrefix: "pagination-fixture-draft-",
  });

  // Expired mutation buckets must reset based on their persisted window, even if the
  // stale document remains and carries an exhausted counter.
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-rate-limit.mjs",
    "global", first.auth.currentUser.uid, "createOrganisation", "expired",
  ], { stdio: "inherit" });
  const afterExpiredMutationQuota = await callOne("createOrganisation", { name: "Tenant After Expired Quota" });
  assert.equal(afterExpiredMutationQuota.role, "owner", "expired mutation quota permits the first request in a new window");
  execFileSync(process.execPath, [
    "functions/scripts/assert-emulator-rate-limit-expiry.mjs",
    "global", first.auth.currentUser.uid, "createOrganisation", "fresh-window",
  ], { stdio: "inherit" });

  // Force a quota boundary in the local emulator and verify a rejected mutation has no side effects.
  const beforeQuotaTest = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const quotaLeadBefore = beforeQuotaTest.leads[0];
  assert.ok(quotaLeadBefore, "at least one lead must exist before the quota test");
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-rate-limit.mjs",
    orgOne.organisationId,
    first.auth.currentUser.uid,
    "updateLeadNotes",
    "exhausted",
  ], { stdio: "inherit" });
  await expectCallableFailure(
    callOne("updateLeadNotes", {
      organisationId: orgOne.organisationId,
      leadId: quotaLeadBefore.id,
      notes: "This update must be rejected by the quota guard",
    }),
    "functions/resource-exhausted",
    "mutation rejected at the persisted rate-limit boundary",
  );
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-rate-limit.mjs",
    orgOne.organisationId,
    first.auth.currentUser.uid,
    "updateLeadNotes",
    "invalid",
  ], { stdio: "inherit" });
  await expectCallableFailure(
    callOne("updateLeadNotes", {
      organisationId: orgOne.organisationId,
      leadId: quotaLeadBefore.id,
      notes: "This update must fail closed on malformed quota state",
    }),
    "functions/failed-precondition",
    "mutation rejected when persisted rate-limit state is malformed",
  );
  const afterQuotaTest = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const quotaLeadAfter = afterQuotaTest.leads.find((lead) => lead.id === quotaLeadBefore.id);
  assert.equal(quotaLeadAfter?.notes, quotaLeadBefore.notes, "rejected quota mutations must not change the lead");

  // A rejected request for a nonexistent target must not spend the final quota slot.
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-rate-limit.mjs",
    orgOne.organisationId,
    first.auth.currentUser.uid,
    "updateLeadNotes",
    "boundary",
  ], { stdio: "inherit" });
  await expectCallableFailure(
    callOne("updateLeadNotes", {
      organisationId: orgOne.organisationId,
      leadId: "nonexistent-synthetic-lead",
      notes: "This must fail before consuming quota",
    }),
    "functions/not-found",
    "notes update rejected for a nonexistent lead",
  );
  const survivingQuotaRequest = await callOne("updateLeadNotes", {
    organisationId: orgOne.organisationId,
    leadId: quotaLeadBefore.id,
    notes: "Final quota slot remains available after a rejected missing-target request",
  });
  assert.equal(survivingQuotaRequest.leadId, quotaLeadBefore.id,
    "a valid request can still consume the final quota slot after the failed request");
  console.log("PASS: failed target validation does not consume the transactional mutation quota.");

  // Race several requests against the final available quota slot. Firestore transaction
  // conflicts must serialize consumption so exactly one mutation can spend that slot.
  const concurrentQuotaLeads = afterQuotaTest.leads.slice(0, 5);
  assert.equal(concurrentQuotaLeads.length, 5, "concurrency fixture requires five visible leads");
  const originalNotes = new Map(concurrentQuotaLeads.map((lead) => [lead.id, lead.notes]));
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-rate-limit.mjs",
    orgOne.organisationId,
    first.auth.currentUser.uid,
    "updateLeadNotes",
    "boundary",
  ], { stdio: "inherit" });
  const concurrentResults = await Promise.allSettled(concurrentQuotaLeads.map((lead, index) =>
    callOne("updateLeadNotes", {
      organisationId: orgOne.organisationId,
      leadId: lead.id,
      notes: `Concurrent quota boundary request ${index + 1}`,
    }),
  ));
  const successfulRequests = concurrentResults.filter((result) => result.status === "fulfilled");
  const rejectedRequests = concurrentResults.filter((result) => result.status === "rejected");
  assert.equal(successfulRequests.length, 1, "only one concurrent request may consume the final available quota slot");
  assert.equal(rejectedRequests.length, 4, "all other concurrent requests must be rate-limited");
  for (const result of rejectedRequests) {
    assert.equal(result.reason?.code, "functions/resource-exhausted", "concurrent losers must receive resource-exhausted");
  }
  const afterConcurrentQuota = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const changedLeads = concurrentQuotaLeads.filter((lead) => {
    const current = afterConcurrentQuota.leads.find((item) => item.id === lead.id);
    return current?.notes !== originalNotes.get(lead.id);
  });
  assert.equal(changedLeads.length, 1, "only the successful concurrent request may change lead notes");
  console.log("PASS: concurrent requests serialize quota consumption; exactly one succeeds at the final slot.");
  
  // Read callables have independent quotas to limit repeated, potentially expensive collection reads.
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-rate-limit.mjs",
    orgOne.organisationId,
    first.auth.currentUser.uid,
    "listLeads",
    "exhausted",
  ], { stdio: "inherit" });
  await expectCallableFailure(
    callOne("listLeads", { organisationId: orgOne.organisationId }),
    "functions/resource-exhausted",
    "read callable rejected at its persisted rate-limit boundary",
  );
  console.log("PASS: listLeads enforces its per-user/per-organisation read quota.");

  // Malformed persisted read-quota state must fail closed just like mutation quota state.
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-rate-limit.mjs",
    orgOne.organisationId,
    first.auth.currentUser.uid,
    "listLeads",
    "invalid",
  ], { stdio: "inherit" });
  await expectCallableFailure(
    callOne("listLeads", { organisationId: orgOne.organisationId }),
    "functions/failed-precondition",
    "read callable rejected when persisted rate-limit state is malformed",
  );
  console.log("PASS: listLeads fails closed on malformed persisted quota state.");

  for (const [operation, payload, label] of [
    ["listCampaigns", { organisationId: orgOne.organisationId }, "campaign listing"],
    ["listOutreachDrafts", { organisationId: orgOne.organisationId }, "outreach-draft listing"],
  ]) {
    execFileSync(process.execPath, [
      "functions/scripts/seed-emulator-rate-limit.mjs",
      orgOne.organisationId,
      first.auth.currentUser.uid,
      operation,
      "exhausted",
    ], { stdio: "inherit" });
    await expectCallableFailure(
      callOne(operation, payload),
      "functions/resource-exhausted",
      `${label} rejected at its persisted read quota boundary`,
    );
    console.log(`PASS: ${operation} enforces its per-user/per-organisation read quota.`);
  }

  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-rate-limit.mjs",
    "global",
    first.auth.currentUser.uid,
    "listMyOrganisations",
    "exhausted",
  ], { stdio: "inherit" });
  await expectCallableFailure(
    callOne("listMyOrganisations"),
    "functions/resource-exhausted",
    "organisation listing rejected at its persisted read quota boundary",
  );
  console.log("PASS: listMyOrganisations enforces its per-user global read quota.");

  console.log("PASS: exhausted and malformed transactional quota states reject mutations without changing protected data.");

  await signOut(first.auth);
  const unauthenticatedCallableNames = [
    "listMyOrganisations",
    "createOrganisation",
    "createCampaign",
    "listCampaigns",
    "updateCampaignStatus",
    "listLeads",
    "createLead",
    "updateLeadContact",
    "updateLeadStatus",
    "updateLeadNotes",
    "setLeadSuppression",
    "createOutreachDraft",
    "listOutreachDrafts",
    "updateOutreachDraft",
    "deleteOutreachDraft",
  ];
  for (const callableName of unauthenticatedCallableNames) {
    await expectCallableFailure(
      callOne(callableName, {}),
      "functions/unauthenticated",
      `unauthenticated denial for ${callableName}`,
    );
  }
  console.log(`PASS: all ${unauthenticatedCallableNames.length} callable exports reject unauthenticated requests before validating payloads or accessing tenant data.`);
  console.log("PASS: emulator smoke checks verified organisation isolation, unauthenticated denial, default Firestore client denial, suppression gates, and draft-only create/update/delete.");
} finally {
  await Promise.all(apps.map((app) => deleteApp(app).catch(() => undefined)));
}
