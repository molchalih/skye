import { describe, expect, it } from "vitest";
import { STATIC_TIME_S, type FrameState, type FrameTime } from "./frame-state.ts";
import { resolveParams, SCENE_NAMES, type SkyeParams } from "./params.ts";
import { FROST_BUILD_UP_S, RAIN_BUILD_UP_S, SceneModel } from "./scene-model.ts";

function at(seconds: number, isStatic = false): FrameTime {
  return { seconds, dt: 1 / 60, isStatic };
}

function stateFor(params: SkyeParams, time = 0, aspect = 1.5): Readonly<FrameState> {
  const model = new SceneModel();
  model.configure(resolveParams(params), aspect);
  return model.target(at(time));
}

describe("SceneModel", () => {
  it("holds a storm to its floors of cover and intensity", () => {
    const s = stateFor({ scene: "storm", cover: 0, intensity: 0 });
    expect(s.cover).toBe(0.7);
    expect(s.intensity).toBe(0.45);
  });

  it("gives clear and cloudy skies no intensity, and caps a clear sky's cover", () => {
    expect(stateFor({ scene: "cloudy", intensity: 1 }).intensity).toBe(0);
    const clear = stateFor({ scene: "clear", cover: 1, intensity: 1 });
    expect(clear.intensity).toBe(0);
    expect(clear.cover).toBe(0.35);
  });

  it("raises the cover rain and snow fall from, the more the harder they fall", () => {
    const light = stateFor({ scene: "rainy", cover: 0, intensity: 0 }).cover;
    const heavy = stateFor({ scene: "rainy", cover: 0, intensity: 1 }).cover;
    expect(light).toBeCloseTo(0.4, 12);
    expect(heavy).toBeCloseTo(0.85, 12);
    expect(stateFor({ scene: "snowy", cover: 0.9, intensity: 1 }).cover).toBe(0.9);
  });

  it("recomputes only when configured: each frame moves nothing but the glass", () => {
    const model = new SceneModel();
    model.configure(resolveParams({ scene: "rainy", hour: 14 }), 1.5);
    const first = structuredClone(model.target(at(1)));
    const later = model.target(at(4));
    expect(later).toEqual({ ...first, glassRain: later.glassRain });
    expect(later.glassRain).toBeGreaterThan(first.glassRain);
    model.configure(resolveParams({ scene: "rainy", hour: 2 }), 1.5);
    expect(model.target(at(4.1)).night).toBe(1);
  });

  it("builds the glass up over its seconds from a scene's first frame, again after a change of scene only", () => {
    const model = new SceneModel();
    const rainy = resolveParams({ scene: "rainy", intensity: 1 });
    model.configure(rainy, 1.5);
    expect(model.target(at(10)).glassRain).toBe(0);
    expect(model.target(at(10 + RAIN_BUILD_UP_S / 2)).glassRain).toBeCloseTo(0.5, 12);
    expect(model.target(at(10 + RAIN_BUILD_UP_S)).glassRain).toBe(1);
    model.configure({ ...rainy, hour: 9 }, 2);
    expect(model.target(at(30)).glassRain).toBe(1);
    model.configure(resolveParams({ scene: "snowy", intensity: 1 }), 2);
    expect(model.target(at(31)).glassFrost).toBe(0);
    expect(model.target(at(31 + FROST_BUILD_UP_S)).glassFrost).toBe(0.75);
  });

  it("shows the glass built up in a static frame, and in the animation after it", () => {
    const model = new SceneModel();
    model.configure(resolveParams({ scene: "rainy", intensity: 1 }), 1.5);
    expect(model.target(at(STATIC_TIME_S, true)).glassRain).toBe(1);
    expect(model.target(at(0)).glassRain).toBe(1);
  });

  it("puts nothing on the glass without it", () => {
    const s = stateFor({ scene: "sleet", glass: false, intensity: 1 }, 100);
    expect([s.glassRain, s.glassFrost, s.glassMist, s.flare]).toEqual([0, 0, 0, 0]);
  });

  it("lights the clouds with the sun by day and the full moon at night", () => {
    const day = stateFor({ scene: "clear", hour: 12.7, moonPhase: 0.5 });
    expect(day.night).toBe(0);
    expect(day.light.position).toEqual(day.sun.position);
    const night = stateFor({ scene: "clear", hour: 0.7, moonPhase: 0.5 });
    expect(night.night).toBe(1);
    expect(night.sun.visibility).toBe(0);
    expect(night.moon.visibility).toBe(1);
    expect(night.light.position).toEqual(night.moon.position);
    // A new moon rises and sets with the sun, so it is down at night.
    expect(stateFor({ scene: "clear", hour: 0.7, moonPhase: 0 }).moon.visibility).toBe(0);
  });

  it("puts the sun at the centre of the frame at solar noon, and higher in summer", () => {
    const summer = stateFor({ scene: "clear", hour: 12.7, solarNoon: 12.7, dayOfYear: 172 });
    const winter = stateFor({ scene: "clear", hour: 12.7, solarNoon: 12.7, dayOfYear: 355 });
    expect(summer.sun.position[0]).toBeCloseTo(0, 12);
    expect(summer.sun.position[1]).toBeGreaterThan(winter.sun.position[1]);
  });

  it("shows stars only at night, and never through overcast or fog", () => {
    expect(stateFor({ scene: "clear", hour: 12.7 }).stars).toBe(0);
    expect(stateFor({ scene: "clear", hour: 0.7, cover: 0 }).stars).toBe(1);
    expect(stateFor({ scene: "cloudy", hour: 0.7, cover: 1 }).stars).toBe(0);
    expect(stateFor({ scene: "fog", hour: 0.7 }).stars).toBe(0);
  });

  it("brings rainbows only with light rain and a low sun, never in a storm", () => {
    const light = { scene: "rainy", hour: 17.5, cover: 0, intensity: 0 } as const;
    expect(stateFor(light).rainbow).toBeGreaterThan(0);
    expect(stateFor({ ...light, intensity: 1 }).rainbow).toBe(0);
    expect(stateFor({ ...light, hour: 12.7 }).rainbow).toBe(0);
    expect(stateFor({ ...light, scene: "storm" }).rainbow).toBe(0);
  });

  it("darkens every sky under heavy weather and raises the exposure at night", () => {
    for (const scene of SCENE_NAMES) {
      const day = stateFor({ scene, hour: 12.7, cover: 0, intensity: 1 });
      const night = stateFor({ scene, hour: 0.7, cover: 0, intensity: 1 });
      expect(night.sceneExposure, scene).toBeGreaterThan(day.sceneExposure);
      expect(
        day.zenith.every((c) => c > 0 && c < 1),
        scene,
      ).toBe(true);
    }
    const clear = stateFor({ scene: "clear", hour: 12.7 });
    const storm = stateFor({ scene: "storm", hour: 12.7 });
    expect(storm.horizon[1]).toBeLessThan(clear.horizon[1]);
    expect(storm.sunHidden).toBeGreaterThan(0.9);
  });
});
