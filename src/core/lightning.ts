import type { FrameState } from "./frame-state.ts";
import { mix, smoothstep } from "./math.ts";
import type { RandomSource } from "./random.ts";

/**
 * Storm lightning scheduler (v6 `_lightning`). The random source is passed to
 * each `step` so the caller owns determinism; draws happen in v6's order: the
 * next-strike delay, then on a strike the bolt x, y, double flag, visibility,
 * seed and the following delay.
 */
export class Lightning {
  /** Bolt brightness of the current frame, 0 when no visible bolt. */
  bolt = 0;
  /** Per-strike random value that shapes the bolt. */
  seed = 0.5;
  /** Bolt position in sky space: x in aspect units, y above the horizon. */
  readonly position: [number, number] = [0, 0.3];
  private next = -1;
  private start = -10;
  private double = false;
  private visible = false;

  /** Advances to time `t` and returns the sky flash for this frame. */
  step(t: number, state: Readonly<FrameState>, random: RandomSource): number {
    const k =
      state.storm * mix(0.45, 1, state.intensity) +
      (1 - state.storm) * state.rain * smoothstep(0.55, 0.85, state.intensity) * 0.6;
    if (k <= 0.01) {
      this.next = -1;
      this.bolt = 0;
      return 0;
    }
    if (this.next < 0) this.next = t + mix(9, 2.5, k) + random() * mix(9, 4, k);
    if (t > this.next) {
      this.start = t;
      this.position[0] = (random() - 0.5) * state.aspect * 0.9;
      this.position[1] = 0.15 + random() * 0.35;
      this.double = random() < 0.6;
      this.visible = random() < 0.35 + 0.45 * state.storm;
      this.seed = random();
      this.next = t + mix(12, 3, k) + random() * mix(12, 4, k);
    }
    const ph = t - this.start;
    if (ph < 0 || ph > 1.2) {
      this.bolt = 0;
      return 0;
    }
    const dbl = this.double && ph > 0.1 ? 0.7 * Math.exp(-(ph - 0.16) * (ph - 0.16) * 600) : 0;
    this.bolt = this.visible
      ? k *
          Math.max(0, Math.exp(-ph * 7) * (0.55 + 0.45 * Math.sin(ph * 80 + 1))) *
          (ph < 0.32 ? 1 : 0) +
        (this.double ? dbl * 0.8 : 0)
      : 0;
    return k * (Math.exp(-ph * 9) + dbl);
  }
}
