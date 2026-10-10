// Values you click to step and drag to scrub, as in a reactive document, or step with the arrow keys once focused.
//
// A click steps the value one notch the way its bright arrow points; at an end the arrow turns, so clicks walk the
// value there and back. A click on an arrow, which the page draws beside the value, steps that way. A sideways drag
// scrubs. Arrow keys step as a click does, shift + arrow nudges finely, Home and End go to the ends, Enter and Space
// step like a click.
import {
  classify,
  type Direction,
  type Drag,
  dragTo,
  endAt,
  type Gesture,
  heading,
  linearTrack,
  nudge,
  slopFor,
  step,
  type Stepped,
  type Steps,
  stopTrack,
} from "./step.ts";

export interface ScrubSpec {
  get(): number;
  set(value: number): void;
  /** How the value steps right now; a range can move with the scene. */
  steps(): Steps;
  /** Value change per pixel dragged. */
  perPixel: number;
  /** Shift + arrow: a finer step than a click's notch. */
  fine: number;
  /** Whole values only, such as an index into a list. */
  discrete?: boolean;
  /** Pixels of drag each of the steps' stops holds for, 14 by default. */
  hold?: number;
  /** A click always steps forward: for a value with no arrows to show which way a click goes. */
  steady?: boolean;
  /** The person changed the value: a click, a key, or the start of a drag. */
  onChange?: () => void;
  /** A drag started or ended. */
  onActive?: (active: boolean) => void;
}

export interface Scrubber {
  /** Brings the arrows and the ARIA value up to date with a value that may have changed elsewhere. */
  sync(): void;
  /** A click on the arrow pointing `way`: a step that way, unless the value stands at that end. */
  stepToward(way: Direction): void;
}

/** How long the arrows stay after a touch or pen lets go, which has no hover to show them. */
const LINGER_MS = 1400;

/** Moves are a click's or a drag's; a click this long after its press came from somewhere else. */
const PRESS_MS = 1000;

const set = (el: HTMLElement, name: string, value: string | undefined): void => {
  if (el.dataset[name] === value) return;
  if (value === undefined) delete el.dataset[name];
  else el.dataset[name] = value;
};

/** Makes `el` a value you click to step and drag to scrub. */
export function scrubbable(el: HTMLElement, spec: ScrubSpec): Scrubber {
  const root = document.documentElement;
  /** The way a click on the word goes next. */
  let dir: Direction = 1;
  /** How the last press ended: as a click, or as a drag or a stray that is no click. */
  let press: { click: boolean; at: number } | undefined;
  let linger: ReturnType<typeof setTimeout> | undefined;
  /** Ends the press in progress as cancelled, if one is. */
  let release: (() => void) | undefined;

  function sync(): void {
    const steps = spec.steps();
    const value = spec.get();
    dir = heading(value, dir, steps);
    // A steady value shows no arrows, so it carries no heading or end for them.
    if (spec.steady !== true) {
      set(el, "heading", dir > 0 ? "up" : "down");
      const end = endAt(value, steps);
      set(el, "end", end === 0 ? undefined : end > 0 ? "high" : "low");
    }
    if (el.hasAttribute("role")) {
      const [lo, hi] = steps.range;
      el.setAttribute("aria-valuemin", String(lo));
      el.setAttribute("aria-valuemax", String(hi));
      el.setAttribute("aria-valuenow", String(Number(value.toFixed(2))));
    }
  }

  function move(to: Stepped): void {
    dir = to.dir;
    spec.set(to.value);
    spec.onChange?.();
    sync();
  }

  /** A click on the word: a step the way the value is heading. */
  function tap(): void {
    move(step(spec.get(), spec.steady === true ? 1 : dir, spec.steps()));
  }

  function stepToward(way: Direction): void {
    const steps = spec.steps();
    const value = spec.get();
    // An arrow pointing past the end it stands at has nowhere to go.
    if (endAt(value, steps) !== way) move(step(value, way, steps));
  }

  el.addEventListener("click", () => {
    const last = press;
    press = undefined;
    // A press that dragged or strayed is not a click. A click without a recent press came from the keyboard or
    // from assistive technology, and steps like a click on the word.
    if (last === undefined || performance.now() - last.at >= PRESS_MS || last.click) tap();
  });

  el.addEventListener("pointerdown", (down) => {
    if (down.button !== 0 || !down.isPrimary) return;
    // A press whose end never came, such as one that lost its capture unseen, ends before the next begins.
    release?.();
    // No text selection or native drag; focus goes to the value without scrolling to it.
    down.preventDefault();
    el.focus({ preventScroll: true });
    el.setPointerCapture(down.pointerId);
    clearTimeout(linger);
    set(el, "shown", "");

    const slop = slopFor(down.pointerType);
    let gesture: Gesture = "still";
    let drag: Drag | undefined;
    // Measured from where the drag took hold, so the value does not jump by the slop as it starts.
    let originX = 0;
    let lastX = down.clientX;
    let dx = 0;
    let frame = 0;
    press = undefined;
    // While it is dragged, the value keeps the widest width it has had, so the sentence around it holds still.
    let widest = 0;
    const holdWidth = new ResizeObserver(([entry]) => {
      const width = entry?.borderBoxSize[0]?.inlineSize ?? 0;
      if (width <= widest) return;
      widest = width;
      el.style.minWidth = `${width}px`;
    });

    // Moves land once a frame, however fast the pointer reports.
    const apply = (): void => {
      frame = 0;
      if (drag === undefined) return;
      spec.set(dragTo(dx, drag, spec.steps()));
      sync();
    };

    const startDrag = (x: number): void => {
      gesture = "drag";
      originX = x;
      const steps = spec.steps();
      const start = spec.get();
      const stops = spec.discrete === true ? undefined : steps.stops;
      const track =
        stops === undefined
          ? linearTrack(spec.perPixel)
          : stopTrack(steps.range[0], stops, spec.perPixel, spec.hold ?? 14);
      drag = { start, track, discrete: spec.discrete === true };
      el.dataset.active = "";
      root.dataset.scrubbing = "";
      holdWidth.observe(el);
      spec.onActive?.(true);
      spec.onChange?.();
    };

    const controller = new AbortController();
    const { signal } = controller;

    el.addEventListener(
      "pointermove",
      (e) => {
        if (gesture === "still") {
          gesture = classify(e.clientX - down.clientX, e.clientY - down.clientY, slop);
          if (gesture === "drag") startDrag(e.clientX);
        }
        if (gesture !== "drag") return;
        // The way the pointer last went is the way the arrows point, and the way the next click goes.
        if (e.clientX !== lastX) dir = e.clientX > lastX ? 1 : -1;
        lastX = e.clientX;
        dx = e.clientX - originX;
        if (frame === 0) frame = requestAnimationFrame(apply);
      },
      { signal },
    );

    const end = (up: boolean): void => {
      release = undefined;
      controller.abort();
      cancelAnimationFrame(frame);
      holdWidth.disconnect();
      el.style.minWidth = "";
      if (gesture === "drag") {
        if (up) apply();
        delete el.dataset.active;
        delete root.dataset.scrubbing;
        spec.onActive?.(false);
      }
      // A cancelled press is followed by no click.
      press = up ? { click: gesture === "still", at: performance.now() } : undefined;
      if (down.pointerType === "mouse") set(el, "shown", undefined);
      else linger = setTimeout(() => set(el, "shown", undefined), LINGER_MS);
    };
    release = () => end(false);
    el.addEventListener("pointerup", () => end(true), { signal });
    el.addEventListener("pointercancel", () => end(false), { signal });
    // Capture can go without a pointerup: taken by another element, or released by the browser.
    el.addEventListener("lostpointercapture", () => end(false), { signal });
  });

  el.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const steps = spec.steps();
    const value = spec.get();
    const [lo, hi] = steps.range;
    const arrow = (way: Direction): Stepped =>
      // Held at an end, an arrow pointing past it stays put rather than turning.
      endAt(value, steps) === way
        ? { value, dir: heading(value, way, steps) }
        : e.shiftKey
          ? nudge(value, way, spec.fine, steps)
          : step(value, way, steps);
    const keys: Record<string, (() => Stepped) | undefined> = {
      ArrowRight: () => arrow(1),
      ArrowUp: () => arrow(1),
      ArrowLeft: () => arrow(-1),
      ArrowDown: () => arrow(-1),
    };
    // A value that comes round has no first or last.
    if (steps.cyclic !== true) {
      keys.Home = () => ({ value: lo, dir: 1 });
      keys.End = () => ({ value: hi, dir: -1 });
    }
    const action = keys[e.key];
    const click = e.key === "Enter" || e.key === " ";
    if (action === undefined && !click) return;
    e.preventDefault();
    e.stopPropagation();
    if (action === undefined) tap();
    else move(action());
  });

  sync();
  return { sync, stepToward };
}

/** The small label that floats over whatever is being changed and names the attribute it writes. */
/** Where the label sits from its point: centred above it, to its left, or starting on it. */
export type ReadoutSide = "above" | "left" | "on";

export interface Readout {
  show(text: string, x: number, y: number, side?: ReadoutSide): void;
  /** Over the top centre of `target`. */
  over(text: string, target: Element): void;
  hide(): void;
}

export function createReadout(el: HTMLElement): Readout {
  const readout: Readout = {
    show(text, x, y, side = "above") {
      el.textContent = text;
      el.dataset.side = side;
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      el.classList.add("is-on");
    },
    over(text, target) {
      const box = target.getBoundingClientRect();
      readout.show(text, box.left + box.width / 2, box.top);
    },
    hide() {
      el.classList.remove("is-on");
    },
  };
  return readout;
}
