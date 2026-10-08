// What the page needs to know about a sky beyond its params: where the sun and moon are, which values a scene
// can show, and roughly how bright it renders. Scene rules come from the renderer's own table.
import { solarPosition, type SolarPosition } from "../src/astro/index.ts";
import { SCENES } from "../src/core/tables.ts";
import type { ResolvedParams, SceneName } from "../src/index.ts";

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** The sun for `p`, at `hour` if given. */
export function sunAt(p: ResolvedParams, hour: number = p.hour): SolarPosition {
  return solarPosition(p.latitude, p.dayOfYear, hour, p.solarNoon);
}

// skye places the moon where the sun was `moonPhase` days earlier in the day: 24 hours per cycle.
function moonAt(p: ResolvedParams): SolarPosition {
  return solarPosition(p.latitude, p.dayOfYear, p.hour - p.moonPhase * 24, p.solarNoon);
}

/** The intensity a scene accepts: storms never fall below their floor. */
export function intensityRange(scene: SceneName): readonly [number, number] {
  return [SCENES[scene].intMin ?? 0, 1];
}

/**
 * The cloud cover a scene can show. skye raises the cover under rain and snow,
 * more so the harder they fall, and holds some skies above a floor or under a
 * cap; the floors for rain and snow follow the renderer's scene model.
 */
export function coverRange(scene: SceneName, intensity: number): readonly [number, number] {
  const def = SCENES[scene];
  let lo = 0;
  if (def.rain) lo = Math.max(lo, (0.4 + 0.45 * intensity) * def.rain);
  if (def.snow) lo = Math.max(lo, (0.35 + 0.4 * intensity) * def.snow);
  if (def.covMin !== undefined) lo = Math.max(lo, def.covMin);
  const hi = def.covMax ?? 1;
  return [Math.min(lo, hi), hi];
}

/** The wind skye uses when `wind` is unset: the scene's own, scaled by intensity. */
export function sceneWind(p: ResolvedParams): number {
  const [calm, gale] = SCENES[p.scene].wind;
  return calm + (gale - calm) * p.intensity;
}

/**
 * The params as skye will show them: intensity and cover moved into what the
 * scene allows, so every number on the page is one the sky really shows.
 */
export function shown(p: ResolvedParams): ResolvedParams {
  const intensity = clamp(p.intensity, ...intensityRange(p.scene));
  const cover = clamp(p.cover, ...coverRange(p.scene, intensity));
  return { ...p, intensity, cover };
}

/**
 * How much daylight each step of the day holds, 0 at night to 1 in full day,
 * at `steps + 1` evenly spaced hours from 0 to 24.
 */
export function daylight(p: ResolvedParams, steps: number): number[] {
  return Array.from({ length: steps + 1 }, (_, i) =>
    smooth(-0.25, 0.05, sunAt(p, (i / steps) * 24).sinElevation),
  );
}

const WEATHER: Readonly<Record<SceneName, (intensity: number) => number>> = {
  clear: () => 1,
  cloudy: () => 1,
  fog: () => 1,
  haze: () => 1,
  rainy: (i) => 1 - 0.7 * i,
  sleet: (i) => 1 - 0.6 * i,
  snowy: (i) => 0.95 - 0.3 * i,
  storm: (i) => 0.4 - 0.3 * i,
};

/**
 * Rough linear luminance of the lower half of the sky, so the type can choose
 * an ink that reads on it. Fitted to frames skye rendered: about 0.55 by day,
 * 0.05 on a moonless night, up to 0.33 when a full moon lights total cover;
 * weather darkens that and exposure scales it.
 * @param p params as shown
 */
export function luminance(p: ResolvedParams): number {
  const day = smooth(-0.25, -0.06, sunAt(p).sinElevation);
  const lit = 0.5 - 0.5 * Math.cos(p.moonPhase * 2 * Math.PI);
  const moon = smooth(-0.05, 0.1, moonAt(p).sinElevation) * smooth(0.02, 0.12, lit);
  const night = 0.045 + moon * (0.04 + 0.29 * p.cover);
  return (night + (0.55 - night) * day) * WEATHER[p.scene](p.intensity) * p.exposure ** 0.8;
}

/**
 * SVG path of the lit part of a unit moon: lit on the right while it waxes,
 * as seen from the north. The terminator is a half ellipse.
 * @param phase 0 is new, 0.5 is full
 */
export function moonPath(phase: number): string {
  const waxing = phase < 0.5;
  const rx = Math.abs(Math.cos(phase * 2 * Math.PI)) * 0.94;
  const gibbous = phase > 0.25 && phase < 0.75;
  const outer = waxing ? 1 : 0;
  const inner = waxing === gibbous ? 1 : 0;
  return `M0,-0.94 A0.94,0.94 0 0 ${outer} 0,0.94 A${rx.toFixed(3)},0.94 0 0 ${inner} 0,-0.94Z`;
}
