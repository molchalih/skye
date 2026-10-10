// The Tune panel: the params a sentence would not carry well, as plain form controls in three groups. It is a
// non-modal dialog that follows the gear in the tab order; opened from the keyboard it takes focus, and Escape
// closes it and hands focus back to the gear.
import type { SkyeStats } from "../src/core/api.ts";
import { SKYE_ATTRIBUTES, type SkyeAttribute } from "../src/element/attributes.ts";
import { resolveMotion, resolveQuality } from "../src/core/params.ts";
import type { ResolvedParams } from "../src/index.ts";
import { $ } from "./dom.ts";
import type { Readout } from "./scrub.ts";
import { sceneWind } from "./sky.ts";
import { attributesOf, type Store } from "./state.ts";
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

/** Room the sky needs left of the pane to name an attribute beside its row. */
const MARGIN_PX = 200;

export interface TuneOptions {
  store: Store;
  /** Names the attribute behind a row while it is hovered or focused, as the sentence does for its values. */
  readout: Readout;
  stats: () => SkyeStats | null;
}

export interface Tune {
  /**
   * Opens or closes the panel; toggles when `open` is omitted. `focus` moves
   * focus into the panel as it opens, for the keyboard.
   */
  show(open?: boolean, focus?: boolean): void;
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

export function createTune({ store, readout, stats }: TuneOptions): Tune {
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
  const needsGlass = $('[data-needs="glass"]', panel);
  const focusInput = $("input", needsGlass, HTMLInputElement);
  // Each segmented choice slides a pill under its checked option.
  const segments = [...panel.querySelectorAll(".seg")].filter((el) => el instanceof HTMLElement);
  const placed = new WeakMap<HTMLElement, string>();
  let timer: ReturnType<typeof setInterval> | undefined;
  /** Where focus was when the keyboard opened the panel, to go back to when it closes. */
  let opener: HTMLElement | null = null;
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

  /**
   * Moves each pill under its checked option. It measures, so it runs only when
   * a choice changes or the panel opens, never on every frame.
   */
  function placePills(force = false): void {
    if (panel.hidden) return;
    for (const seg of segments) {
      const checked = seg.querySelector("input:checked");
      const label = checked?.closest("label");
      if (!(checked instanceof HTMLInputElement) || !(label instanceof HTMLElement)) continue;
      if (!force && placed.get(seg) === checked.value) continue;
      placed.set(seg, checked.value);
      seg.style.setProperty("--x", `${label.offsetLeft}px`);
      seg.style.setProperty("--w", `${label.offsetWidth}px`);
      seg.dataset.placed = "";
    }
  }

  // ------------------------------------------------- the attribute behind each row

  let named: { attribute: SkyeAttribute; row: Element; label: Element } | null = null;

  /**
   * Names the attribute where it covers no control: out in the margin beside
   * its row when the sky has room to the pane's left, else on the row's own
   * label, which stands on a line of its own in a narrow pane.
   */
  function showName(p: ResolvedParams): void {
    if (named === null) return;
    const value = attributesOf(p)[named.attribute];
    // An unset attribute, such as wind left to the weather, is named bare.
    const text = value === undefined ? named.attribute : `${named.attribute}="${value}"`;
    const pane = panel.getBoundingClientRect();
    if (pane.left >= MARGIN_PX) {
      const row = named.row.getBoundingClientRect();
      readout.show(text, pane.left, row.top + row.height / 2, "left");
    } else {
      const label = named.label.getBoundingClientRect();
      readout.show(text, label.left, label.top + label.height / 2, "on");
    }
  }

  function unname(): void {
    if (named === null) return;
    named = null;
    readout.hide();
  }

  for (const row of panel.querySelectorAll("[data-attribute]")) {
    const attribute = SKYE_ATTRIBUTES.find((name) => name === row.getAttribute("data-attribute"));
    if (!(row instanceof HTMLElement) || attribute === undefined) continue;
    const label = row.querySelector("label, .legend") ?? row;
    const name = (): void => {
      named = { attribute, row, label };
      showName(store.get());
    };
    row.addEventListener("pointerenter", name);
    row.addEventListener("focusin", name);
    row.addEventListener("pointerleave", () => {
      if (!row.contains(document.activeElement)) unname();
    });
    row.addEventListener("focusout", (e) => {
      if (
        !(e.relatedTarget instanceof Node && row.contains(e.relatedTarget)) &&
        !row.matches(":hover")
      )
        unname();
    });
  }

  function show(open: boolean, focus = false): void {
    if (open && focus) {
      const active = document.activeElement;
      opener = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    // Focus inside a panel about to hide goes back where it came from: the value it was opened from, or the gear.
    if (!open && panel.contains(document.activeElement)) {
      (opener?.isConnected === true ? opener : toggle).focus({ preventScroll: true });
    }
    if (!open) {
      opener = null;
      unname();
    }
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    clearInterval(timer);
    if (open) {
      readStats();
      timer = setInterval(readStats, 500);
      placePills(true);
      if (focus) panel.focus({ preventScroll: true });
    }
  }

  const isOpen = (): boolean => !panel.hidden;

  // A click from the keyboard has no pointer behind it (detail 0), and takes focus into the panel.
  toggle.addEventListener("click", (e) => show(!isOpen(), e.detail === 0));
  $("[data-close]", panel, HTMLButtonElement).addEventListener("click", () => show(false));
  panel.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    show(false);
  });

  return {
    show: (open = !isOpen(), focus = false) => show(open, focus),
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
      needsGlass.toggleAttribute("data-off", !p.glass);
      focusInput.setAttribute("aria-disabled", String(!p.glass));
      placePills();
      showName(p);
    },
  };
}
