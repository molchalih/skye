import { describe, expect, it } from "vitest";
import { SCENE_NAMES } from "./params.ts";
import { BLUR_DURATION_S, BQ_STEPS, SCENES, SKY_STOPS, TIERS } from "./tables.ts";

describe("tables", () => {
  it("defines every scene", () => {
    expect(Object.keys(SCENES).sort()).toEqual([...SCENE_NAMES].sort());
  });

  it("keeps v6 scene values", () => {
    expect(SCENES.storm).toEqual({
      dark: [0.62, 0.92],
      darkCov: 0.08,
      wind: [2.4, 4.6],
      rain: 1,
      storm: 1,
      covMin: 0.7,
      intMin: 0.45,
    });
    expect(SCENES.clear.covMax).toBe(0.35);
    expect(SCENES.sleet.sleet).toBe(1);
  });

  it("orders tiers low, balanced, high", () => {
    expect(TIERS.map((t) => t.name)).toEqual(["low", "balanced", "high"]);
    expect(TIERS[1].rayTaps).toBe(10);
    expect(TIERS[2].dpr).toBe(1.5);
    expect(TIERS[0].fps).toBe(30);
  });

  it("keeps v6 constants", () => {
    expect(BQ_STEPS).toEqual([0.125, 0.1875, 0.25, 0.375, 0.5, 0.75, 1]);
    expect(BLUR_DURATION_S).toBe(0.62);
    expect(SKY_STOPS).toHaveLength(7);
    expect(SKY_STOPS[0]?.[0]).toBe(-0.31);
    expect(SKY_STOPS[6]?.[2]).toEqual([0.52, 0.67, 0.86]);
  });
});
