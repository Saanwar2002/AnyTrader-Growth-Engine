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
  const orgOne = await callOne("createOrganisation", { name: "Tenant One" });
  assert.equal(orgOne.role, "owner");
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
  await expectCallableFailure(callOne("updateLeadStatus", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, status: "contacted" }), "functions/failed-precondition", "pending review contacted-status gate");
  await expectCallableFailure(callOne("updateLeadStatus", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, status: "sent" }), "functions/failed-precondition", "unknown lead lifecycle status rejected");
  await expectCallableFailure(callOne("updateLeadContact", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    businessName: "Synthetic Test Painting Ltd",
    category: "Painters",
    location: "Manchester",
    email: "not-an-email",
  }), "functions/invalid-argument", "lead contact update rejects malformed email");
  await expectCallableFailure(callOne("updateCampaignStatus", {
    organisationId: orgOne.organisationId,
    campaignId: campaignOne.campaignId,
    status: "sent",
  }), "functions/invalid-argument", "unknown campaign lifecycle status rejected");
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
  await callOne("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: false });
  const clearedLeadList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  assert.equal(clearedLeadList.leads.find((lead) => lead.id === leadOne.leadId)?.contactReviewStatus, "cleared");

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
  await expectCallableFailure(memberCall("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: false }), "functions/permission-denied", "member cannot clear lead suppression");
  await expectCallableFailure(memberCall("createCampaign", { organisationId: orgOne.organisationId, name: "Member denied campaign", brand: "Example", category: "Painters", location: "Manchester", goal: "Role test" }), "functions/permission-denied", "member cannot create campaign");

  const admin = connectClient(initializeApp(firebaseConfig, "role-admin"));
  apps.push(admin.app);
  await createUserWithEmailAndPassword(admin.auth, "admin@example.test", "testing-password-admin");
  seedRole(admin.auth.currentUser.uid, "admin");
  const adminCall = (name, payload = {}) => httpsCallable(admin.functions, name, { timeout: 30000 })(payload).then((response) => response.data);
  const adminCampaign = await adminCall("createCampaign", { organisationId: orgOne.organisationId, name: "Admin role campaign", brand: "Example", category: "Painters", location: "Manchester", goal: "Role test" });
  assert.equal(adminCampaign.status, "active", "admin can create a campaign");
  await adminCall("updateCampaignStatus", { organisationId: orgOne.organisationId, campaignId: adminCampaign.campaignId, status: "paused" });
  await adminCall("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: false });
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
  await expectCallableFailure(viewerCall("updateLeadNotes", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, notes: "Viewer must not edit" }), "functions/permission-denied", "viewer cannot edit lead notes");
  await expectCallableFailure(viewerCall("createCampaign", { organisationId: orgOne.organisationId, name: "Viewer denied campaign", brand: "Example", category: "Painters", location: "Manchester", goal: "Role test" }), "functions/permission-denied", "viewer cannot create campaign");
  await expectCallableFailure(viewerCall("updateCampaignStatus", { organisationId: orgOne.organisationId, campaignId: campaignOne.campaignId, status: "paused" }), "functions/permission-denied", "viewer cannot change campaign status");
  await expectCallableFailure(viewerCall("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: true }), "functions/permission-denied", "viewer cannot suppress a lead");
  await expectCallableFailure(viewerCall("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: false }), "functions/permission-denied", "viewer cannot clear suppression");
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
  await expectCallableFailure(viewerCall("updateLeadStatus", {
    organisationId: orgOne.organisationId,
    leadId: leadOne.leadId,
    status: "qualified",
  }), "functions/permission-denied", "viewer cannot change lead status");
  await expectCallableFailure(viewerCall("updateOutreachDraft", {
    organisationId: orgOne.organisationId,
    draftId: draft.draftId,
    subject: "Viewer must not edit",
    body: "Must remain unchanged.",
  }), "functions/permission-denied", "viewer cannot edit an outreach draft");
  await expectCallableFailure(viewerCall("deleteOutreachDraft", {
    organisationId: orgOne.organisationId,
    draftId: draft.draftId,
  }), "functions/permission-denied", "viewer cannot delete an outreach draft");

  // Cursor tokens are untrusted client input; malformed or cross-collection paths must fail closed.
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

  // A syntactically valid organisation cursor must still point to a valid membership
  // in an existing organisation. This synthetic malformed record is seeded only in the
  // guarded local emulator project.
  execFileSync(process.execPath, [
    "functions/scripts/seed-emulator-invalid-membership.mjs",
    "cursor-fixture-org",
    first.auth.currentUser.uid,
  ], { stdio: "inherit" });
  await expectCallableFailure(
    callOne("listMyOrganisations", { pageToken: `organisations/cursor-fixture-org/members/${first.auth.currentUser.uid}` }),
    "functions/invalid-argument",
    "organisation cursor backed by a malformed membership record",
  );

  // A restriction added after draft creation must be reflected by list and enforced by update.
  await callOne("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: true });
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

  await callOne("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: false });
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
  await expectCallableFailure(callTwo("listCampaigns", { organisationId: orgOne.organisationId }), "functions/permission-denied", "cross-tenant campaign listing denial");
  await expectCallableFailure(callTwo("listOutreachDrafts", { organisationId: orgOne.organisationId }), "functions/permission-denied", "cross-tenant outreach draft listing denial");
  await expectCallableFailure(callTwo("createLead", { organisationId: orgTwo.organisationId, campaignId: campaignOne.campaignId, businessName: "Cross Tenant Attempt" }), "functions/not-found", "cross-tenant campaign reference denial");
  await expectCallableFailure(callTwo("createOutreachDraft", { organisationId: orgTwo.organisationId, leadId: leadOne.leadId, subject: "Cross tenant", body: "Must not be created" }), "functions/not-found", "cross-tenant lead reference denial");
  await expectCallableFailure(callTwo("updateOutreachDraft", { organisationId: orgTwo.organisationId, draftId: draft.draftId, subject: "Cross tenant", body: "Must not be updated" }), "functions/not-found", "cross-tenant draft update denial");
  await expectCallableFailure(callTwo("deleteOutreachDraft", { organisationId: orgTwo.organisationId, draftId: draft.draftId }), "functions/not-found", "cross-tenant draft delete denial");

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
  const orphanLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-orphan-draft");
  const mismatchedLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-mismatched-campaign-draft");
  // Even a legacy lead marked internally cleared must not get a new draft if its campaign record is gone.
  await expectCallableFailure(callOne("createOutreachDraft", {
    organisationId: orgOne.organisationId,
    leadId: "legacy-missing-campaign-lead",
    subject: "Missing campaign must block draft",
    body: "Must not be created without the referenced campaign",
  }), "functions/failed-precondition", "draft creation for a cleared legacy lead with a missing campaign");
  await expectCallableFailure(callOne("updateLeadStatus", {
    organisationId: orgOne.organisationId,
    leadId: "legacy-missing-campaign-lead",
    status: "contacted",
  }), "functions/failed-precondition", "marking a cleared legacy lead contacted when its campaign is missing");
  const missingCampaignLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-missing-campaign-record-draft");
  const nonDraftStatusLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-non-draft-status");
  const missingStatusLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-missing-status");
  const missingRestrictionLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-missing-restriction-draft");
  const malformedRestrictionLegacyDraft = legacyDraftList.drafts.find((item) => item.id === "legacy-malformed-restriction-draft");
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
  assert.ok(missingRestrictionLegacyDraft, "legacy draft with missing contact restriction remains visible for review");
  assert.equal(missingRestrictionLegacyDraft.requiresReview, true, "missing contact restriction requires review");
  assert.match(missingRestrictionLegacyDraft.reviewReason, /restriction could not be verified/i);
  assert.ok(malformedRestrictionLegacyDraft, "legacy draft with malformed contact restriction remains visible for review");
  assert.equal(malformedRestrictionLegacyDraft.requiresReview, true, "malformed contact restriction requires review");
  assert.match(malformedRestrictionLegacyDraft.reviewReason, /restriction could not be verified/i);
  const legacyRestrictionLeads = await callOne("listLeads", { organisationId: orgOne.organisationId });
  const missingRestrictionLead = legacyRestrictionLeads.leads.find((item) => item.id === "legacy-missing-restriction-lead");
  const malformedRestrictionLead = legacyRestrictionLeads.leads.find((item) => item.id === "legacy-malformed-restriction-lead");
  assert.ok(missingRestrictionLead, "lead with missing restriction remains visible");
  assert.equal(missingRestrictionLead.contactRestrictionVerified, false, "missing restriction is not presented as verified");
  assert.equal(missingRestrictionLead.contactReviewStatus, "pending", "missing restriction is normalised to pending review");
  assert.ok(malformedRestrictionLead, "lead with malformed restriction remains visible");
  assert.equal(malformedRestrictionLead.contactRestrictionVerified, false, "malformed restriction is not presented as verified");
  assert.equal(malformedRestrictionLead.contactReviewStatus, "pending", "malformed restriction is normalised to pending review");
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

  await signOut(first.auth);
  await expectCallableFailure(callOne("listMyOrganisations"), "functions/unauthenticated", "unauthenticated callable denial");
  console.log("PASS: emulator smoke checks verified organisation isolation, unauthenticated denial, default Firestore client denial, suppression gates, and draft-only create/update/delete.");
} finally {
  await Promise.all(apps.map((app) => deleteApp(app).catch(() => undefined)));
}
