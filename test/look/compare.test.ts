import { describe, expect, it } from "vitest";
import {
  APPROVED_LIMITS,
  BASELINE_LIMITS,
  compareToApproved,
  compareToBaseline,
  describeVerdict,
  type Limits,
  type Verdict,
} from "./compare.ts";

const WIDTH = 64;
const HEIGHT = 32;

/** An RGBA8 frame, bottom row first, of a vertical grey gradient from `bottom` to `top`, plus `texture(x, y)`. */
function frame(bottom: number, top: number, texture = (_x: number, _y: number): number => 0) {
  const out = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const v = Math.round(bottom + ((top - bottom) * y) / (HEIGHT - 1) + texture(x, y));
      out.set([v, v, v, 255], (y * WIDTH + x) * 4);
    }
  return out;
}

// A fixed pattern of ±3 levels, like cloud detail: an integer hash of the pixel.
const grain = (x: number, y: number): number => (((x * 73 + y * 151) ^ (x * y)) % 7) - 3;

function value(v: Verdict, name: keyof Limits): number {
  return v.measures.find((m) => m.key === name)?.value ?? Number.NaN;
}

describe("compareToApproved", () => {
  it("passes identical frames with every measure at 0", () => {
    const v = compareToApproved(frame(40, 200, grain), frame(40, 200, grain), WIDTH, HEIGHT);
    expect(v.pass).toBe(true);
    expect(v.measures.map((m) => m.value)).toEqual([0, 0, 0, 0]);
    expect(v.measures.map((m) => m.limit)).toEqual([
      APPROVED_LIMITS.frame,
      APPROVED_LIMITS.region,
      APPROVED_LIMITS.block,
      APPROVED_LIMITS.detail,
    ]);
  });

  it("passes a rounding step in a few scattered pixels", () => {
    const skye = frame(40, 200, grain);
    for (let i = 0; i < 16; i++) {
      const at = (i * 131 * 4) % skye.length;
      skye[at] = (skye[at] ?? 0) + 1;
    }
    expect(compareToApproved(frame(40, 200, grain), skye, WIDTH, HEIGHT).pass).toBe(true);
  });

  it("fails a uniform shift of one 8-bit step, on the frame's mean colour", () => {
    const v = compareToApproved(frame(40, 200), frame(41, 201), WIDTH, HEIGHT);
    expect(v.pass).toBe(false);
    expect(value(v, "frame")).toBeGreaterThan(APPROVED_LIMITS.frame);
    expect(describeVerdict(v)).toMatch(/^frame colour 0\.\d\d > 0\.05 FAILS \(L \+0\.\d\d, a/);
  });

  it("fails a change in one region, and says where it is from the top left", () => {
    const skye = frame(40, 200);
    // Rows are bottom first: the frame's top-left 4 × 2 pixels, a region of the 16 × 16 grid.
    for (let y = HEIGHT - 2; y < HEIGHT; y++)
      for (let x = 0; x < 4; x++) skye.set([255, 0, 0, 255], (y * WIDTH + x) * 4);
    const v = compareToApproved(frame(40, 200), skye, WIDTH, HEIGHT);
    expect(v.pass).toBe(false);
    const region = v.measures.find((m) => m.key === "region");
    expect(region?.value).toBeGreaterThan(APPROVED_LIMITS.region);
    expect(region?.at).toBe("x 0–3, y 0–1");
  });

  it("fails lost detail that keeps every mean colour, on the detail alone", () => {
    // Each 2 × 2 block of the textured frame replaced by its mean: the means a colour measure reads stay as they are.
    const approved = frame(40, 200, grain);
    const skye = approved.slice();
    for (let y = 0; y < HEIGHT; y += 2)
      for (let x = 0; x < WIDTH; x += 2) {
        const at = [0, 1, WIDTH, WIDTH + 1].map((d) => (y * WIDTH + x + d) * 4);
        const mean = Math.round(at.reduce((s, i) => s + (approved[i] ?? 0), 0) / 4);
        for (const i of at) skye.set([mean, mean, mean], i);
      }
    const v = compareToApproved(approved, skye, WIDTH, HEIGHT);
    expect(v.measures.filter((m) => m.value > m.limit).map((m) => m.key)).toEqual(["detail"]);
  });

  it("refuses frames that are not the size given", () => {
    expect(() => compareToApproved(frame(0, 0), new Uint8Array(4), WIDTH, HEIGHT)).toThrow(
      /not a 64x32 RGBA image/,
    );
  });
});

describe("compareToBaseline", () => {
  it("allows more drift than the approved build, and still fails a few steps of brightness", () => {
    const small = frame(40.4, 200.4);
    expect(compareToApproved(frame(40, 200), frame(41, 201), WIDTH, HEIGHT).pass).toBe(false);
    expect(BASELINE_LIMITS.frame).toBeGreaterThan(APPROVED_LIMITS.frame);
    expect(compareToBaseline(frame(40, 200), small, WIDTH, HEIGHT).pass).toBe(true);
    expect(compareToBaseline(frame(40, 200), frame(43, 203), WIDTH, HEIGHT).pass).toBe(false);
  });
});
