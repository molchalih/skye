import type { SceneName } from "./params.ts";

/** A value at the weakest and at the strongest weather (intensity 0 and 1), mixed linearly between. */
export type ByIntensity = readonly [weakest: number, strongest: number];

/**
 * What a scene is made of. Every scene has every field, so the scene model
 * reads them without defaults and V8 sees one shape.
 */
export interface SceneDef {
  /** How much of each weather the scene holds, 0 to 1. Sleet is part rain, part snow and its own kind of flake. */
  readonly rain: number;
  readonly snow: number;
  readonly sleet: number;
  readonly storm: number;
  readonly fog: number;
  readonly haze: number;
  /** Dust motes in the air (haze). */
  readonly dust: number;
  /** How dark the clouds turn, before cover adds `darknessPerCover` × cover. */
  readonly darkness: ByIntensity;
  readonly darknessPerCover: number;
  /** Cloud drift speed when the params give none. */
  readonly wind: ByIntensity;
  /** The cloud cover the scene allows, whatever the params ask for. */
  readonly minCover: number;
  readonly maxCover: number;
  /** The weakest weather the scene shows: a storm is never mild. */
  readonly minIntensity: number;
}

/** What every scene sets for itself; the rest defaults to a calm, dry sky. */
type Distinct = "darkness" | "darknessPerCover" | "wind";

const CALM: Omit<SceneDef, Distinct> = {
  rain: 0,
  snow: 0,
  sleet: 0,
  storm: 0,
  fog: 0,
  haze: 0,
  dust: 0,
  minCover: 0,
  maxCover: 1,
  minIntensity: 0,
};

function defineScene(def: Partial<SceneDef> & Pick<SceneDef, Distinct>): SceneDef {
  return { ...CALM, ...def };
}

export const SCENES: Readonly<Record<SceneName, SceneDef>> = {
  clear: defineScene({
    darkness: [0.05, 0.05],
    darknessPerCover: 0.25,
    wind: [0.8, 0.8],
    maxCover: 0.35,
  }),
  cloudy: defineScene({ darkness: [0.1, 0.1], darknessPerCover: 0.3, wind: [1.3, 1.3] }),
  fog: defineScene({
    fog: 1,
    darkness: [0.05, 0.08],
    darknessPerCover: 0.1,
    wind: [0.35, 0.7],
    minCover: 0.5,
  }),
  rainy: defineScene({
    rain: 1,
    darkness: [0.3, 0.72],
    darknessPerCover: 0.1,
    wind: [1.1, 3.0],
  }),
  storm: defineScene({
    rain: 1,
    storm: 1,
    darkness: [0.62, 0.92],
    darknessPerCover: 0.08,
    wind: [2.4, 4.6],
    minCover: 0.7,
    minIntensity: 0.45,
  }),
  sleet: defineScene({
    rain: 0.6,
    snow: 0.6,
    sleet: 1,
    darkness: [0.3, 0.66],
    darknessPerCover: 0.1,
    wind: [1.0, 2.4],
  }),
  snowy: defineScene({
    snow: 1,
    darkness: [0.25, 0.7],
    darknessPerCover: 0.1,
    wind: [0.5, 1.6],
  }),
  haze: defineScene({
    haze: 1,
    dust: 1,
    darkness: [0.12, 0.28],
    darknessPerCover: 0.2,
    wind: [0.5, 0.9],
    maxCover: 0.5,
  }),
};

/** Whether the scene's weather has a strength: rain, snow, fog or haze do; a clear or cloudy sky has none. */
export function hasIntensity(scene: SceneDef): boolean {
  return scene.rain + scene.snow + scene.fog + scene.haze > 0;
}

/** The intensity the scene shows for the `intensity` param. */
export function sceneIntensity(scene: SceneDef, intensity: number): number {
  return Math.max(hasIntensity(scene) ? intensity : 0, scene.minIntensity);
}

/**
 * The least cloud cover the scene shows at `intensity`: rain and snow need
 * cloud to fall from, the more the harder they fall.
 */
export function coverFloor(scene: SceneDef, intensity: number): number {
  return Math.max(
    scene.minCover,
    (0.4 + 0.45 * intensity) * scene.rain,
    (0.35 + 0.4 * intensity) * scene.snow,
  );
}
