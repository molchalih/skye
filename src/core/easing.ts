import {
  copyFrameState,
  createFrameState,
  NUMBER_KEYS,
  VEC2_KEYS,
  VEC3_KEYS,
  type FrameState,
} from "./frame-state.ts";
import { mix, smoothstep } from "./math.ts";
import { BLUR_DURATION_S } from "./tables.ts";

// Time constant of the exponential chase, in seconds.
const CHASE_TAU_S = 0.7;
// Scalars this close to their target land on it exactly.
const SNAP = 1e-4;

/**
 * Eases the displayed frame state toward the target, in place, as v6's `_ease`:
 * an exponential chase for everything except blur, which runs a fixed-duration
 * smoothstep tween so it is independent of frame rate and lands exactly.
 */
export class Easer {
  readonly #state = createFrameState();
  #ready = false;
  #blurFrom = 0;
  #blurTo = 0;
  #blurT = 1;

  /** The eased state; the same object on every call. */
  get current(): FrameState {
    return this.#state;
  }

  /** Makes the next step start from the target again (first-frame behaviour). */
  reset(): void {
    this.#ready = false;
  }

  /**
   * Advances the eased state by `dt` seconds and returns it. The first step, and
   * every step in static mode, copies the target instead.
   */
  step(target: Readonly<FrameState>, dt: number, isStatic: boolean): FrameState {
    const cur = this.#state;
    if (!this.#ready || isStatic) {
      copyFrameState(cur, target);
      this.#ready = true;
      this.#blurFrom = this.#blurTo = cur.blur;
      this.#blurT = 1;
      return cur;
    }
    const a = 1 - Math.exp(-dt / CHASE_TAU_S);
    for (const k of NUMBER_KEYS) {
      const v = target[k];
      const c = cur[k] + (v - cur[k]) * a;
      cur[k] = Math.abs(c - v) < SNAP ? v : c;
    }
    for (const k of VEC2_KEYS) {
      const v = target[k];
      const c = cur[k];
      c[0] += (v[0] - c[0]) * a;
      c[1] += (v[1] - c[1]) * a;
    }
    for (const k of VEC3_KEYS) {
      const v = target[k];
      const c = cur[k];
      c[0] += (v[0] - c[0]) * a;
      c[1] += (v[1] - c[1]) * a;
      c[2] += (v[2] - c[2]) * a;
    }
    if (this.#blurTo !== target.blur) {
      this.#blurFrom = cur.blur;
      this.#blurTo = target.blur;
      this.#blurT = 0;
    }
    if (this.#blurT < 1) this.#blurT = Math.min(1, this.#blurT + dt / BLUR_DURATION_S);
    cur.blur =
      this.#blurT >= 1
        ? this.#blurTo
        : mix(this.#blurFrom, this.#blurTo, smoothstep(0, 1, this.#blurT));
    return cur;
  }
}
