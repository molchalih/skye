import { afterEach, describe, expect, it, vi } from "vitest";
import { Display } from "../../test/support/display.ts";
import { disposeSkies, makeSky, next, wait } from "../../test/support/sky.ts";
import type { TierChange } from "../index.ts";
import { Easer } from "./easing.ts";

const MOTION = { motion: "full", scene: "clear", quality: "balanced" } as const;

/** A sky that is ready, sized small, and not yet started. */
async function readySky(
  params: Parameters<typeof makeSky>[0] = MOTION,
): Promise<ReturnType<typeof makeSky>> {
  const s = makeSky(params);
  await next(s.sky, "ready");
  s.sky.resize(32, 20, 1);
  return s;
}

afterEach(() => {
  disposeSkies();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Sky loop", () => {
  it("draws one frame per display frame between start and stop", async () => {
    const display = new Display().install();
    const { sky, frames } = await readySky();
    expect(display.pending).toBe(0);
    sky.start();
    sky.start();
    expect(display.pending).toBe(1);
    for (let i = 0; i < 3; i++) display.tick();
    expect(frames()).toBe(3);
    sky.stop();
    expect(display.pending).toBe(0);
    display.tick();
    expect(frames()).toBe(3);
    sky.start();
    display.tick();
    expect(frames()).toBe(4);
  });

  it("waits for the programs when started before the sky is ready", async () => {
    const display = new Display().install();
    const { sky, frames } = makeSky(MOTION);
    sky.resize(32, 20, 1);
    sky.start();
    display.tick();
    expect(frames()).toBe(0);
    await next(sky, "ready");
    expect(display.pending).toBe(1);
    display.tick();
    expect(frames()).toBe(1);
  });

  it("pauses while invisible and resumes when visible again", async () => {
    const display = new Display().install();
    const { sky, frames } = await readySky();
    sky.start();
    display.tick();
    sky.setVisible(false);
    expect(display.pending).toBe(0);
    display.tick();
    sky.update({ hour: 3 });
    expect(display.pending).toBe(0);
    expect(frames()).toBe(1);
    sky.setVisible(true);
    sky.setVisible(true);
    expect(display.pending).toBe(1);
    display.tick();
    display.tick();
    expect(frames()).toBe(3);
  });

  it("draws exactly one frame per change under static motion", async () => {
    const display = new Display().install();
    const { sky, frames } = await readySky({ ...MOTION, motion: "static" });
    expect(sky.stats().static).toBe(true);
    sky.start();
    display.tick();
    display.tick();
    expect(frames()).toBe(1);
    expect(display.pending).toBe(0);

    const changes: (() => void)[] = [
      () => sky.update({ hour: 3 }),
      () => sky.resize(40, 24, 1),
      () => sky.setReducedMotion(true),
      () => {
        sky.setVisible(false);
        sky.setVisible(true);
      },
    ];
    let drawn = 1;
    for (const change of changes) {
      change();
      display.tick(500);
      display.tick(500);
      expect(frames()).toBe(++drawn);
    }
    // Changes before one frame share it.
    sky.update({ hour: 4 });
    sky.update({ hour: 3 });
    display.tick();
    expect(frames()).toBe(++drawn);
    // Repeating a value is not a change.
    sky.setReducedMotion(true);
    sky.setVisible(true);
    display.tick();
    expect(frames()).toBe(drawn);
  });

  it("makes auto motion static under reduced motion, and animates again without it", async () => {
    const display = new Display().install();
    const { sky, frames } = await readySky({ ...MOTION, motion: "auto" });
    sky.setReducedMotion(false);
    sky.start();
    display.tick();
    display.tick();
    expect(frames()).toBe(2);
    sky.setReducedMotion(true);
    expect(sky.stats().static).toBe(true);
    display.tick();
    display.tick();
    expect(frames()).toBe(3);
    sky.setReducedMotion(false);
    display.tick();
    display.tick();
    expect(frames()).toBe(5);
    expect(display.pending).toBe(1);
  });

  it("advances by v6's intervals from static frames back to animated ones", async () => {
    const display = new Display().install();
    const step = vi.spyOn(Easer.prototype, "step");
    const { sky } = await readySky({ ...MOTION, motion: "auto" });
    sky.setReducedMotion(false);
    sky.start();
    display.tick(16);
    display.tick(20);
    sky.setReducedMotion(true);
    display.tick(500);
    sky.setReducedMotion(false);
    display.tick(30);
    // The static frame steps 1/60 s and leaves the interval alone, so the next one spans 530 ms, clamped to 0.1 s.
    const steps = step.mock.calls.map(([, dt]) => Math.round(dt * 1e6) / 1e6);
    expect(steps).toEqual([0.016667, 0.02, 0.016667, 0.1]);
  });

  it("keeps drawing and notifies every listener when one throws", async () => {
    const reported: unknown[] = [];
    vi.stubGlobal("reportError", (error: unknown) => reported.push(error));
    const display = new Display().install();
    const { sky, frames } = makeSky(MOTION);
    sky.resize(32, 20, 1);
    sky.start();
    const boom = new Error("listener");
    sky.on("ready", () => {
      throw boom;
    });
    await next(sky, "ready");
    expect(reported).toEqual([boom]);
    expect(display.pending).toBe(1);
    display.tick();
    expect(frames()).toBe(1);
  });

  it("reads reduced motion from the media query once, at creation", async () => {
    let reduced = true;
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: reduced && query === "(prefers-reduced-motion: reduce)",
    }));
    const { sky } = await readySky({ ...MOTION, motion: "auto" });
    expect(sky.stats().static).toBe(true);
    reduced = false;
    expect(sky.stats().static).toBe(true);
    sky.setReducedMotion(false);
    expect(sky.stats().static).toBe(false);
  });

  it("steps the auto tier down on slow frames and reports it", async () => {
    const display = new Display().install();
    const { sky } = await readySky({ ...MOTION, quality: "auto" });
    // Without GPU timing the controller judges the frame interval alone.
    sky.probe(false);
    const changes: TierChange[] = [];
    sky.on("tierchange", (c) => changes.push(c));
    sky.start();
    for (let i = 0; i < 90; i++) display.tick(100);
    expect(changes).toEqual([]);
    expect(sky.stats()).toMatchObject({ quality: "balanced", tier: 1 });
    display.tick(100);
    expect(changes).toEqual([{ quality: "low", tier: 0 }]);
    expect(sky.stats()).toMatchObject({ quality: "low", tier: 0, fpsCap: 30 });
  });

  it("keeps a fixed tier on slow frames", async () => {
    const display = new Display().install();
    const { sky } = await readySky();
    const changes: TierChange[] = [];
    sky.on("tierchange", (c) => changes.push(c));
    sky.start();
    for (let i = 0; i < 100; i++) display.tick(100);
    expect(changes).toEqual([]);
  });

  it("fills the meters from the loop's frames", async () => {
    const display = new Display().install();
    const { sky, gl } = await readySky();
    expect(sky.stats()).toMatchObject({ cpuMs: -1, fps: 0 });
    sky.start();
    for (let i = 0; i < 70; i++) display.tick();
    const stats = sky.stats();
    expect(stats.fps).toBeGreaterThanOrEqual(59);
    expect(stats.fps).toBeLessThanOrEqual(62);
    // Timer resolution is coarse in some engines, so a fast frame can measure 0 ms; unmeasured is -1.
    expect(stats.cpuMs).toBeGreaterThanOrEqual(0);
    expect(stats.passes).toBeGreaterThan(0);
    expect(stats.mpx).toBeGreaterThan(0);
    expect(stats).toMatchObject({
      renderer: "skye",
      worker: false,
      static: false,
      out: [32, 20],
      fpsCap: 60,
      hdr: gl.getExtension("EXT_color_buffer_float") === null ? "rgba8" : "half-float",
      timer: gl.getExtension("EXT_disjoint_timer_query_webgl2") !== null,
    });
  });

  it("times the GPU only in auto quality or while probing", async () => {
    const display = new Display().install();
    const { sky, gl } = await readySky();
    const begin = vi.spyOn(gl, "beginQuery");
    sky.start();
    display.tick();
    expect(begin).not.toHaveBeenCalled();
    sky.probe(true);
    display.tick();
    // Timing needs the timer extension, which not every engine exposes.
    expect(begin).toHaveBeenCalledTimes(sky.stats().timer ? 1 : 0);
    sky.probe(false);
    sky.update({ quality: "auto" });
    display.tick();
    expect(begin).toHaveBeenCalledTimes(sky.stats().timer ? 1 : 0);
  });

  it("paces with a timer where the scope has no requestAnimationFrame", async () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const { sky, frames } = await readySky();
    sky.start();
    await vi.waitFor(() => expect(frames()).toBeGreaterThanOrEqual(3), { timeout: 5000 });
    expect(sky.stats().cpuMs).toBeGreaterThanOrEqual(0);
    sky.stop();
    const drawn = frames();
    await wait(100);
    expect(frames()).toBe(drawn);
  });

  it("stops the loop on dispose", async () => {
    const display = new Display().install();
    const { sky, frames } = await readySky();
    sky.start();
    display.tick();
    sky.dispose();
    expect(display.pending).toBe(0);
    sky.start();
    sky.setVisible(false);
    sky.setVisible(true);
    display.tick();
    expect(frames()).toBe(1);
  });
});
