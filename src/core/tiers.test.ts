import { describe, expect, it } from "vitest";
import { QUALITIES } from "./params.ts";
import { ECO, FIXED_TIERS, START_TIER, tierFor, TIERS } from "./tiers.ts";

describe("tiers", () => {
  it("orders the auto ladder low, balanced, high, each finer than the one below", () => {
    expect(TIERS.map((t) => t.name)).toEqual(["low", "balanced", "high"]);
    for (const [i, tier] of TIERS.entries()) {
      const below = TIERS[i - 1];
      if (below === undefined) continue;
      expect(tier.skyScale).toBeGreaterThan(below.skyScale);
      expect(tier.maxOctaves).toBeGreaterThan(below.maxOctaves);
      expect(tier.rayTaps).toBeGreaterThan(below.rayTaps);
      expect(tier.raindrops).toBeGreaterThan(below.raindrops);
    }
    expect(TIERS[START_TIER].name).toBe("balanced");
  });

  it("keeps eco out of the auto ladder, as low at a lower pixel-ratio and frame-rate cap", () => {
    expect(TIERS.map((t) => t.name)).not.toContain("eco");
    expect(ECO).toEqual({ ...TIERS[0], name: "eco", maxPixelRatio: 0.75, maxFps: 20 });
    expect(FIXED_TIERS.map((t) => t.name)).toEqual(QUALITIES.filter((q) => q !== "auto"));
  });

  it("picks the fixed tier, or the auto controller's", () => {
    expect(tierFor("eco", 2)).toBe(ECO);
    expect(tierFor("high", 0)).toBe(TIERS[2]);
    expect(tierFor("auto", 0)).toBe(TIERS[0]);
    expect(tierFor("auto", 7)).toBe(TIERS[START_TIER]);
  });
});
