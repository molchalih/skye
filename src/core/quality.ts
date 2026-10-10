import type { FrameTime } from "./frame-state.ts";
import { START_TIER, TIERS } from "./tiers.ts";

/** Outcome of one `observe` call. The object is reused: read it before the next call. */
export interface QualityChange {
  /** Tier index after this frame (0 low, 1 balanced, 2 high). */
  tier: number;
  /** True when the tier moved this frame. */
  changed: boolean;
  /** True when the caller must discard its GPU-time average (it measured the old tier). */
  resetGpu: boolean;
}

/** Frames before the first judgement, and between a step and a step down. */
const SETTLE_FRAMES = 60;
/** Frames at a tier before it may step up. */
const STEP_UP_FRAMES = 300;
/** A tier steps up once its GPU time is under this share of the budget. */
const STEP_UP_SHARE = 0.35;
/** Without a GPU timer: frames before the frame interval is judged, and the slowdown that steps down. */
const FALLBACK_SETTLE_FRAMES = 90;
const FALLBACK_SLOWDOWN = 1.5;
/** Weight of each new frame interval in its running average. */
const INTERVAL_SMOOTHING = 0.05;

/** The GPU time a frame may take, in ms: 20 under a 30 fps cap, else 9.5, room to spare in a 60 fps frame. */
function gpuBudgetMs(fpsCap: number): number {
  return fpsCap <= 30 ? 20 : 9.5;
}

/**
 * The automatic quality controller. Steps down when the GPU time exceeds the
 * frame budget, and up after a long stretch well under it; with no GPU
 * timer it judges by the smoothed frame interval, and only steps down.
 */
export class QualityController {
  /** Current tier index. */
  tier: number = START_TIER;
  #intervalMs = 16;
  #frames = 0;
  #sinceStep = 0;
  readonly #result: QualityChange = { tier: START_TIER, changed: false, resetGpu: false };

  /**
   * Feeds one drawn frame: its interval (`time.dt`), the fps cap it was
   * paced at and the smoothed GPU time, `gpu.ms`, which is -1 when unknown.
   */
  observe(time: Readonly<FrameTime>, fpsCap: number, gpu: { readonly ms: number }): QualityChange {
    this.#intervalMs += (time.dt * 1000 - this.#intervalMs) * INTERVAL_SMOOTHING;
    this.#frames++;
    this.#sinceStep++;
    const before = this.tier;
    const gpuMs = gpu.ms;
    const budget = gpuBudgetMs(fpsCap);
    let resetGpu = false;
    if (gpuMs >= 0) {
      const settled = this.#frames > SETTLE_FRAMES && this.#sinceStep > SETTLE_FRAMES;
      if (settled && gpuMs > budget && this.tier > 0) {
        this.tier--;
        resetGpu = true;
      } else if (
        this.#sinceStep > STEP_UP_FRAMES &&
        gpuMs < budget * STEP_UP_SHARE &&
        this.tier < TIERS.length - 1
      ) {
        this.tier++;
        resetGpu = true;
      }
    } else if (
      this.#frames > FALLBACK_SETTLE_FRAMES &&
      this.#sinceStep > FALLBACK_SETTLE_FRAMES &&
      this.#intervalMs > FALLBACK_SLOWDOWN * (1000 / fpsCap) &&
      this.tier > 0
    ) {
      this.tier--;
    }
    const changed = this.tier !== before;
    if (changed) this.#sinceStep = 0;
    this.#result.tier = this.tier;
    this.#result.changed = changed;
    this.#result.resetGpu = resetGpu;
    return this.#result;
  }
}
