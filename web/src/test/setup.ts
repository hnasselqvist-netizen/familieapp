import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Vitest polyfiller ikke jest sine globale hooks — RTL sin automatiske
// opprydding mellom tester må derfor kobles inn eksplisitt her.
afterEach(cleanup);
