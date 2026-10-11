import { describe, expect, it } from "vitest";
import { computeLayout, createLayout, fpsCap, type LayoutInput } from "./layout.ts";
import { TIERS } from "./tiers.ts";

const base = (over: Partial<LayoutInput> = {}): LayoutInput => ({
  cssWidth: 800,
  cssHeight: 400,
  devicePixelRatio: 1,
  tier: TIERS[1],
  blur: 0,
  blurTarget: 0,
  ...over,
});

describe("computeLayout", () => {
  it("sizes buffers from the tier scales without blur", () => {
    const l = computeLayout(base(), createLayout());
    expect([l.width, l.height]).toEqual([800, 400]);
    expect([l.canvasWidth, l.canvasHeight]).toEqual([800, 400]);
    expect([l.skyWidth, l.skyHeight]).toEqual([360, 180]);
    expect([l.sceneWidth, l.sceneHeight]).toEqual([600, 300]);
    expect(l.blurring).toBe(false);
    expect(l.shrink).toBe(false);
  });

  it("caps the device pixel ratio at the tier's cap", () => {
    expect(computeLayout(base({ devicePixelRatio: 3 }), createLayout()).width).toBe(800);
    expect(computeLayout(base({ devicePixelRatio: 3, tier: TIERS[2] }), createLayout()).width).toBe(
      1200,
    );
  });

  it("shrinks the canvas only once the blur has settled", () => {
    const fading = computeLayout(base({ blur: 10, blurTarget: 20 }), createLayout());
    expect(fading.shrink).toBe(false);
    expect(fading.canvasWidth).toBe(800);
    const settled = computeLayout(base({ blur: 20, blurTarget: 20 }), createLayout());
    expect(settled.shrink).toBe(true);
    expect(settled.canvasWidth).toBe(settled.blurWidth);
    expect(settled.canvasWidth).toBeLessThan(800);
  });

  it("carries the detail scale: shrinks once deep, grows back at once", () => {
    const out = createLayout();
    computeLayout(base({ blur: 5, blurTarget: 40 }), out);
    expect(out.detailScale).toBe(1);
    computeLayout(base({ blur: 40, blurTarget: 40 }), out);
    expect(out.detailScale).toBeLessThan(1);
    computeLayout(base({ blur: 40, blurTarget: 0 }), out);
    expect(out.detailScale).toBe(1);
  });

  it("keeps the blur chain's sigma at least 1.6 px wherever it shrinks", () => {
    for (let blur = 0.5; blur <= 64; blur *= 1.5) {
      const l = computeLayout(base({ blur, blurTarget: blur }), createLayout());
      if (l.blurScale < 1) expect(l.sigma, `blur ${blur}`).toBeGreaterThanOrEqual(1.6);
    }
  });
});

describe("fpsCap", () => {
  it("limits to 30 only when the layout has shrunk", () => {
    const l = createLayout();
    expect(fpsCap(TIERS[2], l)).toBe(60);
    l.shrink = true;
    expect(fpsCap(TIERS[2], l)).toBe(30);
    expect(fpsCap(TIERS[0], l)).toBe(30);
  });
});
