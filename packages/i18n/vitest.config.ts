import { defineConfig } from "vitest/config";

// Pure-logic unit tests for the shared i18n/region utilities (cross-app URL
// builder, Brazil formatters). Node environment — no DOM, no edge-runtime.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
  },
});
