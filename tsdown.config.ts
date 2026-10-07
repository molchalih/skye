import { defineConfig, type UserConfig } from "tsdown";

const config: UserConfig = defineConfig({
  entry: {
    index: "src/index.ts",
    astro: "src/astro/index.ts",
    element: "src/element/index.ts",
    define: "src/define.ts",
    worker: "src/worker/worker.ts",
    react: "src/react/index.tsx",
  },
  format: "esm",
  platform: "browser",
  target: "es2022",
  dts: { sourcemap: false },
  // Minified for what a CDN serves as published; shader text lives in string literals, which minification never
  // rewrites. External maps keep the sources debuggable and cost nothing unless developer tools ask for them.
  minify: true,
  sourcemap: true,
  // Every chunk lands in dist/ itself, never a subdirectory: `new URL("./worker.js", import.meta.url)` in whichever
  // chunk holds the worker host must find the worker entry beside it.
  outputOptions: { chunkFileNames: "[name]-[hash].js" },
});

export default config;
