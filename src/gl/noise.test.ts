import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { referenceLattice } from "../../test/parity/lattice.ts";
import { noiseLattice } from "./noise.ts";

function decodeHalf(h: number): number {
  const exponent = h >> 10;
  return exponent === 0 ? (h & 1023) * 2 ** -24 : 2 ** (exponent - 15) * (1 + (h & 1023) / 1024);
}

describe("noiseLattice", () => {
  const lattice = noiseLattice();

  it("holds hash12 at each lattice point, row by row, to the nearest 1/2048", () => {
    const reference = referenceLattice();
    expect(lattice).toHaveLength(reference.length);
    reference.forEach((value, i) => {
      expect(decodeHalf(lattice[i] ?? -1), `(${i % 256}, ${i >> 8})`).toBe(value);
    });
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
    expect(max).toBeLessThanOrEqual(1);
    expect(sum / lattice.length).toBeCloseTo(0.5, 2);
  });

  // The image the parity gate holds skye to depends on these bytes; a change to them changes the clouds and the frost.
  it("is the lattice the clouds were approved with, byte for byte", () => {
    const bytes = new Uint8Array(lattice.buffer);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "8f329a12bc0a8b9a2cac9a32962b4eab3ea8c59e57d65e870a1f3681393668a4",
    );
  });
});
