import { afterEach, describe, expect, it, vi } from "vitest";
import { Display } from "../../test/support/display.ts";
import { FIRST_DT_S, FrameLoop, type LoopClient } from "./loop.ts";

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
    draw: (time) => {
      r.times.push(time.seconds);
      r.steps.push(time.dt);
    },
    paced: (time, cap) => {
      r.intervals.push(time.dt * 1000);
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

  it("skips frames under a cap below 60 fps, halfway between display frames", () => {
    const display = new Display().install();
    const r = recorder();
    r.cap = 30;
    const loop = new FrameLoop(r);
    loop.wake();
    // 60 Hz display: every other frame arrives 33.3 ms after the last drawn one, past the cap's 1000/30 ms less 2 ms.
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

  // Display frames per drawn frame: the first frame at or past the cap's interval less 2 ms, at every
  // common rate. Each timestamp is up to 0.9 ms off its vsync, so an interval between two drawn frames is up to 1.8 ms
  // off: a fixed threshold, 0.5 ms from the nearest frame at 165 Hz under 20 fps, would drop some of them a frame.
  const PACING = [
    { cap: 20, hz: 50, frames: 3 },
    { cap: 20, hz: 60, frames: 3 },
    { cap: 20, hz: 75, frames: 4 },
    { cap: 20, hz: 90, frames: 5 },
    { cap: 20, hz: 100, frames: 5 },
    { cap: 20, hz: 120, frames: 6 },
    { cap: 20, hz: 144, frames: 7 },
    { cap: 20, hz: 165, frames: 8 },
    { cap: 20, hz: 240, frames: 12 },
    { cap: 30, hz: 50, frames: 2 },
    { cap: 30, hz: 60, frames: 2 },
    { cap: 30, hz: 75, frames: 3 },
    { cap: 30, hz: 90, frames: 3 },
    { cap: 30, hz: 100, frames: 4 },
    { cap: 30, hz: 120, frames: 4 },
    { cap: 30, hz: 144, frames: 5 },
    { cap: 30, hz: 165, frames: 6 },
    { cap: 30, hz: 240, frames: 8 },
  ];

  /** Ticks `count` display frames at `hz` from frame `from`, each up to 0.9 ms off its vsync in a fixed pattern. */
  function ticks(display: Display, hz: number, from: number, count: number): void {
    const stamp = (i: number): number => (i * 1000) / hz + 0.9 * Math.sin(i * 12.9898);
    for (let i = from + 1; i <= from + count; i++) display.tick(stamp(i) - stamp(i - 1));
  }

  it.each(PACING)(
    "holds a cap of $cap fps to every $frames frames at $hz Hz, with jittery timestamps",
    ({ cap, hz, frames }) => {
      const display = new Display().install();
      const r = recorder();
      r.cap = cap;
      const loop = new FrameLoop(r);
      loop.wake();
      // A second for the loop to measure the display's frame interval, then 20 capped frames.
      ticks(display, hz, 0, hz);
      const settled = r.intervals.length;
      ticks(display, hz, hz, 20 * frames);
      const counts = r.intervals.slice(settled).map((ms) => Math.round((ms * hz) / 1000));
      expect(counts.length).toBeGreaterThanOrEqual(19);
      expect(new Set(counts)).toEqual(new Set([frames]));
    },
  );

  it("keeps the display's frame interval across an idle gap", () => {
    const display = new Display().install();
    const r = recorder();
    r.cap = 20;
    const loop = new FrameLoop(r);
    loop.wake();
    ticks(display, 144, 0, 144);
    loop.sleep();
    display.tick(5000);
    loop.wake();
    // The first frame after the gap draws at once; the 5 s it spans are no display frame interval.
    const settled = r.intervals.length + 1;
    ticks(display, 144, 1000, 140);
    const counts = r.intervals.slice(settled).map((ms) => Math.round((ms * 144) / 1000));
    expect(counts.length).toBeGreaterThanOrEqual(19);
    expect(new Set(counts)).toEqual(new Set([7]));
  });

  it.each([75, 100, 165])(
    "draws every frame once rAF drops to 30 fps on a %i Hz display under a cap of 30",
    (hz) => {
      const display = new Display().install();
      const r = recorder();
      r.cap = 30;
      const loop = new FrameLoop(r);
      loop.wake();
      ticks(display, hz, 0, hz);
      const drawn = r.times.length;
      // Energy savers hold rAF to 30 fps: 2.5, 3.3 and 5.5 of the frames the loop measured.
      for (let i = 0; i < 90; i++) display.tick(1000 / 30);
      expect(r.times.length - drawn).toBe(90);
    },
  );

  it("keeps the cadence across a missed vsync", () => {
    const display = new Display().install();
    const r = recorder();
    r.cap = 30;
    const loop = new FrameLoop(r);
    loop.wake();
    for (let i = 0; i < 165; i++) display.tick(1000 / 165);
    const settled = r.intervals.length;
    // One vsync without a frame: an interval of two display frames, not one longer frame.
    display.tick(2000 / 165);
    for (let i = 0; i < 120; i++) display.tick(1000 / 165);
    const counts = r.intervals.slice(settled).map((ms) => Math.round((ms * 165) / 1000));
    expect(counts.length).toBeGreaterThanOrEqual(20);
    expect(new Set(counts)).toEqual(new Set([6]));
  });

  it("draws each static frame twice, the repeat a zero step, outside the meters", () => {
    const display = new Display().install();
    const r = recorder();
    r.still = true;
    const loop = new FrameLoop(r);
    loop.wake();
    display.tick(16);
    display.tick(16);
    display.tick(16);
    expect(r.times).toEqual([0, 0.016]);
    expect(r.steps).toEqual([FIRST_DT_S, 0]);
    expect(display.pending).toBe(0);
    loop.wake();
    display.tick(16);
    display.tick(16);
    expect(r.times).toHaveLength(4);
    expect(r.intervals).toEqual([]);
    expect(loop.cpuMs).toBe(-1);
  });

  it("gives a change before the repeat its own pair of static frames", () => {
    const display = new Display().install();
    const r = recorder();
    r.still = true;
    const loop = new FrameLoop(r);
    loop.wake();
    display.tick(16);
    // The repeat is pending; a change reuses that request as its own first frame.
    loop.wake();
    expect(display.pending).toBe(1);
    for (let i = 0; i < 4; i++) display.tick(16);
    expect(r.steps).toEqual([FIRST_DT_S, FIRST_DT_S, 0]);
    expect(display.pending).toBe(0);
  });

  it("drops the pending repeat when a static sky starts animating", () => {
    const display = new Display().install();
    const r = recorder();
    r.still = true;
    const loop = new FrameLoop(r);
    loop.wake();
    display.tick(16);
    r.still = false;
    loop.wake();
    display.tick(16);
    display.tick(16);
    // The animated loop runs as before: a first frame of 1/60 s, then the measured interval.
    expect(r.steps).toEqual([FIRST_DT_S, FIRST_DT_S, 0.016]);
    expect(r.intervals).toEqual([FIRST_DT_S * 1000, 16]);
    expect(display.pending).toBe(1);
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

  it.each([
    ["sleeps", (_r: Recorder, loop: FrameLoop) => loop.sleep()],
    ["may not draw", (r: Recorder) => void (r.allowed = false)],
    ["draws static frames", (r: Recorder) => void (r.still = true)],
  ])(
    "reads 0 frames per second while the loop %s, and measures afresh once it animates",
    (_, stop) => {
      const display = new Display().install();
      const r = recorder();
      const loop = new FrameLoop(r);
      loop.wake();
      for (let i = 0; i < 70; i++) display.tick(1000 / 60);
      expect(loop.fps).toBe(61);
      stop(r, loop);
      display.tick(1000 / 60);
      expect(loop.fps).toBe(0);
      r.allowed = true;
      r.still = false;
      loop.wake();
      for (let i = 0; i < 30; i++) display.tick(1000 / 60);
      // Half a second into the new window: no full second yet.
      expect(loop.fps).toBe(0);
      for (let i = 0; i < 40; i++) display.tick(1000 / 60);
      expect(loop.fps).toBe(61);
    },
  );

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

  it("recovers the cap's rate on a timer that ticked slower than asked", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.useFakeTimers();
    // A throttled timer: no tick sooner than 23 ms.
    const setTimer = globalThis.setTimeout;
    vi.stubGlobal("setTimeout", (cb: () => void, ms: number) => setTimer(cb, Math.max(ms, 23)));
    const r = recorder();
    const loop = new FrameLoop(r);
    loop.wake();
    vi.advanceTimersByTime(1000);
    r.cap = 30;
    vi.advanceTimersByTime(1000);
    const drawn = r.times.length;
    vi.advanceTimersByTime(1000);
    expect(r.times.length - drawn).toBeGreaterThanOrEqual(29);
    loop.sleep();
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
