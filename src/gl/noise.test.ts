import { describe, expect, it } from "vitest";
import { noiseLattice } from "./noise.ts";

function decodeHalf(h: number): number {
  const exponent = h >> 10;
  return exponent === 0 ? (h & 1023) * 2 ** -24 : 2 ** (exponent - 15) * (1 + (h & 1023) / 1024);
}

describe("noiseLattice", () => {
  const lattice = noiseLattice();

  it("holds one half float per point of the 256 x 256 tile, each a multiple of 1/2048 in [0, 1]", () => {
    expect(lattice).toHaveLength(256 * 256);
    for (const [i, h] of lattice.entries()) {
      const v = decodeHalf(h);
      expect(Number.isInteger(v * 2048) && v >= 0 && v <= 1, `(${i % 256}, ${i >> 8}): ${v}`).toBe(
        true,
      );
    }
  });

  it("spreads its values over [0, 1]", () => {
    let sum = 0;
    let min = 1;
    let max = 0;
    for (const h of lattice) {
      const v = decodeHalf(h);
      sum += v;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeLessThan(0.001);
    expect(max).toBeGreaterThan(0.999);
    expect(sum / lattice.length).toBeCloseTo(0.5, 2);
  });
});
