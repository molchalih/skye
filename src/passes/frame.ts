import type { FrameState, FrameTime } from "../core/frame-state.ts";
import type { Layout } from "../core/layout.ts";
import type { Vec2 } from "../core/math.ts";
import type { TierDef } from "../core/tiers.ts";

/** Lightning as the passes read it (a `Lightning` satisfies it). */
export interface LightningState {
  /** Sky flash brightness. */
  readonly flash: number;
  /** Bolt brightness; 0 when none shows. */
  readonly bolt: number;
  readonly seed: number;
  readonly position: Readonly<Vec2>;
}

/** The wind as the passes read it (a `Wind` satisfies it). */
export interface WindState {
  readonly speed: number;
  readonly offset: number;
}

/**
 * Everything one frame's passes read, plus the cost counters they add to.
 * One object, reused every frame.
 */
export interface PassFrame extends FrameTime {
  /** The eased frame state. */
  state: Readonly<FrameState>;
  /** The sun in texture coordinates, 0 to 1 across the frame: where rays converge and the flare sits. */
  readonly sunUV: Vec2;
  /** The antisolar point, the sun mirrored through the horizon: the centre of the rainbow's arc. */
  readonly antiSun: Vec2;
  wind: WindState;
  lightning: LightningState;
  /** HDR encoding factor of the render targets (`hdrEncoding`). */
  encoding: number;
  layout: Readonly<Layout>;
  tier: Readonly<TierDef>;
  /** Shaded pixels so far this frame. */
  pixels: number;
  /** Draw passes so far this frame. */
  passes: number;
}
