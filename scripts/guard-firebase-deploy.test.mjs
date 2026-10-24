import { describe, expect, it } from "vitest";
import { validateDeploymentProject } from "./guard-firebase-deploy.mjs";

describe("Firebase deployment project guard", () => {
  it("requires an explicit approved Growth Engine project ID", () => {
    expect(validateDeploymentProject({ GCLOUD_PROJECT: "growth-prod-123" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("GROWTH_ENGINE_FIREBASE_PROJECT_ID"),
    });
  });

  it("refuses when the Firebase CLI target is missing", () => {
    expect(validateDeploymentProject({ GROWTH_ENGINE_FIREBASE_PROJECT_ID: "growth-prod-123" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("GCLOUD_PROJECT"),
    });
  });

  it("refuses demo projects even when the configured IDs match", () => {
    expect(validateDeploymentProject({
      GROWTH_ENGINE_FIREBASE_PROJECT_ID: "demo-growth-engine-test",
      GCLOUD_PROJECT: "demo-growth-engine-test",
    })).toMatchObject({ ok: false, reason: expect.stringContaining("demo projects") });
  });

  it("refuses a target that differs from the explicit allow-listed project", () => {
    expect(validateDeploymentProject({
      GROWTH_ENGINE_FIREBASE_PROJECT_ID: "growth-prod-123",
      GCLOUD_PROJECT: "anytrader-prod-123",
    })).toMatchObject({ ok: false, reason: expect.stringContaining("does not match") });
  });

  it("allows only the exact explicitly configured non-demo project", () => {
    expect(validateDeploymentProject({
      GROWTH_ENGINE_FIREBASE_PROJECT_ID: "growth-prod-123",
      GCLOUD_PROJECT: "growth-prod-123",
    })).toEqual({ ok: true, projectId: "growth-prod-123" });
  });

  it("rejects blank or whitespace-only project IDs", () => {
    expect(validateDeploymentProject({
      GROWTH_ENGINE_FIREBASE_PROJECT_ID: " ",
      GCLOUD_PROJECT: "growth-prod-123",
    })).toMatchObject({ ok: false });
    expect(validateDeploymentProject({
      GROWTH_ENGINE_FIREBASE_PROJECT_ID: "growth-prod-123",
      GCLOUD_PROJECT: " ",
    })).toMatchObject({ ok: false });
  });
});
