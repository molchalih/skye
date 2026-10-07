import type { FrameState } from "../core/frame-state.ts";
import type { Layout } from "../core/layout.ts";
import type { TierDef } from "../core/tables.ts";

/** Lightning values the passes read (a `Lightning` instance satisfies it). */
export interface BoltState {
  readonly bolt: number;
  readonly seed: number;
  readonly position: readonly [number, number];
}

/** Everything one frame's passes read, plus the cost counters they add to. One object, reused every frame. */
export interface PassFrame {
  /** Animation time in seconds (v6 `T`). */
  time: number;
  /** Integrated wind offset (v6 `_windT`). */
  windT: number;
  /** Gusting wind of this frame (v6 `windNow`). */
  windNow: number;
  /** Lightning flash brightness. */
  flash: number;
  /** HDR encoding factor of the targets (v6 `enc`). */
  enc: number;
  state: Readonly<FrameState>;
  layout: Readonly<Layout>;
  tier: Readonly<TierDef>;
  bolt: BoltState;
  /** Shaded pixels so far this frame. */
  pixels: number;
  /** Draw passes so far this frame. */
  passes: number;
}
