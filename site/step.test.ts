import { describe, expect, it } from "vitest";
import {
  classify,
  type Direction,
  dragTo,
  endAt,
  fit,
  heading,
  linearTrack,
  notch,
  nudge,
  slopFor,
  step,
  type Steps,
  stopTrack,
} from "./step.ts";

/** Every value `clicks` clicks visit from `value`, heading `dir`. */
function walk(value: number, dir: Direction, steps: Steps, clicks: number): number[] {
  const seen: number[] = [];
  let at = { value, dir };
  for (let i = 0; i < clicks; i++) {
    at = step(at.value, at.dir, steps);
    seen.push(at.value);
  }
  return seen;
}

describe("stepping", () => {
  const scenes: Steps = { range: [0, 7], step: 1 };
  const cover: Steps = { range: [0.67, 1], step: 0.1, origin: 0 };

  it("lands on the first whole notch strictly past the value, counted from the origin", () => {
    expect(notch(0.45, 1, 0.1)).toBe(0.5);
    expect(notch(0.45, -1, 0.1)).toBe(0.4);
    expect(notch(0.5, 1, 0.1)).toBe(0.6);
    expect(notch(0.3, -1, 0.1)).toBe(0.2);
    expect(notch(21.3, 1, 1)).toBe(22);
    expect(notch(5, 1, 7, 1)).toBe(8);
  });

  it("with snap, counts from the notch nearest the value", () => {
    expect(notch(0.44, 1, 0.1, 0, true)).toBe(0.5);
    expect(notch(0.47, 1, 0.1, 0, true)).toBe(0.6);
    expect(notch(0.47, -1, 0.1, 0, true)).toBe(0.4);
  });

  it("steps the clock to the next whole hour, never skipping one", () => {
    const hours: Steps = { range: [0, 24], step: 1, cyclic: true };
    expect(step(14.5, 1, hours).value).toBe(15);
    expect(step(22.5, 1, hours).value).toBe(23);
  });

  it("steps cover from a fine value to the next notch down, not past it", () => {
    // 71 %, after a shift + arrow, goes to 70 % on the next arrow down.
    expect(step(0.71, -1, { range: [0, 1], step: 0.1, origin: 0 }).value).toBe(0.7);
  });

  it("changes what the sentence says on the first click from between notches, where it snaps", () => {
    // Rain at 0.45 reads "steadily", as does the notch at 0.5; a click goes on to 0.75, "hard".
    expect(step(0.45, 1, { range: [0, 1], step: 0.25, snap: true }).value).toBe(0.75);
    // A moon at 0.47 reads "full", as does 0.5; a click goes on to 0.625, waning gibbous.
    const phases: Steps = { range: [0, 1], step: 1 / 8, cyclic: true, snap: true };
    expect(step(0.47, 1, phases).value).toBe(0.625);
  });

  it("walks to the end and back, ping-pong", () => {
    expect(walk(5, 1, scenes, 6)).toEqual([6, 7, 6, 5, 4, 3]);
    expect(walk(2, -1, scenes, 5)).toEqual([1, 0, 1, 2, 3]);
  });

  it("turns as it reaches an end, so the next click is already heading back", () => {
    expect(step(6, 1, scenes)).toEqual({ value: 7, dir: -1 });
    expect(step(1, -1, scenes)).toEqual({ value: 0, dir: 1 });
    expect(step(3, 1, scenes)).toEqual({ value: 4, dir: 1 });
  });

  it("turns a value that already stands at the end it heads for", () => {
    expect(heading(7, 1, scenes)).toBe(-1);
    expect(heading(0, -1, scenes)).toBe(1);
    expect(heading(3, 1, scenes)).toBe(1);
    expect(step(7, 1, scenes)).toEqual({ value: 6, dir: -1 });
  });

  it("holds the last notch at an end that falls between notches", () => {
    expect(walk(0.71, 1, cover, 6).map((v) => Number(v.toFixed(2)))).toEqual([
      0.8, 0.9, 1, 0.9, 0.8, 0.7,
    ]);
    expect(walk(0.8, -1, cover, 3).map((v) => Number(v.toFixed(2)))).toEqual([0.7, 0.67, 0.7]);
  });

  it("steps across stops, and to the end past the last", () => {
    const places: Steps = { range: [-66, 66], step: 1, stops: [-33.87, 0, 51.51, 52.37] };
    expect(walk(51.51, 1, places, 4)).toEqual([52.37, 66, 52.37, 51.51]);
    expect(walk(-40, -1, places, 2)).toEqual([-66, -33.87]);
  });

  it("comes round a cyclic value and never turns", () => {
    const hours: Steps = { range: [0, 24], step: 1, cyclic: true };
    expect(walk(22.5, 1, hours, 3)).toEqual([23, 0, 1]);
    expect(walk(0.5, -1, hours, 2)).toEqual([0, 23]);
    expect(endAt(0, hours)).toBe(0);
    expect(heading(0, -1, hours)).toBe(-1);
    const phases: Steps = { range: [0, 1], step: 1 / 8, cyclic: true };
    expect(walk(0.55, 1, phases, 4)).toEqual([0.625, 0.75, 0.875, 0]);
    const months: Steps = { range: [1, 366], step: 1, stops: [21, 172, 355], cyclic: true };
    expect(walk(300, 1, months, 3)).toEqual([355, 21, 172]);
    expect(walk(10, -1, months, 1)).toEqual([355]);
  });

  it("fits a value into the range", () => {
    expect(fit(1.4, { range: [0, 1], step: 0.1 })).toBe(1);
    expect(fit(-3, { range: [0, 1], step: 0.1 })).toBe(0);
    expect(fit(25.5, { range: [0, 24], step: 1, cyclic: true })).toBe(1.5);
    expect(fit(-0.25, { range: [0, 24], step: 1, cyclic: true })).toBe(23.75);
  });

  it("nudges finely, holding at the ends", () => {
    expect(nudge(0.5, 1, 0.01, cover).value).toBeCloseTo(0.67);
    expect(nudge(0.995, 1, 0.01, cover)).toEqual({ value: 1, dir: -1 });
    expect(nudge(0.8, -1, 0.01, cover).value).toBeCloseTo(0.79);
  });
});

describe("dragging", () => {
  it("is a click until it goes sideways past the slop", () => {
    expect(classify(0, 0, 4)).toBe("still");
    expect(classify(3, 2, 4)).toBe("still");
    expect(classify(-4, 1, 4)).toBe("drag");
    expect(classify(6, 6, 4)).toBe("stray");
    expect(classify(1, 5, 4)).toBe("stray");
  });

  it("gives a finger more room than a mouse", () => {
    expect(slopFor("touch")).toBeGreaterThan(slopFor("pen"));
    expect(slopFor("pen")).toBeGreaterThan(slopFor("mouse"));
    expect(slopFor("")).toBe(slopFor("mouse"));
  });

  it("scrubs continuously, held at the ends", () => {
    const steps: Steps = { range: [0, 1], step: 0.1 };
    const drag = { start: 0.5, track: linearTrack(0.004) };
    expect(dragTo(25, drag, steps)).toBeCloseTo(0.6);
    expect(dragTo(-50, drag, steps)).toBeCloseTo(0.3);
    expect(dragTo(400, drag, steps)).toBe(1);
  });

  it("walks a list one entry at a time", () => {
    const steps: Steps = { range: [0, 7], step: 1 };
    const drag = { start: 3, track: linearTrack(1 / 36), discrete: true };
    expect(dragTo(17, drag, steps)).toBe(3);
    expect(dragTo(19, drag, steps)).toBe(4);
    expect(dragTo(-80, drag, steps)).toBe(1);
    expect(dragTo(1000, drag, steps)).toBe(7);
  });

  it("brings a cyclic value round", () => {
    const steps: Steps = { range: [0, 24], step: 1, cyclic: true };
    expect(dragTo(80, { start: 23, track: linearTrack(0.025) }, steps)).toBeCloseTo(1);
  });

  it("holds on each stop for a stretch", () => {
    const track = stopTrack(-10, [0], 1, 14);
    const steps: Steps = { range: [-10, 10], step: 1, stops: [0] };
    const drag = { start: -2, track };
    expect(dragTo(1, drag, steps)).toBe(-1);
    expect(dragTo(2, drag, steps)).toBe(0);
    expect(dragTo(15, drag, steps)).toBe(0);
    expect(dragTo(17, drag, steps)).toBe(1);
    expect(track.value(track.at(0))).toBe(0);
  });
});
