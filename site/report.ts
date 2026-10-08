// The weather report: a clock and a sentence whose italic words are the sky's params, and a ruler of the day.
import type { SkyeAttribute } from "../src/element/attributes.ts";
import { SCENE_NAMES, type ResolvedParams } from "../src/index.ts";
import { $ } from "./dom.ts";
import { PLACE_LATITUDES } from "./places.ts";
import { scrubbable, type Readout, type ScrubSpec } from "./scrub.ts";
import { coverRange, daylight, intensityRange, moonPath, shown, sunAt } from "./sky.ts";
import { attributesOf, type Store } from "./state.ts";
import * as say from "./words.ts";

/** The params the sentence carries as numbers, one italic word each. */
type Worded = "dayOfYear" | "latitude" | "cover" | "intensity" | "moonPhase";

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

const SLIDER_LABEL: Readonly<Record<Worded, string>> = {
  dayOfYear: "Date",
  latitude: "Latitude",
  cover: "Cloud cover",
  intensity: "Intensity",
  moonPhase: "Moon phase",
};

export interface ReportOptions {
  store: Store;
  readout: Readout;
  /** A drag on a value started or ended. */
  onScrub: (key: Changeable, active: boolean) => void;
}

export interface Report {
  render(p: ResolvedParams): void;
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function createReport({ store, readout, onScrub }: ReportOptions): Report {
  const clock = $("#clock");
  const prose = $("#prose");
  const ruler = $("#ruler");
  const mark = $(".ruler-mark", ruler);
  const menu = $("#scene-menu");
  const moon = $(".moon path", prose, SVGPathElement);

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

  const scrubbing = (key: Changeable, active: boolean): void => {
    onScrub(key, active);
    if (!active) unname();
  };

  // ------------------------------------------------------------------- the sentence

  const token = (key: Changeable): HTMLElement => $(`[data-key="${key}"]`, prose);

  type Spec = Omit<ScrubSpec, "get" | "set" | "onActive">;

  function bind(key: Worded, spec: Spec): void {
    const el = token(key);
    el.tabIndex = 0;
    el.setAttribute("role", "slider");
    el.setAttribute("aria-label", SLIDER_LABEL[key]);
    scrubbable(el, {
      get: () => shown(store.get())[key],
      set: (v) => store.set({ [key]: v }),
      ...spec,
      onActive: (active) => scrubbing(key, active),
    });
    labelled(el, key);
  }

  const sceneToken = token("scene");
  sceneToken.tabIndex = 0;
  sceneToken.setAttribute("role", "button");
  sceneToken.setAttribute("aria-haspopup", "menu");
  scrubbable(sceneToken, {
    // Dragging starts half way into the current scene, so either direction changes it after half a step.
    get: () => SCENE_NAMES.indexOf(store.get().scene) + 0.5,
    set: (v) => store.set({ scene: SCENE_NAMES[Math.floor(v)] ?? "cloudy" }),
    range: () => [0, SCENE_NAMES.length],
    perPixel: 1 / 40,
    step: 1,
    bigStep: 1,
    wrap: true,
    onTap: () => openMenu(),
    onActive: (active) => scrubbing("scene", active),
  });
  labelled(sceneToken, "scene");

  bind("dayOfYear", { range: () => [1, 366], perPixel: 0.5, step: 1, bigStep: 7, wrap: true });
  bind("latitude", {
    range: () => [-66, 66],
    perPixel: 0.25,
    step: 1,
    stops: () => PLACE_LATITUDES,
  });
  bind("cover", {
    range: () => {
      const p = shown(store.get());
      return coverRange(p.scene, p.intensity);
    },
    perPixel: 0.004,
    step: 0.05,
    bigStep: 0.2,
  });
  bind("intensity", {
    range: () => intensityRange(store.get().scene),
    perPixel: 0.004,
    step: 0.05,
    bigStep: 0.2,
  });
  bind("moonPhase", {
    range: () => [0, 1],
    perPixel: 0.002,
    step: 1 / 30,
    bigStep: 1 / 8,
    wrap: true,
  });

  // ---------------------------------------------------------------------- the clock

  scrubbable(clock, {
    get: () => store.get().hour,
    set: (hour) => store.set({ hour }),
    range: () => [0, 24],
    perPixel: 0.025,
    step: 1 / 6,
    bigStep: 1,
    wrap: true,
    onActive: (active) => scrubbing("hour", active),
  });
  labelled(clock, "hour");

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
    scrubbing("hour", true);
    store.set({ hour: hourAt(down.clientX) });
    name("hour", mark);
    const gesture = new AbortController();
    const { signal } = gesture;
    const end = (): void => {
      gesture.abort();
      delete ruler.dataset.active;
      scrubbing("hour", false);
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

  // ----------------------------------------------------------------- the scene menu

  const items = SCENE_NAMES.map((scene, i) => {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitemradio");
    item.dataset.scene = scene;
    const word = document.createElement("span");
    word.textContent = say.SCENE_ADJECTIVE[scene];
    const key = document.createElement("kbd");
    key.textContent = String(i + 1);
    item.append(word, key);
    item.addEventListener("click", () => {
      store.set({ scene });
      menu.hidePopover();
    });
    return item;
  });
  menu.append(...items);

  menu.addEventListener("keydown", (e) => {
    const at = items.findIndex((item) => item === document.activeElement);
    const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (move !== 0) {
      e.preventDefault();
      items[(at + move + items.length) % items.length]?.focus();
    }
  });

  menu.addEventListener("toggle", (e) => {
    if (e.newState === "closed" && menu.contains(document.activeElement)) {
      sceneToken.focus({ preventScroll: true });
    }
  });

  function openMenu(): void {
    unname();
    menu.showPopover();
    const anchor = sceneToken.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(Math.max(8, anchor.left - 14), innerWidth - box.width - 8)}px`;
    menu.style.top = `${Math.max(8, anchor.top - box.height - 12)}px`;
    items[SCENE_NAMES.indexOf(store.get().scene)]?.focus();
  }

  // ------------------------------------------------------------------------- render

  const daypart = $('[data-text="daypart"]', prose);
  const clause = $('[data-clause="intensity"]', prose);
  const lead = $('[data-text="lead"]', prose);
  const light = $(".ruler-light", ruler);
  const rise = $('[data-sun="rise"]', ruler);
  const set = $('[data-sun="set"]', ruler);
  const polar = $('[data-sun="polar"]', ruler);
  let day = "";

  function renderToken(key: Worded, text: string, value: number, valueText: string = text): void {
    const el = token(key);
    setText(el, text);
    el.setAttribute("aria-valuenow", value.toFixed(2));
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

    const adjective = say.SCENE_ADJECTIVE[p.scene];
    setText(sceneToken, adjective);
    sceneToken.setAttribute("aria-label", `Weather: ${adjective}`);
    setText(daypart, say.daypart(sun.elevationDeg, say.fromNoon(p.hour, p.solarNoon), sun.polar));
    renderToken("dayOfYear", say.formatDay(p.dayOfYear), p.dayOfYear);
    renderToken("latitude", say.formatLatitude(p.latitude), p.latitude);
    renderToken("cover", say.formatPercent(p.cover), p.cover);
    renderToken("moonPhase", say.moonName(p.moonPhase), p.moonPhase);

    const intensity = say.INTENSITY[p.scene];
    clause.hidden = intensity === undefined;
    if (intensity !== undefined) {
      const [lo, hi] = intensityRange(p.scene);
      setText(lead, intensity.lead);
      const word = say.pick(intensity.words, (p.intensity - lo) / (hi - lo));
      renderToken("intensity", word, p.intensity, `${word}, ${say.formatPercent(p.intensity)}`);
    }

    // The moon as seen from the north; the south sees it mirrored.
    moon.setAttribute("d", say.moonName(p.moonPhase) === "new" ? "" : moonPath(p.moonPhase));
    moon.setAttribute("transform", p.latitude < 0 ? "scale(-1 1)" : "");

    for (const item of items)
      item.setAttribute("aria-checked", String(item.dataset.scene === p.scene));

    renderRuler(p);
    if (named !== null) name(named.key, named.el);
  }

  return { render };
}
