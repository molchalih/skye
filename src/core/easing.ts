import { createFrameState, type Body, type FrameState, type FrameTime } from "./frame-state.ts";
import { mix, smoothstep } from "./math.ts";

/** Time constant of the chase: a value covers 63 % of the way to its target in this many seconds. */
const CHASE_TAU_S = 0.7;
/**
 * How long the background blur takes to reach a new radius. It runs for a
 * fixed time and lands exactly, unlike the chase, because a blur that has
 * settled shrinks the canvas (`computeLayout`).
 */
export const BLUR_FADE_S = 0.62;

/**
 * Where `current` is once `remaining` of its distance to `target` is left;
 * 0 lands on the target. There is no snap. A chase across a whole unit comes
 * within float32's precision of a non-zero target in about 12 s, and the
 * uniform it feeds stops changing; a chase toward 0 only shrinks, through
 * float32's smallest values for about 73 s, and in float64 never reaches 0
 * (it stalls near 1e-322). So gate an eased value by a threshold, never by
 * `> 0`. Kept under V8's 30 bytes of bytecode for small functions, which it
 * inlines at every call whatever else the caller has inlined, so no number is
 * boxed.
 */
function approach(current: number, target: number, remaining: number): number {
  return target + (current - target) * remaining;
}

/**
 * Eases a displayed frame state toward the targets the scene model gives it:
 * every value chases its target exponentially, which is frame-rate
 * independent, while the blur runs a fixed-length smoothstep. The first step,
 * and every static one, lands on the target.
 */
export class Easer {
  /** The eased state; the same object on every step. */
  readonly current: FrameState = createFrameState();
  #started = false;
  // The fraction of each value's distance to its target left after this step. A field rather than an argument:
  // a number passed to a call V8 does not inline is boxed.
  #remaining = 0;
  #blurFrom = 0;
  #blurTo = 0;
  #blurProgress = 1;

  /** Advances the eased state by `time.dt` toward `target`, and returns it. */
  step(target: Readonly<FrameState>, time: Readonly<FrameTime>): FrameState {
    const jump = !this.#started || time.isStatic;
    this.#started = true;
    if (jump) this.#remaining = 0;
    else this.#remaining = Math.exp(-time.dt / CHASE_TAU_S);
    const cur = this.current;
    this.#easeScalars(cur, target);
    this.#easeBody(cur.sun, target.sun);
    this.#easeBody(cur.moon, target.moon);
    this.#easeVector(cur.sun.tint, target.sun.tint);
    this.#easeVector(cur.light.position, target.light.position);
    this.#easeVector(cur.light.color, target.light.color);
    this.#easeVector(cur.zenith, target.zenith);
    this.#easeVector(cur.horizon, target.horizon);
    cur.moon.phase = approach(cur.moon.phase, target.moon.phase, this.#remaining);
    cur.sun.sinElevation = approach(cur.sun.sinElevation, target.sun.sinElevation, this.#remaining);
    if (jump) this.#jumpBlur(target);
    else this.#tweenBlur(target, time);
    return cur;
  }

  #easeScalars(cur: FrameState, to: Readonly<FrameState>): void {
    const r = this.#remaining;
    cur.aspect = approach(cur.aspect, to.aspect, r);
    cur.exposure = approach(cur.exposure, to.exposure, r);
    cur.focus = approach(cur.focus, to.focus, r);
    cur.seed = approach(cur.seed, to.seed, r);
    cur.night = approach(cur.night, to.night, r);
    cur.sceneExposure = approach(cur.sceneExposure, to.sceneExposure, r);
    cur.cover = approach(cur.cover, to.cover, r);
    cur.intensity = approach(cur.intensity, to.intensity, r);
    cur.cloudDarkness = approach(cur.cloudDarkness, to.cloudDarkness, r);
    cur.wind = approach(cur.wind, to.wind, r);
    cur.gustiness = approach(cur.gustiness, to.gustiness, r);
    cur.rain = approach(cur.rain, to.rain, r);
    cur.snow = approach(cur.snow, to.snow, r);
    cur.sleet = approach(cur.sleet, to.sleet, r);
    cur.storm = approach(cur.storm, to.storm, r);
    cur.fog = approach(cur.fog, to.fog, r);
    cur.haze = approach(cur.haze, to.haze, r);
    cur.dust = approach(cur.dust, to.dust, r);
    cur.rays = approach(cur.rays, to.rays, r);
    cur.flare = approach(cur.flare, to.flare, r);
    cur.rainbow = approach(cur.rainbow, to.rainbow, r);
    cur.twilightBelt = approach(cur.twilightBelt, to.twilightBelt, r);
    cur.stars = approach(cur.stars, to.stars, r);
    cur.sunHidden = approach(cur.sunHidden, to.sunHidden, r);
    cur.glassRain = approach(cur.glassRain, to.glassRain, r);
    cur.glassFrost = approach(cur.glassFrost, to.glassFrost, r);
    cur.glassMist = approach(cur.glassMist, to.glassMist, r);
  }

  #easeBody(cur: Body, to: Readonly<Body>): void {
    cur.visibility = approach(cur.visibility, to.visibility, this.#remaining);
    this.#easeVector(cur.position, to.position);
    this.#easeVector(cur.color, to.color);
  }

  #easeVector(cur: number[], to: readonly number[]): void {
    const r = this.#remaining;
    for (let i = 0; i < cur.length; i++) cur[i] = approach(cur[i] ?? 0, to[i] ?? 0, r);
  }

  #jumpBlur(to: Readonly<FrameState>): void {
    this.current.blur = this.#blurFrom = this.#blurTo = to.blur;
    this.#blurProgress = 1;
  }

  // A new target restarts the tween from wherever the blur is.
  #tweenBlur(to: Readonly<FrameState>, time: Readonly<FrameTime>): void {
    if (to.blur !== this.#blurTo) {
      this.#blurFrom = this.current.blur;
      this.#blurTo = to.blur;
      this.#blurProgress = 0;
    }
    this.#blurProgress = Math.min(1, this.#blurProgress + time.dt / BLUR_FADE_S);
    this.current.blur =
      this.#blurProgress < 1
        ? mix(this.#blurFrom, this.#blurTo, smoothstep(0, 1, this.#blurProgress))
        : this.#blurTo;
  }
}
