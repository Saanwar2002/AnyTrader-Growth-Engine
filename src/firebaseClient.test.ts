import { describe, expect, it } from "vitest";
import { readFirebaseWebConfig } from "./firebaseClient";

describe("Firebase web configuration", () => {
  it("keeps Firebase disabled when required values are missing", () => {
    expect(readFirebaseWebConfig({})).toBeNull();
    expect(readFirebaseWebConfig({ VITE_FIREBASE_API_KEY: "key", VITE_FIREBASE_PROJECT_ID: "project" })).toBeNull();
  });

  it("reads required public configuration and trims whitespace", () => {
    expect(readFirebaseWebConfig({
      VITE_FIREBASE_API_KEY: " key ",
      VITE_FIREBASE_AUTH_DOMAIN: " growth.example.firebaseapp.com ",
      VITE_FIREBASE_PROJECT_ID: " growth-project ",
      VITE_FIREBASE_APP_ID: " app-id ",
    })).toEqual({ apiKey: "key", authDomain: "growth.example.firebaseapp.com", projectId: "growth-project", appId: "app-id" });
  });

  it("does not require optional messaging/storage fields", () => {
    expect(readFirebaseWebConfig({
      VITE_FIREBASE_API_KEY: "key", VITE_FIREBASE_AUTH_DOMAIN: "example.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "project", VITE_FIREBASE_APP_ID: "app",
      VITE_FIREBASE_MESSAGING_SENDER_ID: " ", VITE_FIREBASE_STORAGE_BUCKET: "",
    })).toEqual({ apiKey: "key", authDomain: "example.firebaseapp.com", projectId: "project", appId: "app" });
  });
});


describe("Firebase project consistency", () => {
  it("accepts an already initialized app for the configured project", async () => {
    const { assertFirebaseProjectMatches } = await import("./firebaseClient");
    expect(() => assertFirebaseProjectMatches("growth-project", "growth-project")).not.toThrow();
  });

  it("fails closed when an existing default app belongs to a different project", async () => {
    const { assertFirebaseProjectMatches } = await import("./firebaseClient");
    expect(() => assertFirebaseProjectMatches("growth-project", "production-project"))
      .toThrow("Firebase project configuration does not match the initialized default app.");
  });

  it("fails closed when the initialized app has no project ID", async () => {
    const { assertFirebaseProjectMatches } = await import("./firebaseClient");
    expect(() => assertFirebaseProjectMatches("growth-project", undefined)).toThrow();
  });
});
