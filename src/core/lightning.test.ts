import { describe, expect, it } from "vitest";
import { createFrameState } from "./frame-state.ts";
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

describe("Lightning", () => {
  it("is silent and draws nothing without storm or rain", () => {
    const l = new Lightning();
    let draws = 0;
    const flash = l.step(5, createFrameState(), () => (draws++, 0.5));
    expect(flash).toBe(0);
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
    l.step(0, s, random);
    expect(seen).toHaveLength(1);
    l.step(100, s, random);
    expect(seen).toHaveLength(7);
    expect(l.position[0]).toBeCloseTo((0.9 - 0.5) * 2 * 0.9, 12);
    expect(l.position[1]).toBeCloseTo(0.15 + 0.2 * 0.35, 12);
    expect(l.seed).toBe(0.5);
  });

  it("flashes right after a strike and ends after 1.2 seconds", () => {
    const l = new Lightning();
    const random = createRandom(3);
    const s = storm();
    l.step(0, s, random);
    const strike = l.step(100, s, random);
    expect(strike).toBeGreaterThan(0);
    expect(l.step(101.3, s, random)).toBe(0);
    expect(l.bolt).toBe(0);
  });
});
