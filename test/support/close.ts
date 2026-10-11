import { expect } from "vitest";

/**
 * How far apart two numbers may be, relative to the larger (absolute below 1),
 * and still count as one value: 4 float32 ulps (4 × 2^-24). Every value reaches
 * the GPU as a float32, so values this close draw the same image up to rounding,
 * and a rewrite may reorder or restate the arithmetic within it. Whatever moves
 * a value further is left to the look gate, which judges the image.
 */
export const TOLERANCE: number = 4 * 2 ** -24;

/** Whether `a` and `b` are one value up to `TOLERANCE`; 0 and -0 are alike. */
export function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Fails unless `actual` is `expected` up to `TOLERANCE`, element by element for arrays. */
export function expectClose(
  actual: number | readonly number[],
  expected: number | readonly number[],
  label: string,
): void {
  const a = typeof actual === "number" ? [actual] : actual;
  const b = typeof expected === "number" ? [expected] : expected;
  const same = a.length === b.length && a.every((v, i) => close(v, b[i] ?? Number.NaN));
  expect(same, `${label}: ${String(actual)}, expected ${String(expected)}`).toBe(true);
}
