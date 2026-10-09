import { describe, expect, it } from "vitest";
import { Easer } from "./easing.ts";
import { createFrameState, SceneModel, type FrameState } from "./frame-state.ts";
import { resolveParams } from "./params.ts";
import { BLUR_DURATION_S } from "./tables.ts";

// A state whose every number, vector components included, differs from every other, counting up from `first`.
function distinctState(first: number): FrameState {
  const s = createFrameState();
  let n = first;
  for (const [key, value] of Object.entries(s)) {
    if (Array.isArray(value)) value.forEach((_, i) => (value[i] = n++));
    else Reflect.set(s, key, n++);
  }
  return s;
}

// Every number of a state, vector components included, under a path such as "sunPos.1".
function flatten(s: FrameState): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, value] of Object.entries(s)) {
    if (Array.isArray(value)) value.forEach((x: number, i) => out.set(`${key}.${i}`, x));
    else if (typeof value === "number") out.set(key, value);
  }
  return out;
}

describe("frame state", () => {
  it("keeps glass numeric and applies scene rules", () => {
    const model = new SceneModel();
    const s = model.target(resolveParams({ scene: "storm", cover: 0, intensity: 0 }), 1, 1, false);
    expect(s.glass).toBe(1);
    expect(s.cover).toBeGreaterThanOrEqual(0.7);
    expect(s.intensity).toBeGreaterThanOrEqual(0.45);
  });
});

describe("easer", () => {
  it("copies every field on the first step, and on every static one", () => {
    const easer = new Easer();
    expect(easer.step(distinctState(1), 0.016, false)).toEqual(distinctState(1));
    expect(easer.step(distinctState(1001), 0.016, true)).toEqual(distinctState(1001));
  });

  it("copies values without sharing vectors", () => {
    const model = new SceneModel();
    const target = model.target(resolveParams({ scene: "storm" }), 1, 1.5, false);
    const state = new Easer().step(target, 0.016, false);
    expect(state).toEqual(target);
    expect(state.zenith).not.toBe(target.zenith);
  });

  it("moves every field but blur toward the target", () => {
    const easer = new Easer();
    easer.step(distinctState(1), 0.016, false);
    const start = flatten(distinctState(1));
    const target = flatten(distinctState(1001));
    const eased = flatten(easer.step(distinctState(1001), 0.1, false));
    for (const [key, x] of eased) {
      if (key === "blur") continue;
      const from = start.get(key) ?? NaN;
      const to = target.get(key) ?? NaN;
      expect(x, key).toBeGreaterThan(from);
      expect(x, key).toBeLessThan(to);
    }
  });

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
