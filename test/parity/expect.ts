import { expect } from "vitest";
import { compare, describeComparison } from "./compare.ts";
import type { FramePair } from "./harness.ts";

/** Fails the test, naming the frame and the worst pixel, unless the two images pass the gate. */
export function expectParity(f: FramePair, label: string): void {
  const result = compare(f.v6, f.skye, f.width, f.height);
  expect(result.pass, `${label}: ${describeComparison(result)}`).toBe(true);
}

/** Animation times `count` frames apart by `step` seconds, starting at `start`. */
export function frameTimes(start: number, count: number, step: number = 1 / 60): number[] {
  return Array.from({ length: count }, (_, i) => start + i * step);
}
