import type { FrameState, FrameTime } from "./frame-state.ts";

/** How far gusts move the wind speed either way, at a gustiness of 1. */
const GUST_SWING = 0.25;

/**
 * The wind that drifts the clouds and blows the particles. It gusts in two
 * slow swells, about 20 s and 7.6 s long, whose periods never line up, so
 * the pattern does not visibly repeat.
 */
export class Wind {
  /** This frame's speed, gusts included. */
  speed = 0;
  /** How far the wind has carried the clouds: the speed integrated over animation time. */
  offset = 0;

  /** Advances by `time.dt` under the state's wind and gustiness. */
  blow(time: Readonly<FrameTime>, state: Readonly<FrameState>): void {
    const t = time.seconds;
    const swell = Math.sin(t * 0.31) + 0.6 * Math.sin(t * 0.83 + 1.7);
    this.speed = state.wind * (1 + GUST_SWING * swell * state.gustiness);
    this.offset += this.speed * time.dt;
  }
}
