import { afterEach, describe, expect, it, vi } from "vitest";
import { Display } from "../../test/support/display.ts";
import { FrameLoop, type LoopClient } from "./loop.ts";

interface Recorder extends LoopClient {
  times: number[];
  intervals: number[];
  steps: number[];
  caps: number[];
  allowed: boolean;
  still: boolean;
  cap: number;
}

function recorder(): Recorder {
  const r: Recorder = {
    times: [],
    intervals: [],
    steps: [],
    caps: [],
    allowed: true,
    still: false,
    cap: 60,
    canDraw: () => r.allowed,
    isStatic: () => r.still,
    fpsCap: () => r.cap,
    draw: (t, dt) => {
      r.times.push(t);
      r.steps.push(dt);
    },
    paced: (dtMs, cap) => {
      r.intervals.push(dtMs);
      r.caps.push(cap);
    },
  };
  return r;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("FrameLoop", () => {
  it("draws once per display frame in seconds since its first frame, and goes idle on sleep", () => {
    const display = new Display().install();
    const r = recorder();
    const loop = new FrameLoop(r);
    loop.wake();
    loop.wake();
    expect(display.pending).toBe(1);
    display.tick(16);
    display.tick(20);
    display.tick(250);
    expect(r.times).toEqual([0, 0.02, 0.27]);
    // The first interval is 1/60 s, later ones the real interval clamped to 0.1 s.
    expect(r.intervals.map((ms) => Math.round(ms * 1000) / 1000)).toEqual([16.667, 20, 100]);
    loop.sleep();
    expect(display.pending).toBe(0);
    display.tick(16);
    expect(r.times).toHaveLength(3);
  });

  it("skips frames under a cap below 60 fps, with 2 ms of slack", () => {
    const display = new Display().install();
    const r = recorder();
    r.cap = 30;
    const loop = new FrameLoop(r);
    loop.wake();
    // 60 Hz display: every other frame arrives 33.3 ms after the last drawn one, within the slack of 1000/30.
    for (let i = 0; i < 7; i++) display.tick(1000 / 60);
    expect(r.times).toHaveLength(4);
    expect(r.caps).toEqual([30, 30, 30, 30]);
    display.tick(1000 / 60);
    // 16.7 ms after the last drawn frame: too early.
    expect(r.times).toHaveLength(4);
    loop.restart();
    display.tick(1);
    // A restarted interval draws at once and reports 1/60 s.
    expect(r.times).toHaveLength(5);
    expect(r.intervals.at(-1)).toBeCloseTo(1000 / 60, 9);
  });

  it("draws one frame per wake while static, outside the meters", () => {
    const display = new Display().install();
    const r = recorder();
    r.still = true;
    const loop = new FrameLoop(r);
    loop.wake();
    display.tick(16);
    display.tick(16);
    expect(r.times).toEqual([0]);
    expect(display.pending).toBe(0);
    loop.wake();
    display.tick(16);
    expect(r.times).toHaveLength(2);
    expect(r.intervals).toEqual([]);
    expect(loop.cpuMs).toBe(-1);
  });

  it("goes idle when the client cannot draw, keeping its clock", () => {
    const display = new Display().install();
    const r = recorder();
    const loop = new FrameLoop(r);
    loop.wake();
    display.tick(10);
    r.allowed = false;
    display.tick(10);
    expect(display.pending).toBe(0);
    r.allowed = true;
    display.tick(1000);
    loop.wake();
    display.tick(10);
    expect(r.times).toEqual([0, 1.02]);
  });

  it("measures CPU time per frame and frames per second", () => {
    const display = new Display().install();
    const r = recorder();
    const loop = new FrameLoop(r);
    expect(loop.fps).toBe(0);
    loop.wake();
    for (let i = 0; i < 70; i++) display.tick(1000 / 60);
    // Like v6, the frame that opens a one-second window is counted in it.
    expect(loop.fps).toBe(61);
    expect(loop.cpuMs).toBeGreaterThanOrEqual(0);
  });

  it("paces with a timer at the fps cap where the scope has no requestAnimationFrame", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.useFakeTimers();
    const r = recorder();
    r.cap = 30;
    const loop = new FrameLoop(r);
    loop.wake();
    vi.advanceTimersByTime(32);
    expect(r.times).toHaveLength(0);
    vi.advanceTimersByTime(2);
    expect(r.times).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(r.times.length).toBeGreaterThanOrEqual(29);
    loop.sleep();
    const drawn = r.times.length;
    vi.advanceTimersByTime(1000);
    expect(r.times).toHaveLength(drawn);
  });

  it("steps static frames by 1/60 s and measures the next animated one from the last animated frame", () => {
    const display = new Display().install();
    const r = recorder();
    const loop = new FrameLoop(r);
    loop.wake();
    display.tick(16);
    display.tick(20);
    r.still = true;
    loop.wake();
    display.tick(500);
    r.still = false;
    loop.wake();
    display.tick(30);
    // v6: the static frame leaves `_lastFrame` alone, so the interval is 530 ms, clamped to 0.1 s.
    expect(r.steps.map((s) => Math.round(s * 1e6) / 1e6)).toEqual([0.016667, 0.02, 0.016667, 0.1]);
  });
});
