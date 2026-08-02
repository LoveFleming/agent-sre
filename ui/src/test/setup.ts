import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Clean up DOM after each test to ensure isolation
afterEach(() => {
  cleanup();
});
