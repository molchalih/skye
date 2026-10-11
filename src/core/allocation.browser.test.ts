import { afterEach, describe, expect, it } from "vitest";
import { cdp, server } from "vitest/browser";
import { createSky, type Sky, type SkyeParams } from "../index.ts";

// One node of a sampling heap profile; only the fields read here.
interface ProfileNode {
  callFrame: { functionName: string; url: string };
  selfSize: number;
  children: ProfileNode[];
}

// Enough frames for V8 to optimise the whole frame path with its top tier. Per-frame code runs once a frame, so it
// tiers up slowly, and its mid tier boxes numbers the top tier keeps unboxed: after 20,000 frames some of it was still
// there, allocating 5 to 40 B a frame.
const WARM_FRAMES = 60_000;
const SAMPLED_FRAMES = 2_000;
// Three windows one after another; the least is taken. V8 now and then recompiles a wave of functions and allocates
// while it does, which can land inside any one window but not inside all three.
const WINDOWS = 3;
// Frames allocate nothing. A single number boxed in every frame would show here as at least 12 B a frame.
const BUDGET_BYTES_PER_FRAME = 1;

const skies: Sky[] = [];

afterEach(() => {
  for (const sky of skies.splice(0)) sky.dispose();
});

/** A context that accepts every call and draws nothing, so a frame costs only skye's own JavaScript. */
function stubContext(): WebGL2RenderingContext {
  const proto = WebGL2RenderingContext.prototype;
  const gl: WebGL2RenderingContext = Object.create(proto);
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (typeof Object.getOwnPropertyDescriptor(proto, name)?.value === "function")
      Reflect.set(gl, name, () => undefined);
  }
  const location = {};
  Object.assign(gl, {
    getExtension: () => null,
    getProgramParameter: () => true,
    getShaderParameter: () => true,
    getUniformLocation: () => location,
    isContextLost: () => false,
  });
  for (const name of ["Buffer", "Framebuffer", "Program", "Shader", "Texture", "VertexArray"])
    Reflect.set(gl, `create${name}`, () => ({}));
  return gl;
}

/**
 * mulberry32, defined here rather than taken from src/core/random.ts: a
 * random source returns a fresh number each call, which V8 boxes, so its
 * allocations belong to whoever supplies it. Lightning draws seven at a
 * strike.
 */
function random(): () => number {
  let state = 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function ready(params: Partial<SkyeParams>): Promise<Sky> {
  const canvas = document.createElement("canvas");
  const gl = stubContext();
  Reflect.set(canvas, "getContext", () => gl);
  const sky = createSky(canvas, params, { random: random() });
  skies.push(sky);
  await new Promise<void>((resolve) => sky.on("ready", resolve));
  sky.resize(320, 180, 2);
  return sky;
}

/** Bytes allocated per frame by skye's own code over `frames` frames from `from`, under the sampling heap profiler. */
async function sample(frame: (i: number) => void, from: number): Promise<number> {
  const session = cdp();
  await session.send("HeapProfiler.enable");
  await session.send("HeapProfiler.startSampling", {
    samplingInterval: 64,
    // A frame's allocations are short-lived; without these flags only survivors are reported.
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  for (let i = from; i < from + SAMPLED_FRAMES; i++) frame(i);
  const { profile } = await session.send("HeapProfiler.stopSampling");
  await session.send("HeapProfiler.disable");
  let bytes = 0;
  const visit = (node: ProfileNode, updating: boolean): void => {
    const { url, functionName } = node.callFrame;
    const ours = url.includes("/src/") && !url.includes(".test.");
    const inUpdate = updating || (ours && functionName === "update");
    if (ours && !inUpdate) bytes += node.selfSize;
    for (const child of node.children) visit(child, inUpdate);
  };
  visit(profile.head, false);
  return bytes / SAMPLED_FRAMES;
}

/**
 * Bytes allocated per frame by skye's own code once `frame` has run for the
 * warm-up: the least of `WINDOWS` samples. What `update` allocates is left
 * out: a change of params builds new ones, which is not per-frame work.
 */
async function bytesPerFrame(frame: (i: number) => void): Promise<number> {
  for (let i = 0; i < WARM_FRAMES; i++) frame(i);
  let least = Infinity;
  for (let w = 0; w < WINDOWS; w++) {
    // oxlint-disable-next-line no-await-in-loop -- each window samples after the one before
    least = Math.min(least, await sample(frame, WARM_FRAMES + w * SAMPLED_FRAMES));
  }
  return least;
}

// Only Chromium exposes the sampling heap profiler to the tests.
describe.skipIf(server.browser !== "chromium")("per-frame allocation", () => {
  it("stays under a byte a frame with particles, rays, glass and lightning", async () => {
    const sky = await ready({ scene: "storm", hour: 17.5, motion: "full", quality: "high" });
    expect(await bytesPerFrame((i) => sky.render(i / 60))).toBeLessThan(BUDGET_BYTES_PER_FRAME);
  });

  it("stays under a byte a frame in eco, and while switching to and from it", async () => {
    const sky = await ready({ scene: "storm", hour: 17.5, motion: "full", quality: "eco" });
    expect(await bytesPerFrame((i) => sky.render(i / 60))).toBeLessThan(BUDGET_BYTES_PER_FRAME);
    const bytes = await bytesPerFrame((i) => {
      if (i % 60 === 0) sky.update({ quality: i % 120 === 0 ? "high" : "eco" });
      sky.render(i / 60);
    });
    expect(bytes).toBeLessThan(BUDGET_BYTES_PER_FRAME);
  });

  it("stays under a byte a frame with a settled blur", async () => {
    const sky = await ready({ scene: "rainy", hour: 10, motion: "full", blur: 12 });
    expect(await bytesPerFrame((i) => sky.render(i / 60))).toBeLessThan(BUDGET_BYTES_PER_FRAME);
  });

  it("stays under a byte a frame while the blur fades in and out", async () => {
    const sky = await ready({ scene: "cloudy", hour: 7, motion: "full", blur: 0 });
    // A fade lasts about 38 frames; one starts every 60.
    const bytes = await bytesPerFrame((i) => {
      if (i % 60 === 0) sky.update({ blur: i % 120 === 0 ? 12 : 0 });
      sky.render(i / 60);
    });
    expect(bytes).toBeLessThan(BUDGET_BYTES_PER_FRAME);
  });

  it("stays under a byte a frame while the sky eases to a new scene and the glass wets", async () => {
    const sky = await ready({ scene: "clear", hour: 7, motion: "full" });
    // Each change eases for seconds and restarts the glass's build-up, which takes up to 12 s.
    const scenes = ["rainy", "snowy", "fog", "clear"] as const;
    const bytes = await bytesPerFrame((i) => {
      if (i % 240 === 0)
        sky.update({ scene: scenes[(i / 240) % scenes.length], hour: 7 + (i % 960) / 120 });
      sky.render(i / 60);
    });
    expect(bytes).toBeLessThan(BUDGET_BYTES_PER_FRAME);
  });
});
