import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

/**
 * Require an explicit allow-listed Growth Engine Firebase project before any
 * Firebase CLI deployment. This guard does not authenticate or deploy anything.
 */
export function validateDeploymentProject(env) {
  const expected = typeof env.GROWTH_ENGINE_FIREBASE_PROJECT_ID === "string"
    ? env.GROWTH_ENGINE_FIREBASE_PROJECT_ID.trim()
    : "";
  const target = typeof env.GCLOUD_PROJECT === "string" ? env.GCLOUD_PROJECT.trim() : "";

  if (!expected) {
    return { ok: false, reason: "GROWTH_ENGINE_FIREBASE_PROJECT_ID must explicitly name the approved Growth Engine Firebase project." };
  }
  if (!target) {
    return { ok: false, reason: "Firebase CLI did not provide GCLOUD_PROJECT; deployment target cannot be verified." };
  }
  if (target.startsWith("demo-")) {
    return { ok: false, reason: "Firebase demo projects are for local testing and cannot be deployment targets." };
  }
  if (target !== expected) {
    return { ok: false, reason: "Deployment target does not match GROWTH_ENGINE_FIREBASE_PROJECT_ID; refusing deployment." };
  }
  return { ok: true, projectId: target };
}

function main() {
  const result = validateDeploymentProject(process.env);
  if (!result.ok) {
    console.error(`Firebase deployment blocked: ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Firebase deployment target verified: ${result.projectId}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
