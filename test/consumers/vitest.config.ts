import { defineConfig, type ViteUserConfig } from "vitest/config";

// Consumer smoke tests: Node drives real browsers through Playwright against pages served from the packed
// package, so the pages are exactly what a user's server would send, not Vitest's own test page.
const config: ViteUserConfig = defineConfig({
  test: {
    name: "consumers",
    environment: "node",
    include: ["test/consumers/*.test.ts"],
    globalSetup: ["test/consumers/setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // One file at a time: browsers drawing with software GL in parallel starve each other.
    fileParallelism: false,
  },
});

export default config;
