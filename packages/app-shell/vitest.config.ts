import { defineConfig } from "vitest/config";

// Unit tests for the shared app plumbing (proxy cookie composition). Node
// environment — no DOM, no edge-runtime.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
  },
});
