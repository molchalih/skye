import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright";
import { build, createServer, preview, type InlineConfig } from "vite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drawnSky, ENGINES, launch, MIN_COLOURS, openPage } from "./browsers.ts";
import { CONSUMERS, SCRATCH } from "./paths.ts";

const ROOT = join(CONSUMERS, "vite");
const OUT = join(SCRATCH, "vite-dist");

// No config file: the app runs on Vite's defaults, as a new project would.
const BASE: InlineConfig = {
  root: ROOT,
  configFile: false,
  logLevel: "error",
  build: { outDir: OUT, emptyOutDir: true },
};

/** Both elements draw in a worker: `#worker` in skye's own, `#custom` in the app's worker module. */
async function expectWorkerSkies(browser: Browser, url: string): Promise<void> {
  const { page, errors } = await openPage(browser);
  await page.goto(url);
  const ids = ["worker", "custom"];
  const skies = await Promise.all(ids.map((id) => drawnSky(page, id)));
  expect(skies.map((sky) => sky.worker)).toEqual([true, true]);
  for (const [i, sky] of skies.entries()) expect(sky.colours, ids[i]).toBeGreaterThan(MIN_COLOURS);
  expect(errors).toEqual([]);
  await page.close();
}

const browsers = new Map<string, Browser>();

beforeAll(async () => {
  const launched = await Promise.all(ENGINES.map((engine) => launch(engine)));
  ENGINES.forEach((engine, i) => {
    const browser = launched[i];
    if (browser !== undefined) browsers.set(engine.name(), browser);
  });
});

afterAll(async () => {
  await Promise.all([...browsers.values()].map((browser) => browser.close()));
});

describe("vite build + preview", () => {
  let url: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    rmSync(OUT, { recursive: true, force: true });
    await build(BASE);
    const server = await preview({ ...BASE, preview: { host: "127.0.0.1", port: 0 } });
    const local = server.resolvedUrls?.local[0];
    if (local === undefined) throw new Error("vite preview has no local URL");
    url = local;
    close = () => server.close();
  });

  afterAll(async () => {
    await close();
  });

  test("the build emits skye's worker as its own asset", () => {
    const assets = readdirSync(join(OUT, "assets"));
    const workers = assets.filter((file) => file.startsWith("worker") && file.endsWith(".js"));
    expect(workers).toHaveLength(1);
    const main = assets.filter((file) => !workers.includes(file) && file.endsWith(".js"));
    const code = main.map((file) => readFileSync(join(OUT, "assets", file), "utf8")).join("\n");
    expect(code).toContain(workers[0]);
  });

  // Without `sideEffects` naming the worker entry, the bundler drops `import "skye/worker"` and emits an empty worker,
  // which never answers the probe: the sky silently falls back to the main thread.
  test("the build keeps skye's worker inside the app's own worker module", () => {
    const assets = readdirSync(join(OUT, "assets"));
    const custom = assets.filter(
      (file) => file.startsWith("custom-worker") && file.endsWith(".js"),
    );
    expect(custom).toHaveLength(1);
    const code = readFileSync(join(OUT, "assets", custom[0] ?? ""), "utf8");
    expect(code.length).toBeGreaterThan(10_000);
    expect(code).toContain("DedicatedWorkerGlobalScope");
  });

  test.each(ENGINES.map((engine) => engine.name()))("draws in a worker in %s", async (name) => {
    const browser = browsers.get(name);
    if (browser === undefined) throw new Error(`${name} is not running`);
    await expectWorkerSkies(browser, url);
  });
});

describe("vite dev server", () => {
  let url: string;
  let deps: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    // A fresh dependency pre-bundle each run: pre-bundling is what can break a dependency's relative worker URL.
    const server = await createServer({
      ...BASE,
      optimizeDeps: { force: true },
      server: { host: "127.0.0.1", port: 0 },
    });
    await server.listen();
    const local = server.resolvedUrls?.local[0];
    if (local === undefined) throw new Error("vite dev server has no local URL");
    url = local;
    deps = join(server.config.cacheDir, "deps");
    close = () => server.close();
  });

  afterAll(async () => {
    await close();
  });

  test.each(ENGINES.map((engine) => engine.name()))("draws in a worker in %s", async (name) => {
    const browser = browsers.get(name);
    if (browser === undefined) throw new Error(`${name} is not running`);
    await expectWorkerSkies(browser, url);
  });

  // Otherwise the tests above would not cover the worker URL inside a pre-bundled dependency.
  test("served skye pre-bundled", () => {
    expect(readdirSync(deps)).toContain("skye_define.js");
  });
});
