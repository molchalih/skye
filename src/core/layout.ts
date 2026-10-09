import { clamp } from "./math.ts";
import { BQ_STEPS, type TierDef } from "./tables.ts";

/** Everything `computeLayout` reads. */
export interface LayoutInput {
  cssWidth: number;
  cssHeight: number;
  /** Raw device pixel ratio; the tier's cap is applied here. */
  devicePixelRatio: number;
  tier: TierDef;
  /** Eased blur radius in CSS px (FrameState.blur). */
  blurEased: number;
  /** Target blur from the params, CSS px; clamped to 0-64 here. */
  blurTarget: number;
}

/** Buffer sizes for one frame (v6 `_sizes` plus the next detail scale). */
export interface Layout {
  /** Full backing-store size in device px. */
  width: number;
  height: number;
  /** Size the canvas backing store must have; smaller than full once the blur settles. */
  canvasWidth: number;
  canvasHeight: number;
  /** Blur-chain buffer size. */
  blurWidth: number;
  blurHeight: number;
  skyWidth: number;
  skyHeight: number;
  sceneWidth: number;
  sceneHeight: number;
  /** Blur chain scale relative to the full size. */
  blurScale: number;
  blurring: boolean;
  /** True once the fade settled and the canvas is shrunk to the blur size. */
  shrink: boolean;
  /** Blur sigma in blur-buffer px. */
  sigma: number;
  /** Particle buffer scale. */
  particleScale: number;
  /** 0 drops fine detail (deep blur), 1 keeps it. */
  detail: number;
  /** Sky/scene detail scale to pass back as `previousDetailScale` next frame. */
  detailScale: number;
}

export function createLayout(): Layout {
  return {
    width: 1,
    height: 1,
    canvasWidth: 1,
    canvasHeight: 1,
    blurWidth: 1,
    blurHeight: 1,
    skyWidth: 8,
    skyHeight: 8,
    sceneWidth: 8,
    sceneHeight: 8,
    blurScale: 1,
    blurring: false,
    shrink: false,
    sigma: 0,
    particleScale: 1,
    detail: 1,
    detailScale: 1,
  };
}

// Smallest chain scale that still leaves sigma >= 1.6 buffer px, else full resolution. An indexed loop, since this
// runs every frame and V8's mid tier keeps a for-of iterator.
function stepFor(s: number): number {
  if (s > 0.3) {
    for (let i = 0; i < BQ_STEPS.length; i++) {
      const x = BQ_STEPS[i];
      if (x !== undefined && x * s >= 1.6) return x;
    }
  }
  return 1;
}

/**
 * v6 `_layout` without GL or DOM. Writes into `out` (which may be reused every
 * frame) and returns it. `previousDetailScale` is `out.detailScale` from the
 * last call, or 1 on the first.
 */
export function computeLayout(
  input: LayoutInput,
  previousDetailScale: number,
  out: Layout,
): Layout {
  const q = input.tier;
  const dpr = Math.min(input.devicePixelRatio || 1, q.dpr);
  const W = Math.max(1, Math.round(input.cssWidth * dpr));
  const H = Math.max(1, Math.round(input.cssHeight * dpr));
  const sigma = input.blurEased * dpr;
  const target = clamp(input.blurTarget, 0, 64) * dpr;
  const settled = Math.abs(sigma - target) < 1e-3;
  const bq = stepFor(sigma);
  const blurring = sigma > 0.3;
  const bw = Math.max(1, Math.round(W * bq));
  const bh = Math.max(1, Math.round(H * bq));
  const shrink = blurring && settled;
  const dscTarget = Math.min(1, stepFor(target) * 3);
  let dsc = previousDetailScale;
  if (dscTarget >= dsc || sigma >= Math.min(target * 0.85, 8 * dpr)) dsc = dscTarget;
  out.width = W;
  out.height = H;
  out.canvasWidth = shrink ? bw : W;
  out.canvasHeight = shrink ? bh : H;
  out.blurWidth = bw;
  out.blurHeight = bh;
  out.skyWidth = Math.max(8, Math.round(W * q.sky * dsc));
  out.skyHeight = Math.max(8, Math.round(H * q.sky * dsc));
  out.sceneWidth = Math.max(8, Math.round(W * q.scene * dsc));
  out.sceneHeight = Math.max(8, Math.round(H * q.scene * dsc));
  out.blurScale = bq;
  out.blurring = blurring;
  out.shrink = shrink;
  out.sigma = sigma * bq;
  out.particleScale = Math.min(1, (dsc * 4) / 3);
  out.detail = shrink && sigma > 6 ? 0 : 1;
  out.detailScale = dsc;
  return out;
}

/** Frame-rate cap: 30 fps only once the blur has settled and the canvas shrunk (v6 `_fpsCap`). */
export function fpsCap(tierFps: number, layout: Readonly<Layout>): number {
  return layout.shrink ? Math.min(tierFps, 30) : tierFps;
}
