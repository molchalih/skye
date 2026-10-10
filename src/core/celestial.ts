// The clear sky: where the sun and moon stand in the frame, how bright and what colour they are, and the colour of
// the sky itself, all from the sun's elevation. Weather changes these afterwards (weather.ts).
import { copyVec3, mixVec3, scaleVec3, smoothstep, type Vec2, type Vec3 } from "./math.ts";
import type { FrameState, Moon, Sun } from "./frame-state.ts";

/** The horizon's height in sky space: 8 % of the frame height above its bottom edge. */
export const HORIZON_Y = -0.42;
/** Frame heights a body climbs per unit of sine elevation. */
const CLIMB = 0.95;
/** Below this sine elevation a body sinks no further, so its glow stays just under the horizon. */
const LOWEST_SIN_ELEVATION = -0.2;
/** How far a body swings from the centre, as a fraction of the frame width, at azimuth ±90°. */
const SWING = 0.42;

/** Places a body at `azimuth` (0 south, positive west) and `sinElevation` in sky space. */
export function placeInSky(out: Vec2, azimuth: number, sinElevation: number, aspect: number): void {
  out[0] = Math.sin(azimuth) * SWING * aspect;
  out[1] = HORIZON_Y + CLIMB * Math.max(sinElevation, LOWEST_SIN_ELEVATION);
}

/** The sun's position in texture coordinates, 0 to 1 across the frame. */
export function sunInTexture(out: Vec2, state: Readonly<FrameState>): Vec2 {
  const sun = state.sun.position;
  out[0] = sun[0] / state.aspect + 0.5;
  out[1] = sun[1] + 0.5;
  return out;
}

/** The antisolar point: the sun mirrored through the horizon, and the centre of a rainbow's arc. */
export function antisolarPoint(out: Vec2, sun: Readonly<Vec2>): Vec2 {
  out[0] = -sun[0];
  out[1] = 2 * HORIZON_Y - sun[1];
  return out;
}

/** Daylight, 0 to 1: none once the sun is 7° below the horizon, full from 14° above it. */
export function daylight(sinElevation: number): number {
  return smoothstep(-0.12, 0.25, sinElevation);
}

type GradientStop = readonly [
  sinElevation: number,
  zenith: Readonly<Vec3>,
  horizon: Readonly<Vec3>,
];

/**
 * The clear sky's zenith and horizon colours by the sun's elevation, from
 * deep night through the reds of twilight to the blue of day.
 */
const GRADIENT: readonly [GradientStop, GradientStop, ...GradientStop[]] = [
  [-0.31, [0.004, 0.007, 0.02], [0.014, 0.022, 0.045]],
  [-0.21, [0.008, 0.012, 0.036], [0.05, 0.06, 0.12]],
  [-0.105, [0.03, 0.05, 0.13], [0.32, 0.2, 0.3]],
  [0.0, [0.11, 0.17, 0.4], [0.95, 0.52, 0.28]],
  [0.105, [0.15, 0.3, 0.62], [0.88, 0.7, 0.52]],
  [0.5, [0.1, 0.28, 0.7], [0.48, 0.63, 0.84]],
  [1.0, [0.08, 0.24, 0.66], [0.52, 0.67, 0.86]],
];

/** Writes the clear sky's colours for the sun at `sinElevation`, eased between the stops either side of it. */
export function clearSky(sinElevation: number, zenith: Vec3, horizon: Vec3): void {
  let below = GRADIENT[0];
  let above = GRADIENT[1];
  for (let i = 2; i < GRADIENT.length && sinElevation > above[0]; i++) {
    below = above;
    above = GRADIENT[i] ?? above;
  }
  const t = smoothstep(below[0], above[0], sinElevation);
  mixVec3(zenith, below[1], above[1], t);
  mixVec3(horizon, below[2], above[2], t);
}

const SUN_LOW: Readonly<Vec3> = [1.0, 0.45, 0.2];
const SUN_HIGH: Readonly<Vec3> = [1.0, 0.95, 0.88];
/** The sun through dust: red. */
const SUN_IN_HAZE: Readonly<Vec3> = [1.0, 0.38, 0.18];
/** What a sun that is down tints the flare with; the flare is off by then, so only its fade-out shows it. */
const SET_SUN_TINT: Readonly<Vec3> = [1, 0.9, 0.8];

/**
 * Lights the sun: orange on the horizon, warm white from about 20° up, and
 * brighter the higher it climbs; reddened by `hazeDensity` and dimmed by
 * `hazeDimming`, 0 to 1 each.
 */
export function lightSun(sun: Sun, hazeDensity: number, hazeDimming: number): void {
  const height = smoothstep(0, 0.35, sun.sinElevation);
  const color = mixVec3(sun.color, SUN_LOW, SUN_HIGH, height);
  mixVec3(color, color, SUN_IN_HAZE, 0.9 * hazeDensity);
  scaleVec3(color, (1.3 + 1.7 * height) * sun.visibility * (1 - 0.78 * hazeDimming));
  const brightest = Math.max(color[0], color[1], color[2], 1e-3);
  if (sun.visibility > 0.001) scaleVec3(copyVec3(sun.tint, color), 1 / brightest);
  else copyVec3(sun.tint, SET_SUN_TINT);
}

/** Cool blue-white moonlight from a full moon in the sky. */
const MOONLIGHT: Readonly<Vec3> = [0.225, 0.275, 0.4];

/**
 * Lights the moon: it shows only at night, once risen, and once more than a
 * sliver of it is lit.
 */
export function lightMoon(moon: Moon, sinElevation: number, night: number): void {
  const litFraction = 0.5 - 0.5 * Math.cos(moon.phase * 2 * Math.PI);
  moon.visibility =
    smoothstep(-0.05, 0.1, sinElevation) * night * smoothstep(0.02, 0.12, litFraction);
  scaleVec3(copyVec3(moon.color, MOONLIGHT), moon.visibility);
}
