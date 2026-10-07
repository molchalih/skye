import { afterEach, describe, expect, it } from "vitest";
import type { SkyeParams } from "../../src/index.ts";
import { expectParity, frameTimes } from "./expect.ts";
import { ParityPair } from "./harness.ts";

// Smaller than the other parity boxes: these sequences are long, and software GL in headless Chromium is slow.
const WIDTH = 240;
const HEIGHT = 150;
// v6's blur tween lasts 0.62 s, about 38 frames at 60 fps; 42 frames end in the settled, shrunk canvas.
const FADE_FRAMES = 42;
const SEQUENCE_TIMEOUT_MS = 60_000;

let pair: ParityPair | undefined;

afterEach(() => {
  pair?.dispose();
  pair = undefined;
});

describe("blur fade parity with v6", () => {
  // The high tier caps the ratio at 1.5, so ratio 2 changes the buffer sizes and the blur radius in buffer px.
  it.each([1, 2])(
    "0 → 12 → 0 at device pixel ratio %i",
    async (ratio) => {
      const base: SkyeParams = {
        scene: "rainy",
        hour: 10,
        motion: "full",
        quality: "high",
        blur: 0,
      };
      const p = await ParityPair.create(base, WIDTH, HEIGHT, { devicePixelRatio: ratio });
      pair = p;
      const sizes = new Set<string>();
      let t = 0;
      const run = (count: number, label: string): void => {
        for (const time of frameTimes(t, count)) {
          const f = p.frame(time);
          expectParity(f, `${label} t=${time.toFixed(3)}`);
          sizes.add(`${f.width}x${f.height}`);
        }
        t += count / 60;
      };
      run(2, "sharp");
      p.update({ blur: 12 });
      run(FADE_FRAMES, "blurring");
      p.update({ blur: 0 });
      run(FADE_FRAMES, "sharpening");
      // The canvas shrank once the blur settled and grew back on the way out.
      expect(sizes.size).toBeGreaterThan(1);
    },
    SEQUENCE_TIMEOUT_MS,
  );

  it("static deep blur at the low tier", async () => {
    pair = await ParityPair.create(
      { scene: "snowy", hour: 12, motion: "static", quality: "low", blur: 24 },
      WIDTH,
      HEIGHT,
    );
    expectParity(pair.frame(0), "static blur 24");
  });
});
