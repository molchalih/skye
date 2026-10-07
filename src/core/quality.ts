import { TIERS } from "./tables.ts";

/** Outcome of one `observe` call. The object is reused: read it before the next call. */
export interface QualityChange {
  /** Tier index after this frame (0 low, 1 balanced, 2 high). */
  tier: number;
  /** True when the tier moved this frame. */
  changed: boolean;
  /** True when the caller must discard its GPU-time average (it measured the old tier). */
  resetGpu: boolean;
}

/**
 * Auto-quality state machine (v6 loop lines 711-718). Steps down when the GPU
 * time exceeds the frame budget, up after a long stretch well under it; with
 * no GPU timer it falls back to the smoothed frame interval and only steps down.
 */
export class QualityController {
  /** Current tier index; starts at balanced like v6. */
  tier = 1;
  #ema = 16;
  #frames = 0;
  #sinceTier = 0;
  readonly #result: QualityChange = { tier: 1, changed: false, resetGpu: false };

  /**
   * Feeds one drawn frame. `dtMs` is the frame interval, `fpsCap` the current
   * cap, `gpuMs` the smoothed GPU time or -1 when unknown.
   */
  observe(dtMs: number, fpsCap: number, gpuMs: number): QualityChange {
    this.#ema += (dtMs - this.#ema) * 0.05;
    this.#frames++;
    this.#sinceTier++;
    const budget = fpsCap <= 30 ? 20 : 9.5;
    const before = this.tier;
    let resetGpu = false;
    if (gpuMs >= 0) {
      if (this.#frames > 60 && this.#sinceTier > 60 && gpuMs > budget && this.tier > 0) {
        this.tier--;
        resetGpu = true;
      } else if (this.#sinceTier > 300 && gpuMs < budget * 0.35 && this.tier < TIERS.length - 1) {
        this.tier++;
        resetGpu = true;
      }
    } else if (
      this.#frames > 90 &&
      this.#sinceTier > 90 &&
      this.#ema > 1.5 * (1000 / fpsCap) &&
      this.tier > 0
    ) {
      this.tier--;
    }
    const changed = this.tier !== before;
    if (changed) this.#sinceTier = 0;
    this.#result.tier = this.tier;
    this.#result.changed = changed;
    this.#result.resetGpu = resetGpu;
    return this.#result;
  }
}
