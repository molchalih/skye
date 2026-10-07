import { describe, expect, it } from "vitest";
import { createRandom } from "./random.ts";

describe("createRandom", () => {
  it("is deterministic per seed", () => {
    const a = createRandom(7);
    const b = createRandom(7);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("differs between seeds, including fractional ones", () => {
    expect(createRandom(1)()).not.toBe(createRandom(2)());
    expect(createRandom(1)()).not.toBe(createRandom(1.5)());
  });

  it("stays in [0, 1) and is roughly uniform", () => {
    const r = createRandom(0);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 10000).toBeGreaterThan(0.48);
    expect(sum / 10000).toBeLessThan(0.52);
  });
});
