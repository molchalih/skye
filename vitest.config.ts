import { playwright } from "@vitest/browser-playwright";
import { defineConfig, type ViteUserConfig } from "vitest/config";
import type { BrowserConfigOptions } from "vitest/node";

/** Tests that render in dedicated workers. A new worker test must match one of these, or it runs among the rest. */
const WORKER_TESTS = ["src/worker/**/*.browser.test.ts", "test/look/worker.browser.test.ts"];
/** The look gate, outside the worker. */
const LOOK_TESTS = ["test/look/**/*.browser.test.ts"];

// A fresh object per project: Vitest names the instances in place.
function browser(): BrowserConfigOptions {
  return {
    enabled: true,
    headless: true,
    provider: playwright(),
    instances: [{ browser: "webkit" }, { browser: "chromium" }, { browser: "firefox" }],
  };
}

const config: ViteUserConfig = defineConfig({
  test: {
    testTimeout: 15_000,
    hookTimeout: 30_000,
    globalSetup: ["./scripts/shaders.setup.ts"],
    coverage: {
      exclude: ["test/reference/**"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: [
            "src/**/*.test.{ts,tsx}",
            "scripts/**/*.test.ts",
            "test/**/*.test.ts",
            "site/**/*.test.ts",
          ],
          // test/consumers runs against the packed package, after a build: `bun run test:consumers`.
          exclude: ["**/*.browser.test.*", "**/node_modules/**", "test/consumers/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["**/*.browser.test.{ts,tsx}"],
          exclude: ["**/node_modules/**", ...WORKER_TESTS, ...LOOK_TESTS],
          browser: browser(),
        },
      },
      {
        extends: true,
        test: {
          name: "browser-worker",
          include: WORKER_TESTS,
          // After every other browser test: while those draw in parallel, headless Chromium's software GL can
          // starve WebGL in workers for tens of seconds.
          sequence: { groupOrder: 1 },
          browser: browser(),
        },
      },
      {
        extends: true,
        test: {
          name: "browser-look",
          include: LOOK_TESTS,
          exclude: ["**/node_modules/**", ...WORKER_TESTS],
          // Last, among themselves: headless Chromium draws every page through one software GPU process, so the gate's
          // long sequences of two and three skies would otherwise slow the other tests past their timeouts. Run alone
          // or after them, the GPU work is the same.
          sequence: { groupOrder: 2 },
          // One file at a time on CI: a 4-vCPU runner drawing every look file at once in software GL runs them past
          // their timeouts. Locally they run in parallel.
          fileParallelism: process.env["CI"] !== "true",
          browser: browser(),
        },
      },
    ],
  },
});

export default config;
