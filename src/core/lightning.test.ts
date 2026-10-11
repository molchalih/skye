import { describe, expect, it } from "vitest";
import { createFrameState, type FrameTime } from "./frame-state.ts";
import { Lightning } from "./lightning.ts";
import { createRandom } from "./random.ts";

function storm(): ReturnType<typeof createFrameState> {
  const s = createFrameState();
  s.storm = 1;
  s.intensity = 0.8;
  s.rain = 1;
  s.aspect = 2;
  return s;
}

function at(seconds: number): FrameTime {
  return { seconds, dt: 1 / 60, isStatic: false };
}

describe("Lightning", () => {
  it("is silent and draws nothing without storm or rain", () => {
    const l = new Lightning();
    let draws = 0;
    l.step(at(5), createFrameState(), () => (draws++, 0.5));
    expect(l.flash).toBe(0);
    expect(l.bolt).toBe(0);
    expect(draws).toBe(0);
  });

  it("draws one value to schedule, then six on a strike, in order", () => {
    const l = new Lightning();
    const seen: number[] = [];
    const values = [0.1, 0.9, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
    const random = (): number => {
      const v = values[seen.length] ?? 0;
      seen.push(v);
      return v;
    };
    const s = storm();
    l.step(at(0), s, random);
    expect(seen).toHaveLength(1);
    l.step(at(100), s, random);
    expect(seen).toHaveLength(7);
    expect(l.position[0]).toBeCloseTo((0.9 - 0.5) * 2 * 0.9, 12);
    expect(l.position[1]).toBeCloseTo(0.15 + 0.2 * 0.35, 12);
    expect(l.seed).toBe(0.5);
  });

  it("flashes right after a strike and ends after 1.2 seconds", () => {
    const l = new Lightning();
    const random = createRandom(3);
    const s = storm();
    l.step(at(0), s, random);
    l.step(at(100), s, random);
    expect(l.flash).toBeGreaterThan(0);
    l.step(at(101.3), s, random);
    expect(l.flash).toBe(0);
    expect(l.bolt).toBe(0);
  });

  it("spaces strikes by the delays its activity allows: 3 to 7 s in a full storm", () => {
    const l = new Lightning();
    const s = storm();
    s.intensity = 1;
    const random = createRandom(5);
    const strikes: number[] = [];
    let seed = l.seed;
    for (let f = 0; f < 60 * 600; f++) {
      l.step(at(f / 60), s, random);
      if (l.seed !== seed) strikes.push(f / 60);
      seed = l.seed;
    }
    expect(l.activity).toBe(1);
    const gaps = strikes.slice(1).map((t, i) => t - (strikes[i] ?? t));
    expect(gaps.length).toBeGreaterThan(60);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(7 + 1 / 60);
  });

  it("strikes in a storm, in heavy rain more rarely, and never in light rain", () => {
    const l = new Lightning();
    const s = createFrameState();
    const activity = (): number => (l.step(at(0), s, () => 0.5), l.activity);
    s.rain = 1;
    s.intensity = 0.5;
    expect(activity()).toBe(0);
    s.intensity = 1;
    const rain = activity();
    s.storm = 1;
    expect(rain).toBeGreaterThan(0);
    expect(activity()).toBeGreaterThan(rain);
  });
});
