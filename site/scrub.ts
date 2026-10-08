// Values you change by dragging sideways, as in a reactive document, or by arrow keys once focused.

export interface ScrubSpec {
  get(): number;
  set(value: number): void;
  range(): readonly [number, number];
  /** Value change per pixel dragged. */
  perPixel: number;
  /** Arrow-key step. */
  step: number;
  /** Shift + arrow, and the page keys, where there are no stops. Ten steps by default. */
  bigStep?: number;
  /** Wrap around the range instead of stopping at its ends. */
  wrap?: boolean;
  /**
   * Values, ascending and inside the range, that a drag holds on for `hold`
   * pixels before moving on; shift + arrow and the page keys jump between them.
   */
  stops?: () => readonly number[];
  /** Pixels of drag each stop holds for, 14 by default. */
  hold?: number;
  /** A press that does not drag. */
  onTap?: () => void;
  /** The drag started or ended. */
  onActive?: (active: boolean) => void;
}

const mod = (v: number, m: number): number => ((v % m) + m) % m;

interface Track {
  /** Where `value` sits on the track: mid-hold when it is a stop. */
  at(value: number): number;
  /** The value at track position `t`. */
  value(t: number): number;
}

/** Maps drag distance to value: each stop takes up `hold` pixels at one value, the stretches between move at `perPixel`. */
function stopTrack(lo: number, stops: readonly number[], perPixel: number, hold: number): Track {
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

/** Makes `el` scrubbable. Movements under a few pixels count as a tap. */
export function scrubbable(el: HTMLElement, spec: ScrubSpec): void {
  const bigStep = spec.bigStep ?? spec.step * 10;

  const apply = (value: number): void => {
    const [lo, hi] = spec.range();
    spec.set(
      spec.wrap === true ? lo + mod(value - lo, hi - lo) : Math.min(hi, Math.max(lo, value)),
    );
  };

  // A tap acts on click, after the pointer is up, so a popover it opens is not light-dismissed by that same press.
  let dragged = false;
  el.addEventListener("click", () => {
    if (!dragged) spec.onTap?.();
  });

  el.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    dragged = false;
    el.focus({ preventScroll: true });
    el.setPointerCapture(down.pointerId);
    const start = spec.get();
    const stops = spec.stops?.();
    const track =
      stops === undefined
        ? undefined
        : stopTrack(spec.range()[0], stops, spec.perPixel, spec.hold ?? 14);
    const origin = track?.at(start) ?? 0;
    let dragging = false;
    const gesture = new AbortController();
    const { signal } = gesture;

    el.addEventListener(
      "pointermove",
      (move) => {
        const dx = move.clientX - down.clientX;
        if (!dragging && Math.abs(dx) < 4) return;
        if (!dragging) {
          dragging = true;
          el.dataset.active = "";
          document.documentElement.dataset.scrubbing = "";
          spec.onActive?.(true);
        }
        apply(track === undefined ? start + dx * spec.perPixel : track.value(origin + dx));
      },
      { signal },
    );

    const end = (): void => {
      gesture.abort();
      delete el.dataset.active;
      delete document.documentElement.dataset.scrubbing;
      dragged = dragging;
      if (dragging) spec.onActive?.(false);
    };
    el.addEventListener("pointerup", end, { signal });
    el.addEventListener("pointercancel", end, { signal });
  });

  el.addEventListener("keydown", (e) => {
    const [lo, hi] = spec.range();
    const now = spec.get();
    const stops = spec.stops?.();
    // A big step goes on to the next stop that way, where there are stops.
    const leap = (dir: 1 | -1): number => {
      if (stops === undefined) return now + dir * bigStep;
      const stop = dir > 0 ? stops.find((s) => s > now) : stops.filter((s) => s < now).at(-1);
      return stop ?? (dir > 0 ? hi : lo);
    };
    // A small step lands on any stop it comes within half a step of.
    const nudge = (dir: 1 | -1): number => {
      const next = now + dir * spec.step;
      return stops?.find((s) => Math.abs(s - next) < spec.step / 2) ?? next;
    };
    const arrow = (dir: 1 | -1): number => (e.shiftKey ? leap(dir) : nudge(dir));
    const keys: Record<string, (() => number) | undefined> = {
      ArrowRight: () => arrow(1),
      ArrowUp: () => arrow(1),
      ArrowLeft: () => arrow(-1),
      ArrowDown: () => arrow(-1),
      PageUp: () => leap(1),
      PageDown: () => leap(-1),
      Home: () => lo,
      End: () => hi,
    };
    const next = keys[e.key];
    if (next !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      apply(next());
    } else if ((e.key === "Enter" || e.key === " ") && spec.onTap !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      spec.onTap();
    }
  });
}

/** The small label that floats over whatever is being changed and names the attribute it writes. */
export interface Readout {
  show(text: string, x: number, y: number): void;
  /** Over the top centre of `target`. */
  over(text: string, target: Element): void;
  hide(): void;
}

export function createReadout(el: HTMLElement): Readout {
  const readout: Readout = {
    show(text, x, y) {
      el.textContent = text;
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
