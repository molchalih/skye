/** Gaussian blur parameters for the 13-tap bilinear blur shader. */
export interface BlurKernel {
  /** The sigma, in blur-buffer px, the rest is fitted to by `fitBlurKernel`. */
  sigma: number;
  /** Passes to run; variances add, so each pass uses sigma / sqrt(iterations). */
  iterations: number;
  /** Centre weight, then the three paired-tap weights, normalised. */
  weights: [number, number, number, number];
  /** Offsets, in texels, of the three paired taps. */
  offsets: [number, number, number];
}

/** The largest sigma, in px, that one pass of the 13 taps blurs faithfully; a larger one takes more passes. */
const SIGMA_PER_PASS = 2.4;
/** The smallest sigma a pass is given, where the kernel is already all but the identity. */
const MIN_PASS_SIGMA = 0.2;

// Module-level rather than a closure over sigma, so a blurred frame allocates nothing.
function gauss(i: number, sg: number): number {
  return Math.exp((-i * i) / (2 * sg * sg));
}

export function createBlurKernel(): BlurKernel {
  return { sigma: Number.NaN, iterations: 1, weights: [0, 0, 0, 0], offsets: [0, 0, 0] };
}

/**
 * Fits the kernel to its `sigma`, in place. Each pair of taps is one
 * bilinear sample placed between two texels so it weighs both, which is how
 * 13 taps cover 6 texels either side.
 */
export function fitBlurKernel(kernel: BlurKernel): BlurKernel {
  const sigma = kernel.sigma;
  const iterations = Math.max(1, Math.ceil(Math.pow(sigma / SIGMA_PER_PASS, 2)));
  const sg = Math.max(MIN_PASS_SIGMA, sigma / Math.sqrt(iterations));
  const w0 = gauss(0, sg);
  const w1 = gauss(1, sg);
  const w2 = gauss(2, sg);
  const w3 = gauss(3, sg);
  const w4 = gauss(4, sg);
  const w5 = gauss(5, sg);
  const w6 = gauss(6, sg);
  const norm = w0 + 2 * w1 + 2 * w2 + 2 * w3 + 2 * w4 + 2 * w5 + 2 * w6;
  const p1 = w1 + w2;
  const p2 = w3 + w4;
  const p3 = w5 + w6;
  kernel.iterations = iterations;
  kernel.weights[0] = w0 / norm;
  kernel.weights[1] = p1 / norm;
  kernel.weights[2] = p2 / norm;
  kernel.weights[3] = p3 / norm;
  kernel.offsets[0] = (w1 + 2 * w2) / Math.max(p1, 1e-9);
  kernel.offsets[1] = (3 * w3 + 4 * w4) / Math.max(p2, 1e-9);
  kernel.offsets[2] = (5 * w5 + 6 * w6) / Math.max(p3, 1e-9);
  return kernel;
}
