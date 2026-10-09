// What the GPU bench page (`gpu.ts`) and its runner (`gpu-run.ts`) exchange through Playwright. Plain data only:
// every value crosses `page.evaluate` as JSON.
import type { SceneName, Tier } from "../src/index.ts";

/** BroadcastChannel on which the worker hook (gpu-worker-hook.ts) reports its counters to the page. */
export const CHANNEL = "skye-gpu-bench";

/** One configuration to measure. */
export interface CaseInput {
  scene: SceneName;
  hour: number;
  tier: Tier;
  /** CSS px of the canvas. */
  width: number;
  height: number;
  /** Device pixel ratio passed to `resize`; the tier still applies its own cap. */
  dpr: number;
  /** Background blur in CSS px; 0 for none. */
  blur: number;
}

/** p50/p95/p99 plus mean, min and max of a sample, in its own unit. */
export interface Dist {
  n: number;
  mean: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface EnvInfo {
  renderer: string;
  vendor: string;
  userAgent: string;
  devicePixelRatio: number;
  /** `EXT_disjoint_timer_query_webgl2` is exposed. */
  timer: boolean;
  /** Bits of the TIME_ELAPSED counter; 0 means the queries never return data. */
  timerBits: number;
  /** Bits of the TIMESTAMP counter; 0 means `queryCounterEXT` is unusable. */
  timestampBits: number;
  halfFloat: boolean;
  /** Median `requestAnimationFrame` interval, ms. */
  refreshMs: number;
  /** Cross-origin isolated, so `performance.now()` resolves to 5 µs rather than 100 µs. */
  crossOriginIsolated: boolean;
  /** `KHR_parallel_shader_compile` is exposed. */
  parallelCompile: boolean;
}

/** One render target as allocated by the renderer, read from the wrapped `texImage2D` calls. */
export interface TargetInfo {
  name: string;
  format: string;
  width: number;
  height: number;
  mipmapped: boolean;
  bytes: number;
}

export interface Prepared {
  /** Canvas backing store after the first frame. */
  out: [number, number];
  sky: [number, number];
  scene: [number, number];
  hdr: string;
  fpsCap: number;
  targets: TargetInfo[];
  /** Render-target bytes, mip chains included; the canvas's own drawing buffer is `canvasBytes`. */
  targetBytes: number;
  /** One RGBA8 drawing buffer at the canvas size; the compositor holds further copies. */
  canvasBytes: number;
  /** Vertex buffer bytes. */
  bufferBytes: number;
  /** `createSky` call, ms (context, programs and targets created; compiles started). */
  createMs: number;
  /** From `createSky` to "ready" (every program linked), ms. */
  readyMs: number;
  /** From `createSky` to the first frame's pixels read back, ms. */
  firstFrameMs: number;
}

/** GL calls per drawn frame, by group (see CALL_GROUPS) and the most frequent methods. */
export interface CallCounts {
  frames: number;
  perFrame: Record<string, number>;
  top: Array<[string, number]>;
}

/** Paced phase: one `render` per animation frame, with one GPU query around the whole frame. */
export interface Paced {
  frames: number;
  durationMs: number;
  /** Intervals between animation frames, ms. */
  interval: Dist;
  /** Intervals longer than 1.5 display refreshes, counted in frames the display would have shown. */
  dropped: number;
  droppedShare: number;
  /** JS time of one `render` call, ms. */
  cpu: Dist;
  /** GPU time of one frame (TIME_ELAPSED around `render`), ms; null without a timer. */
  gpu: Dist | null;
  /** Frames whose query was discarded for a disjoint event. */
  disjoint: number;
  fps: number;
  /** The renderer's own count of shaded megapixels per frame. */
  mpx: number;
  passes: number;
  calls: CallCounts;
  longTasks: number;
  longTaskMs: number;
  /** `performance.memory.usedJSHeapSize` at the start and end of the phase, MB. */
  heapStartMB: number;
  heapEndMB: number;
}

/**
 * Each pass's draws issued `repeat` times, frames drawn back to back: (wall_repeat - wall_base) / (repeat - 1),
 * in ms per frame. No query splits the work and the GPU runs at full clock.
 */
export interface Marginal {
  repeat: number;
  frames: number;
  /** Wall ms per frame without repeats. */
  baseMs: number;
  passes: Array<{ name: string; ms: number }>;
}

/** What one pass did in a frame, from the wrapped GL calls. */
export interface PassCost {
  name: string;
  /** GPU ms per frame, from one TIME_ELAPSED query per pass; null without a timer. */
  gpu: Dist | null;
  /** Frames in which the pass ran. */
  frames: number;
  draws: number;
  instances: number;
  /** Viewport pixels covered by full-screen draws (instanced quads are not counted). */
  pixels: number;
  /** `pixels` times the bytes per pixel of the target written. */
  bytesWritten: number;
  /** Render targets the pass wrote, as "name WxH format". */
  targets: string[];
}

export interface Passes {
  frames: number;
  passes: PassCost[];
  /** Sum of the per-pass p50s, ms. */
  sumP50: number | null;
  drawsPerFrame: number;
}

/** Back-to-back frames with `finish` at the end: wall time per frame with the GPU saturated. */
export interface Saturated {
  frames: number;
  msPerFrame: number;
}

/** Cold start of the bundled library in a fresh page. */
export interface Startup {
  bundleBytes: number;
  /** Dynamic import of the bundle (fetch from a blob, parse, evaluate), ms. */
  importMs: number;
  createMs: number;
  readyMs: number;
  /** CPU of the first `render`, ms. */
  firstRenderMs: number;
  /** From `createSky` to the first frame's pixels read back, ms. */
  firstFrameMs: number;
  /** JS heap growth from before the import to after the first frame, MB. */
  heapMB: number;
}

export type ElementState = "visible" | "offscreen" | "hidden" | "static" | "reduced-motion";

/** What the page saw during one window of an element in a given state. */
export interface StateCounters {
  seconds: number;
  /** Frames the renderer drew (main thread or worker). */
  frames: number;
  /** `requestAnimationFrame` requests made on the page. */
  rafRequests: number;
  longTasks: number;
  longTaskMs: number;
  calls: CallCounts;
  heapStartMB: number;
  heapEndMB: number;
  /** The element's stats at the end. */
  quality: string;
  out: [number, number];
  worker: boolean;
}

export interface Parity {
  pass: boolean;
  closePercent: number;
  maxDiff: number;
  /** Worst channel, top-left origin. */
  worst: { x: number; y: number; channel: number; baseline: number; candidate: number } | null;
}

export interface Reference {
  width: number;
  height: number;
  /** Animation time of the frame, seconds. */
  time: number;
  frames: number;
  /** PNG, base64. */
  png: string;
  /** Two fresh skies drew bit-identical frames. */
  deterministic: boolean;
  /** Against the baseline's frame, when one was given. */
  parity: Parity | null;
}

/** The functions `gpu.ts` puts on `window` for the runner. */
export interface GpuBenchApi {
  info(): Promise<EnvInfo>;
  prepare(input: CaseInput): Promise<Prepared>;
  warm(ms: number): Promise<void>;
  paced(ms: number): Promise<Paced>;
  passes(frames: number): Promise<Passes>;
  marginal(repeat: number, frames: number): Promise<Marginal>;
  saturate(frames: number): Promise<Saturated>;
  startup(bundle: string, input: CaseInput): Promise<Startup>;
  mountElement(input: CaseInput, worker: boolean, instrument: boolean): Promise<void>;
  setState(state: ElementState): Promise<void>;
  begin(): void;
  end(): StateCounters;
  reference(frames: number, baselinePng: string | null): Promise<Reference>;
  dispose(): void;
}

declare global {
  interface Window {
    skyeGpu?: GpuBenchApi;
  }
}
