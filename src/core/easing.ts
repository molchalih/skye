import { createFrameState, type FrameState, type Vec2 } from "./frame-state.ts";
import { mix, smoothstep, type Vec3 } from "./math.ts";
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
      chaseFrameState(cur, target, 1);
      cur.blur = target.blur;
      this.#ready = true;
      this.#blurFrom = this.#blurTo = cur.blur;
      this.#blurT = 1;
      return cur;
    }
    chaseFrameState(cur, target, 1 - Math.exp(-dt / CHASE_TAU_S));
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

// Moves `c` the fraction `a` of the way to `v`; at 1 it lands on `v` exactly, which is how a step copies the target.
function chase(c: number, v: number, a: number): number {
  if (a >= 1) return v;
  const x = c + (v - c) * a;
  return Math.abs(x - v) < SNAP ? v : x;
}

// Every value but blur moves the fraction `a` of the way to its target. Field by field, since a number read or
// written under a computed key is boxed; and the scalars in groups of a dozen at most, since V8 inlines only about
// that many `chase` calls into one function, and a call it leaves out boxes its result.
function chaseFrameState(cur: FrameState, t: Readonly<FrameState>, a: number): void {
  chaseParams(cur, t, a);
  chaseSky(cur, t, a);
  chaseWeather(cur, t, a);
  chaseEffects(cur, t, a);
  chaseVec2(cur.sunPos, t.sunPos, a);
  chaseVec2(cur.moonPos, t.moonPos, a);
  chaseVec2(cur.lightPos, t.lightPos, a);
  chaseVec2(cur.antiSunPos, t.antiSunPos, a);
  chaseVec2(cur.sunUV, t.sunUV, a);
  chaseVec3(cur.zenith, t.zenith, a);
  chaseVec3(cur.horizon, t.horizon, a);
  chaseVec3(cur.sunColor, t.sunColor, a);
  chaseVec3(cur.moonColor, t.moonColor, a);
  chaseVec3(cur.lightColor, t.lightColor, a);
  chaseVec3(cur.sunTint, t.sunTint, a);
}

function chaseParams(cur: FrameState, t: Readonly<FrameState>, a: number): void {
  cur.cover = chase(cur.cover, t.cover, a);
  cur.intensity = chase(cur.intensity, t.intensity, a);
  cur.seed = chase(cur.seed, t.seed, a);
  cur.glass = chase(cur.glass, t.glass, a);
  cur.focus = chase(cur.focus, t.focus, a);
  cur.wind = chase(cur.wind, t.wind, a);
  cur.exposure = chase(cur.exposure, t.exposure, a);
  cur.aspect = chase(cur.aspect, t.aspect, a);
}

function chaseSky(cur: FrameState, t: Readonly<FrameState>, a: number): void {
  cur.sinElevation = chase(cur.sinElevation, t.sinElevation, a);
  cur.elevationDeg = chase(cur.elevationDeg, t.elevationDeg, a);
  cur.sunrise = chase(cur.sunrise, t.sunrise, a);
  cur.sunset = chase(cur.sunset, t.sunset, a);
  cur.night = chase(cur.night, t.night, a);
  cur.sunUp = chase(cur.sunUp, t.sunUp, a);
  cur.moonUp = chase(cur.moonUp, t.moonUp, a);
  cur.moonPhase = chase(cur.moonPhase, t.moonPhase, a);
  cur.moonIllumination = chase(cur.moonIllumination, t.moonIllumination, a);
  cur.weatherExposure = chase(cur.weatherExposure, t.weatherExposure, a);
  cur.cloudDark = chase(cur.cloudDark, t.cloudDark, a);
}

function chaseWeather(cur: FrameState, t: Readonly<FrameState>, a: number): void {
  cur.rain = chase(cur.rain, t.rain, a);
  cur.snow = chase(cur.snow, t.snow, a);
  cur.fog = chase(cur.fog, t.fog, a);
  cur.haze = chase(cur.haze, t.haze, a);
  cur.dust = chase(cur.dust, t.dust, a);
  cur.storm = chase(cur.storm, t.storm, a);
  cur.sleet = chase(cur.sleet, t.sleet, a);
  cur.gust = chase(cur.gust, t.gust, a);
}

function chaseEffects(cur: FrameState, t: Readonly<FrameState>, a: number): void {
  cur.glassRain = chase(cur.glassRain, t.glassRain, a);
  cur.glassFrost = chase(cur.glassFrost, t.glassFrost, a);
  cur.glassMist = chase(cur.glassMist, t.glassMist, a);
  cur.rays = chase(cur.rays, t.rays, a);
  cur.flare = chase(cur.flare, t.flare, a);
  cur.rainbow = chase(cur.rainbow, t.rainbow, a);
  cur.belt = chase(cur.belt, t.belt, a);
  cur.star = chase(cur.star, t.star, a);
  cur.hide = chase(cur.hide, t.hide, a);
}

function chaseVec2(c: Vec2, v: Readonly<Vec2>, a: number): void {
  const copy = a >= 1;
  c[0] = copy ? v[0] : c[0] + (v[0] - c[0]) * a;
  c[1] = copy ? v[1] : c[1] + (v[1] - c[1]) * a;
}

function chaseVec3(c: Vec3, v: Readonly<Vec3>, a: number): void {
  const copy = a >= 1;
  c[0] = copy ? v[0] : c[0] + (v[0] - c[0]) * a;
  c[1] = copy ? v[1] : c[1] + (v[1] - c[1]) * a;
  c[2] = copy ? v[2] : c[2] + (v[2] - c[2]) * a;
}
