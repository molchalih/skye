import { describe, expect, it } from "vitest";
import { SceneModel } from "../src/core/frame-state.ts";
import { resolveParams, SCENE_NAMES } from "../src/index.ts";
import { coverRange, intensityRange, sceneWind, shown } from "./sky.ts";

// The page shows cover and intensity as the renderer will draw them; these cases hold it to the scene model.
describe("shown params", () => {
  const covers = [0, 0.2, 0.5, 0.8, 1];
  const intensities = [0, 0.3, 0.6, 1];

  it.each(SCENE_NAMES)("match what the renderer draws for %s", (scene) => {
    for (const cover of covers) {
      for (const intensity of intensities) {
        const params = resolveParams({ scene, cover, intensity });
        const drawn = new SceneModel().target(params, 0, 1.5, false);
        expect(shown(params).cover, `cover ${cover}, intensity ${intensity}`).toBeCloseTo(
          drawn.cover,
          9,
        );
        const uses = drawn.rain + drawn.snow + drawn.fog + drawn.haze > 0;
        if (uses) expect(shown(params).intensity).toBeCloseTo(drawn.intensity, 9);
      }
    }
  });

  it.each(SCENE_NAMES)("give the renderer's own wind for %s", (scene) => {
    for (const intensity of intensities) {
      const params = resolveParams({ scene, intensity });
      const drawn = new SceneModel().target(params, 0, 1.5, false);
      expect(sceneWind(shown(params))).toBeCloseTo(drawn.wind, 9);
    }
  });

  it("keep every range inside 0 to 1, low end first", () => {
    for (const scene of SCENE_NAMES) {
      for (const [lo, hi] of [
        intensityRange(scene),
        ...intensities.map((i) => coverRange(scene, i)),
      ]) {
        expect(lo).toBeGreaterThanOrEqual(0);
        expect(hi).toBeLessThanOrEqual(1);
        expect(lo).toBeLessThanOrEqual(hi);
      }
    }
  });
});
