// Global test setup: registers jest-dom matchers (toBeInTheDocument, etc.) and
// tears down the DOM between tests. Referenced from vitest.config.ts setupFiles.
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
