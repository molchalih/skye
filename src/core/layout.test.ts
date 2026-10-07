import { describe, expect, it } from "vitest";
import { computeLayout, createLayout, fpsCap, type LayoutInput } from "./layout.ts";
import { TIERS } from "./tables.ts";

const base = (over: Partial<LayoutInput> = {}): LayoutInput => ({
  cssWidth: 800,
  cssHeight: 400,
  devicePixelRatio: 1,
  tier: TIERS[1],
  blurEased: 0,
  blurTarget: 0,
  ...over,
});

describe("computeLayout", () => {
  it("sizes buffers from the tier scales without blur", () => {
    const l = computeLayout(base(), 1, createLayout());
    expect([l.width, l.height]).toEqual([800, 400]);
    expect([l.canvasWidth, l.canvasHeight]).toEqual([800, 400]);
    expect([l.skyWidth, l.skyHeight]).toEqual([360, 180]);
    expect([l.sceneWidth, l.sceneHeight]).toEqual([600, 300]);
    expect(l.blurring).toBe(false);
    expect(l.shrink).toBe(false);
  });

  it("caps the device pixel ratio at the tier's cap", () => {
    expect(computeLayout(base({ devicePixelRatio: 3 }), 1, createLayout()).width).toBe(800);
    expect(
      computeLayout(base({ devicePixelRatio: 3, tier: TIERS[2] }), 1, createLayout()).width,
    ).toBe(1200);
  });

  it("shrinks the canvas only once the blur has settled", () => {
    const fading = computeLayout(base({ blurEased: 10, blurTarget: 20 }), 1, createLayout());
    expect(fading.shrink).toBe(false);
    expect(fading.canvasWidth).toBe(800);
    const settled = computeLayout(base({ blurEased: 20, blurTarget: 20 }), 1, createLayout());
    expect(settled.shrink).toBe(true);
    expect(settled.canvasWidth).toBe(settled.blurWidth);
    expect(settled.canvasWidth).toBeLessThan(800);
  });

  it("carries the detail scale: shrinks once deep, grows back at once", () => {
    const out = createLayout();
    computeLayout(base({ blurEased: 40, blurTarget: 40 }), 1, out);
    const shrunk = out.detailScale;
    expect(shrunk).toBeLessThan(1);
    computeLayout(base({ blurEased: 40, blurTarget: 0 }), shrunk, out);
    expect(out.detailScale).toBe(1);
  });

  it("clamps the target blur to 64", () => {
    const a = computeLayout(base({ blurEased: 64, blurTarget: 500 }), 1, createLayout());
    expect(a.shrink).toBe(true);
  });
});

describe("fpsCap", () => {
  it("limits to 30 only when the layout has shrunk", () => {
    const l = createLayout();
    expect(fpsCap(60, l)).toBe(60);
    l.shrink = true;
    expect(fpsCap(60, l)).toBe(30);
    expect(fpsCap(30, l)).toBe(30);
  });
});
