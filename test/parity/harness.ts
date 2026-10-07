import { STATIC_TIME_S } from "../../src/core/frame-state.ts";
import { createRandom } from "../../src/core/random.ts";
import {
  createSky,
  resolveParams,
  type Sky,
  type SkyeParams,
  type SkyeStats,
} from "../../src/index.ts";

// Registers <weather-sky-v6>.
await import("../reference/weather-sky-v6.js");

/** Seed of the random sequence both renderers draw lightning from; each side gets its own fresh copy. */
const RANDOM_SEED = 1;
const START_TIMEOUT_MS = 10_000;

/** One frame from both renderers, as read back with `readPixels`. */
export interface FramePair {
  width: number;
  height: number;
  v6: Uint8Array;
  skye: Uint8Array;
  /** v6's lightning flash and visible bolt strength in this frame, so a case can show lightning really fired. */
  flash: number;
  bolt: number;
}

/** How a pair is set up beyond its params and CSS size. */
export interface PairOptions {
  /** Device pixel ratio both sides see; headless engines report 1. */
  devicePixelRatio?: number;
  /** False hides `EXT_color_buffer_float` from both, forcing the RGBA8 targets and v6's `enc = 0.2`. */
  floatTargets?: boolean;
}

// v6 reads window.devicePixelRatio inside each frame; it is stubbed only around v6's draw, then put back.
function withDevicePixelRatio(ratio: number, draw: () => void): void {
  const own = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: ratio });
  try {
    draw();
  } finally {
    if (own === undefined) Reflect.deleteProperty(window, "devicePixelRatio");
    else Object.defineProperty(window, "devicePixelRatio", own);
  }
}

// Both renderers look the extension up once while starting; the wrapper lives on the prototype only until both have started.
function hideFloatTargets(): () => void {
  const proto = WebGL2RenderingContext.prototype;
  const own = Object.getOwnPropertyDescriptor(proto, "getExtension");
  const original: unknown = own?.value;
  if (own === undefined || typeof original !== "function") throw new Error("no getExtension");
  Object.defineProperty(proto, "getExtension", {
    ...own,
    value(this: WebGL2RenderingContext, name: string): unknown {
      return name === "EXT_color_buffer_float" ? null : Reflect.apply(original, this, [name]);
    },
  });
  return () => Object.defineProperty(proto, "getExtension", own);
}

function finiteNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function readCanvas(gl: WebGL2RenderingContext): {
  width: number;
  height: number;
  pixels: Uint8Array;
} {
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return { width, height, pixels };
}

function loseContext(gl: WebGL2RenderingContext | null | undefined): void {
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
}

/**
 * Writes every param as a v6 attribute, including the ones v6 would otherwise
 * take from the clock. A number the caller gave is written as given, so v6's
 * own parsing and clamping meet skye's; an absent one is written resolved.
 */
function setV6Attributes(el: HTMLElement, params: SkyeParams): void {
  const p = resolveParams(params);
  const n = (given: number | undefined, resolved: number): string =>
    String(typeof given === "number" && Number.isFinite(given) ? given : resolved);
  const attrs: Record<string, string | undefined> = {
    scene: p.scene,
    cover: n(params.cover, p.cover),
    intensity: n(params.intensity, p.intensity),
    wind: p.wind === undefined ? undefined : String(p.wind),
    seed: n(params.seed, p.seed),
    hour: n(params.hour, p.hour),
    lat: n(params.latitude, p.latitude),
    day: n(params.dayOfYear, p.dayOfYear),
    noon: n(params.solarNoon, p.solarNoon),
    moon: n(params.moonPhase, p.moonPhase),
    glass: p.glass ? "1" : "0",
    focus: n(params.focus, p.focus),
    dim: n(params.exposure, p.exposure),
    blur: n(params.blur, p.blur),
    quality: p.quality,
    motion: p.motion,
  };
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }
}

function until(ready: () => boolean, what: string): Promise<void> {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const check = (): void => {
      if (ready()) resolve();
      else if (performance.now() - start > START_TIMEOUT_MS)
        reject(new Error(`timed out waiting for ${what}`));
      else setTimeout(check, 10);
    };
    check();
  });
}

/** Resolves on the sky's "ready" event; rejects on "error". */
export function whenReady(sky: Sky): Promise<void> {
  return new Promise((resolve, reject) => {
    sky.on("ready", () => resolve());
    sky.on("error", reject);
  });
}

/**
 * v6 and skye side by side in this page at the same CSS size and device pixel
 * ratio, driven frame by frame with the same params, time and random sequence.
 */
export class ParityPair {
  private readonly host: HTMLDivElement;
  private readonly v6: HTMLElement;
  private readonly v6Gl: WebGL2RenderingContext;
  private readonly sky: Sky;
  private readonly skyGl: WebGL2RenderingContext;
  private readonly v6Random = createRandom(RANDOM_SEED);
  private params: SkyeParams;
  private ratio: number;
  private lastT = 0;
  private hasLastT = false;
  private flash = 0;

  private constructor(
    host: HTMLDivElement,
    v6: HTMLElement,
    v6Gl: WebGL2RenderingContext,
    sky: Sky,
    skyGl: WebGL2RenderingContext,
    params: SkyeParams,
    ratio: number,
  ) {
    this.host = host;
    this.v6 = v6;
    this.v6Gl = v6Gl;
    this.sky = sky;
    this.skyGl = skyGl;
    this.params = params;
    this.ratio = ratio;
    // Records the flash v6 computes each frame without changing what it returns.
    const lightning: unknown = Reflect.get(v6, "_lightning");
    if (typeof lightning !== "function") throw new Error("v6 has no _lightning");
    Reflect.set(v6, "_lightning", (...args: unknown[]): unknown => {
      const flash: unknown = Reflect.apply(lightning, v6, args);
      this.flash = finiteNumber(flash);
      return flash;
    });
  }

  static async create(
    params: SkyeParams,
    cssWidth: number,
    cssHeight: number,
    options: PairOptions = {},
  ): Promise<ParityPair> {
    const ratio = options.devicePixelRatio ?? 1;
    const restore = options.floatTargets === false ? hideFloatTargets() : (): void => undefined;
    try {
      const host = document.createElement("div");
      host.style.cssText = `position:absolute;left:0;top:0;width:${cssWidth}px;height:${cssHeight}px`;
      const v6 = document.createElement("weather-sky-v6");
      // The harness drives every frame itself; v6's own rAF loop would draw extra frames.
      Reflect.set(v6, "_loop", () => undefined);
      setV6Attributes(v6, params);
      host.append(v6);
      document.body.append(host);

      const canvas = document.createElement("canvas");
      const sky = createSky(canvas, params, { random: createRandom(RANDOM_SEED) });
      const ready = whenReady(sky);
      sky.resize(cssWidth, cssHeight, ratio);
      await until(() => Reflect.get(v6, "_glass") && Reflect.get(v6, "_blur"), "v6 programs");
      await ready;
      const v6Gl: unknown = Reflect.get(v6, "_gl");
      const skyGl = canvas.getContext("webgl2");
      if (!(v6Gl instanceof WebGL2RenderingContext) || skyGl === null)
        throw new Error("no WebGL2 context");
      return new ParityPair(host, v6, v6Gl, sky, skyGl, params, ratio);
    } finally {
      restore();
    }
  }

  /** Whether v6 renders into half-float targets. */
  get v6FloatTargets(): boolean {
    return Reflect.get(this.v6, "_float") === true;
  }

  /** skye's stats, e.g. to confirm which render targets it uses. */
  skyeStats(): SkyeStats {
    return this.sky.stats();
  }

  /** The animation time of v6's next lightning strike, or -1 while none is scheduled. */
  get nextStrike(): number {
    const bolt: unknown = Reflect.get(this.v6, "_bolt");
    return typeof bolt === "object" && bolt !== null ? finiteNumber(Reflect.get(bolt, "next")) : -1;
  }

  /** Merges new params into both, like `Sky.update`; v6 sees the merged set as attributes. */
  update(params: SkyeParams): void {
    this.params = { ...this.params, ...params };
    setV6Attributes(this.v6, this.params);
    this.sky.update(params);
    // v6's attributeChangedCallback restarts its frame interval.
    this.hasLastT = false;
  }

  /**
   * Changes the CSS size and device pixel ratio of both. v6's ResizeObserver
   * drops the cached target but leaves the frame interval running.
   */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number = this.ratio): void {
    this.host.style.width = `${cssWidth}px`;
    this.host.style.height = `${cssHeight}px`;
    // Set what v6's ResizeObserver would record, so the next frame does not depend on observer timing.
    Reflect.set(this.v6, "_cw", cssWidth);
    Reflect.set(this.v6, "_ch", cssHeight);
    Reflect.set(this.v6, "_envKey", "");
    this.ratio = devicePixelRatio;
    this.sky.resize(cssWidth, cssHeight, devicePixelRatio);
  }

  /** Draws one frame at animation time `t` (seconds) in both and reads both back. */
  frame(t: number): FramePair {
    const isStatic = this.params.motion === "static";
    const time = isStatic ? STATIC_TIME_S : t;
    // v6's loop: 1/60 for the first frame (static frames pass nothing, which v6 also reads as 1/60), then the
    // interval capped at 0.1 s. Its clock never runs backwards, so a backward step reaches it as no time at all.
    const dt = isStatic || !this.hasLastT ? 1 / 60 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    this.hasLastT = true;

    Reflect.set(this.v6, "_now", () => time);
    // v6's static path clears the eased state before each frame.
    if (isStatic) Reflect.set(this.v6, "_cur", null);
    this.flash = 0;
    const random = Math.random;
    Math.random = this.v6Random;
    try {
      withDevicePixelRatio(this.ratio, () => {
        Reflect.apply(Reflect.get(this.v6, "renderFrame"), this.v6, [dt]);
      });
    } finally {
      Math.random = random;
    }
    const a = readCanvas(this.v6Gl);
    const bolt: unknown = Reflect.get(this.v6, "_bolt");
    const boltStrength =
      typeof bolt === "object" && bolt !== null ? finiteNumber(Reflect.get(bolt, "bolt")) : 0;

    this.sky.render(t);
    const b = readCanvas(this.skyGl);
    if (a.width !== b.width || a.height !== b.height) {
      throw new Error(
        `canvas sizes differ: v6 ${a.width}x${a.height}, skye ${b.width}x${b.height}`,
      );
    }
    return {
      width: a.width,
      height: a.height,
      v6: a.pixels,
      skye: b.pixels,
      flash: this.flash,
      bolt: boltStrength,
    };
  }

  dispose(): void {
    this.sky.dispose();
    loseContext(this.skyGl);
    loseContext(this.v6Gl);
    this.host.remove();
  }
}
