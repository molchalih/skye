import type { SkyeParams, Tier } from "./params.ts";
import type { RandomSource } from "./random.ts";

/** Events a sky emits, mapped to their payloads. */
export interface SkyEvents {
  /**
   * Every shader program is linked and frames now draw. Fires once, never
   * synchronously inside `createSky`, so subscribing right after it is enough.
   */
  ready: undefined;
  /**
   * A shader failed to compile or link; the sky stays blank for good. The
   * error is kept: a listener added later receives it on a microtask. When no
   * listener has received it or is subscribed, the next `render` throws it
   * instead. A sky driven only by `start()` never calls `render`, so this event
   * is its only report of the failure.
   */
  error: Error;
  /**
   * The WebGL context was lost and frames stopped. The sky waits for the
   * browser to restore it; nothing needs to be called meanwhile.
   */
  contextlost: undefined;
  /**
   * After `contextlost`: the context is back, every GPU resource has been
   * rebuilt and linked, and frames draw again.
   */
  contextrestored: undefined;
  /** The automatic quality controller moved to another tier (`quality: "auto"` only). */
  tierchange: TierChange;
}

/** Payload of the `tierchange` event. */
export interface TierChange {
  /** The tier now in use. */
  quality: Tier;
  /** Its index: 0 low, 1 balanced, 2 high. */
  tier: number;
}

/** Live cost metrics, the shape of v6's `getStats()`. */
export interface SkyeStats {
  /** Always `"skye"` (v6 reported `"v6"`). */
  renderer: "skye";
  /** Tier in use. */
  quality: Tier;
  /** Whether the tier adapts to frame time. */
  auto: boolean;
  /**
   * The automatic controller's tier index (0 low, 1 balanced, 2 high), as v6
   * reported it. Under a fixed `quality` it is not the tier in use (that is
   * `quality`): it keeps the controller's last value, 1 until it has moved.
   */
  tier: number;
  /**
   * Smoothed GPU ms per frame; -1 when not measured. Measured only while
   * `quality` is `"auto"`, or after `probe(true)`, and only with a GPU timer.
   */
  gpuMs: number;
  /** Smoothed CPU ms per frame drawn by the loop; -1 until the loop draws one. */
  cpuMs: number;
  /** Frames the loop drew per second over the last second; 0 until a second has passed. */
  fps: number;
  /** The loop's frame-rate cap: the tier's, or 30 while a settled blur is shown. */
  fpsCap: number;
  /** Eased blur radius in CSS px. */
  blur: number;
  /** Canvas backing-store size. */
  out: [number, number];
  /** Sky buffer size. */
  sky: [number, number];
  /** Scene buffer size. */
  scene: [number, number];
  /** Shaded megapixels in the last frame. */
  mpx: number;
  /** Draw passes in the last frame. */
  passes: number;
  /** Whether a GPU timer is available. */
  timer: boolean;
  /** Storage of the HDR render targets: half-float, or RGBA8 (values scaled by 0.2) without `EXT_color_buffer_float`. */
  hdr: "half-float" | "rgba8";
  /** Whether frames are static: `motion: "static"`, or `"auto"` under reduced motion. */
  static: boolean;
  /** Whether the sky renders in a worker. */
  worker: boolean;
}

/** Options fixed for the life of a sky. */
export interface CreateSkyOptions {
  /** Random source for lightning; defaults to a generator seeded with `params.seed`. */
  random?: RandomSource | undefined;
}

/**
 * A sky drawing into one canvas. It expects to be the only user of that
 * canvas's WebGL context.
 *
 * Frames are drawn either by the caller, with `render(t)`, or by the sky's own
 * loop, with `start()`. While the loop runs, every change (`update`, `resize`,
 * `setReducedMotion`, regained visibility, a restored context) takes effect on
 * its next frame; with static motion the loop draws exactly one frame per
 * change and is otherwise idle.
 */
export interface Sky {
  /** Merges `params` into the current ones; the next frame eases toward them. */
  update(params: Partial<SkyeParams>): void;
  /**
   * Sets the CSS size and device pixel ratio the buffers are sized from; the
   * tier caps the ratio. Until the first call, the canvas's own width and
   * height stand in for its CSS size, at ratio 1.
   */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  /**
   * Draws one frame at animation time `t`, in seconds. The first frame, and the
   * first after `update`, advances by 1/60 s; later frames by the time since the
   * previous one, at most 0.1 s. A `t` equal to or before the previous one also
   * advances by 1/60 s. Draws nothing until the sky is ready, while the context
   * is lost, after `dispose`, or for a non-finite `t`. Throws a failed shader
   * build once, when no `"error"` listener has received it.
   *
   * Calling it while the loop runs is allowed and draws one extra frame at
   * `t`. The loop keeps its own clock and frame interval, so the scene jumps
   * between the two times; drive frames one way only.
   */
  render(t: number): void;
  /**
   * Starts the sky's own frame loop: one frame per display refresh (from
   * `requestAnimationFrame`, or a timer at the fps cap where the scope has
   * none), paced by the fps cap, with the automatic quality controller and the
   * `cpuMs`/`fps` meters running. Animation time is seconds since the loop's
   * first frame and keeps counting while stopped or hidden. Frames begin once
   * the sky is ready. Does nothing if already started. A shader failure leaves
   * the canvas blank and throws nowhere: listen for `"error"` to learn of it.
   */
  start(): void;
  /** Stops the loop; the last frame stays on the canvas. */
  stop(): void;
  /**
   * Tells the sky whether its canvas can be seen (in the viewport, document
   * not hidden). While invisible the loop draws nothing; it resumes when
   * visible again. Visible by default.
   */
  setVisible(visible: boolean): void;
  /**
   * Tells the sky whether the user prefers reduced motion, which makes
   * `motion: "auto"` static. The default is the `prefers-reduced-motion` media
   * query at creation; the sky does not watch it, so the host forwards changes.
   */
  setReducedMotion(reduced: boolean): void;
  /** Current cost metrics, as a new object on every call (a snapshot, not a live view). */
  stats(): SkyeStats;
  /**
   * Turns GPU timing on or off regardless of `quality`; by default it runs only
   * while `quality` is `"auto"`. Timing needs `EXT_disjoint_timer_query_webgl2`.
   */
  probe(on: boolean): void;
  /**
   * Stops the loop, stops listening to the canvas, and releases every GPU
   * resource the sky created. The context itself stays with the canvas. Safe
   * to call more than once.
   */
  dispose(): void;
  /**
   * Subscribes to an event; returns the unsubscribe function. Listeners run
   * after the sky has updated its own state. One that throws is reported like
   * an uncaught error (`reportError`) and stops neither the other listeners
   * nor the sky.
   */
  on<K extends keyof SkyEvents>(event: K, listener: (payload: SkyEvents[K]) => void): () => void;
}
