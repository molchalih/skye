import { afterEach, describe, expect, it } from "vitest";
import type { SceneName, SkyeParams } from "../../src/index.ts";
import { expectParity, frameTimes } from "./expect.ts";
import { ParityPair } from "./harness.ts";

const BASE: SkyeParams = { motion: "full", glass: true, quality: "balanced", hour: 15 };
const WIDTH = 320;
const HEIGHT = 200;
// Every case here draws tens of particle-heavy frames per side, the storm and resize cases the most. Software GL
// in headless Chromium, sharing the CPU with the other test files, needs the headroom on slow CI.
const SEQUENCE_TIMEOUT_MS = 60_000;

let pair: ParityPair | undefined;

async function open(params: SkyeParams): Promise<ParityPair> {
  pair = await ParityPair.create({ ...BASE, ...params }, WIDTH, HEIGHT);
  return pair;
}

afterEach(() => {
  pair?.dispose();
  pair = undefined;
});

describe("animated parity with v6", { timeout: SEQUENCE_TIMEOUT_MS }, () => {
  const scenes: SceneName[] = ["rainy", "snowy", "fog", "sleet", "haze"];

  it.each(scenes)("%s over 30 frames at 60 fps", async (scene) => {
    const p = await open({ scene });
    for (const t of frameTimes(0, 30)) expectParity(p.frame(t), `t=${t.toFixed(3)}`);
  });

  it("storm through lightning strikes until a bolt is visible", async () => {
    const p = await open({ scene: "storm", hour: 21 });
    // The first frame schedules a strike from the shared random sequence. Each window runs 30 frames across
    // the next strike; the jump between windows is clamped to 0.1 s on both sides. Not every strike shows a
    // bolt (v6 draws that by chance), so windows continue until one does.
    expectParity(p.frame(0), "t=0");
    let flash = 0;
    let bolt = 0;
    for (let strikes = 0; strikes < 4 && bolt === 0; strikes++) {
      const strike = p.nextStrike;
      expect(strike).toBeGreaterThan(0);
      for (const t of frameTimes(strike - 3 / 60, 30)) {
        const f = p.frame(t);
        expectParity(f, `t=${t.toFixed(3)}`);
        flash = Math.max(flash, f.flash);
        bolt = Math.max(bolt, f.bolt);
      }
    }
    expect(flash).toBeGreaterThan(0.5);
    expect(bolt).toBeGreaterThan(0);
  });

  it("follows a scene change mid-sequence", async () => {
    const p = await open({ scene: "rainy" });
    const times = frameTimes(0, 30);
    for (const [i, t] of times.entries()) {
      if (i === 15) p.update({ scene: "snowy" });
      expectParity(p.frame(t), `frame ${i}`);
    }
  });

  it("steps 1/60 s when a frame repeats or goes back in time, as v6 does for a zero interval", async () => {
    const p = await open({ scene: "rainy" });
    const times = [0, 1 / 60, 2 / 60, 2 / 60, 2 / 60, 3 / 60, 1 / 60, 0.5, 0.25, 4 / 60];
    for (const [i, t] of times.entries())
      expectParity(p.frame(t), `frame ${i} at t=${t.toFixed(3)}`);
  });

  it("keeps the frame interval across a resize, at 30 fps", async () => {
    const p = await open({ scene: "rainy", quality: "high" });
    const times = frameTimes(0, 30, 1 / 30);
    for (const [i, t] of times.entries()) {
      if (i === 10) p.resize(517, 243);
      if (i === 20) p.resize(517, 243, 2);
      expectParity(p.frame(t), `frame ${i}`);
    }
  });
});
