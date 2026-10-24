import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run every Functions unit and source-contract test, including new focused
    // regression suites; an allow-list of one file silently skipped the rest.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
