import type { AutoTier, Quality, Tier } from "./params.ts";

/** What a quality tier draws, and at what resolution and rate. */
export interface TierDef<N extends Tier = Tier> {
  readonly name: N;
  /** Sky (cloud) buffer size relative to the canvas backing store. */
  readonly skyScale: number;
  /** Scene (composite and particle) buffer size relative to the backing store. */
  readonly sceneScale: number;
  /** The highest device pixel ratio the backing store follows. */
  readonly maxPixelRatio: number;
  /**
   * The first and last cloud layer drawn, of the sky shader's five: from 0,
   * the finest and slowest, to 4, the broadest and fastest.
   */
  readonly cloudLayers: readonly [first: number, last: number];
  /** The most noise octaves a cloud layer takes. */
  readonly maxOctaves: number;
  /** Particles at full weather and full particle resolution. */
  readonly raindrops: number;
  readonly snowflakes: number;
  readonly dustMotes: number;
  /** Samples per pixel along each crepuscular ray. */
  readonly rayTaps: number;
  readonly maxFps: number;
}

/** Ordered low, balanced, high: auto-tiering steps through the indices. */
export const TIERS: readonly [TierDef<AutoTier>, TierDef<AutoTier>, TierDef<AutoTier>] = [
  {
    name: "low",
    skyScale: 0.3,
    sceneScale: 0.5,
    maxPixelRatio: 1,
    cloudLayers: [1, 3],
    maxOctaves: 4,
    raindrops: 2500,
    snowflakes: 700,
    dustMotes: 250,
    rayTaps: 6,
    maxFps: 30,
  },
  {
    name: "balanced",
    skyScale: 0.45,
    sceneScale: 0.75,
    maxPixelRatio: 1,
    cloudLayers: [0, 3],
    maxOctaves: 5,
    raindrops: 4000,
    snowflakes: 1600,
    dustMotes: 400,
    rayTaps: 10,
    maxFps: 60,
  },
  {
    name: "high",
    skyScale: 0.5,
    sceneScale: 1,
    maxPixelRatio: 1.5,
    cloudLayers: [0, 4],
    maxOctaves: 6,
    raindrops: 8000,
    snowflakes: 3200,
    dustMotes: 600,
    rayTaps: 16,
    maxFps: 60,
  },
];

/** Where `"auto"` starts, and what an unknown index falls back to. */
export const START_TIER = 1;

/**
 * The opt-in tier below low, outside the auto ladder: only `quality: "eco"`
 * selects it. Low's cloud layers, octaves, particles and ray taps, so the sky
 * keeps low's shapes; fewer canvas pixels than CSS px (the page scales the
 * canvas up), which softens it, and 20 fps, which calms it. A frame costs about
 * 60 % of low's on the GPU, and draws a third fewer frames a second.
 */
export const ECO: TierDef<"eco"> = { ...TIERS[0], name: "eco", maxPixelRatio: 0.75, maxFps: 20 };

/** Every fixed tier, from cheapest to finest: what `quality` names besides `"auto"`. */
export const FIXED_TIERS: readonly TierDef[] = [ECO, ...TIERS];

/** The tier `quality` draws with; `autoTier` is the auto controller's index, used under `"auto"`. */
export function tierFor(quality: Quality, autoTier: number): TierDef {
  if (quality === "auto") return TIERS[autoTier] ?? TIERS[START_TIER];
  return FIXED_TIERS.find((tier) => tier.name === quality) ?? TIERS[START_TIER];
}
