import { describe, expect, it } from "vitest";
import { clamp, luminance, mix, mixVec3, smoothstep, type Vec3 } from "./math.ts";

describe("math", () => {
  it("clamps to the range", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
  });

  it("smoothsteps between edges", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(-0.2, 0.2, 0)).toBeCloseTo(0.5, 12);
  });

  it("mixes linearly", () => {
    expect(mix(2, 4, 0.5)).toBe(3);
  });

  it("mixes vectors into the output in place", () => {
    const out: Vec3 = [0, 0, 0];
    const result = mixVec3(out, [0, 1, 2], [2, 3, 4], 0.5);
    expect(result).toBe(out);
    expect(out).toEqual([1, 2, 3]);
  });

  it("weights luminance with Rec. 709 coefficients", () => {
    expect(luminance([1, 1, 1])).toBeCloseTo(1, 12);
    expect(luminance([1, 0, 0])).toBeCloseTo(0.2126, 12);
  });
});
