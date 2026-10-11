import { describe, expect, it } from "vitest";
import { SCENE_NAMES } from "./params.ts";
import { coverFloor, hasIntensity, sceneIntensity, SCENES } from "./scenes.ts";

describe("scenes", () => {
  it("defines every scene, each with every field", () => {
    expect(Object.keys(SCENES).sort()).toEqual([...SCENE_NAMES].sort());
    const fields = Object.keys(SCENES.clear).sort();
    for (const scene of SCENE_NAMES)
      expect(Object.keys(SCENES[scene]).sort(), scene).toEqual(fields);
  });

  it("keeps the storm's values", () => {
    expect(SCENES.storm).toMatchObject({
      rain: 1,
      storm: 1,
      darkness: [0.62, 0.92],
      darknessPerCover: 0.08,
      wind: [2.4, 4.6],
      minCover: 0.7,
      minIntensity: 0.45,
    });
  });

  it("makes sleet part rain, part snow", () => {
    expect([SCENES.sleet.rain, SCENES.sleet.snow, SCENES.sleet.sleet]).toEqual([0.6, 0.6, 1]);
  });

  it("gives intensity only to weather that has a strength", () => {
    expect(SCENE_NAMES.filter((s) => hasIntensity(SCENES[s]))).toEqual([
      "fog",
      "rainy",
      "storm",
      "sleet",
      "snowy",
      "haze",
    ]);
    expect(sceneIntensity(SCENES.cloudy, 0.8)).toBe(0);
    expect(sceneIntensity(SCENES.storm, 0.1)).toBe(0.45);
    expect(sceneIntensity(SCENES.rainy, 0.3)).toBe(0.3);
  });

  it("asks for more cloud the harder rain or snow falls", () => {
    expect(coverFloor(SCENES.cloudy, 1)).toBe(0);
    expect(coverFloor(SCENES.rainy, 0)).toBeCloseTo(0.4, 12);
    expect(coverFloor(SCENES.rainy, 1)).toBeCloseTo(0.85, 12);
    expect(coverFloor(SCENES.snowy, 1)).toBeCloseTo(0.75, 12);
    expect(coverFloor(SCENES.storm, 0)).toBe(0.7);
  });
});
