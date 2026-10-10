import type { FrameState, FrameTime } from "./frame-state.ts";
import { mix, smoothstep, type Vec2 } from "./math.ts";
import type { RandomSource } from "./random.ts";

/** Lightning this faint stops: no strike is scheduled. */
const MIN_ACTIVITY = 0.01;
/** How long a strike lights the sky, in seconds. */
const FLASH_S = 1.2;
/** How long a visible bolt shows, in seconds. */
const BOLT_S = 0.32;
/** When a double strike's second pulse peaks, in seconds after the first. */
const RESTRIKE_S = 0.16;
/** The second pulse's sharpness: 1 / (2σ²) for a σ of 29 ms. */
const RESTRIKE_SHARPNESS = 600;

/**
 * Storm lightning: when strikes fall, where, and how bright the sky flashes
 * and the bolt shows in each frame. Draws from the random source in a fixed
 * order (the delay to the first strike, then per strike its x, y, whether it
 * restrikes, whether its bolt shows, the bolt's seed and the delay to the
 * next), so a seeded source replays the same storm.
 */
export class Lightning {
  /**
   * How active the lightning is, 0 to 1: storms always strike, harder with
   * intensity; heavy rain alone sometimes does. Set by each step.
   */
  activity = 0;
  /** Sky flash brightness of the current frame. */
  flash = 0;
  /** Brightness of the current frame's bolt; 0 when none shows. */
  bolt = 0;
  /** Per-strike random value that shapes the bolt. */
  seed = 0.5;
  /** The strike's position in sky space. */
  readonly position: Vec2 = [0, 0.3];
  /** Time of the next strike; negative while none is scheduled. */
  #next = -1;
  #start = -10;
  #restrikes = false;
  #boltShows = false;

  /** Advances to `time.seconds` and sets this frame's `flash` and `bolt`. */
  step(time: Readonly<FrameTime>, state: Readonly<FrameState>, random: RandomSource): void {
    // Storms always strike, the harder the more intense; heavy rain alone sometimes does. Strikes are scheduled here
    // rather than in a method of their own: they run a few times a minute, too rarely for V8 to optimise such a
    // method, and unoptimised code boxes every number it computes.
    const storm = state.storm * mix(0.45, 1, state.intensity);
    const heavyRain = state.rain * smoothstep(0.55, 0.85, state.intensity) * 0.6;
    const activity = storm + (1 - state.storm) * heavyRain;
    this.activity = activity;
    if (activity <= MIN_ACTIVITY) {
      this.#next = -1;
      this.flash = this.bolt = 0;
      return;
    }
    const t = time.seconds;
    // The first strike comes 2.5 to 6.5 s in at full activity, up to 9 to 18 s when barely active.
    if (this.#next < 0) this.#next = t + mix(9, 2.5, activity) + random() * mix(9, 4, activity);
    if (t > this.#next) {
      // Anywhere across the middle 90 % of the frame, in its upper half. Most strikes restrike, and a storm's bolts
      // show more often than rain's. The next follows 3 to 7 s later at full activity, up to 12 to 24 s.
      this.#start = t;
      this.position[0] = (random() - 0.5) * state.aspect * 0.9;
      this.position[1] = 0.15 + random() * 0.35;
      this.#restrikes = random() < 0.6;
      this.#boltShows = random() < 0.35 + 0.45 * state.storm;
      this.seed = random();
      this.#next = t + mix(12, 3, activity) + random() * mix(12, 4, activity);
    }
    const since = t - this.#start;
    if (since < 0 || since > FLASH_S) {
      this.flash = this.bolt = 0;
      return;
    }
    const restrike =
      this.#restrikes && since > 0.1
        ? 0.7 * Math.exp(-(since - RESTRIKE_S) * (since - RESTRIKE_S) * RESTRIKE_SHARPNESS)
        : 0;
    this.flash = activity * (Math.exp(-since * 9) + restrike);
    // The bolt flickers as it fades, and the restrike lights it again.
    const flicker =
      since < BOLT_S ? Math.exp(-since * 7) * (0.55 + 0.45 * Math.sin(since * 80 + 1)) : 0;
    this.bolt = this.#boltShows ? activity * flicker + 0.8 * restrike : 0;
  }
}
