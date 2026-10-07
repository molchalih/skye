import { describe, expect, it } from "vitest";
import { Easer } from "./easing.ts";
import {
  copyFrameState,
  createFrameState,
  NUMBER_KEYS,
  SceneModel,
  VEC2_KEYS,
  VEC3_KEYS,
} from "./frame-state.ts";
import { resolveParams } from "./params.ts";
import { BLUR_DURATION_S } from "./tables.ts";

describe("frame state", () => {
  it("lists every field exactly once in the easing key tables", () => {
    const listed = [...NUMBER_KEYS, ...VEC2_KEYS, ...VEC3_KEYS, "blur"].sort();
    expect(listed).toEqual(Object.keys(createFrameState()).sort());
  });

  it("copies values without sharing vectors", () => {
    const model = new SceneModel();
    const src = model.target(resolveParams({ scene: "storm" }), 1, 1.5, false);
    const dst = createFrameState();
    copyFrameState(dst, src);
    expect(dst).toEqual(src);
    expect(dst.zenith).not.toBe(src.zenith);
  });

  it("keeps glass numeric and applies scene rules", () => {
    const model = new SceneModel();
    const s = model.target(resolveParams({ scene: "storm", cover: 0, intensity: 0 }), 1, 1, false);
    expect(s.glass).toBe(1);
    expect(s.cover).toBeGreaterThanOrEqual(0.7);
    expect(s.intensity).toBeGreaterThanOrEqual(0.45);
  });
});

describe("easer", () => {
  it("copies the first target, then chases it", () => {
    const model = new SceneModel();
    const easer = new Easer();
    const day = resolveParams({ hour: 12 });
    const night = resolveParams({ hour: 0 });
    const first = easer.step(model.target(day, 1, 1.5, false), 0.016, false);
    const nightStart = first.night;
    const target = model.target(night, 1.1, 1.5, false);
    easer.step(target, 0.1, false);
    expect(easer.current.night).toBeGreaterThan(nightStart);
    expect(easer.current.night).toBeLessThan(target.night);
  });

  it("lands blur exactly on the target after the fixed duration", () => {
    const model = new SceneModel();
    const easer = new Easer();
    easer.step(model.target(resolveParams({ blur: 0 }), 1, 1.5, false), 0.016, false);
    const p = resolveParams({ blur: 12 });
    let t = 1;
    easer.step(model.target(p, (t += 0.1), 1.5, false), 0.1, false);
    expect(easer.current.blur).toBeGreaterThan(0);
    expect(easer.current.blur).toBeLessThan(12);
    for (let i = 0; i < Math.ceil(BLUR_DURATION_S / 0.1); i++) {
      easer.step(model.target(p, (t += 0.1), 1.5, false), 0.1, false);
    }
    expect(easer.current.blur).toBe(12);
  });
});
