/** Gaussian blur parameters for the 13-tap bilinear shader (v6 `renderFrame`). */
export interface BlurKernel {
  /** Passes to run; variances add, so each pass uses sigma / sqrt(iterations). */
  iterations: number;
  /** Centre weight, then the three paired-tap weights, normalised. */
  weights: [number, number, number, number];
  /** Offsets, in texels, of the three paired taps. */
  offsets: [number, number, number];
}

// Module-level rather than a closure over sigma, so a blurred frame allocates nothing.
function gauss(i: number, sg: number): number {
  return Math.exp((-i * i) / (2 * sg * sg));
}

export function createBlurKernel(): BlurKernel {
  return { iterations: 1, weights: [0, 0, 0, 0], offsets: [0, 0, 0] };
}

/**
 * Computes the kernel for a sigma in blur-buffer px. The 13-tap kernel is
 * exact up to about 2.4 px, so larger sigmas iterate. Writes into `out`.
 */
export function blurKernel(sigma: number, out: BlurKernel): BlurKernel {
  const iterations = Math.max(1, Math.ceil(Math.pow(sigma / 2.4, 2)));
  const sg = Math.max(0.2, sigma / Math.sqrt(iterations));
  const w0 = gauss(0, sg);
  const w1 = gauss(1, sg);
  const w2 = gauss(2, sg);
  const w3 = gauss(3, sg);
  const w4 = gauss(4, sg);
  const w5 = gauss(5, sg);
  const w6 = gauss(6, sg);
  // Same left-to-right accumulation order as v6's loop, so the sums match bit for bit.
  const norm = w0 + 2 * w1 + 2 * w2 + 2 * w3 + 2 * w4 + 2 * w5 + 2 * w6;
  const p1 = w1 + w2;
  const p2 = w3 + w4;
  const p3 = w5 + w6;
  out.iterations = iterations;
  out.weights[0] = w0 / norm;
  out.weights[1] = p1 / norm;
  out.weights[2] = p2 / norm;
  out.weights[3] = p3 / norm;
  out.offsets[0] = (w1 + 2 * w2) / Math.max(p1, 1e-9);
  out.offsets[1] = (3 * w3 + 4 * w4) / Math.max(p2, 1e-9);
  out.offsets[2] = (5 * w5 + 6 * w6) / Math.max(p3, 1e-9);
  return out;
}
