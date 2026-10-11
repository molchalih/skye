import { afterEach, describe, expect, it } from "vitest";
import type { SceneName, SkyeParams } from "../../src/index.ts";
import { expectLook, frameTimes } from "./expect.ts";
import { LookPair, type PairOptions } from "./harness.ts";

const BASE: SkyeParams = { motion: "full", glass: true, quality: "balanced", hour: 15 };
const WIDTH = 320;
const HEIGHT = 200;
// Every case here draws tens of particle-heavy frames per side, the storm and resize cases the most. Software GL
// in headless Chromium, sharing the CPU with the other test files, needs the headroom on slow CI.
const SEQUENCE_TIMEOUT_MS = 60_000;

let pair: LookPair | undefined;

async function open(params: SkyeParams, options?: PairOptions): Promise<LookPair> {
  pair = await LookPair.create({ ...BASE, ...params }, WIDTH, HEIGHT, options);
  return pair;
}

/** The mean of the red, green and blue channels over an RGBA8 frame. */
function meanLevel(pixels: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4)
    sum += (pixels[i] ?? 0) + (pixels[i + 1] ?? 0) + (pixels[i + 2] ?? 0);
  return sum / ((pixels.length / 4) * 3);
}

afterEach(() => {
  pair?.dispose();
  pair = undefined;
});

describe("animated look against the approved build", { timeout: SEQUENCE_TIMEOUT_MS }, () => {
  const scenes: SceneName[] = ["rainy", "snowy", "fog", "sleet", "haze"];

  it.each(scenes)("%s over 30 frames at 60 fps", async (scene) => {
    const p = await open({ scene });
    for (const t of frameTimes(0, 30)) expectLook(p.frame(t), `t=${t.toFixed(3)}`);
  });

  it("storm through lightning strikes until a bolt is visible", async () => {
    // v6 draws from the same random sequence, so its schedule times the windows; its frames are not compared.
    const p = await open({ scene: "storm", hour: 21 }, { v6: true });
    // The first frame schedules a strike. Each window runs 30 frames across the next strike; the jump between
    // windows is clamped to 0.1 s. Not every strike shows a bolt (that is drawn by chance), so windows continue
    // until one does.
    const first = p.frame(0);
    expectLook(first, "t=0");
    let flash = 0;
    let bolt = 0;
    let brightest = 0;
    for (let strikes = 0; strikes < 4 && bolt === 0; strikes++) {
      const strike = p.nextStrike;
      expect(strike).toBeGreaterThan(0);
      for (const t of frameTimes(strike - 3 / 60, 30)) {
        const f = p.frame(t);
        expectLook(f, `t=${t.toFixed(3)}`);
        flash = Math.max(flash, f.v6?.flash ?? 0);
        bolt = Math.max(bolt, f.v6?.bolt ?? 0);
        brightest = Math.max(brightest, meanLevel(f.skye));
      }
    }
    expect(flash).toBeGreaterThan(0.5);
    expect(bolt).toBeGreaterThan(0);
    // skye flashed too: its brightest frame is well above the dark storm it started from.
    expect(brightest).toBeGreaterThan(meanLevel(first.skye) * 1.5);
  });

  it("follows a scene change mid-sequence", async () => {
    const p = await open({ scene: "rainy" });
    const times = frameTimes(0, 30);
    for (const [i, t] of times.entries()) {
      if (i === 15) p.update({ scene: "snowy" });
      expectLook(p.frame(t), `frame ${i}`);
    }
  });

  it("steps 1/60 s when a frame repeats or goes back in time", async () => {
    const p = await open({ scene: "rainy" });
    const times = [0, 1 / 60, 2 / 60, 2 / 60, 2 / 60, 3 / 60, 1 / 60, 0.5, 0.25, 4 / 60];
    for (const [i, t] of times.entries()) expectLook(p.frame(t), `frame ${i} at t=${t.toFixed(3)}`);
  });

  it("keeps the frame interval across a resize, at 30 fps", async () => {
    const p = await open({ scene: "rainy", quality: "high" });
    const times = frameTimes(0, 30, 1 / 30);
    for (const [i, t] of times.entries()) {
      if (i === 10) p.resize(517, 243);
      if (i === 20) p.resize(517, 243, 2);
      expectLook(p.frame(t), `frame ${i}`);
    }
  });
});
