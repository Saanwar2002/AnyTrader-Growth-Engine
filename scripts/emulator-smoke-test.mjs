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
  await expectCallableFailure(callOne("createOutreachDraft", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, subject: "Blocked", body: "Must not be created" }), "functions/failed-precondition", "suppressed lead draft gate");
  await expectCallableFailure(callOne("updateLeadStatus", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, status: "contacted" }), "functions/failed-precondition", "suppressed lead contacted status gate");
  await callOne("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: false });
  const clearedLeadList = await callOne("listLeads", { organisationId: orgOne.organisationId });
  assert.equal(clearedLeadList.leads.find((lead) => lead.id === leadOne.leadId)?.contactReviewStatus, "cleared");

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

  // A restriction added after draft creation must be reflected by list and enforced by update.
  await callOne("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: true });
  const suppressedDraftList = await callOne("listOutreachDrafts", { organisationId: orgOne.organisationId });
  assert.equal(suppressedDraftList.drafts[0].leadSuppressed, true);
  assert.equal(suppressedDraftList.drafts[0].requiresReview, true);
  await expectCallableFailure(callOne("updateOutreachDraft", { organisationId: orgOne.organisationId, draftId: draft.draftId, subject: "Blocked update", body: "Must not be edited" }), "functions/failed-precondition", "suppression added after draft creation");

  await callOne("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: false });
  await callOne("updateOutreachDraft", { organisationId: orgOne.organisationId, draftId: draft.draftId, subject: "Updated test draft", body: "Still draft only" });
  const draftList = await callOne("listOutreachDrafts", { organisationId: orgOne.organisationId });
  assert.equal(draftList.drafts.length, 1);
  assert.equal(draftList.drafts[0].subject, "Updated test draft");
  assert.equal(draftList.drafts[0].sent, undefined);

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
  assert.equal(secondLeadPage.leads.length, 1, "the second lead page returns the remaining record");
  assert.equal(secondLeadPage.hasMoreLeads, false, "the final lead page has no further cursor");
  assert.equal(secondLeadPage.nextPageToken, null);
  const paginatedLeadIds = [...firstLeadPage.leads, ...secondLeadPage.leads].map((lead) => lead.id);
  assert.equal(new Set(paginatedLeadIds).size, 101, "lead pages do not duplicate records");

  // Exercise campaign pagination beyond the same 100-record page boundary.
  // The owner and admin setup already created two campaigns, so add 99 to
  // make the organisation contain exactly 101 records for this paging check.
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
  assert.equal(secondCampaignPage.campaigns.length, 1, "the second campaign page returns the remaining record");
  assert.equal(secondCampaignPage.hasMoreCampaigns, false, "the final campaign page has no further cursor");
  assert.equal(secondCampaignPage.nextPageToken, null);
  const paginatedCampaignIds = [...firstCampaignPage.campaigns, ...secondCampaignPage.campaigns].map((campaign) => campaign.id);
  assert.equal(new Set(paginatedCampaignIds).size, 101, "campaign pages do not duplicate records");

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
  assert.equal(secondDraftPage.drafts.length, 1, "the second draft page returns the remaining record");
  assert.equal(secondDraftPage.hasMoreDrafts, false, "the final draft page has no further cursor");
  assert.equal(secondDraftPage.nextPageToken, null);
  const paginatedDraftIds = [...firstDraftPage.drafts, ...secondDraftPage.drafts].map((item) => item.id);
  assert.equal(new Set(paginatedDraftIds).size, 101, "draft pages do not duplicate records");
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
  await callOne("deleteOutreachDraft", { organisationId: orgOne.organisationId, draftId: draft.draftId });

  await signOut(first.auth);
  await expectCallableFailure(callOne("listMyOrganisations"), "functions/unauthenticated", "unauthenticated callable denial");
  console.log("PASS: emulator smoke checks verified organisation isolation, unauthenticated denial, default Firestore client denial, suppression gates, and draft-only create/update/delete.");
} finally {
  await Promise.all(apps.map((app) => deleteApp(app).catch(() => undefined)));
}
