// Puts the page together: one store of params drives the sky, the sentence, the snippet and the panel.
import { dayOfYear, moonPhase } from "../src/astro/index.ts";
import { PARAM_ATTRIBUTES } from "../src/element/attributes.ts";
import { defineSkye } from "../src/element/define.ts";
import {
  DEFAULTS,
  resolveParams,
  SCENE_NAMES,
  type ResolvedParams,
  type SkyeParams,
} from "../src/index.ts";
import { $, copy } from "./dom.ts";
import { placeAt } from "./places.ts";
import { POSTCARDS, STORY } from "./postcards.ts";
import { createReport } from "./report.ts";
import { createReadout } from "./scrub.ts";
import { clamp, coverRange, luminance, shown } from "./sky.ts";
import { createSnippet } from "./snippet.ts";
import { attributesOf, createStore, hashOf, paramsFromHash } from "./state.ts";
import { createTune } from "./tune.ts";

/** A day passes in 40 seconds. */
const HOURS_PER_SECOND = 0.6;
/** Below this the sky reads as dark and the type turns light; above the next, dark again. */
const LIGHT_INK_BELOW = 0.15;
const DARK_INK_ABOVE = 0.2;

const root = document.documentElement;
const sky = $("#sky", document, defineSkye());
const stage = $("#stage");
const placeName = $('[data-text="place"]');
const hint = $("#hint");
const playButton = $("#play", document, HTMLButtonElement);
const themeColor = $('meta[name="theme-color"]', document, HTMLMetaElement);

// ------------------------------------------------------------------------------ state

const linked = paramsFromHash(location.hash);
/** The postcard on screen, if the sky came from one. */
let card: SkyeParams | null = Object.keys(linked).length === 0 ? (POSTCARDS[0] ?? null) : null;
const store = createStore(resolveParams({ ...DEFAULTS, ...STORY, ...card, ...linked }));

/** Following the clock, after "Now". */
let live = false;
/** The latitude and solar noon came from the person's position. */
let located = false;
/** No WebGL2: skye shows its gradient. */
let unsupported = false;

// ------------------------------------------------------------------------------ views

const readout = createReadout($("#readout"));
const report = createReport({
  store,
  readout,
  onScrub: (key, active) => {
    if (!active) return;
    dismissHint();
    if (key === "hour") play(false);
  },
});
const snippet = createSnippet(() => store.get());
const tune = createTune({ store, stats: () => sky.stats() });

let frame = 0;
let ink = luminance(shown(store.get())) < (LIGHT_INK_BELOW + DARK_INK_ABOVE) / 2 ? "light" : "dark";
let hashTimer: ReturnType<typeof setTimeout> | undefined;

// The address keeps the sky, so a reload or a shared link brings it back. Written once things settle.
const writeHash = (): void => {
  const { pathname, search } = location;
  history.replaceState(null, "", `${pathname}${search}${hashOf(shown(store.get()))}`);
};

store.subscribe((_, source) => {
  if (source !== "live") live = false;
  if (frame === 0) frame = requestAnimationFrame(render);
  clearTimeout(hashTimer);
  hashTimer = setTimeout(writeHash, 250);
});

/**
 * skye's fallback gradient takes its day colours between 6.5 h and 19.5 h and
 * its night colours otherwise; only the storm's stay dark by day.
 */
function fallbackLuminance(p: ResolvedParams): number {
  return p.hour > 6.5 && p.hour < 19.5 && p.scene !== "storm" ? 0.5 : 0.05;
}

/** The place at this latitude, or "here" for the viewer's own. */
function place(p: ResolvedParams): string {
  return live && located ? "here" : placeAt(p.latitude);
}

function render(): void {
  frame = 0;
  const p = shown(store.get());

  // The element takes every param as an attribute and eases toward each change.
  const attributes = attributesOf(p);
  for (const name of PARAM_ATTRIBUTES) {
    const value = attributes[name];
    if (value === undefined) sky.removeAttribute(name);
    else if (sky.getAttribute(name) !== value) sky.setAttribute(name, value);
  }

  report.render(p);
  snippet.render(p);
  tune.render(p);

  const y = unsupported ? fallbackLuminance(p) : luminance(p);
  const next = y < LIGHT_INK_BELOW ? "light" : y > DARK_INK_ABOVE ? "dark" : ink;
  if (next !== root.dataset.ink) {
    ink = next;
    root.dataset.ink = ink;
    themeColor.content = ink === "light" ? "#0a1020" : "#c9d4e4";
  }

  // The place a latitude belongs to, in brackets after it; a no-break space keeps the two on one line.
  const name = place(p);
  const bracketed = name === "" ? "" : ` (${name})`;
  if (placeName.textContent !== bracketed) placeName.textContent = bracketed;
}

// ---------------------------------------------------------------------- the day passing

let playing = 0;

function play(on: boolean): void {
  cancelAnimationFrame(playing);
  playing = 0;
  playButton.setAttribute("aria-pressed", String(on));
  playButton.textContent = on ? "Pause" : "Play";
  if (!on) return;
  let last = performance.now();
  const tick = (time: number): void => {
    const dt = Math.min(0.1, (time - last) / 1000);
    last = time;
    store.set({ hour: store.get().hour + dt * HOURS_PER_SECOND }, "play");
    playing = requestAnimationFrame(tick);
  };
  playing = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------- postcards

let deck: SkyeParams[] = [];

/** The next postcard from a shuffled deck, never the one on screen. */
function shuffle(): void {
  if (deck.length === 0) {
    deck = POSTCARDS.filter((c) => c !== card);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const [a, b] = [deck[i], deck[j]];
      if (a !== undefined && b !== undefined) [deck[i], deck[j]] = [b, a];
    }
  }
  const next = deck.pop();
  if (next === undefined) return;
  card = next;
  store.set({ ...STORY, ...next }, "postcard");
}

// ---------------------------------------------------------------------------------- now

/** Minutes the sun runs ahead of the clock over the year. */
function equationOfTime(day: number): number {
  const b = (2 * Math.PI * (day - 81)) / 364;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

function clockParams(date: Date): SkyeParams {
  return {
    hour: date.getHours() + date.getMinutes() / 60,
    dayOfYear: dayOfYear(date),
    moonPhase: moonPhase(date),
  };
}

let ticking: ReturnType<typeof setInterval> | undefined;

function now(): void {
  play(false);
  const date = new Date();
  store.set(clockParams(date), "live");
  live = true;
  located = false;
  if (frame === 0) frame = requestAnimationFrame(render);
  clearInterval(ticking);
  ticking = setInterval(() => {
    if (live) store.set(clockParams(new Date()), "live");
    else clearInterval(ticking);
  }, 15_000);

  // Latitude rounds to a degree and solar noon to six minutes: enough for the sky, too coarse to find anyone.
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      if (!live) return;
      const zone = -date.getTimezoneOffset() / 60;
      const noon = 12 + zone - coords.longitude / 15 - equationOfTime(dayOfYear(date)) / 60;
      located = true;
      store.set(
        { latitude: Math.round(coords.latitude), solarNoon: Math.round(noon * 10) / 10 },
        "live",
      );
    },
    () => {},
    { timeout: 10_000, maximumAge: 3_600_000 },
  );
}

// ----------------------------------------------------------------------- dragging the sky

// Remember whether the last input was a pointer or a key, so focus rings show only for the keyboard.
addEventListener("pointerdown", () => (root.dataset.input = "pointer"), { capture: true });
addEventListener("keydown", () => delete root.dataset.input, { capture: true });

function dismissHint(): void {
  if (!unsupported) hint.classList.add("is-gone");
}
setTimeout(dismissHint, 9000);
addEventListener("pointerdown", dismissHint, { once: true });

stage.addEventListener("pointerdown", (down) => {
  if (down.button !== 0) return;
  stage.setPointerCapture(down.pointerId);
  root.dataset.dragging = "";
  dismissHint();
  play(false);
  const start = shown(store.get());
  const gesture = new AbortController();
  const { signal } = gesture;

  stage.addEventListener(
    "pointermove",
    (move) => {
      const dx = move.clientX - down.clientX;
      const dy = move.clientY - down.clientY;
      // Sideways is time; up and down is cloud, after a little give so a sideways drag leaves the clouds alone.
      const lift = Math.sign(dy) * Math.max(0, Math.abs(dy) - 12);
      const p = shown(store.get());
      store.set({
        hour: start.hour + (dx / innerWidth) * 16,
        cover: clamp(start.cover - (lift / innerHeight) * 1.5, ...coverRange(p.scene, p.intensity)),
      });
      const a = attributesOf(shown(store.get()));
      readout.show(`hour="${a.hour}" cover="${a.cover}"`, move.clientX, move.clientY - 18);
    },
    { signal },
  );

  const end = (): void => {
    gesture.abort();
    delete root.dataset.dragging;
    readout.hide();
  };
  stage.addEventListener("pointerup", end, { signal });
  stage.addEventListener("pointercancel", end, { signal });
});

stage.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    dismissHint();
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    store.set({
      hour: store.get().hour + delta * (e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 0.06 : 0.004),
    });
  },
  { passive: false },
);

// -------------------------------------------------------------------------------- keys

document.addEventListener("keydown", (e) => {
  const target = e.target;
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  const p = shown(store.get());
  const hourStep = e.shiftKey ? 1 : 1 / 6;

  switch (e.key) {
    case " ":
      if (target instanceof HTMLButtonElement) return;
      play(playing === 0);
      break;
    case "ArrowRight":
    case "ArrowLeft":
      play(false);
      store.set({ hour: p.hour + (e.key === "ArrowRight" ? hourStep : -hourStep) });
      break;
    case "ArrowUp":
    case "ArrowDown":
      store.set({
        cover: clamp(
          p.cover + (e.key === "ArrowUp" ? 0.05 : -0.05),
          ...coverRange(p.scene, p.intensity),
        ),
      });
      break;
    case "s":
    case "S":
      shuffle();
      break;
    case "n":
    case "N":
      now();
      break;
    case "t":
    case "T":
      tune.show();
      break;
    case "Escape":
      if (!tune.open) return;
      tune.show(false);
      break;
    default: {
      const scene = SCENE_NAMES[Number(e.key) - 1];
      if (!/^[1-8]$/.test(e.key) || scene === undefined) return;
      store.set({ scene });
    }
  }
  dismissHint();
  e.preventDefault();
});

// ------------------------------------------------------------------------------ buttons

playButton.addEventListener("click", () => play(playing === 0));
$("#shuffle", document, HTMLButtonElement).addEventListener("click", shuffle);
$("#now", document, HTMLButtonElement).addEventListener("click", now);

for (const button of document.querySelectorAll("[data-copy]")) {
  if (!(button instanceof HTMLButtonElement)) continue;
  button.addEventListener("click", () => {
    void copy(button, button.dataset.copy ?? "", { done: button.dataset.copied });
  });
}

addEventListener("hashchange", () => {
  const params = paramsFromHash(location.hash);
  if (Object.keys(params).length === 0) return;
  card = null;
  store.set(params, "load");
});

sky.addEventListener("skye-fallback", () => {
  unsupported = true;
  const lines = ["WebGL2 is unavailable", "this is skye’s fallback gradient"].map((text) => {
    const line = document.createElement("span");
    line.textContent = text;
    return line;
  });
  hint.replaceChildren(...lines);
  hint.classList.remove("is-gone");
  tune.note("WebGL2 is unavailable in this browser.");
  render();
});
sky.addEventListener("skye-error", (e) => reportError(e.detail));

// ------------------------------------------------------------------------------- start

render();
// Show the type once its faces have loaded, so nothing reflows on the way in.
void Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1200))]).then(() =>
  root.classList.remove("is-booting"),
);
