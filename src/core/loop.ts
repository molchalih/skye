/** What a `FrameLoop` drives. The sky implements it; every method is called from inside a frame. */
export interface LoopClient {
  /** Whether a frame may be drawn now. When false the loop goes idle until woken. */
  canDraw(): boolean;
  /** Static frames: each wake draws one frame and the loop goes idle again. */
  isStatic(): boolean;
  /** The current frame-rate cap. */
  fpsCap(): number;
  /**
   * Draws one frame at loop time `t`, advancing the animation by `dt`, both in
   * seconds. `dt` is v6's: 1/60 for static frames and for the first animated
   * frame after a restart, else the time since the last animated frame, at
   * most 0.1 s. Static frames leave that interval untouched.
   */
  draw(t: number, dt: number): void;
  /** Runs after each animated frame with its interval in ms and the cap it was paced at. */
  paced(dtMs: number, fpsCap: number): void;
}

/**
 * v6's frame loop (`_loop`): one frame per display refresh, skipped while the
 * fps cap says it is too early, plus the CPU-time and fps meters. Under a cap
 * it draws the frames v6 drew, the first at or past the cap's interval less
 * 2 ms, but judges each by a threshold halfway between display frames, so
 * timestamp jitter cannot move a frame across it. Frames come from the
 * global `requestAnimationFrame`, looked up at each request so a worker scope
 * without it falls back to a `setTimeout` pacer at the fps cap.
 *
 * Loop time is seconds since the loop's first frame, on the frame timestamps'
 * clock. It keeps counting while the loop is idle, as v6's did while hidden.
 */
export class FrameLoop {
  /** Frames drawn per second over the last full second; 0 until one has passed. */
  fps = 0;
  /** Smoothed CPU ms per animated frame; -1 until one is drawn. */
  cpuMs = -1;
  readonly #client: LoopClient;
  #rafId: number | undefined;
  #timeoutId: ReturnType<typeof setTimeout> | undefined;
  #hasOrigin = false;
  #origin = 0;
  #hasLast = false;
  #lastDrawn = 0;
  #fpsCount = 0;
  #hasFpsStart = false;
  #fpsStart = 0;
  /** The previous frame's timestamp. */
  #prevFrame = 0;
  /**
   * The display's frame interval in ms, smoothed over about 20 frames. It
   * assumes each interval spans a whole number of display frames. From 16 ms,
   * a display at 42 Hz or more measures its own interval; a slower one, or rAF
   * slowed to 30 fps, measures a whole fraction of it, which paces the same.
   */
  #period = 16;

  constructor(client: LoopClient) {
    this.#client = client;
  }

  /** Requests a frame unless one is already pending. */
  wake(): void {
    if (this.#rafId === undefined && this.#timeoutId === undefined) this.#request();
  }

  /** Cancels the pending frame; the loop stays idle until the next `wake`. */
  sleep(): void {
    if (this.#rafId !== undefined) globalThis.cancelAnimationFrame(this.#rafId);
    clearTimeout(this.#timeoutId);
    this.#rafId = undefined;
    this.#timeoutId = undefined;
  }

  /** The next frame ignores the cap and reports an interval of 1/60 s, as after a v6 attribute change. */
  restart(): void {
    this.#hasLast = false;
  }

  #request(): void {
    if (typeof globalThis.requestAnimationFrame === "function") {
      this.#rafId = globalThis.requestAnimationFrame(this.#onFrame);
    } else {
      this.#timeoutId = setTimeout(this.#onTimeout, 1000 / this.#client.fpsCap());
    }
  }

  readonly #onFrame = (now: number): void => {
    this.#rafId = undefined;
    this.#run(now);
  };

  readonly #onTimeout = (): void => {
    this.#timeoutId = undefined;
    this.#run(performance.now());
  };

  #run(now: number): void {
    const client = this.#client;
    if (!client.canDraw()) return;
    if (!this.#hasOrigin) {
      this.#origin = now;
      this.#hasOrigin = true;
    }
    const t = (now - this.#origin) / 1000;
    if (client.isStatic()) {
      client.draw(t, 1 / 60);
      return;
    }
    this.#request();
    const cap = client.fpsCap();
    // Each interval counts as the nearest whole number of display frames: a missed vsync, a gap such as the first
    // frame after a wake, or a timer tick moves the estimate by no more than its rounding.
    const frameMs = now - this.#prevFrame;
    this.#prevFrame = now;
    if (frameMs > 0)
      this.#period +=
        (frameMs / Math.max(1, Math.round(frameMs / this.#period)) - this.#period) * 0.05;
    // v6 drew the first display frame at or past the cap's interval less 2 ms: a fixed threshold, which can sit a
    // fraction of a millisecond from a frame (0.5 ms at 165 Hz under 20 fps), so that jitter moves frames across it.
    // The same frame is drawn here, judged by a threshold halfway between it and the frame before: the whole frames
    // that reach that time, less half a frame. A frame that arrives that long after the one before draws in any
    // case, as when rAF or the timer runs no faster than the cap.
    const due = 1000 / cap - 2;
    const frame = this.#period;
    if (
      this.#hasLast &&
      cap < 60 &&
      frameMs < due &&
      now - this.#lastDrawn < (Math.ceil(due / frame) - 0.5) * frame
    )
      return;
    const dt = this.#hasLast ? Math.min(0.1, (now - this.#lastDrawn) / 1000) : 1 / 60;
    this.#lastDrawn = now;
    this.#hasLast = true;
    // The measured draw includes harvesting GPU timer results, which v6 did just after its measurement; the
    // difference is a few query reads.
    const c0 = performance.now();
    client.draw(t, dt);
    const cpu = performance.now() - c0;
    this.cpuMs = this.cpuMs < 0 ? cpu : this.cpuMs + (cpu - this.cpuMs) * 0.1;
    this.#countFrame(now);
    client.paced(dt * 1000, cap);
  }

  #countFrame(now: number): void {
    this.#fpsCount++;
    if (!this.#hasFpsStart) {
      this.#fpsStart = now;
      this.#hasFpsStart = true;
    } else if (now - this.#fpsStart > 1000) {
      this.fps = Math.round((this.#fpsCount * 1000) / (now - this.#fpsStart));
      this.#fpsCount = 0;
      this.#fpsStart = now;
    }
  }
}
