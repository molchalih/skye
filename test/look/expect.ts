import { expect } from "vitest";
import { compareToApproved, compareToBaseline, describeVerdict } from "./compare.ts";
import type { Frame, LookFrame } from "./harness.ts";

const HOW_TO =
  "a change meant to alter the look needs the owner's approval, then `bun run look:approve` (CONTRIBUTING.md)";

/** Fails the test, naming the frame and every measure, unless skye keeps the approved look. */
export function expectApprovedLook(skye: Frame, approved: Frame, label: string): void {
  expect([skye.width, skye.height], `${label}: canvas size`).toEqual([
    approved.width,
    approved.height,
  ]);
  const verdict = compareToApproved(approved.pixels, skye.pixels, skye.width, skye.height);
  expect(
    verdict.pass,
    `${label}, against the approved build: ${describeVerdict(verdict)}; ${HOW_TO}`,
  ).toBe(true);
}

/** `expectApprovedLook` for a pair's frame, and, when the pair draws the frozen baseline, the drift check. */
export function expectLook(f: LookFrame, label: string): void {
  const { width, height } = f;
  expectApprovedLook(
    { width, height, pixels: f.skye },
    { width, height, pixels: f.approved },
    label,
  );
  if (f.baseline === undefined) return;
  const verdict = compareToBaseline(f.baseline, f.skye, width, height);
  expect(
    verdict.pass,
    `${label}, against the 2026-10 baseline: ${describeVerdict(verdict)}; the look has drifted too far ` +
      "from it for an approval alone; the owner decides whether to freeze a new baseline (CONTRIBUTING.md)",
  ).toBe(true);
}

/** Animation times `count` frames apart by `step` seconds, starting at `start`. */
export function frameTimes(start: number, count: number, step: number = 1 / 60): number[] {
  return Array.from({ length: count }, (_, i) => start + i * step);
}
