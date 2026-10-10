// The weather report: a clock and a sentence whose italic words are the sky's params, and a ruler of the day.
import type { SkyeAttribute } from "../src/element/attributes.ts";
import { SCENE_NAMES, type ResolvedParams } from "../src/index.ts";
import { $ } from "./dom.ts";
import { PLACE_LATITUDES, placeAt } from "./places.ts";
import { scrubbable, type Readout, type ScrubSpec, type Scrubber } from "./scrub.ts";
import type { Direction } from "./step.ts";
import { coverRange, daylight, intensityRange, moonPath, shown, sunAt } from "./sky.ts";
import { attributesOf, type Store } from "./state.ts";
import * as say from "./words.ts";

/** The params the sentence carries as numbers, one italic word each. */
type Worded = "dayOfYear" | "latitude" | "cover" | "intensity" | "moonPhase";

/** The day of the year of the 21st of each month, in a common year: near each solstice and equinox. */
const MONTH_21STS: readonly number[] = Array.from({ length: 12 }, (_, month) => {
  const start = Date.UTC(2025, 0, 1);
  return Math.round((Date.UTC(2025, month, 21) - start) / 86_400_000) + 1;
});

/** Every value the report lets you change. */
export type Changeable = Worded | "scene" | "hour";

/** The attribute that carries each value. */
const ATTRIBUTE: Readonly<Record<Changeable, SkyeAttribute>> = {
  scene: "scene",
  hour: "hour",
  dayOfYear: "day-of-year",
  latitude: "latitude",
  cover: "cover",
  intensity: "intensity",
  moonPhase: "moon-phase",
};

/** What assistive technology calls each value in the sentence. */
const LABEL: Readonly<Record<Exclude<Changeable, "hour">, string>> = {
  scene: "Weather",
  dayOfYear: "Date",
  latitude: "Latitude",
  cover: "Cloud cover",
  intensity: "Intensity",
  moonPhase: "Moon phase",
};

export interface ReportOptions {
  store: Store;
  readout: Readout;
  /** The person changed a value: a click, a key, or the start of a drag. */
  onChange: (key: Changeable) => void;
}

export interface Report {
  render(p: ResolvedParams): void;
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function createReport({ store, readout, onChange }: ReportOptions): Report {
  const clock = $("#clock");
  const prose = $("#prose");
  const ruler = $("#ruler");
  const mark = $(".ruler-mark", ruler);
  const moon = $(".moon path", prose, SVGPathElement);
  const nudges = $("#nudges");
  const report = $(".report");

  // ------------------------------------------------- the attribute behind each value

  let named: { key: Changeable; el: Element } | null = null;

  /** Floats `attribute="value"` over `el` until `unname`; it follows the value as it changes. */
  function name(key: Changeable, el: Element): void {
    named = { key, el };
    const attribute = ATTRIBUTE[key];
    readout.over(`${attribute}="${attributesOf(shown(store.get()))[attribute] ?? ""}"`, el);
  }

  function unname(): void {
    named = null;
    readout.hide();
  }

  /** Shows `key`'s attribute while `el` is hovered, focused or dragged. */
  function labelled(el: HTMLElement, key: Changeable, over: Element = el): void {
    const show = (): void => name(key, over);
    const hide = (): void => {
      if (el.dataset.active === undefined) unname();
    };
    el.addEventListener("pointerenter", show);
    el.addEventListener("focus", show);
    el.addEventListener("pointerleave", hide);
    el.addEventListener("blur", hide);
  }

  // ------------------------------------------------------------------- the sentence

  const token = (key: Changeable): HTMLElement => $(`[data-key="${key}"]`, prose);
  const scrubbers: Scrubber[] = [];

  type Spec = Omit<ScrubSpec, "onChange" | "onActive">;

  /** Makes `el` the value `key`: click to step, drag to scrub, and labelled with its attribute. */
  function bind(el: HTMLElement, key: Changeable, spec: Spec): Scrubber {
    const scrubber = scrubbable(el, {
      ...spec,
      onChange: () => onChange(key),
      // The label stays up through a drag and goes when it ends.
      onActive: (active) => {
        if (!active) unname();
      },
    });
    scrubbers.push(scrubber);
    labelled(el, key);
    return scrubber;
  }

  // ------------------------------------------------------ the arrows beside a value

  /** The values in the sentence, which show arrows. */
  const values = new Map<HTMLElement, { key: Changeable; scrubber: Scrubber; tail?: Element }>();
  const arrows = [...nudges.querySelectorAll("[data-way]")].filter(
    (el) => el instanceof HTMLElement,
  );
  /** The value whose arrows show, or showed last while they fade. */
  let reached: HTMLElement | null = null;
  let reachedNow = false;
  let overArrows = false;
  /** The value a mouse or pen is over; tracked from events, as :hover can lag them. */
  let hovering: HTMLElement | null = null;
  /** Takes the mask off a sentence whose fades have gone out. */
  let unmask: ReturnType<typeof setTimeout> | undefined;
  /** A little longer than the fades take to go out. */
  const UNMASK_MS = 250;

  function dropMask(): void {
    clearTimeout(unmask);
    unmask = undefined;
    if (!reachedNow) delete prose.dataset.mask;
  }

  prose.addEventListener("transitionend", (e) => {
    if (e.target === prose && e.propertyName.startsWith("--erase")) dropMask();
  });

  // The sentence reflows when the window or the Tune pane changes its width; the arrows and fades follow the value.
  new ResizeObserver(() => {
    if (reachedNow) reach();
  }).observe(prose);

  const flag = (el: HTMLElement, attr: string, on: boolean): void => {
    if (on) el.dataset[attr] = "";
    else delete el.dataset[attr];
  };

  /** The value whose arrows show: the one dragged, else hovered, else just touched, else focused by keyboard. */
  function inReach(): { el: HTMLElement; touch: boolean } | null {
    const all = [...values.keys()];
    const dragged = all.find((el) => el.dataset.active !== undefined);
    if (dragged !== undefined) return { el: dragged, touch: false };
    // A pointer gone from a value onto one of its arrows keeps the value in reach, so the arrow stays to be clicked.
    const hovered = hovering ?? (overArrows && reachedNow ? reached : null);
    if (hovered !== null) return { el: hovered, touch: false };
    const touched = all.find((el) => el.dataset.shown !== undefined);
    if (touched !== undefined) return { el: touched, touch: true };
    // Focus left by a click is no reason to keep the arrows once the pointer goes; focus from the keyboard is.
    if (document.documentElement.dataset.input === "pointer") return null;
    const focused = all.find((el) => el.matches(":focus-visible"));
    return focused === undefined ? null : { el: focused, touch: false };
  }

  /**
   * Lays the arrows beside the value in reach and fades the words they stand
   * over. With none in reach they fade out where they stood.
   */
  function reach(): void {
    const next = inReach();
    if (reached !== null && reached !== next?.el) delete reached.dataset.reach;
    reachedNow = next !== null;
    flag(prose, "reach", reachedNow);
    flag(nudges, "reach", reachedNow);
    flag(nudges, "touch", next?.touch === true);
    if (next === null) {
      // The mask stays until the fades have gone out; the transition's end takes it off, or this, should none run.
      if (prose.dataset.mask !== undefined && unmask === undefined)
        unmask = setTimeout(dropMask, UNMASK_MS);
      return;
    }
    clearTimeout(unmask);
    unmask = undefined;
    prose.dataset.mask = "";
    reached = next.el;
    reached.dataset.reach = "";

    const at = reached.getBoundingClientRect();
    // A value's own icon, the moon beside its phase, belongs to it: the fade starts past the icon, not on it.
    const tail = values.get(reached)?.tail?.getBoundingClientRect();
    const right =
      tail !== undefined && tail.top < at.bottom && tail.bottom > at.top
        ? Math.max(at.right, tail.right)
        : at.right;
    const sentence = prose.getBoundingClientRect();
    const box = report.getBoundingClientRect();
    const px = (v: number): string => `${Math.round(v * 10) / 10}px`;
    prose.style.setProperty("--at-l", px(at.left - sentence.left));
    prose.style.setProperty("--at-r", px(right - sentence.left));
    prose.style.setProperty("--at-t", px(at.top - sentence.top));
    prose.style.setProperty("--at-h", px(at.height));
    nudges.style.setProperty("--l", px(at.left - box.left));
    nudges.style.setProperty("--r", px(right - box.left));
    nudges.style.setProperty("--y", px(at.top + at.height / 2 - box.top));
    nudges.style.setProperty("--vl", px(-box.left));
    nudges.style.setProperty("--vr", px(innerWidth - box.left));
    for (const el of [prose, nudges]) {
      const end = reached.dataset.end;
      if (end === undefined) delete el.dataset.end;
      else el.dataset.end = end;
    }
    nudges.dataset.heading = reached.dataset.heading ?? "up";
  }

  /** Whether a pointer event's other end is one of the arrows. */
  const toArrow = (e: PointerEvent): boolean =>
    e.relatedTarget instanceof Node && nudges.contains(e.relatedTarget);

  for (const arrow of arrows) {
    const way: Direction = arrow.dataset.way === "back" ? -1 : 1;
    arrow.addEventListener("pointerenter", () => {
      overArrows = true;
      reach();
      if (reached !== null) {
        const entry = values.get(reached);
        if (entry !== undefined) name(entry.key, reached);
      }
    });
    // Leaving an arrow for anything but the other arrow or its value hides them at once.
    arrow.addEventListener("pointerleave", (e) => {
      overArrows = toArrow(e);
      if (!overArrows) unname();
      reach();
    });
    arrow.addEventListener("click", () => {
      if (reached !== null) values.get(reached)?.scrubber.stepToward(way);
    });
  }

  // Dragging, and the arrows that linger after a touch, show as attributes the scrubber sets.
  const watch = new MutationObserver(reach);

  /** A value in the sentence: focusable, a spin button to assistive technology, with arrows when in reach. */
  function word(key: Exclude<Changeable, "hour">, spec: Spec, tail?: Element): void {
    const el = token(key);
    el.tabIndex = 0;
    el.setAttribute("role", "spinbutton");
    el.setAttribute("aria-label", LABEL[key]);
    values.set(el, { key, scrubber: bind(el, key, spec), ...(tail === undefined ? {} : { tail }) });
    el.addEventListener("pointerenter", (e) => {
      // A touch has no hover: its arrows linger after it instead.
      if (e.pointerType === "touch") return;
      hovering = el;
      reach();
    });
    // Leaving a value hides its arrows at once, unless the pointer went onto one of them, whose hit areas reach the
    // value's edge.
    el.addEventListener("pointerleave", (e) => {
      if (hovering === el) hovering = null;
      overArrows = toArrow(e);
      reach();
    });
    el.addEventListener("focus", reach);
    el.addEventListener("blur", reach);
    watch.observe(el, { attributeFilter: ["data-active", "data-shown"] });
  }

  /** A worded param read and written as is. */
  const param = (key: Worded): Pick<ScrubSpec, "get" | "set"> => ({
    get: () => shown(store.get())[key],
    set: (v) => store.set({ [key]: v }),
  });

  // The scenes in order; a click walks them to the last and back.
  word("scene", {
    get: () => SCENE_NAMES.indexOf(store.get().scene),
    set: (v) => store.set({ scene: SCENE_NAMES[Math.round(v)] ?? "cloudy" }),
    steps: () => ({ range: [0, SCENE_NAMES.length - 1], step: 1 }),
    perPixel: 1 / 36,
    fine: 1,
    discrete: true,
  });
  // A click goes on to the 21st of the next month, so four clicks span a season; the year comes round.
  word("dayOfYear", {
    ...param("dayOfYear"),
    // Cyclic, not ping-pong: the year has no last day to turn round at.
    steps: () => ({ range: [1, 366], step: 1, stops: MONTH_21STS, cyclic: true }),
    perPixel: 0.5,
    fine: 1,
    hold: 0,
  });
  // A click travels to the next place north, or south on the way back.
  word("latitude", {
    ...param("latitude"),
    steps: () => ({ range: [-66, 66], step: 1, stops: PLACE_LATITUDES }),
    perPixel: 0.25,
    fine: 1,
  });
  word("cover", {
    ...param("cover"),
    steps: () => {
      const p = shown(store.get());
      return { range: coverRange(p.scene, p.intensity), step: 0.1, origin: 0 };
    },
    perPixel: 0.004,
    fine: 0.01,
  });
  // One notch per word, so every click changes what the sentence says.
  word("intensity", {
    ...param("intensity"),
    steps: () => {
      const scene = store.get().scene;
      const [lo, hi] = intensityRange(scene);
      const words = say.INTENSITY[scene]?.words.length ?? 5;
      return { range: [lo, hi], step: (hi - lo) / (words - 1), snap: true };
    },
    perPixel: 0.004,
    fine: 0.01,
  });
  // A click goes on to the next of the eight named phases; the month comes round.
  word(
    "moonPhase",
    {
      ...param("moonPhase"),
      // Cyclic, not ping-pong: the moon's month has no last phase to turn round at.
      steps: () => ({ range: [0, 1], step: 1 / 8, cyclic: true, snap: true }),
      perPixel: 0.002,
      fine: 1 / 30,
    },
    $(".moon", prose, SVGSVGElement),
  );

  // ---------------------------------------------------------------------- the clock

  // A click goes on to the next whole hour, always forward, since the clock shows no arrows to say which way; the
  // ruler below is its keyboard control.
  bind(clock, "hour", {
    get: () => store.get().hour,
    set: (hour) => store.set({ hour }),
    // Cyclic, not ping-pong: the day has no last hour to turn round at.
    steps: () => ({ range: [0, 24], step: 1, cyclic: true }),
    perPixel: 0.025,
    fine: 1 / 6,
    steady: true,
  });

  // ---------------------------------------------------------------------- the ruler

  const hourAt = (clientX: number): number => {
    const box = ruler.getBoundingClientRect();
    return Math.min(23.99, Math.max(0, ((clientX - box.left) / box.width) * 24));
  };

  ruler.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    ruler.focus({ preventScroll: true });
    ruler.setPointerCapture(down.pointerId);
    ruler.dataset.active = "";
    onChange("hour");
    store.set({ hour: hourAt(down.clientX) });
    name("hour", mark);
    const gesture = new AbortController();
    const { signal } = gesture;
    const end = (): void => {
      gesture.abort();
      delete ruler.dataset.active;
      unname();
    };
    ruler.addEventListener("pointermove", (e) => store.set({ hour: hourAt(e.clientX) }), {
      signal,
    });
    ruler.addEventListener("pointerup", end, { signal });
    ruler.addEventListener("pointercancel", end, { signal });
  });
  labelled(ruler, "hour", mark);

  ruler.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 1 : 1 / 6;
    const delta: Record<string, number | undefined> = {
      ArrowRight: step,
      ArrowUp: step,
      ArrowLeft: -step,
      ArrowDown: -step,
      PageUp: 1,
      PageDown: -1,
    };
    const by = delta[e.key];
    if (by !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      store.set({ hour: store.get().hour + by });
    }
  });

  // ------------------------------------------------------------------------- render

  const daypart = $('[data-text="daypart"]', prose);
  const clause = $('[data-clause="intensity"]', prose);
  const lead = $('[data-text="lead"]', prose);
  const light = $(".ruler-light", ruler);
  const rise = $('[data-sun="rise"]', ruler);
  const set = $('[data-sun="set"]', ruler);
  const polar = $('[data-sun="polar"]', ruler);
  let day = "";

  function renderToken(key: Exclude<Changeable, "hour">, text: string, valueText = text): void {
    const el = token(key);
    setText(el, text);
    if (el.getAttribute("aria-valuetext") !== valueText)
      el.setAttribute("aria-valuetext", valueText);
  }

  function renderRuler(p: ResolvedParams): void {
    ruler.style.setProperty("--at", String(p.hour / 24));
    ruler.setAttribute("aria-valuenow", p.hour.toFixed(2));
    ruler.setAttribute("aria-valuetext", say.formatTime(p.hour));

    // The day's light only changes with the place and the date.
    const key = `${p.latitude}|${p.dayOfYear}|${p.solarNoon}`;
    if (key === day) return;
    day = key;
    const steps = 48;
    const stops = daylight(p, steps).map(
      (v, i) =>
        `color-mix(in srgb, var(--ink) ${Math.round(10 + 55 * v)}%, transparent) ${((i / steps) * 100).toFixed(2)}%`,
    );
    light.style.background = `linear-gradient(to right, ${stops.join(", ")})`;

    const sun = sunAt(p);
    const at = (hour: number): string =>
      String(Math.min(0.96, Math.max(0.04, ((hour + 24) % 24) / 24)));
    const normal = sun.polar === null;
    setText(rise, normal ? `↑ ${say.formatTime(sun.sunrise)}` : "");
    setText(set, normal ? `↓ ${say.formatTime(sun.sunset)}` : "");
    const polarText = { day: "the sun does not set", night: "the sun does not rise" } as const;
    setText(polar, sun.polar === null ? "" : polarText[sun.polar]);
    rise.style.setProperty("--x", at(sun.sunrise));
    set.style.setProperty("--x", at(sun.sunset));
  }

  function render(raw: ResolvedParams): void {
    const p = shown(raw);
    const sun = sunAt(p);

    setText(clock, say.formatTime(p.hour));

    renderToken("scene", say.SCENE_ADJECTIVE[p.scene]);
    setText(daypart, say.daypart(sun.elevationDeg, say.fromNoon(p.hour, p.solarNoon), sun.polar));
    renderToken("dayOfYear", say.formatDay(p.dayOfYear));
    const place = placeAt(p.latitude);
    const latitude = say.formatLatitude(p.latitude);
    renderToken("latitude", latitude, place === "" ? latitude : `${latitude}, ${place}`);
    renderToken("cover", say.formatPercent(p.cover));
    renderToken("moonPhase", say.moonName(p.moonPhase));

    const intensity = say.INTENSITY[p.scene];
    clause.hidden = intensity === undefined;
    if (intensity !== undefined) {
      const [lo, hi] = intensityRange(p.scene);
      setText(lead, intensity.lead);
      const strength = say.pick(intensity.words, (p.intensity - lo) / (hi - lo));
      renderToken("intensity", strength, `${strength}, ${say.formatPercent(p.intensity)}`);
    }

    // The moon as seen from the north; the south sees it mirrored.
    moon.setAttribute("d", say.moonName(p.moonPhase) === "new" ? "" : moonPath(p.moonPhase));
    moon.setAttribute("transform", p.latitude < 0 ? "scale(-1 1)" : "");

    for (const scrubber of scrubbers) scrubber.sync();
    // A value's width changes with what it says, and the arrows and fades follow its edges.
    if (reachedNow) reach();
    renderRuler(p);
    if (named !== null) name(named.key, named.el);
  }

  return { render };
}
