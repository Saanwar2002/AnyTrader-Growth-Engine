import assert from "node:assert/strict";
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
  const leadOne = await callOne("createLead", { organisationId: orgOne.organisationId, campaignId: campaignOne.campaignId, businessName: "Synthetic Test Painting Ltd", category: "Painters", location: "Manchester", email: "hello@example.test" });

  await callOne("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: true });
  await expectCallableFailure(callOne("createOutreachDraft", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, subject: "Blocked", body: "Must not be created" }), "functions/failed-precondition", "suppressed lead draft gate");
  await expectCallableFailure(callOne("updateLeadStatus", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, status: "contacted" }), "functions/failed-precondition", "suppressed lead contacted status gate");
  await callOne("setLeadSuppression", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, doNotContact: false });
  const draft = await callOne("createOutreachDraft", { organisationId: orgOne.organisationId, leadId: leadOne.leadId, subject: "Test draft", body: "Review before use" });
  assert.equal(draft.sent, false);
  await callOne("updateOutreachDraft", { organisationId: orgOne.organisationId, draftId: draft.draftId, subject: "Updated test draft", body: "Still draft only" });
  const draftList = await callOne("listOutreachDrafts", { organisationId: orgOne.organisationId });
  assert.equal(draftList.drafts.length, 1);
  assert.equal(draftList.drafts[0].subject, "Updated test draft");
  await callOne("deleteOutreachDraft", { organisationId: orgOne.organisationId, draftId: draft.draftId });

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
  await expectCallableFailure(callTwo("createLead", { organisationId: orgTwo.organisationId, campaignId: campaignOne.campaignId, businessName: "Cross Tenant Attempt" }), "functions/not-found", "cross-tenant campaign reference denial");

  await signOut(first.auth);
  await expectCallableFailure(callOne("listMyOrganisations"), "functions/unauthenticated", "unauthenticated callable denial");
  console.log("PASS: emulator smoke checks verified organisation isolation, unauthenticated denial, default Firestore client denial, suppression gates, and draft-only create/update/delete.");
} finally {
  await Promise.all(apps.map((app) => deleteApp(app).catch(() => undefined)));
}
