import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Deterministic, headless: no network, no real timers.
    environment: "node",
  },
});
