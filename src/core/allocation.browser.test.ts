import { afterEach, describe, expect, it } from "vitest";
import { cdp, server } from "vitest/browser";
import { createSky, type Sky, type SkyeParams } from "../index.ts";

// One node of a sampling heap profile; only the fields read here.
interface ProfileNode {
  callFrame: { functionName: string; url: string };
  selfSize: number;
  children: ProfileNode[];
}

// Enough frames for V8 to optimise the frame path; per-frame code runs once a frame, so it tiers up slowly.
const WARM_FRAMES = 20_000;
const SAMPLED_FRAMES = 2_000;
// A few numbers are still boxed where one is passed to or returned from a call V8 does not inline: 120 to 200 B a
// frame here, against about 2 KB before. Everything this guards against costs kilobytes: values read or written
// under computed keys, uniform values passed as arguments, or a for-of loop in a draw, whose iterator V8's mid tier
// keeps.
const BUDGET_BYTES_PER_FRAME = 512;

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

async function ready(params: Partial<SkyeParams>): Promise<Sky> {
  const canvas = document.createElement("canvas");
  const gl = stubContext();
  Reflect.set(canvas, "getContext", () => gl);
  const sky = createSky(canvas, params);
  skies.push(sky);
  await new Promise<void>((resolve) => sky.on("ready", resolve));
  sky.resize(320, 180, 2);
  return sky;
}

/** Bytes allocated by skye's own code per frame, sampled once `frame` has run for the warm-up. */
async function bytesPerFrame(frame: (i: number) => void): Promise<number> {
  for (let i = 0; i < WARM_FRAMES; i++) frame(i);
  const session = cdp();
  await session.send("HeapProfiler.enable");
  await session.send("HeapProfiler.startSampling", {
    samplingInterval: 64,
    // A frame's allocations are short-lived; without these flags only survivors are reported.
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  for (let i = WARM_FRAMES; i < WARM_FRAMES + SAMPLED_FRAMES; i++) frame(i);
  const { profile } = await session.send("HeapProfiler.stopSampling");
  await session.send("HeapProfiler.disable");
  let bytes = 0;
  const visit = (node: ProfileNode): void => {
    const { url } = node.callFrame;
    if (url.includes("/src/") && !url.includes(".test.")) bytes += node.selfSize;
    for (const child of node.children) visit(child);
  };
  visit(profile.head);
  return bytes / SAMPLED_FRAMES;
}

// Only Chromium exposes the sampling heap profiler to the tests.
describe.skipIf(server.browser !== "chromium")("per-frame allocation", () => {
  it("stays within the budget with particles, rays, glass and lightning", async () => {
    const sky = await ready({ scene: "storm", hour: 17.5, motion: "full", quality: "high" });
    const bytes = await bytesPerFrame((i) => sky.render(i / 60));
    expect(bytes).toBeLessThan(BUDGET_BYTES_PER_FRAME);
  });

  it("stays within the budget with a settled blur", async () => {
    const sky = await ready({ scene: "rainy", hour: 10, motion: "full", blur: 12 });
    const bytes = await bytesPerFrame((i) => sky.render(i / 60));
    expect(bytes).toBeLessThan(BUDGET_BYTES_PER_FRAME);
  });

  it("stays within the budget while the blur fades in and out", async () => {
    const sky = await ready({ scene: "cloudy", hour: 7, motion: "full", blur: 0 });
    // A fade lasts about 38 frames; one starts every 60.
    const bytes = await bytesPerFrame((i) => {
      if (i % 60 === 0) sky.update({ blur: i % 120 === 0 ? 12 : 0 });
      sky.render(i / 60);
    });
    expect(bytes).toBeLessThan(BUDGET_BYTES_PER_FRAME);
  });
});
