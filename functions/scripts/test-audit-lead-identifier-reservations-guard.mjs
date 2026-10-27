import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "audit-lead-identifier-reservations.mjs");

function assertRefused(label, environment, expectedMessage, args = ["--organisation-id", "synthetic-org"]) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GCLOUD_PROJECT: environment.projectId,
      FIREBASE_PROJECT: environment.projectId,
      FIRESTORE_EMULATOR_HOST: environment.emulatorHost,
    },
    timeout: 10_000,
  });
  assert.equal(result.error, undefined, `${label}: child process should start`);
  assert.notEqual(result.status, 0, `${label}: audit CLI must fail closed`);
  assert.match(result.stderr, expectedMessage, `${label}: expected explicit refusal reason`);
  assert.doesNotMatch(result.stdout, /"findings"\s*:\s*\{/,
    `${label}: refusal must not emit audit findings`);
}

assertRefused(
  "non-demo project even when an emulator host is present",
  { projectId: "growth-engine-production", emulatorHost: "127.0.0.1:8080" },
  /refuses all cloud Firestore projects/,
);
assertRefused(
  "demo project without a Firestore emulator",
  { projectId: "demo-growth-engine-test", emulatorHost: "" },
  /refuses all cloud Firestore projects/,
);
assertRefused(
  "demo project with an unsupported emulator endpoint",
  { projectId: "demo-growth-engine-test", emulatorHost: "firestore.example.com:8080" },
  /refuses all cloud Firestore projects/,
);
const safeEmulator = { projectId: "demo-growth-engine-test", emulatorHost: "127.0.0.1:8080" };
assertRefused(
  "invalid organisation ID",
  safeEmulator,
  /Usage: node functions\/scripts\/audit-lead-identifier-reservations\.mjs/,
  ["--organisation-id", "bad/organisation"],
);
assertRefused(
  "page size above the configured maximum",
  safeEmulator,
  /--page-size must be an integer from 1 to 200/,
  ["--organisation-id", "synthetic-org", "--page-size", "201"],
);
assertRefused(
  "record budget above the configured maximum",
  safeEmulator,
  /--max-records must be an integer from 1 to 20000/,
  ["--organisation-id", "synthetic-org", "--max-records", "20001"],
);

console.log("Reservation audit CLI guard and argument validation tests passed.");
