import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFunctions, type Functions } from "firebase/functions";

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
}

export interface FirebaseClient {
  app: FirebaseApp;
  auth: Auth;
  functions: Functions;
  projectId: string;
}

/** Returns null until all required public Firebase web config values are supplied. */
export function readFirebaseWebConfig(env: Record<string, string | undefined>): FirebaseWebConfig | null {
  const apiKey = env.VITE_FIREBASE_API_KEY?.trim();
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim();
  const appId = env.VITE_FIREBASE_APP_ID?.trim();
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    ...(env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() ? { messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID.trim() } : {}),
    ...(env.VITE_FIREBASE_STORAGE_BUCKET?.trim() ? { storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET.trim() } : {}),
  };
}

export function createFirebaseClient(config: FirebaseWebConfig): FirebaseClient {
  const app = getApps().length ? getApp() : initializeApp(config);
  return { app, auth: getAuth(app), functions: getFunctions(app), projectId: config.projectId };
}

const config = readFirebaseWebConfig(import.meta.env);
/** Null means the app must remain in clearly-labelled local demo mode. */
export const firebaseClient: FirebaseClient | null = config ? createFirebaseClient(config) : null;
