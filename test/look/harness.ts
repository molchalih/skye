import { STATIC_TIME_S } from "../../src/core/frame-state.ts";
import { createRandom } from "../../src/core/random.ts";
import { CONTEXT_ATTRIBUTES } from "../../src/gl/context.ts";
import { createSky, resolveParams, type SkyeParams } from "../../src/index.ts";
import { createSky as createApprovedSky } from "../reference/skye-approved.js";
import { createSky as createBaselineSky } from "../reference/skye-baseline-2026-10.js";
import { instrument, type Mutation } from "./mutations.ts";

// Registers <weather-sky-v6>.
await import("../reference/weather-sky-v6.js");

/** Seed of the random sequence every renderer draws lightning from; each gets its own fresh copy. */
export const RANDOM_SEED = 1;
const START_TIMEOUT_MS = 10_000;

/** One frame read back from a canvas with `readPixels`, bottom row first. */
export interface Frame {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** v6's frame, plus its lightning flash and visible bolt strength, so a case can show lightning really fired. */
export interface V6Frame extends Frame {
  flash: number;
  bolt: number;
}

/**
 * What the harness drives on a sky, whichever build made it: skye's source or
 * a reference build, which declares its own types.
 */
export interface DrivenSky {
  on(event: "ready", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  update(params: SkyeParams): void;
  render(t: number): void;
  stats(): { readonly hdr: string };
  dispose(): void;
}

type CreateDrivenSky = (
  canvas: HTMLCanvasElement,
  params: SkyeParams,
  options: { random: () => number },
) => DrivenSky;

/** One frame from skye and from its references, all of one size. */
export interface LookFrame {
  width: number;
  height: number;
  skye: Uint8Array;
  /** The approved build's frame (test/reference/skye-approved.js). */
  approved: Uint8Array;
  /** The frozen baseline's frame, when the pair draws it (test/reference/skye-baseline-2026-10.js). */
  baseline?: Uint8Array;
  /** v6's frame, when the pair draws v6. */
  v6?: V6Frame;
}

/** How a pair is set up beyond its params and CSS size. */
export interface PairOptions {
  /** Device pixel ratio every renderer sees; headless engines report 1. */
  devicePixelRatio?: number;
  /** False hides `EXT_color_buffer_float` from every renderer, forcing RGBA8 targets. */
  floatTargets?: boolean;
  /** Also draw the frozen baseline, the long-range drift check (`compareToBaseline`). */
  baseline?: boolean;
  /** Also draw v6, which times frames to its lightning schedule, drawn from the same random sequence. */
  v6?: boolean;
  /** A deliberate regression applied to skye alone, for the gate's own tests (mutations.ts). */
  mutation?: Mutation;
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

// Every renderer looks the extension up once while starting; the wrapper lives on the prototype only until all have.
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

function readCanvas(gl: WebGL2RenderingContext): Frame {
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
 * own parsing and clamping apply; an absent one is written resolved.
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
export function whenReady(sky: Pick<DrivenSky, "on">): Promise<void> {
  return new Promise((resolve, reject) => {
    sky.on("ready", () => resolve());
    sky.on("error", reject);
  });
}

/**
 * v6's element in this page at a CSS size and device pixel ratio, its own
 * loop switched off, drawn frame by frame with stubbed time and random
 * sequence the way skye is driven with `render(t)`. Its source is unchanged.
 */
export class V6Reference {
  readonly #host: HTMLDivElement;
  readonly #el: HTMLElement;
  readonly #gl: WebGL2RenderingContext;
  readonly #random = createRandom(RANDOM_SEED);
  #params: SkyeParams;
  #ratio: number;
  #lastT = 0;
  #hasLastT = false;
  #flash = 0;

  private constructor(
    host: HTMLDivElement,
    el: HTMLElement,
    gl: WebGL2RenderingContext,
    params: SkyeParams,
    ratio: number,
  ) {
    this.#host = host;
    this.#el = el;
    this.#gl = gl;
    this.#params = params;
    this.#ratio = ratio;
    // Records the flash v6 computes each frame without changing what it returns.
    const lightning: unknown = Reflect.get(el, "_lightning");
    if (typeof lightning !== "function") throw new Error("v6 has no _lightning");
    Reflect.set(el, "_lightning", (...args: unknown[]): unknown => {
      const flash: unknown = Reflect.apply(lightning, el, args);
      this.#flash = finiteNumber(flash);
      return flash;
    });
  }

  /** Mounts v6 and resolves once its programs are linked. */
  static async create(
    params: SkyeParams,
    cssWidth: number,
    cssHeight: number,
    devicePixelRatio = 1,
  ): Promise<V6Reference> {
    const host = document.createElement("div");
    host.style.cssText = `position:absolute;left:0;top:0;width:${cssWidth}px;height:${cssHeight}px`;
    const el = document.createElement("weather-sky-v6");
    // Every frame is drawn by hand; v6's own rAF loop would draw extra ones.
    Reflect.set(el, "_loop", () => undefined);
    setV6Attributes(el, params);
    host.append(el);
    document.body.append(host);
    await until(() => Reflect.get(el, "_glass") && Reflect.get(el, "_blur"), "v6 programs");
    const gl: unknown = Reflect.get(el, "_gl");
    if (!(gl instanceof WebGL2RenderingContext)) throw new Error("v6 has no WebGL2 context");
    return new V6Reference(host, el, gl, params, devicePixelRatio);
  }

  /** The animation time of v6's next lightning strike, or -1 while none is scheduled. */
  get nextStrike(): number {
    const bolt: unknown = Reflect.get(this.#el, "_bolt");
    return typeof bolt === "object" && bolt !== null ? finiteNumber(Reflect.get(bolt, "next")) : -1;
  }

  /** Merges new params, like `Sky.update`; v6 sees the merged set as attributes. */
  update(params: SkyeParams): void {
    this.#params = { ...this.#params, ...params };
    setV6Attributes(this.#el, this.#params);
    // v6's attributeChangedCallback restarts its frame interval.
    this.#hasLastT = false;
  }

  /** Changes the CSS size and ratio. v6's ResizeObserver drops the cached target but keeps the frame interval. */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    this.#host.style.width = `${cssWidth}px`;
    this.#host.style.height = `${cssHeight}px`;
    // Set what v6's ResizeObserver would record, so the next frame does not depend on observer timing.
    Reflect.set(this.#el, "_cw", cssWidth);
    Reflect.set(this.#el, "_ch", cssHeight);
    Reflect.set(this.#el, "_envKey", "");
    this.#ratio = devicePixelRatio;
  }

  /** Draws one frame at animation time `t` (seconds) and reads it back. */
  frame(t: number): V6Frame {
    const isStatic = this.#params.motion === "static";
    const time = isStatic ? STATIC_TIME_S : t;
    // v6's loop: 1/60 for the first frame (static frames pass nothing, which v6 also reads as 1/60), then the
    // interval capped at 0.1 s. Its clock never runs backwards, so a backward step reaches it as no time at all.
    const dt = isStatic || !this.#hasLastT ? 1 / 60 : Math.min(0.1, Math.max(0, t - this.#lastT));
    this.#lastT = t;
    this.#hasLastT = true;

    Reflect.set(this.#el, "_now", () => time);
    // v6's static path clears the eased state before each frame.
    if (isStatic) Reflect.set(this.#el, "_cur", null);
    this.#flash = 0;
    const random = Math.random;
    Math.random = this.#random;
    try {
      withDevicePixelRatio(this.#ratio, () => {
        Reflect.apply(Reflect.get(this.#el, "renderFrame"), this.#el, [dt]);
      });
    } finally {
      Math.random = random;
    }
    const bolt: unknown = Reflect.get(this.#el, "_bolt");
    return {
      ...readCanvas(this.#gl),
      flash: this.#flash,
      bolt: typeof bolt === "object" && bolt !== null ? finiteNumber(Reflect.get(bolt, "bolt")) : 0,
    };
  }

  dispose(): void {
    loseContext(this.#gl);
    this.#host.remove();
  }
}

/** A sky on a canvas of its own in this page, each frame read back right after it is drawn. */
export class PageSky {
  readonly #sky: DrivenSky;
  readonly #gl: WebGL2RenderingContext;
  readonly #mutation: Mutation | undefined;
  readonly #applied: () => number;
  #images = 0;

  private constructor(
    sky: DrivenSky,
    gl: WebGL2RenderingContext,
    mutation: Mutation | undefined,
    applied: () => number,
  ) {
    this.#sky = sky;
    this.#gl = gl;
    this.#mutation = mutation;
    this.#applied = applied;
  }

  static async #create(
    create: CreateDrivenSky,
    params: SkyeParams,
    cssWidth: number,
    cssHeight: number,
    devicePixelRatio: number,
    mutation?: Mutation,
  ): Promise<PageSky> {
    const canvas = document.createElement("canvas");
    // Each build creates its context with its own attributes. Only a mutation takes it first (with skye's, which
    // createSky then reuses), to instrument it.
    let applied = (): number => 0;
    if (mutation !== undefined) {
      const own = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
      if (own === null) throw new Error("no WebGL2 context");
      applied = instrument(own, mutation);
    }
    const sky = create(
      canvas,
      { ...params, ...mutation?.params },
      { random: createRandom(RANDOM_SEED) },
    );
    const ready = whenReady(sky);
    sky.resize(cssWidth, cssHeight, devicePixelRatio);
    await ready;
    const gl = canvas.getContext("webgl2");
    if (gl === null) throw new Error("no WebGL2 context");
    return new PageSky(sky, gl, mutation, applied);
  }

  /**
   * skye from source at a CSS size and ratio, with its own copy of the shared
   * random sequence; `mutation` is a deliberate regression (mutations.ts).
   */
  static skye(
    params: SkyeParams,
    cssWidth: number,
    cssHeight: number,
    devicePixelRatio = 1,
    mutation?: Mutation,
  ): Promise<PageSky> {
    return PageSky.#create(createSky, params, cssWidth, cssHeight, devicePixelRatio, mutation);
  }

  /** The approved build (test/reference/skye-approved.js), as `skye` sets up skye. */
  static approved(
    params: SkyeParams,
    cssWidth: number,
    cssHeight: number,
    devicePixelRatio = 1,
  ): Promise<PageSky> {
    return PageSky.#create(createApprovedSky, params, cssWidth, cssHeight, devicePixelRatio);
  }

  /** The frozen baseline (test/reference/skye-baseline-2026-10.js), as `skye` sets up skye. */
  static baseline(
    params: SkyeParams,
    cssWidth: number,
    cssHeight: number,
    devicePixelRatio = 1,
  ): Promise<PageSky> {
    return PageSky.#create(createBaselineSky, params, cssWidth, cssHeight, devicePixelRatio);
  }

  /** How many times the mutation has changed something so far: params, a shader, an upload, a draw or a frame. */
  get mutated(): number {
    return (this.#mutation?.params === undefined ? 0 : 1) + this.#applied() + this.#images;
  }

  stats(): { readonly hdr: string } {
    return this.#sky.stats();
  }

  /** Merges new params, like `Sky.update`; a mutation's own params stay on top. */
  update(params: SkyeParams): void {
    this.#sky.update({ ...params, ...this.#mutation?.params });
  }

  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    this.#sky.resize(cssWidth, cssHeight, devicePixelRatio);
  }

  /** Draws one frame at animation time `t` (seconds) and reads it back. */
  frame(t: number): Frame {
    this.#sky.render(t);
    const f = readCanvas(this.#gl);
    const image = this.#mutation?.image;
    if (image !== undefined) {
      image(f.pixels, f.width, f.height);
      this.#images++;
    }
    return f;
  }

  dispose(): void {
    this.#sky.dispose();
    loseContext(this.#gl);
  }
}

function sameSize(a: Frame, b: Frame, what: string): void {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error(
      `canvas sizes differ: skye ${a.width}x${a.height}, ${what} ${b.width}x${b.height}`,
    );
}

/**
 * skye beside the approved build of itself, and optionally beside v6, in this
 * page at the same CSS size and device pixel ratio, driven frame by frame with
 * the same params, time and random sequence.
 */
export class LookPair {
  readonly #skye: PageSky;
  readonly #approved: PageSky;
  readonly #baseline: PageSky | undefined;
  readonly #v6: V6Reference | undefined;
  #ratio: number;

  private constructor(
    skye: PageSky,
    approved: PageSky,
    baseline: PageSky | undefined,
    v6: V6Reference | undefined,
    ratio: number,
  ) {
    this.#skye = skye;
    this.#approved = approved;
    this.#baseline = baseline;
    this.#v6 = v6;
    this.#ratio = ratio;
  }

  static async create(
    params: SkyeParams,
    cssWidth: number,
    cssHeight: number,
    options: PairOptions = {},
  ): Promise<LookPair> {
    const ratio = options.devicePixelRatio ?? 1;
    const restore = options.floatTargets === false ? hideFloatTargets() : (): void => undefined;
    try {
      const [skye, approved, baseline, v6] = await Promise.all([
        PageSky.skye(params, cssWidth, cssHeight, ratio, options.mutation),
        PageSky.approved(params, cssWidth, cssHeight, ratio),
        options.baseline === true
          ? PageSky.baseline(params, cssWidth, cssHeight, ratio)
          : undefined,
        options.v6 === true ? V6Reference.create(params, cssWidth, cssHeight, ratio) : undefined,
      ]);
      return new LookPair(skye, approved, baseline, v6, ratio);
    } finally {
      restore();
    }
  }

  /** skye's stats, e.g. to confirm which render targets it uses. */
  skyeStats(): { readonly hdr: string } {
    return this.#skye.stats();
  }

  /** The approved build's stats. */
  approvedStats(): { readonly hdr: string } {
    return this.#approved.stats();
  }

  /** How many times skye's mutation has changed something so far (`PageSky.mutated`). */
  get mutated(): number {
    return this.#skye.mutated;
  }

  /** The animation time of v6's next lightning strike, or -1 while none is scheduled. */
  get nextStrike(): number {
    if (this.#v6 === undefined) throw new Error("this pair draws no v6");
    return this.#v6.nextStrike;
  }

  /** Merges new params into every renderer, like `Sky.update`. */
  update(params: SkyeParams): void {
    for (const sky of this.#skies()) sky.update(params);
    this.#v6?.update(params);
  }

  /** Changes the CSS size and, when given, the device pixel ratio of every renderer. */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio?: number): void {
    const ratio = devicePixelRatio ?? this.#ratio;
    for (const sky of this.#skies()) sky.resize(cssWidth, cssHeight, ratio);
    this.#v6?.resize(cssWidth, cssHeight, ratio);
    this.#ratio = ratio;
  }

  /** Draws one frame at animation time `t` (seconds) in every renderer and reads each back. */
  frame(t: number): LookFrame {
    const skye = this.#skye.frame(t);
    const approved = this.#approved.frame(t);
    sameSize(skye, approved, "approved");
    const frame: LookFrame = {
      width: skye.width,
      height: skye.height,
      skye: skye.pixels,
      approved: approved.pixels,
    };
    const baseline = this.#baseline?.frame(t);
    if (baseline !== undefined) {
      sameSize(skye, baseline, "baseline");
      frame.baseline = baseline.pixels;
    }
    const v6 = this.#v6?.frame(t);
    if (v6 !== undefined) {
      sameSize(skye, v6, "v6");
      frame.v6 = v6;
    }
    return frame;
  }

  dispose(): void {
    for (const sky of this.#skies()) sky.dispose();
    this.#v6?.dispose();
  }

  #skies(): PageSky[] {
    return this.#baseline === undefined
      ? [this.#skye, this.#approved]
      : [this.#skye, this.#approved, this.#baseline];
  }
}
