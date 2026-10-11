import type { TierDef } from "./tiers.ts";

/** Everything `computeLayout` reads. */
export interface LayoutInput {
  cssWidth: number;
  cssHeight: number;
  /** The display's device pixel ratio; the tier caps it. */
  devicePixelRatio: number;
  tier: TierDef;
  /** The blur radius drawn this frame, in CSS px. */
  blur: number;
  /** The blur radius the params ask for, in CSS px, which `blur` is easing toward. */
  blurTarget: number;
}

/** Buffer sizes for one frame, in device px. */
export interface Layout {
  /** The full backing-store size. */
  width: number;
  height: number;
  /** The size the canvas's backing store must have: the blur chain's once a blur has settled, else full. */
  canvasWidth: number;
  canvasHeight: number;
  /** The blur chain's buffer size. */
  blurWidth: number;
  blurHeight: number;
  skyWidth: number;
  skyHeight: number;
  sceneWidth: number;
  sceneHeight: number;
  /** The blur chain's scale relative to the full size. */
  blurScale: number;
  /** Whether the blur chain runs. */
  blurring: boolean;
  /** True once the blur has settled and the canvas is shrunk to the blur chain's size. */
  shrink: boolean;
  /** The blur's sigma in blur-chain px. */
  sigma: number;
  /** The particle count's scale. */
  particleScale: number;
  /** 0 drops the glass's fine detail, which a deep blur hides, and 1 keeps it. */
  detail: number;
  /**
   * The sky and scene buffers' scale under a deep blur, which hides their
   * detail. It carries from frame to frame: it shrinks only once the blur
   * has deepened most of the way, and grows back at once.
   */
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

/** The scales the blur chain may run at, smallest first. */
const BLUR_SCALES: readonly number[] = [0.125, 0.1875, 0.25, 0.375, 0.5, 0.75, 1];
/** A blur below this sigma, in device px, is not drawn. */
const MIN_SIGMA_PX = 0.3;
/** The smallest sigma, in blur-chain px, that the chain blurs smoothly. */
const MIN_CHAIN_SIGMA_PX = 1.6;
/** A settled blur deeper than this, in device px, hides the glass's fine detail. */
const DETAIL_HIDDEN_SIGMA_PX = 6;
/** The smallest sky and scene buffers, in px. */
const MIN_BUFFER_PX = 8;

// The smallest chain scale that still leaves the blur at least MIN_CHAIN_SIGMA_PX in chain px. An indexed loop: it
// runs every frame, and V8's mid tier keeps a for-of iterator.
function blurScaleFor(sigma: number): number {
  if (sigma <= MIN_SIGMA_PX) return 1;
  for (let i = 0; i < BLUR_SCALES.length; i++) {
    const scale = BLUR_SCALES[i] ?? 1;
    if (scale * sigma >= MIN_CHAIN_SIGMA_PX) return scale;
  }
  return 1;
}

function scaled(size: number, scale: number, min: number): number {
  return Math.max(min, Math.round(size * scale));
}

/**
 * Sizes every buffer for a frame and writes them into `out`, which carries
 * `detailScale` from the frame before (1 for a new layout). Returns `out`.
 */
export function computeLayout(input: Readonly<LayoutInput>, out: Layout): Layout {
  const tier = input.tier;
  const ratio = Math.min(input.devicePixelRatio || 1, tier.maxPixelRatio);
  const width = scaled(input.cssWidth, ratio, 1);
  const height = scaled(input.cssHeight, ratio, 1);
  const sigma = input.blur * ratio;
  const target = input.blurTarget * ratio;
  const blurScale = blurScaleFor(sigma);
  const blurring = sigma > MIN_SIGMA_PX;
  const shrink = blurring && Math.abs(sigma - target) < 1e-3;
  const blurWidth = scaled(width, blurScale, 1);
  const blurHeight = scaled(height, blurScale, 1);
  // Under a deep blur the sky and scene can render at three times the chain's scale and lose nothing it shows.
  const detailTarget = Math.min(1, blurScaleFor(target) * 3);
  if (detailTarget >= out.detailScale || sigma >= Math.min(target * 0.85, 8 * ratio))
    out.detailScale = detailTarget;
  const detailScale = out.detailScale;
  out.width = width;
  out.height = height;
  out.canvasWidth = shrink ? blurWidth : width;
  out.canvasHeight = shrink ? blurHeight : height;
  out.blurWidth = blurWidth;
  out.blurHeight = blurHeight;
  out.skyWidth = scaled(width * tier.skyScale, detailScale, MIN_BUFFER_PX);
  out.skyHeight = scaled(height * tier.skyScale, detailScale, MIN_BUFFER_PX);
  out.sceneWidth = scaled(width * tier.sceneScale, detailScale, MIN_BUFFER_PX);
  out.sceneHeight = scaled(height * tier.sceneScale, detailScale, MIN_BUFFER_PX);
  out.blurScale = blurScale;
  out.blurring = blurring;
  out.shrink = shrink;
  out.sigma = sigma * blurScale;
  out.particleScale = Math.min(1, (detailScale * 4) / 3);
  out.detail = shrink && sigma > DETAIL_HIDDEN_SIGMA_PX ? 0 : 1;
  return out;
}

/** The frame-rate cap: the tier's, or at most 30 fps while a settled blur is shown. */
export function fpsCap(tier: Readonly<TierDef>, layout: Readonly<Layout>): number {
  return layout.shrink ? Math.min(tier.maxFps, 30) : tier.maxFps;
}
