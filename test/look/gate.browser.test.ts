// The gate's own tests: numeric noise passes, and each deliberate regression in mutations.ts fails, read by the
// measure named. A mutation changes skye alone, through its context (mutations.ts); the approved build draws as is.
import { describe, expect, it } from "vitest";
import type { SkyeParams } from "../../src/index.ts";
import {
  compareToApproved,
  compareToBaseline,
  describeVerdict,
  type Limits,
  type Verdict,
} from "./compare.ts";
import { expectLook, frameTimes } from "./expect.ts";
import { LookPair, type LookFrame } from "./harness.ts";
import { MUTATIONS, NUMERIC_NOISE, type Mutation, type MutationName } from "./mutations.ts";

const WIDTH = 320;
const HEIGHT = 200;
const STATIC: SkyeParams = { motion: "static", glass: true, quality: "balanced" };
// Each case starts two or three skies; software GL in headless Chromium, sharing the CPU with the other test files,
// needs the headroom on a slow machine.
const TIMEOUT = { timeout: 60_000 };

type Measure = keyof Limits;

const STATIC_CASES: { name: MutationName; params: SkyeParams; by: Measure }[] = [
  { name: "skyBrighter", params: { scene: "clear", hour: 13 }, by: "frame" },
  { name: "skyHue", params: { scene: "clear", hour: 13 }, by: "frame" },
  { name: "exposure", params: { scene: "cloudy", hour: 13 }, by: "frame" },
  { name: "sun", params: { scene: "clear", hour: 6.5 }, by: "region" },
  { name: "cover", params: { scene: "cloudy", hour: 13 }, by: "frame" },
  { name: "fog", params: { scene: "fog", hour: 13 }, by: "frame" },
  { name: "stars", params: { scene: "clear", hour: 2 }, by: "region" },
  { name: "frost", params: { scene: "snowy", hour: 13 }, by: "frame" },
  // At the high tier, whose 8000 streaks show; the balanced tier's are faint in one still frame.
  { name: "rain", params: { scene: "rainy", hour: 13, quality: "high" }, by: "frame" },
  { name: "refraction", params: { scene: "rainy", hour: 13 }, by: "region" },
  { name: "particles", params: { scene: "rainy", hour: 13 }, by: "frame" },
  { name: "rays", params: { scene: "clear", hour: 6.5 }, by: "frame" },
  { name: "tonemap", params: { scene: "clear", hour: 13 }, by: "frame" },
  { name: "tier", params: { scene: "cloudy", hour: 13 }, by: "frame" },
  { name: "flip", params: { scene: "clear", hour: 13 }, by: "region" },
  // A blur, a lower resolution or fewer bits keep every mean colour; only the detail sees them.
  { name: "pixelated", params: { scene: "cloudy", hour: 13 }, by: "detail" },
  { name: "pixelatedShifted", params: { scene: "cloudy", hour: 13 }, by: "detail" },
  { name: "blurred", params: { scene: "cloudy", hour: 13 }, by: "detail" },
  { name: "sixBit", params: { scene: "clear", hour: 13 }, by: "detail" },
];

const BASELINE_CASES: { name: MutationName; params: SkyeParams; by: Measure }[] = [
  { name: "skyMuchBrighter", params: { scene: "clear", hour: 13 }, by: "frame" },
  { name: "stars", params: { scene: "clear", hour: 2 }, by: "region" },
  { name: "rays", params: { scene: "snowy", hour: 6.5 }, by: "frame" },
  { name: "cover", params: { scene: "cloudy", hour: 13 }, by: "region" },
];

// Rain at night moves most under noise (its drops refract what lies behind them); snow and dusk add frost and sun.
const NOISE_CASES: SkyeParams[] = [
  { scene: "rainy", hour: 2 },
  { scene: "snowy", hour: 13 },
  { scene: "storm", hour: 19.5 },
  { scene: "clear", hour: 6.5 },
];

function expectCaught(verdict: Verdict, by: Measure): void {
  expect(verdict.pass, describeVerdict(verdict)).toBe(false);
  const measure = verdict.measures.find((m) => m.key === by);
  expect(measure, by).toBeDefined();
  expect(measure?.value, describeVerdict(verdict)).toBeGreaterThan(measure?.limit ?? Infinity);
}

type Reference = "approved" | "baseline";

// A fresh pair for each case: static frames still move the clouds by the wind, so both must have drawn as many.
// Every frame at `times` is drawn, so both have followed the same sequence; only the last is compared.
async function lastVerdict(
  mutation: Mutation,
  params: SkyeParams,
  times: readonly number[],
  against: Reference = "approved",
): Promise<Verdict> {
  const pair = await LookPair.create(params, WIDTH, HEIGHT, {
    mutation,
    baseline: against === "baseline",
  });
  try {
    let last: LookFrame | undefined;
    for (const t of times) last = pair.frame(t);
    if (last === undefined) throw new Error("no frame times");
    // A mutation that no longer applies (a renamed uniform, a shader it no longer matches) would pass for caught.
    expect(pair.mutated, `${mutation.name} changed nothing`).toBeGreaterThan(0);
    const { width, height, skye } = last;
    return against === "baseline"
      ? compareToBaseline(last.baseline ?? last.approved, skye, width, height)
      : compareToApproved(last.approved, skye, width, height);
  } finally {
    pair.dispose();
  }
}

describe("the look gate", TIMEOUT, () => {
  it.each(NOISE_CASES)("lets numeric noise through, $scene at $hour", async (params) => {
    const pair = await LookPair.create({ ...STATIC, ...params }, WIDTH, HEIGHT, {
      mutation: NUMERIC_NOISE,
    });
    try {
      expectLook(pair.frame(0), NUMERIC_NOISE.name);
      expect(pair.mutated, "uniforms the noise rewrote").toBeGreaterThan(0);
    } finally {
      pair.dispose();
    }
  });

  it.each(STATIC_CASES)("catches $name in a static frame, by $by", async ({ name, params, by }) => {
    expectCaught(await lastVerdict(MUTATIONS[name], { ...STATIC, ...params }, [0]), by);
  });

  // Both start where the approved build does; what they get wrong builds up frame by frame.
  it.each(["wind", "frozen"] as const)(
    "catches %s by half a second into the clouds' motion, by region",
    async (name) => {
      const params: SkyeParams = { ...STATIC, scene: "cloudy", hour: 15, motion: "full" };
      expectCaught(await lastVerdict(MUTATIONS[name], params, frameTimes(0, 30)), "region");
    },
  );

  // The baseline's looser limits still stop an approval that breaks the look.
  it.each(BASELINE_CASES)(
    "stops $name against the frozen baseline, by $by",
    async ({ name, params, by }) => {
      const verdict = await lastVerdict(MUTATIONS[name], { ...STATIC, ...params }, [0], "baseline");
      expectCaught(verdict, by);
    },
  );
});
