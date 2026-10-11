import { describe, expect, it } from "vitest";
import { createBlurKernel, fitBlurKernel, type BlurKernel } from "./blur-kernel.ts";

function blurKernel(sigma: number): BlurKernel {
  return fitBlurKernel({ ...createBlurKernel(), sigma });
}

describe("blurKernel", () => {
  it("uses one pass up to sigma 2.4 and iterates beyond it", () => {
    expect(blurKernel(2.4).iterations).toBe(1);
    expect(blurKernel(2.41).iterations).toBe(2);
    expect(blurKernel(0.2).iterations).toBe(1);
    expect(blurKernel(4.8).iterations).toBe(4);
    expect(blurKernel(30).iterations).toBe(157);
  });

  it("matches hand-derived values for sigma 1", () => {
    const k = blurKernel(1);
    const e = (i: number): number => Math.exp(-(i * i) / 2);
    const norm = 1 + 2 * (e(1) + e(2) + e(3) + e(4) + e(5) + e(6));
    expect(k.weights[0]).toBeCloseTo(1 / norm, 12);
    expect(k.weights[1]).toBeCloseTo((e(1) + e(2)) / norm, 12);
    expect(k.offsets[0]).toBeCloseTo((e(1) + 2 * e(2)) / (e(1) + e(2)), 12);
    expect(k.weights[0]).toBeCloseTo(0.3989, 3);
    expect(k.offsets[0]).toBeCloseTo(1.2, 1);
  });

  it("floors the per-pass sigma at 0.2, collapsing to a near identity kernel", () => {
    const k = blurKernel(0.01);
    expect(k.iterations).toBe(1);
    expect(k.weights[0]).toBeCloseTo(1, 4);
    expect(Number.isFinite(k.offsets[2])).toBe(true);
  });

  it("normalises: centre plus twice the paired weights is 1", () => {
    for (const s of [0.2, 1, 2.4, 7, 30]) {
      const w = blurKernel(s).weights;
      expect(w[0] + 2 * (w[1] + w[2] + w[3])).toBeCloseTo(1, 12);
    }
  });

  it("fits the given kernel in place and returns it", () => {
    const kernel = createBlurKernel();
    kernel.sigma = 3;
    expect(fitBlurKernel(kernel)).toBe(kernel);
    expect(kernel.iterations).toBe(2);
  });
});

// v6's renderFrame computed the kernel inline with this loop; the kernel reproduces it bit for bit.
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

describe("fitBlurKernel against v6's inline loop", () => {
  it("is bit-identical across the sigma range", () => {
    const out = createBlurKernel();
    for (const sigma of [0, 0.01, 0.2, 0.7, 1, 1.6, 2.4, 2.41, 3.3, 7, 19.2, 30, 76.8]) {
      const v6 = v6Kernel(sigma);
      out.sigma = sigma;
      fitBlurKernel(out);
      expect(out.iterations, `sigma ${sigma}`).toBe(v6.iters);
      expect(out.weights, `sigma ${sigma}`).toStrictEqual(v6.uW);
      expect(out.offsets, `sigma ${sigma}`).toStrictEqual(v6.uO);
    }
  });
});
