import { readFileSync } from "node:fs";
import { defineConfig, type UserConfig } from "vite";

// The showcase page, which the pages workflow publishes. Like the bench it imports skye from source, so the page
// shows the renderer of the commit it is built from; `bun run site` serves it and `bun run site:build` writes
// site/dist.
const { version }: { version: string } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const config: UserConfig = defineConfig({
  root: import.meta.dirname,
  // Relative URLs, so the build works under the repository's path on github.io and on any other host.
  base: "./",
  plugins: [
    {
      // The Copy button hands out the published package at the version this commit carries.
      name: "skye-version",
      transformIndexHtml: (html) => html.replaceAll("__SKYE_VERSION__", version),
    },
  ],
});

export default config;
