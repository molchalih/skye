import { defineConfig, type UserConfig } from "vite";

// The benchmark page: measures the renderer per scene, mode and quality tier on the device it opens on. Plain DOM,
// no framework; it imports skye from source, so `bun run bench` runs the shader generator first.
const config: UserConfig = defineConfig({
  root: import.meta.dirname,
});

export default config;
