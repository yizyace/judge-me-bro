import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Vitest config for the web app.
 *
 * Mirrors the tsconfig `@/*` path alias so test files resolve the same module
 * specifiers as the app. Uses jsdom + Testing Library for component/hook tests.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Matches tsconfig.json `paths`: "@/*" -> "./*" (the web/ root).
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test-setup.ts"],
    css: false,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
  },
});
