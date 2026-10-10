// How a value moves when it is clicked, keyed or dragged. Pure functions: numbers in, numbers out.
//
// A click steps a value one notch the way it is heading. A value with ends turns round at each one, so clicking
// alone walks it from one end to the other and back; a value that comes round, such as the hour, keeps going.

/** Forward, toward the high end, or back. */
export type Direction = 1 | -1;

export interface Steps {
  /** The lowest and highest value. */
  readonly range: readonly [number, number];
  /** One notch: values a click lands on are whole notches from `origin`. */
  readonly step: number;
  /** Where the notches are counted from; the low end by default. */
  readonly origin?: number;
  /** Values, ascending and inside the range, that a click lands on instead of notches. */
  readonly stops?: readonly number[];
  /** The ends meet: past one end the value comes round to the other and never turns. */
  readonly cyclic?: boolean;
  /**
   * Count a click from the notch nearest the value rather than from the value: for a value whose notches each read
   * as a word, so a value just short of a notch, a moon a little short of full, never steps onto the same word.
   */
  readonly snap?: boolean;
}

/** Closer than this, two values are the same notch. */
const EPSILON = 1e-6;

const mod = (v: number, m: number): number => ((v % m) + m) % m;

/** Rounds away floating-point dust, so 0.1 + 0.2 lands on the notch at 0.3. */
const tidy = (v: number): number => Number(v.toFixed(9));

/** `value` kept inside the range: brought round when cyclic, held at the end otherwise. */
export function fit(value: number, { range: [lo, hi], cyclic }: Steps): number {
  if (cyclic === true) return hi === lo ? lo : tidy(lo + mod(value - lo, hi - lo));
  return Math.min(hi, Math.max(lo, value));
}

/** The end `value` sits at, if any. A cyclic value has none. */
export function endAt(value: number, { range: [lo, hi], cyclic }: Steps): Direction | 0 {
  if (cyclic === true) return 0;
  if (value >= hi - EPSILON) return 1;
  if (value <= lo + EPSILON) return -1;
  return 0;
}

/** The way the next step goes: `dir`, unless the value already stands at that end, where it turns. */
export function heading(value: number, dir: Direction, steps: Steps): Direction {
  if (endAt(value, steps) !== dir) return dir;
  return dir > 0 ? -1 : 1;
}

/**
 * The next notch going `dir`: the first strictly past `value`, or, with `snap`,
 * one on from the notch nearest `value`.
 */
export function notch(
  value: number,
  dir: Direction,
  size: number,
  origin = 0,
  snap = false,
): number {
  const k = (value - origin) / size;
  if (snap) return tidy(origin + (Math.round(k) + dir) * size);
  const n = dir > 0 ? Math.floor(k + EPSILON) + 1 : Math.ceil(k - EPSILON) - 1;
  return tidy(origin + n * size);
}

/** The first stop strictly past `value` going `dir`, or undefined past the last. */
function nextStop(value: number, dir: Direction, stops: readonly number[]): number | undefined {
  return dir > 0
    ? stops.find((s) => s > value + EPSILON)
    : stops.filter((s) => s < value - EPSILON).at(-1);
}

export interface Stepped {
  readonly value: number;
  /** The way the step after this one goes: turned round if this one reached an end. */
  readonly dir: Direction;
}

/** One click's step from `value`, heading `dir`. */
export function step(value: number, dir: Direction, steps: Steps): Stepped {
  const way = heading(value, dir, steps);
  const [lo, hi] = steps.range;
  let next: number;
  if (steps.stops === undefined) {
    next = notch(value, way, steps.step, steps.origin ?? lo, steps.snap === true);
  } else {
    const stop = nextStop(value, way, steps.stops);
    const round = way > 0 ? steps.stops[0] : steps.stops.at(-1);
    next = stop ?? (steps.cyclic === true ? (round ?? lo) : way > 0 ? hi : lo);
  }
  const landed = fit(next, steps);
  return { value: landed, dir: heading(landed, way, steps) };
}

/** A fine step: `by` in `dir` with no notches, held at the ends or brought round. */
export function nudge(value: number, dir: Direction, by: number, steps: Steps): Stepped {
  const next = fit(value + dir * by, steps);
  return { value: next, dir: heading(next, dir, steps) };
}

// ------------------------------------------------------------------------------ dragging

/** What a press has turned into so far: still a click, a sideways drag, or a stray that does neither. */
export type Gesture = "still" | "drag" | "stray";

/**
 * Pixels a press can wander and still be a click. A finger wanders more than a
 * mouse, so touch gets more room.
 */
export function slopFor(pointerType: string): number {
  return pointerType === "touch" ? 10 : pointerType === "pen" ? 6 : 4;
}

/**
 * Reads a press that has moved `dx`, `dy` from where it went down. It becomes a
 * drag once it goes further sideways than `slop` and more sideways than up or
 * down; a press that wanders up or down first is a stray, neither a click nor a
 * drag, so a missed swipe never steps a value.
 */
export function classify(dx: number, dy: number, slop: number): Gesture {
  const across = Math.abs(dx);
  const along = Math.abs(dy);
  if (across >= slop && across > along) return "drag";
  if (along >= slop) return "stray";
  return "still";
}

/** Maps drag distance to value: each stop holds `hold` pixels at one value, the runs between move at `perPixel`. */
export interface Track {
  /** Where `value` sits on the track: mid-hold when it is a stop. */
  at(value: number): number;
  /** The value at track position `t`. */
  value(t: number): number;
}

export function linearTrack(perPixel: number): Track {
  return { at: (value) => value / perPixel, value: (t) => t * perPixel };
}

export function stopTrack(
  lo: number,
  stops: readonly number[],
  perPixel: number,
  hold: number,
): Track {
  return {
    at(value) {
      let t = (value - lo) / perPixel;
      for (const stop of stops) {
        if (stop < value) t += hold;
        else if (stop === value) t += hold / 2;
      }
      return t;
    },
    value(t) {
      let from = lo;
      let pos = 0;
      for (const stop of stops) {
        const run = (stop - from) / perPixel;
        if (t < pos + run) break;
        pos += run;
        if (t < pos + hold) return stop;
        pos += hold;
        from = stop;
      }
      return from + (t - pos) * perPixel;
    },
  };
}

export interface Drag {
  /** The value when the drag began. */
  readonly start: number;
  readonly track: Track;
  /** Whole values only: a list such as the scenes, which a drag walks one entry at a time. */
  readonly discrete?: boolean;
}

/** The value a drag `dx` pixels sideways has reached. */
export function dragTo(dx: number, { start, track, discrete }: Drag, steps: Steps): number {
  const raw = track.value(track.at(start) + dx);
  return fit(discrete === true ? Math.round(raw) : raw, steps);
}
