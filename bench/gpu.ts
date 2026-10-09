// The page side of `bun run bench:gpu`. The runner (`gpu-run.ts`) calls the phases one by one through
// `window.skyeGpu`, so it can sample system counters around exactly the window it wants.
//
// - Matrix phases drive one sky per case with `render(t)` at fixed animation times (frame i draws t = i/60), so
//   every run draws the same frames whatever the display does.
// - `startup` imports a bundled build from a blob and times the first frame in a fresh page.
// - The element phases mount a real `<skye-view>`, on the main thread or in a worker, and let its own loop run,
//   to see what it costs in each visibility and motion state.
// Everything is measured from outside the renderer: see `gl-probe.ts`.
import { createSky, type Sky } from "../src/index.ts";
import { CONTEXT_ATTRIBUTES } from "../src/gl/context.ts";
import { toAttributes } from "../src/element/attributes.ts";
import { defineSkye } from "../src/element/define.ts";
import { MAX_DIFF, MIN_CLOSE } from "../test/parity/compare.ts";
import { CALL_GROUPS, GlProbe, type FrameRecord, type SegmentCount } from "./gl-probe.ts";
import type {
  CallCounts,
  CaseInput,
  Dist,
  ElementState,
  EnvInfo,
  GpuBenchApi,
  Marginal,
  Paced,
  Parity,
  PassCost,
  Passes,
  Prepared,
  Reference,
  Saturated,
  StateCounters,
  Startup,
} from "./gpu-protocol.ts";
import { CHANNEL } from "./gpu-protocol.ts";

const SEED = 3;
const STEP_S = 1 / 60;
const PASS_ORDER = ["sky", "composite", "particles", "mipmap", "rays", "glass", "blur", "other"];
const WORKER_URL = new URL("./gpu-worker.ts", import.meta.url).href;
const PLAIN_WORKER_URL = new URL("../src/worker/worker.ts", import.meta.url).href;

interface Running {
  input: CaseInput;
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  probe: GlProbe;
  sky: Sky;
  frame: number;
}

let current: Running | null = null;
let refreshMs = 1000 / 60;

// --------------------------------------------------------------------------------------------------------------
// Page-wide observers: long tasks, animation-frame requests, and (for the element phases) every WebGL2 context.

const longTasks: Array<{ start: number; duration: number }> = [];
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longTasks.push({ start: e.startTime, duration: e.duration });
  }).observe({ type: "longtask", buffered: true });
} catch {
  // No long-task timing in this browser.
}

// The bench's own frames use the original; only the page's other requests (the sky's loop) are counted.
const raf = window.requestAnimationFrame.bind(window);
let rafRequests = 0;
window.requestAnimationFrame = (cb) => {
  rafRequests++;
  return raf(cb);
};

let hookContexts = false;
const pageProbes: GlProbe[] = [];
const hooked = new WeakSet<WebGL2RenderingContext>();
/* oxlint-disable typescript/unbound-method, typescript/no-unsafe-type-assertion -- wraps an overloaded DOM method */
const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
  const ctx: unknown = Reflect.apply(getContext, this, args);
  if (
    hookContexts &&
    args[0] === "webgl2" &&
    ctx instanceof WebGL2RenderingContext &&
    !hooked.has(ctx)
  ) {
    hooked.add(ctx);
    pageProbes.push(new GlProbe(ctx));
  }
  return ctx;
} as typeof getContext;
/* oxlint-enable typescript/unbound-method, typescript/no-unsafe-type-assertion */

let workerCounts: { frames: number; calls: Record<string, number> } = { frames: 0, calls: {} };
new BroadcastChannel(CHANNEL).onmessage = (e: MessageEvent<typeof workerCounts>) => {
  workerCounts = e.data;
};

/** `performance.memory.usedJSHeapSize` in MB (Chromium only; exact with --enable-precise-memory-info). */
function heapMB(): number {
  const m: unknown = Reflect.get(performance, "memory");
  const used: unknown =
    typeof m === "object" && m !== null ? Reflect.get(m, "usedJSHeapSize") : undefined;
  return typeof used === "number" ? used / 2 ** 20 : NaN;
}

// --------------------------------------------------------------------------------------------------------------

function dist(values: ReadonlyArray<number>): Dist {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (q: number) =>
    s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] ?? NaN;
  return {
    n: s.length,
    mean: s.length > 0 ? s.reduce((a, b) => a + b, 0) / s.length : NaN,
    min: s[0] ?? NaN,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: s[s.length - 1] ?? NaN,
  };
}

const nextFrame = () => new Promise<number>((resolve) => raf(resolve));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function callCounts(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
  frames: number,
): CallCounts {
  const diff = new Map<string, number>();
  for (const [k, v] of after) {
    const d = v - (before.get(k) ?? 0);
    if (d > 0) diff.set(k, d);
  }
  const per = Math.max(1, frames);
  const perFrame: Record<string, number> = {};
  let total = 0;
  for (const v of diff.values()) total += v;
  perFrame["total"] = total / per;
  for (const [group, names] of Object.entries(CALL_GROUPS)) {
    perFrame[group] = names.reduce((a, n) => a + (diff.get(n) ?? 0), 0) / per;
  }
  return {
    frames,
    perFrame,
    top: [...diff.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([k, v]) => [k, v / per] as [string, number]),
  };
}

function running(): Running {
  if (current === null) throw new Error("no case prepared");
  return current;
}

function mountCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;display:block";
  document.body.append(canvas);
  return canvas;
}

function release(canvas: HTMLCanvasElement, sky: Sky | null): void {
  sky?.dispose();
  // Free the context at once: a matrix of cases would otherwise reach the browser's context limit.
  canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  canvas.remove();
}

function params(input: CaseInput) {
  return {
    scene: input.scene,
    hour: input.hour,
    seed: SEED,
    motion: "full",
    quality: input.tier,
    blur: input.blur,
  } as const;
}

function whenReady(sky: Pick<Sky, "on">): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("sky not ready after 10 s")), 10_000);
    sky.on("error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    sky.on("ready", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

/** Blocks until the GPU has finished everything submitted: a one-pixel read waits for the drawing buffer. */
function sync(gl: WebGL2RenderingContext): void {
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
}

/** Draws the case's next frame, timed by the probe. Returns the JS time of `render`. */
function drawNext(r: Running): number {
  r.probe.beginFrame();
  const c0 = performance.now();
  r.sky.render(r.frame * STEP_S);
  const cpu = performance.now() - c0;
  r.probe.endFrame();
  r.frame++;
  return cpu;
}

/** Keeps polling until every query in flight has landed (or two seconds pass). */
async function drain(probe: GlProbe, into: FrameRecord[]): Promise<void> {
  const t0 = performance.now();
  while (probe.pendingFrames > 0 && performance.now() - t0 < 2000) {
    // oxlint-disable-next-line no-await-in-loop -- results land between frames
    await nextFrame();
    into.push(...probe.harvest());
  }
}

async function measureRefresh(): Promise<number> {
  const stamps: number[] = [];
  for (let i = 0; i < 61; i++) {
    // oxlint-disable-next-line no-await-in-loop -- one stamp per frame
    stamps.push(await nextFrame());
  }
  return dist(stamps.slice(1).map((t, i) => t - (stamps[i] ?? t))).p50;
}

async function info(): Promise<EnvInfo> {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
  if (gl === null) throw new Error("WebGL2 unavailable");
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const probe = new GlProbe(gl);
  refreshMs = await measureRefresh();
  const env: EnvInfo = {
    renderer: String(gl.getParameter(dbg === null ? gl.RENDERER : dbg.UNMASKED_RENDERER_WEBGL)),
    vendor: String(gl.getParameter(dbg === null ? gl.VENDOR : dbg.UNMASKED_VENDOR_WEBGL)),
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    timer: probe.timer,
    timerBits: probe.timerBits,
    timestampBits: probe.timestampBits,
    halfFloat: gl.getExtension("EXT_color_buffer_float") !== null,
    refreshMs,
    crossOriginIsolated: window.crossOriginIsolated,
    parallelCompile: gl.getExtension("KHR_parallel_shader_compile") !== null,
  };
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return env;
}

// --------------------------------------------------------------------------------------------------------------
// Matrix phases

async function prepare(input: CaseInput): Promise<Prepared> {
  dispose();
  const canvas = mountCanvas();
  // Taken before `createSky`, with its attributes, so the renderer receives this same, instrumented context.
  const gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
  if (gl === null) throw new Error("WebGL2 unavailable");
  const probe = new GlProbe(gl);
  const t0 = performance.now();
  const sky = createSky(canvas, params(input));
  const createMs = performance.now() - t0;
  const r: Running = { input, canvas, gl, probe, sky, frame: 0 };
  current = r;
  await whenReady(sky);
  const readyMs = performance.now() - t0;
  sky.resize(input.width, input.height, input.dpr);
  drawNext(r);
  sync(gl);
  const firstFrameMs = performance.now() - t0;
  probe.harvest();
  const s = sky.stats();
  const targets = probe.targets();
  return {
    out: s.out,
    sky: s.sky,
    scene: s.scene,
    hdr: s.hdr,
    fpsCap: s.fpsCap,
    targets,
    targetBytes: targets.reduce((a, t) => a + t.bytes, 0),
    canvasBytes: s.out[0] * s.out[1] * 4,
    bufferBytes: probe.bufferBytes,
    createMs,
    readyMs,
    firstFrameMs,
  };
}

async function warm(ms: number): Promise<void> {
  const r = running();
  r.probe.mode = "off";
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    // oxlint-disable-next-line no-await-in-loop -- one frame per display refresh
    await nextFrame();
    drawNext(r);
    r.probe.harvest();
  }
  sync(r.gl);
}

async function paced(ms: number): Promise<Paced> {
  const r = running();
  r.probe.mode = "frame";
  const stamps: number[] = [];
  const cpu: number[] = [];
  const records: FrameRecord[] = [];
  const calls0 = r.probe.snapshot();
  const frames0 = r.probe.framesDrawn;
  const heapStartMB = heapMB();
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    // oxlint-disable-next-line no-await-in-loop -- one frame per display refresh
    stamps.push(await nextFrame());
    cpu.push(drawNext(r));
    records.push(...r.probe.harvest());
  }
  const durationMs = performance.now() - t0;
  const calls = callCounts(calls0, r.probe.snapshot(), r.probe.framesDrawn - frames0);
  const heapEndMB = heapMB();
  await drain(r.probe, records);
  r.probe.mode = "off";
  const intervals = stamps.slice(1).map((t, i) => t - (stamps[i] ?? t));
  let dropped = 0;
  for (const d of intervals) if (d > 1.5 * refreshMs) dropped += Math.round(d / refreshMs) - 1;
  const gpu = records.filter((f) => !f.disjoint).map((f) => f.gpu.get("frame") ?? NaN);
  const long = longTasks.filter((l) => l.start >= t0);
  const s = r.sky.stats();
  return {
    frames: stamps.length,
    durationMs,
    interval: dist(intervals),
    dropped,
    droppedShare: dropped / Math.max(1, dropped + intervals.length),
    cpu: dist(cpu),
    gpu: r.probe.timer ? dist(gpu) : null,
    disjoint: records.filter((f) => f.disjoint).length,
    fps: (stamps.length * 1000) / durationMs,
    mpx: s.mpx,
    passes: s.passes,
    calls,
    longTasks: long.length,
    longTaskMs: long.reduce((a, l) => a + l.duration, 0),
    heapStartMB,
    heapEndMB,
  };
}

function addCounts(into: SegmentCount, c: SegmentCount): void {
  into.draws += c.draws;
  into.instances += c.instances;
  into.pixels += c.pixels;
  into.bytesWritten += c.bytesWritten;
  for (const t of c.targets) into.targets.add(t);
}

async function timedFrames(r: Running, frames: number): Promise<FrameRecord[]> {
  const records: FrameRecord[] = [];
  for (let i = 0; i < frames; i++) {
    // oxlint-disable-next-line no-await-in-loop -- one frame per display refresh
    await nextFrame();
    drawNext(r);
    records.push(...r.probe.harvest());
  }
  await drain(r.probe, records);
  return records.filter((f) => !f.disjoint);
}

async function passes(frames: number): Promise<Passes> {
  const r = running();
  r.probe.mode = "pass";
  const ok = await timedFrames(r, frames);
  r.probe.mode = "off";
  const names = new Set<string>();
  for (const f of ok) for (const n of f.counts.keys()) names.add(n);
  const ordered = [...names].sort((a, b) => PASS_ORDER.indexOf(a) - PASS_ORDER.indexOf(b));
  const costs: PassCost[] = ordered.map((name) => {
    const sum: SegmentCount = {
      draws: 0,
      instances: 0,
      pixels: 0,
      bytesWritten: 0,
      targets: new Set(),
    };
    let ran = 0;
    const gpu: number[] = [];
    for (const f of ok) {
      const c = f.counts.get(name);
      if (c === undefined) continue;
      ran++;
      addCounts(sum, c);
      const ms = f.gpu.get(name);
      if (ms !== undefined) gpu.push(ms);
    }
    const per = Math.max(1, ran);
    return {
      name,
      gpu: r.probe.timer && gpu.length > 0 ? dist(gpu) : null,
      frames: ran,
      draws: sum.draws / per,
      instances: sum.instances / per,
      pixels: sum.pixels / per,
      bytesWritten: sum.bytesWritten / per,
      targets: [...sum.targets],
    };
  });
  const timed = costs.filter((c) => c.gpu !== null);
  return {
    frames: ok.length,
    passes: costs,
    sumP50: timed.length > 0 ? timed.reduce((a, c) => a + (c.gpu?.p50 ?? 0), 0) : null,
    drawsPerFrame: costs.reduce((a, c) => a + c.draws * (c.frames / Math.max(1, ok.length)), 0),
  };
}

/** Wall ms per frame for `frames` frames drawn back to back, then a one-pixel read: best of two rounds. */
async function wallPerFrame(r: Running, frames: number): Promise<number> {
  let best = Infinity;
  for (let round = 0; round < 2; round++) {
    // oxlint-disable-next-line no-await-in-loop -- rounds must not overlap
    await nextFrame();
    for (let i = 0; i < 3; i++) r.sky.render(r.frame++ * STEP_S);
    sync(r.gl);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) r.sky.render(r.frame++ * STEP_S);
    sync(r.gl);
    best = Math.min(best, (performance.now() - t0) / frames);
  }
  return best;
}

async function marginal(repeat: number, frames: number): Promise<Marginal> {
  const r = running();
  r.probe.mode = "off";
  try {
    const names = new Set<string>();
    r.probe.beginFrame();
    r.sky.render(r.frame++ * STEP_S);
    r.probe.endFrame();
    for (const f of r.probe.harvest()) for (const n of f.counts.keys()) names.add(n);
    const ordered = [...names]
      .filter((n) => n !== "other")
      .sort((a, b) => PASS_ORDER.indexOf(a) - PASS_ORDER.indexOf(b));
    r.probe.repeatPass = null;
    const baseMs = await wallPerFrame(r, frames);
    // The slope between two repeat counts, both well above one: at one repeat the frame can be bound by
    // submission rather than by the GPU, which would hide part of the pass's cost.
    const low = Math.max(2, Math.round(repeat / 2));
    const out: Array<{ name: string; ms: number }> = [];
    for (const name of ordered) {
      r.probe.repeatPass = name;
      r.probe.repeatCount = low;
      // oxlint-disable-next-line no-await-in-loop -- one pass at a time on one GPU
      const a = await wallPerFrame(r, frames);
      r.probe.repeatCount = repeat;
      // oxlint-disable-next-line no-await-in-loop -- see above
      const b = await wallPerFrame(r, frames);
      out.push({ name, ms: (b - a) / (repeat - low) });
    }
    return { repeat, frames, baseMs, passes: out };
  } finally {
    r.probe.repeatPass = null;
    r.probe.repeatCount = 1;
  }
}

async function saturate(frames: number): Promise<Saturated> {
  const r = running();
  r.probe.mode = "off";
  return { frames, msPerFrame: await wallPerFrame(r, frames) };
}

// --------------------------------------------------------------------------------------------------------------
// Reference frames

/** Draws frames 0..frames-1 on a fresh sky and reads the last one back, top row first. */
async function referenceFrame(
  input: CaseInput,
  frames: number,
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  const canvas = mountCanvas();
  const sky = createSky(canvas, params(input));
  try {
    await whenReady(sky);
    sky.resize(input.width, input.height, input.dpr);
    for (let i = 0; i < frames; i++) sky.render(i * STEP_S);
    const gl = canvas.getContext("webgl2");
    if (gl === null) throw new Error("context gone");
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const raw = new Uint8Array(width * height * 4);
    // Read in the task that drew it: the drawing buffer is not preserved past compositing.
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const pixels = new Uint8Array(raw.length);
    const row = width * 4;
    for (let y = 0; y < height; y++)
      pixels.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    return { pixels, width, height };
  } finally {
    release(canvas, sky);
  }
}

async function encodePng(pixels: Uint8Array, width: number, height: number): Promise<string> {
  const c = new OffscreenCanvas(width, height);
  const ctx = c.getContext("2d");
  if (ctx === null) throw new Error("2d context unavailable");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  const bytes = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function decodePng(
  png: string,
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  const bin = atob(png);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = c.getContext("2d");
  if (ctx === null) throw new Error("2d context unavailable");
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  return { pixels: new Uint8Array(data.buffer), width: bitmap.width, height: bitmap.height };
}

/** The parity gate's tolerance: 99.9 % of channels within 1/255, none beyond 4/255. */
function compareImages(
  base: { pixels: Uint8Array; width: number; height: number },
  cand: { pixels: Uint8Array; width: number; height: number },
): Parity {
  if (base.width !== cand.width || base.height !== cand.height) {
    return { pass: false, closePercent: 0, maxDiff: 255, worst: null };
  }
  let close = 0;
  let worstIndex = -1;
  let maxDiff = 0;
  const a = base.pixels;
  const b = cand.pixels;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    if (d <= 1) close++;
    if (d > maxDiff) {
      maxDiff = d;
      worstIndex = i;
    }
  }
  const share = close / a.length;
  const px = Math.floor(worstIndex / 4);
  return {
    pass: share >= MIN_CLOSE && maxDiff <= MAX_DIFF,
    closePercent: share * 100,
    maxDiff,
    worst:
      worstIndex < 0
        ? null
        : {
            x: px % base.width,
            y: Math.floor(px / base.width),
            channel: worstIndex % 4,
            baseline: a[worstIndex] ?? 0,
            candidate: b[worstIndex] ?? 0,
          },
  };
}

async function reference(frames: number, baselinePng: string | null): Promise<Reference> {
  const input = running().input;
  const first = await referenceFrame(input, frames);
  const second = await referenceFrame(input, frames);
  const png = await encodePng(first.pixels, first.width, first.height);
  // The PNG must decode back to the exact bytes, or a later comparison would measure the codec.
  const roundTrip = compareImages(first, await decodePng(png));
  if (roundTrip.maxDiff !== 0) throw new Error("PNG round trip changed pixels");
  return {
    width: first.width,
    height: first.height,
    time: (frames - 1) * STEP_S,
    frames,
    png,
    deterministic: compareImages(first, second).maxDiff === 0,
    parity: baselinePng === null ? null : compareImages(await decodePng(baselinePng), first),
  };
}

function dispose(): void {
  if (current !== null) release(current.canvas, current.sky);
  current = null;
  for (const el of document.querySelectorAll("skye-view")) el.remove();
  document.getElementById("box")?.remove();
}

// --------------------------------------------------------------------------------------------------------------
// Startup: a bundled build, imported from a blob into this (fresh) page.

interface SkyModule {
  createSky: typeof createSky;
}

async function startup(bundle: string, input: CaseInput): Promise<Startup> {
  const heap0 = heapMB();
  const url = URL.createObjectURL(new Blob([bundle], { type: "text/javascript" }));
  const i0 = performance.now();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the bundle of src/index.ts
  const mod = (await import(/* @vite-ignore */ url)) as SkyModule;
  const importMs = performance.now() - i0;
  const canvas = mountCanvas();
  const t0 = performance.now();
  const sky = mod.createSky(canvas, params(input));
  const createMs = performance.now() - t0;
  await whenReady(sky);
  const readyMs = performance.now() - t0;
  sky.resize(input.width, input.height, input.dpr);
  const r0 = performance.now();
  sky.render(0);
  const firstRenderMs = performance.now() - r0;
  const gl = canvas.getContext("webgl2");
  if (gl !== null) sync(gl);
  const firstFrameMs = performance.now() - t0;
  const heap = heapMB() - heap0;
  release(canvas, sky);
  return {
    bundleBytes: bundle.length,
    importMs,
    createMs,
    readyMs,
    firstRenderMs,
    firstFrameMs,
    heapMB: heap,
  };
}

// --------------------------------------------------------------------------------------------------------------
// Element phases: a real <skye-view> with its own loop.

let hidden = false;
Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
Object.defineProperty(document, "visibilityState", {
  configurable: true,
  get: () => (hidden ? "hidden" : "visible"),
});

let element:
  | (HTMLElement & { stats(): { quality: string; out: [number, number]; worker: boolean } | null })
  | null = null;
let elementWorker = false;

async function mountElement(input: CaseInput, worker: boolean, instrument: boolean): Promise<void> {
  dispose();
  defineSkye();
  hookContexts = instrument && !worker;
  elementWorker = worker;
  const box = document.createElement("div");
  box.id = "box";
  box.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh";
  const el = document.createElement("skye-view") as NonNullable<typeof element>;
  for (const [name, value] of Object.entries(toAttributes(params(input))))
    el.setAttribute(name, value);
  // The plain worker entry when not instrumenting, so nothing of the bench runs in the worker.
  if (worker) el.setAttribute("worker", instrument ? WORKER_URL : PLAIN_WORKER_URL);
  box.append(el);
  document.body.append(box);
  element = el;
  const t0 = performance.now();
  while ((el.stats()?.out[0] ?? 0) <= 1 && performance.now() - t0 < 10_000) {
    // oxlint-disable-next-line no-await-in-loop -- polling for the first frame
    await sleep(30);
  }
  hookContexts = false;
  await sleep(500);
}

async function setState(state: ElementState): Promise<void> {
  const el = element;
  const box = document.getElementById("box");
  if (el === null || box === null) throw new Error("no element mounted");
  box.style.transform = state === "offscreen" ? "translateY(300vh)" : "";
  el.setAttribute(
    "motion",
    state === "static" ? "static" : state === "reduced-motion" ? "auto" : "full",
  );
  const wasHidden = hidden;
  hidden = state === "hidden";
  if (wasHidden !== hidden) document.dispatchEvent(new Event("visibilitychange"));
  // Observers report on the next frames; let the element settle into the state before measuring.
  await sleep(600);
}

let windowStart: {
  t: number;
  frames: number;
  raf: number;
  calls: Map<string, number>;
  heap: number;
} = { t: 0, frames: 0, raf: 0, calls: new Map(), heap: 0 };

function elementCounters(): { frames: number; calls: Map<string, number> } {
  if (elementWorker)
    return { frames: workerCounts.frames, calls: new Map(Object.entries(workerCounts.calls)) };
  const calls = new Map<string, number>();
  let frames = 0;
  for (const p of pageProbes) {
    frames += p.framesDrawn;
    for (const [k, v] of p.calls) calls.set(k, (calls.get(k) ?? 0) + v);
  }
  return { frames, calls };
}

function begin(): void {
  const c = elementCounters();
  windowStart = {
    t: performance.now(),
    frames: c.frames,
    raf: rafRequests,
    calls: c.calls,
    heap: heapMB(),
  };
}

function end(): StateCounters {
  const c = elementCounters();
  const seconds = (performance.now() - windowStart.t) / 1000;
  const frames = c.frames - windowStart.frames;
  const long = longTasks.filter((l) => l.start >= windowStart.t);
  const s = element?.stats() ?? null;
  return {
    seconds,
    frames,
    rafRequests: rafRequests - windowStart.raf,
    longTasks: long.length,
    longTaskMs: long.reduce((a, l) => a + l.duration, 0),
    calls: callCounts(windowStart.calls, c.calls, frames),
    heapStartMB: windowStart.heap,
    heapEndMB: heapMB(),
    quality: s?.quality ?? "?",
    out: s?.out ?? [0, 0],
    worker: s?.worker ?? false,
  };
}

const api: GpuBenchApi = {
  info,
  prepare,
  warm,
  paced,
  passes,
  marginal,
  saturate,
  reference,
  startup,
  mountElement,
  setState,
  begin,
  end,
  dispose,
};
window.skyeGpu = api;
document.body.dataset["ready"] = "true";
