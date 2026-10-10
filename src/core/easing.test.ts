import { describe, expect, it } from "vitest";
import { BLUR_FADE_S, Easer } from "./easing.ts";
import { createFrameState, type FrameState, type FrameTime } from "./frame-state.ts";

const STATE_KEYS = Object.keys(createFrameState());

// Every number of a state, vector components and nested lights included, under a path such as "sun.position.1".
function flatten(value: unknown, path = "", out = new Map<string, number>()): Map<string, number> {
  if (typeof value === "number") out.set(path, value);
  else if (typeof value === "object" && value !== null)
    for (const [key, child] of Object.entries(value))
      flatten(child, path === "" ? key : `${path}.${key}`, out);
  return out;
}

// Writes `values(path)` to every number of `state`, in place.
function fill(state: object, values: (path: string) => number, path = ""): void {
  for (const [key, child] of Object.entries(state)) {
    const at = path === "" ? key : `${path}.${key}`;
    if (typeof child === "number") Reflect.set(state, key, values(at));
    else if (typeof child === "object" && child !== null) fill(child, values, at);
  }
}

// A state whose every number differs from every other, counting up from `first`.
function distinctState(first: number): FrameState {
  const s = createFrameState();
  let n = first;
  fill(s, () => n++);
  return s;
}

function moving(dt: number): FrameTime {
  return { seconds: 0, dt, isStatic: false };
}

/** An easer that has landed on `from` and is now chasing `to`. */
function chasing(from: FrameState): Easer {
  const easer = new Easer();
  easer.step(from, moving(1 / 60));
  return easer;
}

describe("Easer", () => {
  it("lands on the target on the first step, and on every static step", () => {
    const easer = new Easer();
    expect(easer.step(distinctState(1), moving(0.016))).toEqual(distinctState(1));
    expect(easer.step(distinctState(1001), { seconds: 0, dt: 0.016, isStatic: true })).toEqual(
      distinctState(1001),
    );
    expect(Object.keys(easer.current)).toEqual(STATE_KEYS);
  });

  it("keeps its own vectors, never the target's", () => {
    const target = distinctState(1);
    const state = new Easer().step(target, moving(0.016));
    expect(state.zenith).not.toBe(target.zenith);
    expect(state.sun.position).not.toBe(target.sun.position);
  });

  it("moves every value but the blur part of the way to its target", () => {
    const start = flatten(distinctState(1));
    const target = flatten(distinctState(1001));
    const easer = chasing(distinctState(1));
    const eased = flatten(easer.step(distinctState(1001), moving(0.1)));
    for (const [path, x] of eased) {
      if (path === "blur") continue;
      expect(x, path).toBeGreaterThan(start.get(path) ?? NaN);
      expect(x, path).toBeLessThan(target.get(path) ?? NaN);
    }
  });

  it("covers 63 % of the way in 0.7 s, however the time is split into frames", () => {
    const at = (frames: number): number => {
      const from = createFrameState();
      const to = createFrameState();
      to.cover = 1;
      const easer = chasing(from);
      for (let i = 0; i < frames; i++) easer.step(to, moving(0.7 / frames));
      return easer.current.cover;
    };
    expect(at(1)).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(at(7)).toBeCloseTo(at(1), 12);
    expect(at(42)).toBeCloseTo(at(1), 12);
  });

  it("converges monotonically, until float32 cannot tell it from the target", () => {
    const from = createFrameState();
    const to = createFrameState();
    to.night = 0.8;
    to.zenith[2] = 0.3;
    const easer = chasing(from);
    let night = 0;
    for (let frame = 0; frame < 1200; frame++) {
      easer.step(to, moving(1 / 60));
      expect(easer.current.night).toBeGreaterThanOrEqual(night);
      expect(easer.current.night).toBeLessThanOrEqual(to.night);
      night = easer.current.night;
    }
    expect(Math.fround(easer.current.night)).toBe(Math.fround(0.8));
    expect(Math.fround(easer.current.zenith[2])).toBe(Math.fround(0.3));
  });

  it.each([30, 60, 144])(
    "takes a value chasing 0 below 0.001 within 5 s at %i fps, though never to 0",
    (fps) => {
      const from = createFrameState();
      from.rays = 1;
      const to = createFrameState();
      const easer = chasing(from);
      for (let frame = 0; frame < 5 * fps; frame++) easer.step(to, moving(1 / fps));
      expect(easer.current.rays).toBeLessThan(0.001);
      expect(easer.current.rays).toBeGreaterThan(0);
    },
  );

  it("fades the blur over a fixed time, along a smoothstep, landing exactly", () => {
    const from = createFrameState();
    const to = createFrameState();
    to.blur = 12;
    const easer = chasing(from);
    easer.step(to, moving(BLUR_FADE_S / 2));
    expect(easer.current.blur).toBeCloseTo(6, 12);
    easer.step(to, moving(BLUR_FADE_S / 4));
    expect(easer.current.blur).toBeCloseTo(12 * (0.75 * 0.75 * (3 - 1.5)), 12);
    easer.step(to, moving(BLUR_FADE_S / 4));
    expect(easer.current.blur).toBe(12);
  });

  it("restarts the blur fade from where it is when the target changes mid-fade", () => {
    const from = createFrameState();
    const to = createFrameState();
    to.blur = 12;
    const easer = chasing(from);
    easer.step(to, moving(BLUR_FADE_S / 2));
    const back = createFrameState();
    easer.step(back, moving(BLUR_FADE_S / 2));
    expect(easer.current.blur).toBeCloseTo(3, 12);
    easer.step(back, moving(BLUR_FADE_S / 2));
    expect(easer.current.blur).toBe(0);
  });
});
