import { getWebGL2, Gpu, type SkyCanvas } from "../gl/context.ts";
import { hdrEncoding } from "../gl/target.ts";
import { GpuTimer } from "../gl/timer.ts";
import type { PassFrame } from "../passes/frame.ts";
import { Pipeline } from "../passes/pipeline.ts";
import { Easer } from "./easing.ts";
import { Emitter } from "./emitter.ts";
import { SceneModel, STATIC_TIME_S } from "./frame-state.ts";
import { computeLayout, createLayout, fpsCap, type LayoutInput } from "./layout.ts";
import { Lightning } from "./lightning.ts";
import { FrameLoop } from "./loop.ts";
import type { CreateSkyOptions, Sky, SkyEvents, SkyeStats } from "./api.ts";
import { resolveParams, type Quality, type ResolvedParams, type SkyeParams } from "./params.ts";
import { QualityController } from "./quality.ts";
import { createRandom, type RandomSource } from "./random.ts";
import { TIERS, type TierDef } from "./tables.ts";

const FIRST_DT = 1 / 60;
const MAX_DT = 0.1;
const POLL_MS = 16;

// An indexed loop rather than find() or for-of: this runs every frame and must allocate neither a callback nor an
// iterator, which V8's mid tier keeps.
function tierOf(quality: Quality, autoTier: number): TierDef {
  if (quality === "auto") return TIERS[autoTier] ?? TIERS[1];
  for (let i = 0; i < TIERS.length; i++) {
    const t = TIERS[i];
    if (t?.name === quality) return t;
  }
  return TIERS[1];
}

/** Every GPU object a sky owns. A restored context gets a new set; the old one died with the lost context. */
class Resources {
  readonly gpu: Gpu;
  readonly timer: GpuTimer;
  readonly pipeline: Pipeline;

  constructor(gl: WebGL2RenderingContext) {
    this.gpu = new Gpu(gl);
    this.timer = new GpuTimer(gl);
    this.pipeline = new Pipeline(this.gpu);
  }

  dispose(): void {
    this.pipeline.dispose();
    this.timer.dispose();
    this.gpu.dispose();
  }
}

class SkyRenderer implements Sky {
  readonly #canvas: SkyCanvas;
  readonly #gl: WebGL2RenderingContext;
  #res: Resources;
  readonly #random: RandomSource;
  readonly #events = new Emitter<SkyEvents>();
  readonly #model = new SceneModel();
  readonly #easer = new Easer();
  readonly #lightning = new Lightning();
  readonly #quality = new QualityController();
  readonly #layout = createLayout();
  readonly #layoutInput: LayoutInput;
  readonly #frame: PassFrame;
  readonly #loop: FrameLoop;
  #input: Partial<SkyeParams>;
  #params: ResolvedParams;
  #cssWidth: number;
  #cssHeight: number;
  #lastT = 0;
  #hasLastT = false;
  #reducedMotion: boolean;
  #probing: boolean | undefined;
  #running = false;
  #visible = true;
  /** Programs linked on the current context. */
  #ready = false;
  /** "ready" has fired; it fires once per sky. */
  #announced = false;
  /** The context is lost and not yet restored. */
  #lost = false;
  /** "contextlost" has fired and its "contextrestored" has not. */
  #down = false;
  #error: Error | undefined;
  /** `render` has thrown the error. */
  #errorThrown = false;
  #disposed = false;
  #drawn = false;
  #pollTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    canvas: SkyCanvas,
    gl: WebGL2RenderingContext,
    params: Partial<SkyeParams>,
    options: CreateSkyOptions,
  ) {
    this.#canvas = canvas;
    this.#gl = gl;
    this.#input = { ...params };
    this.#params = resolveParams(this.#input);
    this.#random = options.random ?? createRandom(this.#params.seed);
    this.#reducedMotion =
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // Until the first resize, the canvas's own size stands in for its CSS size.
    this.#cssWidth = canvas.width;
    this.#cssHeight = canvas.height;
    this.#res = new Resources(gl);
    const tier = tierOf(this.#params.quality, this.#quality.tier);
    this.#layoutInput = {
      cssWidth: 0,
      cssHeight: 0,
      devicePixelRatio: 1,
      tier,
      blurEased: 0,
      blurTarget: 0,
    };
    this.#frame = {
      time: 0,
      windT: 0,
      windNow: 0,
      flash: 0,
      enc: hdrEncoding(this.#res.gpu.float),
      state: this.#easer.current,
      layout: this.#layout,
      tier,
      bolt: this.#lightning,
      pixels: 0,
      passes: 0,
    };
    this.#loop = new FrameLoop({
      canDraw: () => this.#canDraw(),
      isStatic: () => this.#isStatic(),
      fpsCap: () => this.#fpsCap(),
      draw: (t, dt) => this.#draw(t, dt),
      paced: (dtMs, cap) => this.#adaptTier(dtMs, cap),
    });
    const target: EventTarget = canvas;
    target.addEventListener("webglcontextlost", this.#onLost);
    target.addEventListener("webglcontextrestored", this.#onRestored);
    this.#pollTimer = setTimeout(this.#poll, 0);
  }

  update(params: Partial<SkyeParams>): void {
    if (this.#disposed) return;
    this.#input = { ...this.#input, ...params };
    this.#params = resolveParams(this.#input);
    // What v6's attributeChangedCallback does: drop the cached target and restart the frame interval.
    this.#model.invalidate();
    this.#hasLastT = false;
    this.#loop.restart();
    this.#kick();
  }

  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    if (this.#disposed) return;
    this.#cssWidth = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 0;
    this.#cssHeight = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 0;
    this.#layoutInput.devicePixelRatio =
      Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
    // v6's ResizeObserver drops the cached target but, unlike an attribute change, keeps the frame interval running.
    this.#model.invalidate();
    this.#kick();
  }

  render(t: number): void {
    if (!Number.isFinite(t)) return;
    if (!this.#checkReady()) {
      this.#throwUnheard();
      return;
    }
    // Like v6: 1/60 for static frames and the first frame after an update, then the interval capped at 0.1 s;
    // v6's renderFrame also reads a zero interval as 1/60, and a backward step is treated the same.
    const step = t - this.#lastT;
    const dt =
      this.#isStatic() || !this.#hasLastT || !(step > 0) ? FIRST_DT : Math.min(MAX_DT, step);
    this.#lastT = t;
    this.#hasLastT = true;
    this.#draw(t, dt);
  }

  start(): void {
    if (this.#disposed || this.#running) return;
    this.#running = true;
    this.#kick();
  }

  stop(): void {
    this.#running = false;
    this.#loop.sleep();
  }

  setVisible(visible: boolean): void {
    if (this.#disposed || visible === this.#visible) return;
    this.#visible = visible;
    if (visible) this.#kick();
    else this.#loop.sleep();
  }

  setReducedMotion(reduced: boolean): void {
    if (this.#disposed || reduced === this.#reducedMotion) return;
    this.#reducedMotion = reduced;
    this.#kick();
  }

  stats(): SkyeStats {
    const tier = tierOf(this.#params.quality, this.#quality.tier);
    const l = this.#layout;
    return {
      renderer: "skye",
      quality: tier.name,
      auto: this.#params.quality === "auto",
      tier: this.#quality.tier,
      gpuMs: this.#res.timer.ms,
      cpuMs: this.#loop.cpuMs,
      fps: this.#loop.fps,
      fpsCap: this.#fpsCap(),
      blur: this.#drawn ? this.#easer.current.blur : 0,
      out: [this.#canvas.width, this.#canvas.height],
      sky: this.#drawn ? [l.skyWidth, l.skyHeight] : [0, 0],
      scene: this.#drawn ? [l.sceneWidth, l.sceneHeight] : [0, 0],
      mpx: this.#frame.pixels / 1e6,
      passes: this.#frame.passes,
      timer: this.#res.timer.available,
      hdr: this.#res.gpu.float ? "half-float" : "rgba8",
      static: this.#isStatic(),
      worker: false,
    };
  }

  probe(on: boolean): void {
    this.#probing = on;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#running = false;
    this.#loop.sleep();
    clearTimeout(this.#pollTimer);
    const target: EventTarget = this.#canvas;
    target.removeEventListener("webglcontextlost", this.#onLost);
    target.removeEventListener("webglcontextrestored", this.#onRestored);
    this.#events.clear();
    this.#res.dispose();
  }

  on<K extends keyof SkyEvents>(event: K, listener: (payload: SkyEvents[K]) => void): () => void {
    if (this.#disposed) return () => undefined;
    return this.#events.on(event, listener);
  }

  #isStatic(): boolean {
    const motion = this.#params.motion;
    return motion === "static" || (motion === "auto" && this.#reducedMotion);
  }

  #fpsCap(): number {
    return fpsCap(tierOf(this.#params.quality, this.#quality.tier).fps, this.#layout);
  }

  #canDraw(): boolean {
    return this.#running && this.#visible && this.#ready && !this.#lost && !this.#disposed;
  }

  // Every change goes through here: an animating loop is already scheduled, a static one draws once more.
  #kick(): void {
    if (this.#canDraw()) this.#loop.wake();
  }

  // One frame at animation time `t`, advanced by `dt`; `render` and the loop each keep their own interval.
  #draw(t: number, dt: number): void {
    const params = this.#params;
    const isStatic = this.#isStatic();
    const time = isStatic ? STATIC_TIME_S : t;
    const tier = tierOf(params.quality, this.#quality.tier);
    const aspect = this.#cssWidth / Math.max(1, this.#cssHeight);
    if (isStatic) this.#easer.reset();
    const state = this.#easer.step(
      this.#model.target(params, time, aspect, isStatic),
      dt,
      isStatic,
    );

    const li = this.#layoutInput;
    li.cssWidth = this.#cssWidth;
    li.cssHeight = this.#cssHeight;
    li.tier = tier;
    li.blurEased = state.blur;
    li.blurTarget = params.blur;
    const l = computeLayout(li, this.#layout.detailScale, this.#layout);
    if (this.#canvas.width !== l.canvasWidth || this.#canvas.height !== l.canvasHeight) {
      this.#canvas.width = l.canvasWidth;
      this.#canvas.height = l.canvasHeight;
    }
    const { gpu, pipeline, timer } = this.#res;
    pipeline.allocate(l);
    // After allocating, which binds textures behind the bind cache.
    gpu.beginFrame();

    const f = this.#frame;
    f.flash = this.#lightning.step(time, state, this.#random);
    const gust =
      1 + 0.25 * (Math.sin(time * 0.31) + 0.6 * Math.sin(time * 0.83 + 1.7)) * state.gust;
    f.windNow = state.wind * gust;
    f.windT += f.windNow * dt;
    f.time = time;
    f.tier = tier;
    f.pixels = 0;
    f.passes = 0;
    const timed = (this.#probing ?? params.quality === "auto") && timer.begin();
    pipeline.draw(f);
    if (timed) timer.end();
    timer.poll();
    this.#drawn = true;
  }

  // v6 steps the auto tier after each loop frame, from the frame interval and the smoothed GPU time.
  #adaptTier(dtMs: number, cap: number): void {
    if (this.#params.quality !== "auto") return;
    const timer = this.#res.timer;
    const change = this.#quality.observe(dtMs, cap, timer.ms);
    if (change.resetGpu) timer.reset();
    if (change.changed) {
      const tier = tierOf("auto", change.tier);
      this.#events.emit("tierchange", { quality: tier.name, tier: change.tier });
    }
  }

  readonly #poll = (): void => {
    this.#pollTimer = undefined;
    if (this.#checkReady() || !this.#compiling()) return;
    this.#pollTimer = setTimeout(this.#poll, POLL_MS);
  };

  // A lost context stops the poll; the restore event rebuilds the programs and starts it again.
  #compiling(): boolean {
    return (
      !this.#disposed &&
      !this.#ready &&
      !this.#lost &&
      this.#error === undefined &&
      !this.#gl.isContextLost()
    );
  }

  // False while disposed, lost, still compiling or failed. Never throws: a failure is kept in `error`.
  #checkReady(): boolean {
    if (this.#ready) return this.#canRender();
    if (!this.#compiling() || !this.#res.pipeline.isSettled()) return false;
    try {
      this.#res.pipeline.finish();
    } catch (err) {
      // On a context lost mid-compile the link status reads as a failure with an empty log; the restore retries.
      if (this.#gl.isContextLost()) return false;
      this.#error = err instanceof Error ? err : new Error(String(err));
      this.#events.latch("error", this.#error);
      return false;
    }
    // State and the loop first, events last: listeners see a sky that is already drawing.
    this.#ready = true;
    const restored = this.#down;
    const first = !this.#announced;
    this.#down = false;
    this.#announced = true;
    this.#kick();
    if (restored) this.#events.emit("contextrestored", undefined);
    if (first) this.#events.emit("ready", undefined);
    // A listener may have disposed the sky.
    return this.#canRender();
  }

  #canRender(): boolean {
    return !this.#disposed && !this.#lost;
  }

  // A subscribed listener is owed the replay, so only an error nobody has received or will receive is thrown, once.
  #throwUnheard(): void {
    const error = this.#error;
    if (error === undefined || this.#errorThrown) return;
    if (this.#events.heard("error") || this.#events.listening("error")) return;
    this.#errorThrown = true;
    throw error;
  }

  readonly #onLost = (e: Event): void => {
    // Without preventDefault the browser never restores the context.
    e.preventDefault();
    if (this.#disposed) return;
    this.#lost = true;
    this.#ready = false;
    this.#loop.sleep();
    clearTimeout(this.#pollTimer);
    this.#pollTimer = undefined;
    if (this.#down) return;
    this.#down = true;
    this.#events.emit("contextlost", undefined);
  };

  // What v6's restore handler does through _init: new programs, buffers and targets, and fresh buffer sizes.
  // Like v6, the detail scale (_dsc) and the GPU-time average (_gpuMs) survive; only pending queries are dropped.
  readonly #onRestored = (): void => {
    if (this.#disposed || this.#error !== undefined) return;
    this.#lost = false;
    const gpuMs = this.#res.timer.ms;
    this.#res = new Resources(this.#gl);
    this.#res.timer.ms = gpuMs;
    this.#frame.enc = hdrEncoding(this.#res.gpu.float);
    const detailScale = this.#layout.detailScale;
    Object.assign(this.#layout, createLayout());
    this.#layout.detailScale = detailScale;
    this.#model.invalidate();
    this.#pollTimer = setTimeout(this.#poll, 0);
  };
}

/**
 * Creates a sky drawing into `canvas` with WebGL2. Throws when the canvas
 * cannot provide a WebGL2 context. Shaders compile in the background where the
 * driver allows; listen for `"ready"` to know when frames start drawing.
 */
export function createSky(
  canvas: SkyCanvas,
  params: Partial<SkyeParams> = {},
  options: CreateSkyOptions = {},
): Sky {
  const gl = getWebGL2(canvas);
  if (gl === null) throw new Error("skye: WebGL2 is not available");
  return new SkyRenderer(canvas, gl, params, options);
}
