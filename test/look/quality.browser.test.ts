import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SkyeParams } from "../../src/index.ts";
import { expectLook, frameTimes } from "./expect.ts";
import { LookPair } from "./harness.ts";

const WIDTH = 320;
const HEIGHT = 200;
const STATIC: SkyeParams = { motion: "static", glass: true, quality: "balanced" };
// Animated cases draw tens of particle-heavy frames per side; software GL in headless Chromium needs the headroom.
const SEQUENCES = { timeout: 60_000 };

// Rainy at noon draws rain, glass drops and crepuscular rays; haze in the morning draws dust motes.
const VIEWS: SkyeParams[] = [
  { scene: "rainy", hour: 13 },
  { scene: "haze", hour: 9 },
];

describe("static look per setting, against the approved build", () => {
  let pair: LookPair;

  beforeAll(async () => {
    pair = await LookPair.create(STATIC, WIDTH, HEIGHT);
  });

  afterAll(() => {
    pair.dispose();
  });

  const cases: { name: string; params: SkyeParams }[] = [
    ...(["eco", "low", "balanced", "high", "auto"] as const).flatMap((quality) =>
      VIEWS.map((v) => ({ name: `quality ${quality}, ${v.scene}`, params: { ...v, quality } })),
    ),
    ...(["rainy", "snowy", "fog"] as const).map((scene) => ({
      name: `glass off, ${scene}`,
      params: { scene, hour: 13, glass: false },
    })),
    // Out-of-range values, so clamping is covered.
    ...[0, 0.12, 1, 9].flatMap((focus) =>
      (["rainy", "snowy"] as const).map((scene) => ({
        name: `focus ${focus}, ${scene}`,
        params: { scene, hour: 13, focus },
      })),
    ),
    ...[0, 0.2, 1.2, 9].map((exposure) => ({
      name: `exposure ${exposure}`,
      params: { scene: "clear" as const, hour: 2, exposure },
    })),
  ];

  it.each(cases)("$name", ({ params }) => {
    pair.update({ ...STATIC, glass: true, focus: undefined, exposure: undefined, ...params });
    expectLook(pair.frame(0), "static frame");
  });
});

describe("look at device pixel ratios other than 1", () => {
  // Low and balanced cap the ratio at 1, high at 1.5; 1.25 stays under the cap, so buffers scale by a fraction.
  // Eco caps it at 0.75, below one canvas pixel per CSS px; the page scales the canvas up.
  const cases = [
    { quality: "eco", ratio: 2, canvas: [240, 150] },
    { quality: "balanced", ratio: 2, canvas: [320, 200] },
    { quality: "high", ratio: 1.25, canvas: [400, 250] },
    { quality: "high", ratio: 2, canvas: [480, 300] },
    { quality: "high", ratio: 3, canvas: [480, 300] },
  ] as const;

  it.each(cases)("$quality at ratio $ratio", async ({ quality, ratio, canvas }) => {
    const pair = await LookPair.create(
      { ...STATIC, scene: "rainy", hour: 13, quality },
      WIDTH,
      HEIGHT,
      { devicePixelRatio: ratio },
    );
    try {
      const f = pair.frame(0);
      expect([f.width, f.height]).toEqual(canvas);
      expectLook(f, "static frame");
    } finally {
      pair.dispose();
    }
  });
});

describe("look with an explicit wind", SEQUENCES, () => {
  // Still air and a reversed wind: the two values the scene's own wind range never produces.
  it.each([0, -2.5])("wind %d over 20 frames", async (wind) => {
    const pair = await LookPair.create(
      { scene: "rainy", hour: 15, motion: "full", quality: "balanced", wind },
      WIDTH,
      HEIGHT,
    );
    try {
      for (const t of frameTimes(0, 20)) expectLook(pair.frame(t), `t=${t.toFixed(3)}`);
    } finally {
      pair.dispose();
    }
  });
});

describe("look without half-float render targets", SEQUENCES, () => {
  let pair: LookPair;

  beforeAll(async () => {
    // v6 times the storm's frames to its lightning schedule, which draws from the same random sequence.
    pair = await LookPair.create(STATIC, WIDTH, HEIGHT, { floatTargets: false, v6: true });
  });

  afterAll(() => {
    pair.dispose();
  });

  it("both fall back to RGBA8", () => {
    expect(pair.skyeStats().hdr).toBe("rgba8");
    expect(pair.approvedStats().hdr).toBe("rgba8");
  });

  const cases: { name: string; params: SkyeParams }[] = [
    { name: "clear night", params: { scene: "clear", hour: 2 } },
    { name: "rainy noon", params: { scene: "rainy", hour: 13 } },
    { name: "haze dusk", params: { scene: "haze", hour: 19.5 } },
    { name: "snowy noon, blur 12", params: { scene: "snowy", hour: 13, blur: 12 } },
  ];

  it.each(cases)("$name", ({ params }) => {
    pair.update({ ...STATIC, blur: 0, ...params });
    expectLook(pair.frame(0), "static frame");
  });

  it("storm animated through a strike", () => {
    pair.update({ scene: "storm", hour: 21, blur: 0, motion: "full" });
    expectLook(pair.frame(0), "t=0");
    let flash = 0;
    for (const t of frameTimes(pair.nextStrike - 2 / 60, 20)) {
      const f = pair.frame(t);
      expectLook(f, `t=${t.toFixed(3)}`);
      flash = Math.max(flash, f.v6?.flash ?? 0);
    }
    expect(flash).toBeGreaterThan(0);
  });
});
