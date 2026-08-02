import { defineConfig } from "vitest/config";

/**
 * Root-level Vitest configuration for server-side (Node.js) tests.
 *
 * UI tests live under `ui/` with their own Vite + Vitest setup.
 * This config targets server source (`server/`) only.
 */
export default defineConfig({
  test: {
    // Colocated test files under server/ alongside their source.
    include: ["server/**/*.test.mjs"],
    // Node environment — no DOM needed for server tests.
    environment: "node",
    // Ensure process isolation per test file.
    pool: "threads",
  },
});
