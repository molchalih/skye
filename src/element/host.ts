import type { Sky, SkyEvents, SkyeStats } from "../core/api.ts";
import { Emitter } from "../core/emitter.ts";
import type { SkyeParams } from "../core/params.ts";
import { createSky } from "../core/renderer.ts";
import { getWebGL2 } from "../gl/context.ts";

/** Events a host emits: the sky's own, plus what the browser reports about the context. */
export interface SkyHostEvents extends SkyEvents {
  /**
   * The browser lost the context. Unlike `contextlost`, this fires on every
   * loss, including one that comes before the sky finished relinking after a
   * restore.
   */
  webglcontextlost: undefined;
  /**
   * The browser restored the lost context. Shaders still have to relink;
   * `contextrestored` follows once frames draw again.
   */
  webglcontextrestored: undefined;
  /**
   * The host cannot render after all and draws nothing more: a worker that
   * failed to load or start, or has no WebGL2 for an `OffscreenCanvas`. Its
   * canvas may already be the worker's, so the element renders on the main
   * thread on a fresh canvas. The main-thread host never emits it: it knows
   * at creation whether it can render.
   */
  unsupported: undefined;
}

/**
 * What `<skye-view>` drives: a sky rendering into the element's canvas,
 * either on the main thread or in a worker. The element owns the observers
 * and forwards what they report.
 */
export interface SkyHost {
  update(params: Partial<SkyeParams>): void;
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  setVisible(visible: boolean): void;
  setReducedMotion(reduced: boolean): void;
  start(): void;
  /**
   * Runs `run` once the page shows a frame the sky has drawn since this call,
   * or would have drawn: a sky that draws nothing (paused, lost) still lets
   * it run after the next frame. Returns a function that cancels it.
   */
  afterFrame(run: () => void): () => void;
  /** The latest metrics, or null while none are known yet. */
  stats(): SkyeStats | null;
  on<K extends keyof SkyHostEvents>(
    event: K,
    listener: (payload: SkyHostEvents[K]) => void,
  ): () => void;
  /** Stops drawing and releases everything, the WebGL context included. */
  dispose(): void;
}

class MainThreadHost implements SkyHost {
  readonly #canvas: HTMLCanvasElement;
  readonly #gl: WebGL2RenderingContext;
  readonly #sky: Sky;
  readonly #events = new Emitter<SkyHostEvents>();

  constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, sky: Sky) {
    this.#canvas = canvas;
    this.#gl = gl;
    this.#sky = sky;
    const events = this.#events;
    sky.on("ready", () => events.emit("ready", undefined));
    // Latched like the core's, so a listener added later still learns of the failure.
    sky.on("error", (error) => events.latch("error", error));
    sky.on("contextlost", () => events.emit("contextlost", undefined));
    sky.on("contextrestored", () => events.emit("contextrestored", undefined));
    sky.on("tierchange", (change) => events.emit("tierchange", change));
    canvas.addEventListener("webglcontextlost", this.#onLost);
    canvas.addEventListener("webglcontextrestored", this.#onRestored);
  }

  update(params: Partial<SkyeParams>): void {
    this.#sky.update(params);
  }

  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    this.#sky.resize(cssWidth, cssHeight, devicePixelRatio);
  }

  setVisible(visible: boolean): void {
    this.#sky.setVisible(visible);
  }

  setReducedMotion(reduced: boolean): void {
    this.#sky.setReducedMotion(reduced);
  }

  start(): void {
    this.#sky.start();
  }

  // The sky requests its frame before it announces a change or acts on a visibility switch, so a frame callback
  // requested after that runs in the same frame, after the draw.
  afterFrame(run: () => void): () => void {
    const id = requestAnimationFrame(() => run());
    return () => cancelAnimationFrame(id);
  }

  stats(): SkyeStats {
    return this.#sky.stats();
  }

  on<K extends keyof SkyHostEvents>(
    event: K,
    listener: (payload: SkyHostEvents[K]) => void,
  ): () => void {
    return this.#events.on(event, listener);
  }

  dispose(): void {
    this.#sky.dispose();
    this.#events.clear();
    this.#canvas.removeEventListener("webglcontextlost", this.#onLost);
    this.#canvas.removeEventListener("webglcontextrestored", this.#onRestored);
    // Browsers cap live contexts per page and evict the oldest past the cap; a dropped canvas only
    // frees its context when collected, so remounts would push other skies out. Free it now.
    if (!this.#gl.isContextLost()) this.#gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  readonly #onLost = (): void => {
    this.#events.emit("webglcontextlost", undefined);
  };

  readonly #onRestored = (): void => {
    this.#events.emit("webglcontextrestored", undefined);
  };
}

/**
 * A host rendering into `canvas` on the main thread, or null when the canvas
 * cannot provide a WebGL2 context.
 */
export function createMainThreadHost(
  canvas: HTMLCanvasElement,
  params: Partial<SkyeParams>,
): SkyHost | null {
  const gl = getWebGL2(canvas);
  if (gl === null) return null;
  let sky: Sky;
  try {
    sky = createSky(canvas, params);
  } catch (error) {
    // The context exists and nothing will use it; free it rather than wait for collection.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw error;
  }
  return new MainThreadHost(canvas, gl, sky);
}
