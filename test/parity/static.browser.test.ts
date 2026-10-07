import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCENE_NAMES, createSky, type SkyeParams } from "../../src/index.ts";
import { compare, describeComparison } from "./compare.ts";
import { ParityPair, whenReady } from "./harness.ts";

const HOURS = [
  { name: "night", hour: 2 },
  { name: "dawn", hour: 6.5 },
  { name: "noon", hour: 13 },
  { name: "dusk", hour: 19.5 },
] as const;

// A small landscape box and a portrait one with odd sizes, so rounding in the buffer sizes is exercised.
const SIZES = [
  [320, 200],
  [283, 419],
] as const;

const BASE: SkyeParams = { motion: "static", glass: true, quality: "balanced" };

const CASES = SCENE_NAMES.flatMap((scene) =>
  HOURS.map(({ name, hour }) => ({ scene, name, hour })),
);

describe.each(SIZES)("static parity with v6 at %ix%i", (width, height) => {
  let pair: ParityPair;

  beforeAll(async () => {
    pair = await ParityPair.create(BASE, width, height);
  });

  afterAll(() => {
    pair.dispose();
  });

  it.each(CASES)("$scene at $name", ({ scene, hour }) => {
    pair.update({ ...BASE, scene, hour });
    const f = pair.frame(0);
    const result = compare(f.v6, f.skye, f.width, f.height);
    expect(result.pass, describeComparison(result)).toBe(true);
  });
});

function draw(canvas: HTMLCanvasElement): Uint8Array {
  const gl = canvas.getContext("webgl2");
  if (gl === null) throw new Error("no context");
  const out = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.readPixels(
    0,
    0,
    gl.drawingBufferWidth,
    gl.drawingBufferHeight,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    out,
  );
  return out;
}

describe("several skies on one page", () => {
  it("render independently, and disposing one leaves the others drawing", async () => {
    const clear: SkyeParams = { ...BASE, scene: "clear", hour: 13 };
    const storm: SkyeParams = { ...BASE, scene: "storm", hour: 2 };
    const canvases = [0, 1, 2].map(() => document.createElement("canvas"));
    const [ca, cb, cc] = canvases;
    if (ca === undefined || cb === undefined || cc === undefined) throw new Error("unreachable");
    const a = createSky(ca, clear);
    const b = createSky(cb, storm);
    await Promise.all([whenReady(a), whenReady(b)]);
    for (const s of [a, b]) s.resize(160, 100, 1);

    a.render(0);
    const a1 = draw(ca);
    b.render(0);
    const b1 = draw(cb);
    expect(b1).not.toEqual(a1);

    b.dispose();
    b.render(1);
    a.render(1);
    const a2 = draw(ca);

    // A fresh sky given the same params and frames must match the survivor exactly.
    const c = createSky(cc, clear);
    await whenReady(c);
    c.resize(160, 100, 1);
    c.render(0);
    expect(draw(cc)).toEqual(a1);
    c.render(1);
    expect(draw(cc)).toEqual(a2);

    a.dispose();
    c.dispose();
    for (const cv of canvases)
      cv.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
});
