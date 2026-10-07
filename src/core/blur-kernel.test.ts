import { describe, expect, it } from "vitest";
import { blurKernel, createBlurKernel } from "./blur-kernel.ts";

describe("blurKernel", () => {
  it("uses one pass up to sigma 2.4 and iterates beyond it", () => {
    expect(blurKernel(2.4, createBlurKernel()).iterations).toBe(1);
    expect(blurKernel(2.41, createBlurKernel()).iterations).toBe(2);
    expect(blurKernel(0.2, createBlurKernel()).iterations).toBe(1);
    expect(blurKernel(4.8, createBlurKernel()).iterations).toBe(4);
    expect(blurKernel(30, createBlurKernel()).iterations).toBe(157);
  });

  it("matches hand-derived values for sigma 1", () => {
    const k = blurKernel(1, createBlurKernel());
    const e = (i: number): number => Math.exp(-(i * i) / 2);
    const norm = 1 + 2 * (e(1) + e(2) + e(3) + e(4) + e(5) + e(6));
    expect(k.weights[0]).toBeCloseTo(1 / norm, 12);
    expect(k.weights[1]).toBeCloseTo((e(1) + e(2)) / norm, 12);
    expect(k.offsets[0]).toBeCloseTo((e(1) + 2 * e(2)) / (e(1) + e(2)), 12);
    expect(k.weights[0]).toBeCloseTo(0.3989, 3);
    expect(k.offsets[0]).toBeCloseTo(1.2, 1);
  });

  it("floors the per-pass sigma at 0.2, collapsing to a near identity kernel", () => {
    const k = blurKernel(0.01, createBlurKernel());
    expect(k.iterations).toBe(1);
    expect(k.weights[0]).toBeCloseTo(1, 4);
    expect(Number.isFinite(k.offsets[2])).toBe(true);
  });

  it("normalises: centre plus twice the paired weights is 1", () => {
    for (const s of [0.2, 1, 2.4, 7, 30]) {
      const w = blurKernel(s, createBlurKernel()).weights;
      expect(w[0] + 2 * (w[1] + w[2] + w[3])).toBeCloseTo(1, 12);
    }
  });

  it("writes into and returns the given object", () => {
    const out = createBlurKernel();
    expect(blurKernel(3, out)).toBe(out);
  });
});

// v6's renderFrame computes the kernel inline with this loop; the port must reproduce it bit for bit.
function v6Kernel(sigma: number): { iters: number; uW: number[]; uO: number[] } {
  const iters = Math.max(1, Math.ceil(Math.pow(sigma / 2.4, 2)));
  const sg = Math.max(0.2, sigma / Math.sqrt(iters));
  const w: number[] = [];
  let norm = 0;
  for (let i = 0; i <= 6; i++) {
    const wi = Math.exp((-i * i) / (2 * sg * sg));
    w[i] = wi;
    norm += i ? 2 * wi : wi;
  }
  const at = (i: number): number => w[i] ?? Number.NaN;
  const W1 = at(1) + at(2);
  const W2 = at(3) + at(4);
  const W3 = at(5) + at(6);
  return {
    iters,
    uW: [at(0) / norm, W1 / norm, W2 / norm, W3 / norm],
    uO: [
      (at(1) + 2 * at(2)) / Math.max(W1, 1e-9),
      (3 * at(3) + 4 * at(4)) / Math.max(W2, 1e-9),
      (5 * at(5) + 6 * at(6)) / Math.max(W3, 1e-9),
    ],
  };
}

describe("blurKernel against v6's inline loop", () => {
  it("is bit-identical across the sigma range", () => {
    const out = createBlurKernel();
    for (const sigma of [0, 0.01, 0.2, 0.7, 1, 1.6, 2.4, 2.41, 3.3, 7, 19.2, 30, 76.8]) {
      const v6 = v6Kernel(sigma);
      blurKernel(sigma, out);
      expect(out.iterations, `sigma ${sigma}`).toBe(v6.iters);
      expect(out.weights, `sigma ${sigma}`).toStrictEqual(v6.uW);
      expect(out.offsets, `sigma ${sigma}`).toStrictEqual(v6.uO);
    }
  });
});
