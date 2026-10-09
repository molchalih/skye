// `bun run bench:gpu`: measures what the renderer costs to run, on every axis this machine exposes without
// root, in Chromium on the real GPU (ANGLE over Metal). Writes results.json, report.md and one reference frame
// per case to an output directory. CONTRIBUTING.md says what each figure means and how far to trust it.
//
// Sections, in order:
//   startup   the library bundled into one minified file, imported into fresh pages: import, compile, first frame.
//   idle      the browser with the bench page open and nothing drawing: the baseline for every system figure.
//   matrix    per scene x tier x size x pixel ratio, a sky driven with render(t) at fixed times:
//             paced (GPU/CPU/frame-interval percentiles, GL calls, system counters), passes (one GPU query per
//             pass), marginal (each pass repeated inside an unsplit frame), saturated (frames back to back),
//             allocations (sampling heap profiler), trace (GC, thread busy time), reference (a PNG per case,
//             compared with --baseline under the parity gate's tolerance).
//   element   a real <skye-view> on the main thread and in a worker, its own loop running, in each state:
//             visible, offscreen, hidden, static, reduced-motion.
//
// Options (all optional):
//   --sizes 1280x720,1920x1080,2560x1440   --dprs 1,2   --tiers low,balanced,high
//   --scenes cloudy@17.5,rainy@17.5        scene@hour pairs
//   --blur 0                               background blur, CSS px
//   --seconds 4 --warm 1.5 --pass-frames 120 --marginal-frames 20 --repeat 12 --saturate-frames 30
//   --ref-frames 91 --idle 4 --profile-seconds 1.5 --state-seconds 4 --cold 3 --warm-starts 3
//   --element 1920x1080@2:balanced:cloudy@17.5
//   --skip startup,marginal,profile,element  sections to leave out
//   --out bench/results/<timestamp>   --baseline <earlier output dir>
//   --headed                               a visible window (paced by the display) instead of headless
//   --quick                                1280x720 at ratio 1, one scene, short phases
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { brotliCompressSync, gzipSync } from "node:zlib";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright";
import { createServer } from "vite";
import { SCENE_NAMES, type SceneName, type Tier } from "../src/core/params.ts";
import type { CaseInput, ElementState, Startup } from "./gpu-protocol.ts";
import { report } from "./gpu-report.ts";
import type {
  CaseResult,
  ElementPathResult,
  Results,
  StartupResult,
  StateResult,
} from "./gpu-results.ts";
import {
  machine,
  sampleAllocations,
  summarizeTrace,
  SystemWindow,
  thermal,
  TRACE_CATEGORIES,
  type Allocations,
  type TraceSummary,
} from "./gpu-system.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = (s: string) => process.stdout.write(s);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const { values: opts } = parseArgs({
  options: {
    sizes: { type: "string" },
    dprs: { type: "string" },
    tiers: { type: "string", default: "low,balanced,high" },
    scenes: { type: "string" },
    blur: { type: "string", default: "0" },
    seconds: { type: "string" },
    warm: { type: "string" },
    "pass-frames": { type: "string" },
    "marginal-frames": { type: "string" },
    repeat: { type: "string", default: "12" },
    "saturate-frames": { type: "string", default: "30" },
    "ref-frames": { type: "string", default: "91" },
    idle: { type: "string" },
    "profile-seconds": { type: "string" },
    "state-seconds": { type: "string" },
    cold: { type: "string" },
    "warm-starts": { type: "string" },
    element: { type: "string", default: "1920x1080@2:balanced:cloudy@17.5" },
    skip: { type: "string", default: "" },
    out: { type: "string" },
    baseline: { type: "string" },
    headed: { type: "boolean", default: false },
    quick: { type: "boolean", default: false },
  },
});

function list(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");
}

function number(s: string, name: string): number {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name}: not a number: ${s}`);
  return n;
}

function size(s: string): readonly [number, number] {
  const [w, h] = s.split("x").map(Number);
  if (w === undefined || h === undefined || !(w > 0) || !(h > 0)) throw new Error(`bad size: ${s}`);
  return [w, h];
}

function tier(t: string): Tier {
  if (t !== "low" && t !== "balanced" && t !== "high") throw new Error(`bad tier: ${t}`);
  return t;
}

function scene(s: string): { scene: SceneName; hour: number } {
  const [name, hour] = s.split("@");
  const found = SCENE_NAMES.find((n) => n === name);
  if (found === undefined) throw new Error(`bad scene: ${s} (one of ${SCENE_NAMES.join(", ")})`);
  return { scene: found, hour: number(hour ?? "17.5", "scenes") };
}

const quick = opts.quick;
const skip = new Set(list(opts.skip));
// An option given on the command line wins; otherwise --quick picks the short value.
const q = (given: string | undefined, full: string, short: string) =>
  given ?? (quick ? short : full);
const sizes = list(q(opts.sizes, "1280x720,1920x1080,2560x1440", "1280x720")).map(size);
const dprs = list(q(opts.dprs, "1,2", "1")).map((s) => number(s, "dprs"));
const tiers = list(opts.tiers).map(tier);
const scenes = list(q(opts.scenes, "cloudy@17.5,rainy@17.5", "cloudy@17.5")).map(scene);
const blur = number(opts.blur, "blur");
const sampleMs = number(q(opts.seconds, "4", "2"), "seconds") * 1000;
const warmMs = number(q(opts.warm, "1.5", "0.75"), "warm") * 1000;
const passFrames = number(q(opts["pass-frames"], "120", "60"), "pass-frames");
const marginalFrames = number(q(opts["marginal-frames"], "20", "10"), "marginal-frames");
const repeat = Math.max(4, number(opts.repeat, "repeat"));
const saturateFrames = number(opts["saturate-frames"], "saturate-frames");
const refFrames = Math.max(1, number(opts["ref-frames"], "ref-frames"));
const idleMs = number(q(opts.idle, "4", "2"), "idle") * 1000;
const profileMs = number(q(opts["profile-seconds"], "1.5", "1"), "profile-seconds") * 1000;
const stateMs = number(q(opts["state-seconds"], "4", "2"), "state-seconds") * 1000;
const coldStarts = Math.max(1, number(q(opts.cold, "3", "1"), "cold"));
const warmStarts = number(q(opts["warm-starts"], "3", "1"), "warm-starts");
const [elementSize, elementTier, elementScene] = opts.element.split(":");
const [elementWH, elementDpr] = (elementSize ?? "1920x1080@2").split("@");
const elementInput: CaseInput = {
  ...scene(elementScene ?? "cloudy@17.5"),
  tier: tier(elementTier ?? "balanced"),
  width: size(elementWH ?? "1920x1080")[0],
  height: size(elementWH ?? "1920x1080")[1],
  dpr: number(elementDpr ?? "2", "element"),
  blur,
};
const STATES: ElementState[] = ["visible", "offscreen", "hidden", "static", "reduced-motion"];
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = resolve(opts.out ?? join(root, "bench", "results", stamp));
const baselineDir = opts.baseline === undefined ? null : resolve(opts.baseline);

const ARGS = [
  // The real GPU through ANGLE's Metal backend; without these, headless Chromium falls back to SwiftShader.
  "--use-angle=metal",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
  // performance.memory reports exact sizes instead of rounded buckets.
  "--enable-precise-memory-info",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
];

function caseId(c: CaseInput): string {
  const b = c.blur > 0 ? `-blur${c.blur}` : "";
  return `${c.scene}-${c.hour}h-${c.tier}-${c.width}x${c.height}@${c.dpr}x${b}`;
}

function api(page: Page) {
  // These arrow functions run in the page, where gpu.ts set `window.skyeGpu` before body[data-ready] appeared.
  const need = <T>(v: T | undefined): T => {
    if (v === undefined) throw new Error("bench page not ready");
    return v;
  };
  return {
    info: async () => need(await page.evaluate(() => window.skyeGpu?.info())),
    prepare: async (i: CaseInput) =>
      need(await page.evaluate((x) => window.skyeGpu?.prepare(x), i)),
    warm: (ms: number) => page.evaluate((x) => window.skyeGpu?.warm(x), ms),
    paced: async (ms: number) => need(await page.evaluate((x) => window.skyeGpu?.paced(x), ms)),
    passes: async (n: number) => need(await page.evaluate((x) => window.skyeGpu?.passes(x), n)),
    marginal: async (k: number, n: number) =>
      need(await page.evaluate(([a, b]) => window.skyeGpu?.marginal(a, b), [k, n] as const)),
    saturate: async (n: number) => need(await page.evaluate((x) => window.skyeGpu?.saturate(x), n)),
    reference: async (n: number, png: string | null) =>
      need(await page.evaluate(([x, p]) => window.skyeGpu?.reference(x, p), [n, png] as const)),
    startup: async (bundle: string, i: CaseInput) =>
      need(await page.evaluate(([b, x]) => window.skyeGpu?.startup(b, x), [bundle, i] as const)),
    mountElement: (i: CaseInput, w: boolean, instrument: boolean) =>
      page.evaluate(([x, y, z]) => window.skyeGpu?.mountElement(x, y, z), [
        i,
        w,
        instrument,
      ] as const),
    setState: (s: ElementState) => page.evaluate((x) => window.skyeGpu?.setState(x), s),
    begin: () => page.evaluate(() => window.skyeGpu?.begin()),
    end: async () => need(await page.evaluate(() => window.skyeGpu?.end())),
    dispose: () => page.evaluate(() => window.skyeGpu?.dispose()),
  };
}

interface Opened {
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  bench: ReturnType<typeof api>;
}

async function openPage(
  browser: Browser,
  url: string,
  w: number,
  h: number,
  dpr: number,
): Promise<Opened> {
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: dpr,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => out(`  page error: ${e.message}\n`));
  await page.goto(url);
  await page.waitForSelector("body[data-ready=true]", { state: "attached", timeout: 30_000 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  return { context, page, cdp, bench: api(page) };
}

async function traced(
  browser: Browser,
  page: Page,
  body: () => Promise<unknown>,
): Promise<TraceSummary | null> {
  try {
    await browser.startTracing(page, { categories: TRACE_CATEGORIES });
    await body();
    return summarizeTrace(await browser.stopTracing());
  } catch (e) {
    out(`  trace failed: ${String(e)}\n`);
    return null;
  }
}

interface Bundle {
  text: string;
  bytes: number;
  gzip: number;
  brotli: number;
}

interface BunBuild {
  build(options: {
    entrypoints: string[];
    minify: boolean;
    format: "esm";
    target: "browser";
  }): Promise<{
    success: boolean;
    outputs: Array<{ text(): Promise<string> }>;
  }>;
}

// The runner runs under Bun (`bun bench/gpu-run.ts`); its bundler stands in for an app's.
function bunRuntime(): BunBuild {
  const bun: unknown = Reflect.get(globalThis, "Bun");
  if (typeof bun !== "object" || bun === null)
    throw new Error("run this under Bun: bun run bench:gpu");
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Bun's global, typed here for the one call used
  return bun as BunBuild;
}

async function bundleLibrary(): Promise<Bundle> {
  // What an app's bundler makes of the core: one minified ES module.
  const built = await bunRuntime().build({
    entrypoints: [join(root, "src", "index.ts")],
    minify: true,
    format: "esm",
    target: "browser",
  });
  const output = built.outputs[0];
  if (!built.success || output === undefined) throw new Error("bundling src/index.ts failed");
  const text = await output.text();
  const buf = Buffer.from(text);
  return {
    text,
    bytes: buf.length,
    gzip: gzipSync(buf).length,
    brotli: brotliCompressSync(buf).length,
  };
}

function loadBaseline(): Results | null {
  if (baselineDir === null) return null;
  const file = join(baselineDir, "results.json");
  if (!existsSync(file)) throw new Error(`--baseline: ${file} not found`);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by this script
  return JSON.parse(readFileSync(file, "utf8")) as Results;
}

function readPng(file: string): string | null {
  return existsSync(file) ? readFileSync(file).toString("base64") : null;
}

const f = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d);

async function launch(): Promise<{ browser: Browser; cdp: CDPSession | null }> {
  const browser = await chromium.launch({ headless: !opts.headed, args: ARGS });
  let cdp: CDPSession | null = null;
  try {
    cdp = await browser.newBrowserCDPSession();
  } catch {
    cdp = null;
  }
  return { browser, cdp };
}

async function startupIn(
  browser: Browser,
  url: string,
  bundle: Bundle,
  input: CaseInput,
  label: string,
): Promise<Startup> {
  const o = await openPage(browser, url, input.width, input.height, 1);
  try {
    const s = await o.bench.startup(bundle.text, input);
    out(
      `  ${label}: import ${f(s.importMs)} ms, ready ${f(s.readyMs)} ms, first frame ${f(s.firstFrameMs)} ms\n`,
    );
    return s;
  } finally {
    await o.context.close();
  }
}

async function runStartup(url: string, bundle: Bundle): Promise<StartupResult> {
  const input: CaseInput = { ...elementInput, dpr: 1 };
  const cold: Startup[] = [];
  const warm: Startup[] = [];
  for (let i = 0; i < coldStarts; i++) {
    // A new browser has an empty GPU program cache: the compile and link are paid in full.
    // oxlint-disable-next-line no-await-in-loop -- one browser at a time
    const { browser } = await launch();
    try {
      // oxlint-disable-next-line no-await-in-loop -- see above
      cold.push(await startupIn(browser, url, bundle, input, "cold"));
      if (i === coldStarts - 1) {
        for (let j = 0; j < warmStarts; j++) {
          // oxlint-disable-next-line no-await-in-loop -- one page at a time
          warm.push(await startupIn(browser, url, bundle, input, "warm"));
        }
      }
    } finally {
      // oxlint-disable-next-line no-await-in-loop -- see above
      await browser.close();
    }
  }
  return {
    bundle: { bytes: bundle.bytes, gzip: bundle.gzip, brotli: bundle.brotli },
    input,
    cold,
    warm,
  };
}

async function runCase(
  browser: Browser,
  browserCdp: CDPSession | null,
  o: Opened,
  input: CaseInput,
): Promise<CaseResult> {
  const { bench, cdp, page } = o;
  const id = caseId(input);
  const prepared = await bench.prepare(input);
  await bench.warm(warmMs);
  const sys = new SystemWindow(browserCdp, cdp);
  await sys.start(sampleMs / 1000);
  const paced = await bench.paced(sampleMs);
  const system = await sys.stop();
  const passes = await bench.passes(passFrames);
  const marginal = skip.has("marginal") ? null : await bench.marginal(repeat, marginalFrames);
  const saturated = await bench.saturate(saturateFrames);
  let allocations: Allocations | null = null;
  let trace: TraceSummary | null = null;
  if (!skip.has("profile")) {
    allocations = await sampleAllocations(cdp, profileMs / 1000, () => bench.paced(profileMs));
    trace = await traced(browser, page, () => bench.paced(profileMs));
  }
  const basePng = baselineDir === null ? null : readPng(join(baselineDir, "frames", `${id}.png`));
  const ref = await bench.reference(refFrames, basePng);
  await bench.dispose();
  const file = `frames/${id}.png`;
  writeFileSync(join(outDir, file), Buffer.from(ref.png, "base64"));
  const { png: _png, ...refMeta } = ref;
  return {
    id,
    input,
    prepared,
    paced,
    system,
    passes,
    marginal,
    saturated,
    allocations,
    trace,
    reference: { ...refMeta, file },
  };
}

async function runElement(
  browser: Browser,
  browserCdp: CDPSession | null,
  url: string,
  path: "main" | "worker",
): Promise<ElementPathResult> {
  const input = elementInput;
  const o = await openPage(browser, url, input.width, input.height, input.dpr);
  const states: StateResult[] = [];
  let allocations: Allocations | null = null;
  let trace: TraceSummary | null = null;
  try {
    await o.bench.mountElement(input, path === "worker", true);
    for (const state of STATES) {
      /* oxlint-disable no-await-in-loop -- one state at a time */
      await o.page.emulateMedia({
        reducedMotion: state === "reduced-motion" ? "reduce" : "no-preference",
      });
      await o.bench.setState(state);
      const sys = new SystemWindow(browserCdp, o.cdp);
      await sys.start(stateMs / 1000);
      await o.bench.begin();
      await sleep(stateMs);
      const counters = await o.bench.end();
      const system = await sys.stop();
      states.push({ path, state, counters, system });
      out(
        `  ${path} ${state}: ${f(counters.frames / counters.seconds, 1)} frames/s, ` +
          `${f(counters.rafRequests / counters.seconds, 1)} rAF/s, renderer CPU ${f(system.process?.cpu["renderer"], 1)} %, ` +
          `GPU process ${f(system.process?.cpu["gpu-process"], 1)} %, ioreg ${f(system.ioreg?.device, 0)} %\n`,
      );
      /* oxlint-enable no-await-in-loop */
    }
    if (!skip.has("profile")) {
      // Allocations and the trace come from a fresh, uninstrumented element: no GL proxy, no bench code in a worker.
      await o.page.emulateMedia({ reducedMotion: "no-preference" });
      await o.bench.mountElement(input, path === "worker", false);
      allocations = await sampleAllocations(o.cdp, profileMs / 1000, () => sleep(profileMs));
      trace = await traced(browser, o.page, () => sleep(profileMs));
    }
  } finally {
    await o.page.emulateMedia({ reducedMotion: "no-preference" });
    await o.context.close();
  }
  return { path, input, states, allocations, trace };
}

async function runMatrix(
  browser: Browser,
  cdp: CDPSession | null,
  url: string,
): Promise<CaseResult[]> {
  const cases: CaseResult[] = [];
  const total = sizes.length * dprs.length * tiers.length * scenes.length;
  for (const [w, h] of sizes) {
    for (const dpr of dprs) {
      // oxlint-disable-next-line no-await-in-loop -- cases share one GPU and run one at a time
      const o = await openPage(browser, url, w, h, dpr);
      for (const sc of scenes) {
        for (const t of tiers) {
          const input: CaseInput = {
            scene: sc.scene,
            hour: sc.hour,
            tier: t,
            width: w,
            height: h,
            dpr,
            blur,
          };
          out(`[${cases.length + 1}/${total}] ${caseId(input)} `);
          // oxlint-disable-next-line no-await-in-loop -- see above
          const c = await runCase(browser, cdp, o, input);
          cases.push(c);
          const parity = c.reference.parity;
          out(
            `gpu ${f(c.paced.gpu?.p50)} ms, cpu ${f(c.paced.cpu.p50, 3)} ms, saturated ${f(c.saturated.msPerFrame)} ms, ` +
              `ioreg ${f(c.system.ioreg?.device, 0)} %${parity === null ? "" : `, parity ${parity.pass ? "pass" : "FAIL"}`}\n`,
          );
        }
      }
      // oxlint-disable-next-line no-await-in-loop -- see above
      await o.context.close();
    }
  }
  return cases;
}

async function main(): Promise<void> {
  const baseline = loadBaseline();
  mkdirSync(join(outDir, "frames"), { recursive: true });
  const bundle = await bundleLibrary();
  const server = await createServer({
    configFile: join(root, "bench", "vite.config.ts"),
    logLevel: "warn",
    server: {
      port: 0,
      strictPort: false,
      // Cross-origin isolation: performance.now() then resolves to 5 µs instead of 100 µs.
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (base === undefined) throw new Error("vite did not report a URL");
  const url = new URL("gpu.html", base).href;
  const thermalStart = await thermal();
  try {
    let startup: StartupResult | null = null;
    if (!skip.has("startup")) {
      out("startup\n");
      startup = await runStartup(url, bundle);
    }
    const { browser, cdp } = await launch();
    try {
      const probe = await openPage(browser, url, 1280, 720, 1);
      const env = await probe.bench.info();
      out(
        `renderer: ${env.renderer}\ntimer: ${env.timer ? `TIME_ELAPSED ${env.timerBits} bits` : "unavailable"}; ` +
          `cross-origin isolated: ${String(env.crossOriginIsolated)}\n`,
      );
      if (/swiftshader|llvmpipe|software/i.test(env.renderer)) {
        throw new Error(`software rendering (${env.renderer}): GPU numbers would be meaningless`);
      }
      out(`idle baseline, ${idleMs / 1000} s\n`);
      const idleWindow = new SystemWindow(cdp, probe.cdp);
      await idleWindow.start(idleMs / 1000);
      await sleep(idleMs);
      const idle = await idleWindow.stop();
      await probe.context.close();

      const cases = await runMatrix(browser, cdp, url);

      const element: ElementPathResult[] = [];
      if (!skip.has("element")) {
        out(`element ${caseId(elementInput)}\n`);
        for (const path of ["main", "worker"] as const) {
          // oxlint-disable-next-line no-await-in-loop -- one path at a time
          element.push(await runElement(browser, cdp, url, path));
        }
      }

      out(`idle again, ${idleMs / 1000} s\n`);
      const after = await openPage(browser, url, 1280, 720, 1);
      const afterWindow = new SystemWindow(cdp, after.cdp);
      await afterWindow.start(idleMs / 1000);
      await sleep(idleMs);
      const idleAfter = await afterWindow.stop();
      await after.context.close();

      const results: Results = {
        date: new Date().toISOString(),
        machine: await machine(),
        browser: {
          version: `Chromium ${browser.version()}`,
          mode: opts.headed ? "headed" : "headless",
          args: ARGS,
        },
        env,
        thermal: { start: thermalStart, end: await thermal() },
        settings: {
          sizes,
          dprs,
          tiers,
          scenes,
          blur,
          sampleMs,
          warmMs,
          passFrames,
          marginalFrames,
          repeat,
          saturateFrames,
          refFrames,
          idleMs,
          profileMs,
          stateMs,
          seed: 3,
          element: elementInput,
          skip: [...skip],
        },
        idle,
        idleAfter,
        startup,
        cases,
        element,
      };
      writeFileSync(join(outDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
      const md = report(results, baseline);
      writeFileSync(join(outDir, "report.md"), md);
      out(`\n${md}\nwritten to ${outDir}\n`);
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
}

await main();
