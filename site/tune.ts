// The Tune panel: the params a sentence would not carry well, as plain form controls.
import type { SkyeStats } from "../src/core/api.ts";
import { resolveMotion, resolveQuality } from "../src/core/params.ts";
import type { ResolvedParams } from "../src/index.ts";
import { $ } from "./dom.ts";
import { sceneWind } from "./sky.ts";
import type { Store } from "./state.ts";
import { formatTime } from "./words.ts";

/** The params the panel sets with a slider, and how each reads beside it. */
const FORMAT = {
  wind: (v: number) => v.toFixed(1),
  seed: (v: number) => v.toFixed(2),
  solarNoon: formatTime,
  focus: (v: number) => v.toFixed(2),
  exposure: (v: number) => v.toFixed(2),
  blur: (v: number) => `${v} px`,
} as const;

type Ranged = keyof typeof FORMAT;

const isRanged = (name: string): name is Ranged => Object.hasOwn(FORMAT, name);

interface Slider {
  key: Ranged;
  input: HTMLInputElement;
  output: HTMLOutputElement;
}

export interface TuneOptions {
  store: Store;
  stats: () => SkyeStats | null;
}

export interface Tune {
  /** Opens or closes the panel; toggles when `open` is omitted. */
  show(open?: boolean): void;
  readonly open: boolean;
  /** Shows `text` in place of the stats from now on. */
  note(text: string): void;
  render(p: ResolvedParams): void;
}

function describe(s: SkyeStats): string {
  const cost =
    s.gpuMs >= 0
      ? `${s.gpuMs.toFixed(1)} ms GPU`
      : s.cpuMs >= 0
        ? `${s.cpuMs.toFixed(1)} ms CPU`
        : "";
  const tier = s.auto ? `${s.quality} (auto)` : s.quality;
  return [`${s.fps} fps`, tier, cost, `${s.out[0]}×${s.out[1]}`].filter(Boolean).join(" · ");
}

export function createTune({ store, stats }: TuneOptions): Tune {
  const panel = $("#panel");
  const toggle = $("#tune", document, HTMLButtonElement);
  const statsOut = $("#stats", panel, HTMLOutputElement);
  const windAuto = $('[data-auto="wind"]', panel, HTMLButtonElement);
  const glass = $('input[name="glass"]', panel, HTMLInputElement);
  const sliders: Slider[] = [...panel.querySelectorAll('input[type="range"]')].map((input) => {
    if (!(input instanceof HTMLInputElement) || !isRanged(input.name)) {
      throw new Error(`unknown slider ${input.outerHTML}`);
    }
    const output = $(`output[data-for="${input.name}"]`, panel, HTMLOutputElement);
    return { key: input.name, input, output };
  });
  const radios = [...panel.querySelectorAll('input[type="radio"]')].filter(
    (el) => el instanceof HTMLInputElement,
  );
  let timer: ReturnType<typeof setInterval> | undefined;
  // Replaces the stats when there are none to show.
  let message = "";

  for (const { key, input } of sliders) {
    input.addEventListener("input", () => store.set({ [key]: Number(input.value) }));
  }
  glass.addEventListener("change", () => store.set({ glass: glass.checked }));
  for (const radio of radios) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      if (radio.name === "quality") store.set({ quality: resolveQuality(radio.value) });
      if (radio.name === "motion") store.set({ motion: resolveMotion(radio.value) });
    });
  }
  windAuto.addEventListener("click", () => {
    const p = store.get();
    store.set({ wind: p.wind === undefined ? Number(sceneWind(p).toFixed(1)) : undefined });
  });

  const readStats = (): void => {
    const s = stats();
    statsOut.value = message || (s === null ? "starting…" : describe(s));
  };

  function show(open: boolean): void {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    clearInterval(timer);
    if (open) {
      readStats();
      timer = setInterval(readStats, 500);
    }
  }

  const isOpen = (): boolean => !panel.hidden;

  const close = (): void => {
    show(false);
    toggle.focus();
  };

  toggle.addEventListener("click", () => show(!isOpen()));
  $("[data-close]", panel, HTMLButtonElement).addEventListener("click", close);
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  return {
    show: (open = !isOpen()) => show(open),
    get open() {
      return isOpen();
    },
    note(text) {
      message = text;
      readStats();
    },
    render(p) {
      for (const { key, input, output } of sliders) {
        const auto = key === "wind" && p.wind === undefined;
        const value = key === "wind" ? (p.wind ?? sceneWind(p)) : p[key];
        if (document.activeElement !== input) input.value = String(value);
        const min = Number(input.min);
        const max = Number(input.max);
        input.style.setProperty("--fill", `${((Number(input.value) - min) / (max - min)) * 100}%`);
        input.toggleAttribute("data-auto", auto);
        output.value = FORMAT[key](value);
      }
      windAuto.setAttribute("aria-pressed", String(p.wind === undefined));
      glass.checked = p.glass;
      for (const radio of radios) {
        radio.checked = (radio.name === "quality" ? p.quality : p.motion) === radio.value;
      }
    },
  };
}
