// What the weather does to the clear sky (celestial.ts): it greys and darkens the sky's colours, sets the exposure,
// and lets through or smothers the optical effects.
import {
  clamp,
  luminance,
  mix,
  mixRange,
  mixVec3,
  scaleVec3,
  smoothstep,
  type Vec3,
} from "./math.ts";
import type { FrameState } from "./frame-state.ts";
import type { ByIntensity, SceneDef } from "./scenes.ts";

type Weather = "rain" | "snow" | "fog" | "haze" | "storm";

/** Fades `color` the fraction `amount` of the way to its own luminance, tinted by `tint`. */
function greyToward(color: Vec3, tint: Readonly<Vec3>, amount: number): void {
  const grey = luminance(color);
  color[0] = mix(color[0], grey * tint[0], amount);
  color[1] = mix(color[1], grey * tint[1], amount);
  color[2] = mix(color[2], grey * tint[2], amount);
}

/** Cloud greys the sky, a cool grey overhead and a nearly neutral one at the horizon, and dims it. */
export function overcast(zenith: Vec3, horizon: Vec3, cover: number): void {
  greyToward(zenith, [0.92, 0.96, 1.06], 0.25 * cover);
  scaleVec3(zenith, 1 - 0.25 * cover);
  greyToward(horizon, [0.95, 0.97, 1.02], 0.3 * cover);
  scaleVec3(horizon, 1 - 0.2 * cover);
}

/** A colour by daylight: [with none, in full daylight], mixed linearly between. */
type Shade = readonly [night: Readonly<Vec3>, day: Readonly<Vec3>];

/** `tint` at the brightness `night` with no daylight, and at `day` in full daylight. */
function shade(tint: Readonly<Vec3>, night: number, day: number): Shade {
  return [
    [tint[0] * night, tint[1] * night, tint[2] * night],
    [tint[0] * day, tint[1] * day, tint[2] * day],
  ];
}

/**
 * A weather that veils the sky in a colour of its own, which brightens with
 * daylight: the sky turns toward it, by `strength` at intensity 0 and 1, and
 * overhead by `overhead` of that.
 */
interface Veil {
  readonly weather: Weather;
  readonly zenith: Shade;
  readonly horizon: Shade;
  readonly strength: ByIntensity;
  readonly overhead: number;
}

const VEILS: readonly Veil[] = [
  // Snow cloud: a cold blue-grey.
  {
    weather: "snow",
    zenith: [
      [0.02, 0.03, 0.05],
      [0.14, 0.18, 0.28],
    ],
    horizon: [
      [0.03, 0.04, 0.06],
      [0.24, 0.28, 0.36],
    ],
    strength: [0.15, 0.6],
    overhead: 1,
  },
  // Fog: a blue-grey whose level rises from 0.012 at night to 0.172 by day, 1.3 to 1.5 times that overhead and
  // twice it at the horizon.
  {
    weather: "fog",
    zenith: shade([1.3, 1.36, 1.5], 0.012, 0.172),
    horizon: shade([2, 2.05, 2.15], 0.012, 0.172),
    strength: [0.55, 0.95],
    overhead: 1,
  },
  // Dust haze: ochre overhead, sand at the horizon, keeping 12 % of its daylight colour at night.
  {
    weather: "haze",
    zenith: shade([0.55, 0.42, 0.26], 0.12, 1),
    horizon: shade([0.9, 0.64, 0.36], 0.12, 1),
    strength: [0.5, 0.85],
    overhead: 0.8,
  },
];

// Scratch for a veil's colour; the sky is recomputed only when the params change.
const veilColor: Vec3 = [0, 0, 0];

function veil(color: Vec3, [night, day]: Shade, daylight: number, strength: number): void {
  mixVec3(color, color, mixVec3(veilColor, night, day, daylight), strength);
}

/**
 * Recolours the sky for the scene's weather. Rain darkens it and greys the
 * horizon; snow, fog and haze veil it; a storm darkens what they leave. Each
 * acts on the colours the one before left.
 */
export function weatherSky(
  scene: SceneDef,
  intensity: number,
  daylight: number,
  zenith: Vec3,
  horizon: Vec3,
): void {
  if (scene.rain > 0) {
    const wet = intensity * scene.rain;
    scaleVec3(zenith, mix(0.8, 0.35, wet));
    greyToward(horizon, [1, 1, 1.05], 0.6 * wet);
    scaleVec3(horizon, mix(0.85, 0.45, wet));
  }
  for (const v of VEILS) {
    const strength = mixRange(v.strength, intensity) * scene[v.weather];
    if (strength <= 0) continue;
    veil(zenith, v.zenith, daylight, strength * v.overhead);
    veil(horizon, v.horizon, daylight, strength);
  }
  if (scene.storm > 0) {
    scaleVec3(zenith, mix(0.7, 0.4, intensity));
    scaleVec3(horizon, mix(0.75, 0.45, intensity));
  }
}

/** How each weather present scales the exposure, at intensity 0 and 1: their bright, flat skies would wash out. */
const WEATHER_EXPOSURE: readonly (readonly [Weather, ByIntensity])[] = [
  ["snow", [0.95, 0.78]],
  ["rain", [1, 0.82]],
  ["fog", [0.95, 0.95]],
  ["haze", [0.95, 0.8]],
  ["storm", [0.85, 0.85]],
];

/** The exposure the scene calls for: 0.8 by day, rising to 2 at night to lift the night sky's dark colours. */
export function sceneExposure(scene: SceneDef, intensity: number, night: number): number {
  let exposure = 0.8 + 1.2 * night;
  for (const [weather, scale] of WEATHER_EXPOSURE)
    if (scene[weather] > 0) exposure *= mixRange(scale, intensity);
  return exposure;
}

/**
 * Sets the optical effects the sun, the cloud and the weather let through,
 * from the state's sun, night, cover and intensity. `glass` is the param:
 * without the glass there is no lens to flare.
 */
export function showEffects(s: FrameState, scene: SceneDef, glass: boolean): void {
  const { cover, intensity, night } = s;
  const { visibility: sunUp, sinElevation: height } = s.sun;
  const { rain, snow, storm, fog, haze } = scene;
  // Crepuscular rays: shafts of sunlight through broken cloud, from 12 % cover to 85 %, longest from a low sun. Fog
  // smothers them; rain, haze and storm thin them.
  s.rays =
    sunUp *
    smoothstep(0.12, 0.4, cover) *
    (1 - smoothstep(0.85, 1, cover)) *
    (1 - fog) *
    (1 - 0.7 * rain) *
    (1 - 0.6 * haze) *
    (0.45 + 0.55 * (1 - clamp(height, 0, 1))) *
    (1 - 0.4 * storm);
  // A lens flare needs a clear line to the sun: little cloud, and no rain, snow or fog.
  s.flare = glass
    ? sunUp *
      (1 - smoothstep(0.2, 0.6, cover)) *
      (1 - fog) *
      (1 - rain) *
      (1 - snow) *
      (1 - 0.5 * haze)
    : 0;
  // A rainbow needs light rain and the sun out, low enough (below about 46°) for the bow to clear the horizon. Never
  // in a storm.
  s.rainbow =
    rain *
    (1 - smoothstep(0.3, 0.6, intensity)) *
    sunUp *
    smoothstep(0.72, 0.4, height) *
    (1 - smoothstep(0.6, 0.9, cover)) *
    (1 - storm);
  // The Belt of Venus: a pink band above the horizon opposite the sun, from just before sunset to just after, in a
  // clear sky.
  s.twilightBelt =
    smoothstep(-0.16, -0.03, height) *
    smoothstep(0.09, -0.02, height) *
    (1 - cover) *
    (1 - fog) *
    (1 - haze);
  // Stars show only at night, through gaps in the cloud, dimmed by haze and by falling rain or snow.
  s.stars =
    night *
    Math.pow(1 - cover, 1.5) *
    (1 - fog) *
    (1 - 0.85 * haze) *
    (1 - 0.9 * rain) *
    (1 - 0.9 * snow);
  // The sun's disc is as hidden as whichever of storm cloud, fog, rain and haze hides it most; fog and haze by
  // their density.
  s.sunHidden = Math.max(storm * 0.97, s.fog * 0.95, rain * intensity * 0.5, s.haze * 0.75);
}
