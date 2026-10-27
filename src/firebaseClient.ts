import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFunctions, type Functions } from "firebase/functions";
import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from "firebase/app-check";

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  appCheckSiteKey: string;
  messagingSenderId?: string;
  storageBucket?: string;
}

export interface FirebaseClient {
  app: FirebaseApp;
  auth: Auth;
  functions: Functions;
  appCheck: AppCheck;
  projectId: string;
}

/** Returns null until all required public Firebase web config values are supplied. */
export function readFirebaseWebConfig(env: Record<string, string | undefined>): FirebaseWebConfig | null {
  const apiKey = env.VITE_FIREBASE_API_KEY?.trim();
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim();
  const approvedProjectId = env.VITE_GROWTH_ENGINE_FIREBASE_PROJECT_ID?.trim();
  const appId = env.VITE_FIREBASE_APP_ID?.trim();
  const appCheckSiteKey = env.VITE_FIREBASE_APPCHECK_SITE_KEY?.trim();
  // Require a separately declared allow-list value so a mistaken Firebase target
  // cannot silently enable cloud mode. Deployment has a matching server-side guard.
  if (!apiKey || !authDomain || !projectId || !approvedProjectId || projectId !== approvedProjectId || !appId || !appCheckSiteKey) return null;
  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    appCheckSiteKey,
    ...(env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() ? { messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID.trim() } : {}),
    ...(env.VITE_FIREBASE_STORAGE_BUCKET?.trim() ? { storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET.trim() } : {}),
  };
}

export function assertFirebaseProjectMatches(configuredProjectId: string, existingProjectId: string | undefined): void {
  if (!existingProjectId || existingProjectId !== configuredProjectId) {
    throw new Error("Firebase project configuration does not match the initialized default app.");
  }
}

export function createFirebaseClient(config: FirebaseWebConfig): FirebaseClient {
  const existingDefaultApp = getApps().find((app) => app.name === "[DEFAULT]");
  const app = existingDefaultApp ?? initializeApp(config);
  if (existingDefaultApp) assertFirebaseProjectMatches(config.projectId, app.options.projectId);
  const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(config.appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
  return { app, auth: getAuth(app), functions: getFunctions(app), appCheck, projectId: app.options.projectId ?? config.projectId };
}

const config = readFirebaseWebConfig(import.meta.env);
/** Null means the app must remain in clearly-labelled local demo mode. */
export const firebaseClient: FirebaseClient | null = config ? createFirebaseClient(config) : null;
