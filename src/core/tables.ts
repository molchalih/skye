import type { Vec3 } from "./math.ts";
import type { SceneName, Tier } from "./params.ts";

export interface SceneDef {
  /** Cloud darkening at minimum and maximum intensity. */
  readonly dark: readonly [number, number];
  readonly darkCov: number;
  /** Wind at minimum and maximum intensity. */
  readonly wind: readonly [number, number];
  readonly covMax?: number;
  readonly covMin?: number;
  readonly intMin?: number;
  readonly fog?: number;
  readonly rain?: number;
  readonly snow?: number;
  readonly storm?: number;
  readonly sleet?: number;
  readonly haze?: number;
  readonly dust?: number;
}

export interface TierDef {
  readonly name: Tier;
  /** Cloud-buffer scale relative to the canvas backing store. */
  readonly sky: number;
  /** Composite and particle buffer scale relative to the backing store. */
  readonly scene: number;
  readonly dpr: number;
  readonly start: number;
  readonly end: number;
  readonly oct: number;
  readonly rain: number;
  readonly snow: number;
  readonly dust: number;
  readonly rayTaps: number;
  readonly fps: number;
}

export type SkyStop = readonly [elevation: number, zenith: Readonly<Vec3>, horizon: Readonly<Vec3>];

export const SCENES: Readonly<Record<SceneName, SceneDef>> = {
  clear: { dark: [0.05, 0.05], darkCov: 0.25, wind: [0.8, 0.8], covMax: 0.35 },
  cloudy: { dark: [0.1, 0.1], darkCov: 0.3, wind: [1.3, 1.3] },
  fog: { dark: [0.05, 0.08], darkCov: 0.1, wind: [0.35, 0.7], fog: 1, covMin: 0.5 },
  rainy: { dark: [0.3, 0.72], darkCov: 0.1, wind: [1.1, 3.0], rain: 1 },
  storm: {
    dark: [0.62, 0.92],
    darkCov: 0.08,
    wind: [2.4, 4.6],
    rain: 1,
    storm: 1,
    covMin: 0.7,
    intMin: 0.45,
  },
  sleet: { dark: [0.3, 0.66], darkCov: 0.1, wind: [1.0, 2.4], rain: 0.6, snow: 0.6, sleet: 1 },
  snowy: { dark: [0.25, 0.7], darkCov: 0.1, wind: [0.5, 1.6], snow: 1 },
  haze: { dark: [0.12, 0.28], darkCov: 0.2, wind: [0.5, 0.9], haze: 1, dust: 1, covMax: 0.5 },
};

/** Ordered low, balanced, high: auto-tiering steps through the indices. */
export const TIERS: readonly [TierDef, TierDef, TierDef] = [
  {
    name: "low",
    sky: 0.3,
    scene: 0.5,
    dpr: 1,
    start: 1,
    end: 3,
    oct: 4,
    rain: 2500,
    snow: 700,
    dust: 250,
    rayTaps: 6,
    fps: 30,
  },
  {
    name: "balanced",
    sky: 0.45,
    scene: 0.75,
    dpr: 1,
    start: 0,
    end: 3,
    oct: 5,
    rain: 4000,
    snow: 1600,
    dust: 400,
    rayTaps: 10,
    fps: 60,
  },
  {
    name: "high",
    sky: 0.5,
    scene: 1,
    dpr: 1.5,
    start: 0,
    end: 4,
    oct: 6,
    rain: 8000,
    snow: 3200,
    dust: 600,
    rayTaps: 16,
    fps: 60,
  },
];

export const BQ_STEPS: readonly number[] = [0.125, 0.1875, 0.25, 0.375, 0.5, 0.75, 1];

/** Sun-elevation stops (sine of elevation) with zenith and horizon colours. */
export const SKY_STOPS: readonly SkyStop[] = [
  [-0.31, [0.004, 0.007, 0.02], [0.014, 0.022, 0.045]],
  [-0.21, [0.008, 0.012, 0.036], [0.05, 0.06, 0.12]],
  [-0.105, [0.03, 0.05, 0.13], [0.32, 0.2, 0.3]],
  [0.0, [0.11, 0.17, 0.4], [0.95, 0.52, 0.28]],
  [0.105, [0.15, 0.3, 0.62], [0.88, 0.7, 0.52]],
  [0.5, [0.1, 0.28, 0.7], [0.48, 0.63, 0.84]],
  [1.0, [0.08, 0.24, 0.66], [0.52, 0.67, 0.86]],
];

/** Fixed duration of the blur tween, in seconds. */
export const BLUR_DURATION_S = 0.62;
