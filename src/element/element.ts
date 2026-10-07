import type { SkyeStats, TierChange } from "../core/api.ts";
import type { SkyeParams } from "../core/params.ts";
import { createWorkerHost } from "../worker/host.ts";
import { attributesToParams, PARAM_ATTRIBUTES, type SkyeAttribute } from "./attributes.ts";
import { fallbackBackground } from "./fallback.ts";
import { createMainThreadHost, type SkyHost } from "./host.ts";

/** Programs are linked and the sky is drawing. */
export const SKYE_READY = "skye-ready";
/** The sky failed (a shader did not build); `detail` is the error. The fallback gradient stays. */
export const SKYE_ERROR = "skye-error";
/** The WebGL context was lost; drawing stopped. */
export const SKYE_CONTEXTLOST = "skye-contextlost";
/** After a loss: drawing again, on the restored context or on a replacement canvas. */
export const SKYE_CONTEXTRESTORED = "skye-contextrestored";
/** WebGL2 is unavailable; the fallback gradient is shown for good. */
export const SKYE_FALLBACK = "skye-fallback";
/** The automatic quality tier changed (`quality="auto"` only); `detail` is the new tier. */
export const SKYE_TIERCHANGE = "skye-tierchange";

/** The `detail` of each event `<skye-view>` dispatches. */
export interface SkyeEventDetailMap {
  "skye-ready": null;
  "skye-error": Error;
  "skye-contextlost": null;
  "skye-contextrestored": null;
  "skye-fallback": null;
  "skye-tierchange": TierChange;
}

/** The events `<skye-view>` dispatches. All bubble and cross shadow roots. */
export type SkyeEventMap = { [K in keyof SkyeEventDetailMap]: CustomEvent<SkyeEventDetailMap[K]> };

/** `HTMLElementEventMap` plus the element's own events, for typed `addEventListener`. */
export interface SkyeElementEventMap extends HTMLElementEventMap, SkyeEventMap {}

const OBSERVED: readonly string[] = [...PARAM_ATTRIBUTES, "worker"];

const STYLE =
  ":host{display:block;position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:#1a2440}" +
  "canvas,div{position:absolute;inset:0;width:100%;height:100%;display:block}" +
  "div[hidden]{display:none}";

// Importing the element must not throw where there is no DOM (server rendering); it can only be used in a browser.
const ElementBase: typeof HTMLElement =
  typeof HTMLElement === "undefined"
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in base that is never instantiated
      (Object as unknown as typeof HTMLElement)
    : HTMLElement;

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * `<skye-view>`: a sky that fills its positioned container. Params are set
 * with attributes (see `SKYE_ATTRIBUTES`); it starts when the browser is idle,
 * follows its size and the device pixel ratio, pauses while off screen, in a
 * hidden document or disconnected, and draws once per change under
 * `motion="static"` or a reduced-motion preference. Until the sky is ready,
 * and for good without WebGL2, it shows a gradient for the scene and hour.
 *
 * With the `worker` attribute the sky renders in a dedicated worker, on the
 * canvas transferred to an `OffscreenCanvas`; a non-empty value is the URL of
 * the worker module to load instead of skye's own. Where that cannot work (no
 * WebGL2 in workers, no `transferControlToOffscreen`, a worker that fails to
 * load or start), it renders on the main thread instead. Adding, removing or
 * changing the attribute restarts the sky in the new mode, with a new
 * `skye-ready`.
 *
 * Removing the element stops drawing at once. Unless it is inserted again
 * within the same task (a move, or a framework's disconnect/reconnect), the
 * sky is then disposed and its WebGL context freed; a later insertion starts
 * a new one.
 *
 * @tagname skye-view
 * @attr {"clear" | "cloudy" | "fog" | "rainy" | "storm" | "sleet" | "snowy" | "haze"} [scene=cloudy] - Weather scene; unknown names are `cloudy`.
 * @attr {number} [cover=0.4] - Cloud cover, clamped to 0-1.
 * @attr {number} [intensity=0.6] - Precipitation, fog or haze strength, clamped to 0-1.
 * @attr {number} [wind] - Cloud wind speed; absent is the scene's own wind, scaled by intensity.
 * @attr {number} [seed=0] - Cloud pattern seed.
 * @attr {number} [hour=17.5] - Local clock hour, read against `solar-noon`; wraps into 0-24.
 * @attr {number} [latitude=52.37] - Degrees north, clamped to -66-66.
 * @attr {number} [day-of-year=172] - Day of the year, 1-366.
 * @attr {number} [solar-noon=12.7] - Local hour of solar noon.
 * @attr {number} [moon-phase=0.5] - Moon phase; wraps into 0-1. 0 is new, 0.5 is full.
 * @attr {string} [glass=on] - Rain-on-glass layer: off for `0`, `false`, `off` or `none` in any case, on for any other value.
 * @attr {number} [focus-depth=0.45] - Glass focus depth, clamped to 0.12-1.
 * @attr {number} [exposure=1] - Overall brightness, clamped to 0.2-1.2.
 * @attr {number} [blur-radius=0] - Background blur in CSS px, clamped to 0-64.
 * @attr {"auto" | "low" | "balanced" | "high"} [quality=auto] - Quality tier; `auto` adapts to frame time, unknown values are `balanced`.
 * @attr {"auto" | "full" | "static"} [motion=auto] - `static` draws one frame per change; `auto` follows prefers-reduced-motion.
 * @attr {boolean | string} worker - Render in a dedicated worker; a non-empty value is the URL of the worker module to load instead of skye's own.
 * @fires {CustomEvent<null>} skye-ready - Programs are linked and the sky is drawing.
 * @fires {CustomEvent<Error>} skye-error - The sky failed; `detail` is the error. The fallback gradient stays.
 * @fires {CustomEvent<null>} skye-contextlost - The WebGL context was lost; drawing stopped.
 * @fires {CustomEvent<null>} skye-contextrestored - Drawing again after a context loss.
 * @fires {CustomEvent<null>} skye-fallback - WebGL2 is unavailable; the fallback gradient is shown for good.
 * @fires {CustomEvent<TierChange>} skye-tierchange - The automatic quality tier changed; `detail` is the new tier.
 */
export class SkyeElement extends ElementBase {
  /**
   * How long, in ms, to wait after a context loss for the browser to restore
   * the context before replacing the canvas with a new one. Applies to every
   * `<skye-view>`.
   */
  static restoreTimeoutMs: number = 3000;

  /**
   * How long, in ms, a `worker` element waits for its worker to load and
   * report whether it can render before it renders on the main thread
   * instead. Applies to every `<skye-view>`.
   */
  static workerProbeTimeoutMs: number = 5000;

  static get observedAttributes(): readonly string[] {
    return OBSERVED;
  }

  // One constructed sheet adopted by every instance: no inline <style>, so a CSP without 'unsafe-inline' allows it.
  static #sheet: CSSStyleSheet | undefined;

  static #styles(): CSSStyleSheet {
    if (SkyeElement.#sheet === undefined) {
      SkyeElement.#sheet = new CSSStyleSheet();
      SkyeElement.#sheet.replaceSync(STYLE);
    }
    return SkyeElement.#sheet;
  }

  readonly #cover: HTMLDivElement;
  #canvas: HTMLCanvasElement;
  #host: SkyHost | undefined;
  #offHost: (() => void)[] = [];
  /** Cancels the pending idle start. */
  #cancelStart: (() => void) | undefined;
  #teardown: ReturnType<typeof setTimeout> | undefined;
  #restore: ReturnType<typeof setTimeout> | undefined;
  /** Cancels the pending reveal. */
  #reveal: (() => void) | undefined;
  /** The host's sky has linked its programs and its context is not lost. */
  #ready = false;
  /** The host replaces one lost to a context loss; its ready means restored. */
  #replacing = false;
  /** `skye-contextlost` was dispatched and neither `skye-contextrestored` nor `skye-ready` has followed. */
  #down = false;
  /** No WebGL2: the gradient stays. */
  #unsupported = false;
  /** The worker could not render; the main thread does until the `worker` attribute changes. */
  #workerFailed = false;
  #width = 0;
  #height = 0;
  #intersecting = true;
  #motionQuery: MediaQueryList | undefined;
  #ratioQuery: MediaQueryList | undefined;
  readonly #resizeObserver: ResizeObserver;
  readonly #intersectionObserver: IntersectionObserver;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [SkyeElement.#styles()];
    this.#canvas = document.createElement("canvas");
    this.#cover = document.createElement("div");
    this.#cover.style.background = fallbackBackground(this.#params());
    root.append(this.#canvas, this.#cover);
    this.#resizeObserver = new ResizeObserver(this.#onResize);
    this.#intersectionObserver = new IntersectionObserver(this.#onIntersection);
  }

  /**
   * Current cost metrics, or null while no sky is running (before the idle
   * start, or without WebGL2). In worker mode, the worker's latest snapshot
   * (taken up to four times a second), or null before its first.
   */
  stats(): SkyeStats | null {
    return this.#host?.stats() ?? null;
  }

  connectedCallback(): void {
    clearTimeout(this.#teardown);
    this.#teardown = undefined;
    this.#resizeObserver.observe(this);
    this.#intersectionObserver.observe(this);
    document.addEventListener("visibilitychange", this.#onVisibility);
    this.#motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
    this.#motionQuery.addEventListener("change", this.#onMotion);
    this.#watchRatio();
    if (this.#host !== undefined) {
      // Back before the teardown ran: keep the sky.
      this.#host.setReducedMotion(this.#motionQuery.matches);
      this.#applySize();
      this.#applyVisibility();
    } else if (!this.#unsupported && this.#cancelStart === undefined) {
      this.#scheduleStart();
    }
  }

  disconnectedCallback(): void {
    // Removed before the idle start: no context is ever created.
    this.#cancelStart?.();
    this.#cancelStart = undefined;
    this.#resizeObserver.disconnect();
    this.#intersectionObserver.disconnect();
    document.removeEventListener("visibilitychange", this.#onVisibility);
    this.#motionQuery?.removeEventListener("change", this.#onMotion);
    this.#ratioQuery?.removeEventListener("change", this.#onRatio);
    this.#motionQuery = undefined;
    this.#ratioQuery = undefined;
    if (this.#host === undefined) return;
    this.#host.setVisible(false);
    // A task rather than a microtask, so a framework that reinserts from a promise callback keeps the sky too.
    this.#teardown = setTimeout(this.#tearDown, 0);
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null): void {
    if (name === "worker") {
      if (value !== old) this.#onWorkerChange(old, value);
      return;
    }
    const params = this.#params();
    this.#host?.update(params);
    if (!this.#cover.hidden) this.#cover.style.background = fallbackBackground(params);
  }

  #params(): SkyeParams {
    return attributesToParams((name: SkyeAttribute) => this.getAttribute(name));
  }

  #scheduleStart(): void {
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(this.#start, { timeout: 300 });
      this.#cancelStart = () => cancelIdleCallback(id);
    } else {
      const id = setTimeout(this.#start, 32);
      this.#cancelStart = () => clearTimeout(id);
    }
  }

  readonly #start = (): void => {
    this.#cancelStart = undefined;
    if (this.isConnected) this.#createHost();
  };

  #createHost(): void {
    const params = this.#params();
    const url = this.#workerFailed ? null : this.getAttribute("worker");
    let host: SkyHost | null;
    try {
      host =
        (url === null
          ? null
          : createWorkerHost(this.#canvas, params, url, SkyeElement.workerProbeTimeoutMs)) ??
        createMainThreadHost(this.#canvas, params);
    } catch (error) {
      this.#emit(SKYE_ERROR, toError(error));
      return;
    }
    if (host === null) {
      this.#fallBack();
      return;
    }
    this.#host = host;
    this.#offHost = [
      host.on("ready", this.#onReady),
      host.on("error", this.#onError),
      host.on("contextlost", this.#onLost),
      host.on("webglcontextlost", this.#onContextLost),
      host.on("webglcontextrestored", this.#onContextRestored),
      host.on("contextrestored", this.#onRestored),
      host.on("tierchange", (change) => this.#emit(SKYE_TIERCHANGE, change)),
      host.on("unsupported", this.#onUnsupported),
    ];
    host.setReducedMotion(this.#motionQuery?.matches ?? false);
    this.#applySize();
    this.#applyVisibility();
    host.start();
  }

  // No WebGL2: the gradient stays for good.
  #fallBack(): void {
    this.#unsupported = true;
    this.#canvas.remove();
    this.#emit(SKYE_FALLBACK, null);
  }

  #dropHost(): void {
    clearTimeout(this.#restore);
    this.#restore = undefined;
    for (const off of this.#offHost) off();
    this.#offHost = [];
    this.#host?.dispose();
    this.#host = undefined;
    this.#ready = false;
    this.#replacing = false;
    // The old canvas's context is lost for good; a new sky needs a new canvas.
    const canvas = document.createElement("canvas");
    this.#canvas.replaceWith(canvas);
    this.#canvas = canvas;
    this.#showCover();
  }

  #showCover(): void {
    this.#reveal?.();
    this.#reveal = undefined;
    this.#cover.style.background = fallbackBackground(this.#params());
    this.#cover.hidden = false;
  }

  readonly #tearDown = (): void => {
    this.#teardown = undefined;
    // A later insertion starts a new sky, not the one that went down.
    this.#down = false;
    this.#dropHost();
  };

  // Zero-size boxes (display:none, collapsed) never reach the sky: it keeps its last size and stays paused.
  #applySize(): void {
    if (this.#host !== undefined && this.#width > 0 && this.#height > 0)
      this.#host.resize(this.#width, this.#height, devicePixelRatio);
  }

  #applyVisibility(): void {
    const host = this.#host;
    if (host === undefined) return;
    const visible =
      this.isConnected &&
      this.#intersecting &&
      !document.hidden &&
      this.#width > 0 &&
      this.#height > 0;
    host.setVisible(visible);
    if (visible && this.#ready && !this.#cover.hidden) this.#scheduleReveal(host);
  }

  // Called right after the sky is told it is visible or announces that it draws, so the gradient goes away once the
  // canvas shows the frame that follows, never over a blank canvas. A worker's frame shows later than the page's
  // own, so the host decides when.
  #scheduleReveal(host: SkyHost): void {
    if (this.#reveal !== undefined) return;
    this.#reveal = host.afterFrame(() => {
      this.#reveal = undefined;
      this.#cover.hidden = true;
    });
  }

  // Re-armed on every change: the query matches only the ratio it was made for.
  #watchRatio(): void {
    this.#ratioQuery?.removeEventListener("change", this.#onRatio);
    this.#ratioQuery = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    this.#ratioQuery.addEventListener("change", this.#onRatio);
  }

  readonly #onRatio = (): void => {
    this.#watchRatio();
    this.#applySize();
  };

  readonly #onResize = (entries: ResizeObserverEntry[]): void => {
    const entry = entries[entries.length - 1];
    if (entry === undefined) return;
    this.#width = entry.contentRect.width;
    this.#height = entry.contentRect.height;
    this.#applySize();
    this.#applyVisibility();
  };

  readonly #onIntersection = (entries: IntersectionObserverEntry[]): void => {
    const entry = entries[entries.length - 1];
    if (entry === undefined) return;
    this.#intersecting = entry.isIntersecting;
    this.#applyVisibility();
  };

  readonly #onVisibility = (): void => {
    this.#applyVisibility();
  };

  readonly #onMotion = (): void => {
    this.#host?.setReducedMotion(this.#motionQuery?.matches ?? false);
  };

  readonly #onReady = (): void => {
    const replaced = this.#replacing;
    this.#ready = true;
    this.#replacing = false;
    this.#down = false;
    this.#applyVisibility();
    this.#emit(replaced ? SKYE_CONTEXTRESTORED : SKYE_READY, null);
  };

  // Armed on every loss the browser reports, so a second loss while the sky relinks after a restore is
  // timed too; the sky itself reports one contextlost until it draws again.
  readonly #onContextLost = (): void => {
    this.#stopDrawing();
    clearTimeout(this.#restore);
    this.#restore = setTimeout(this.#replace, SkyeElement.restoreTimeoutMs);
  };

  // The sky's own report, which may come before or after the browser's: either way the gradient is up first.
  readonly #onLost = (): void => {
    this.#stopDrawing();
    this.#down = true;
    this.#emit(SKYE_CONTEXTLOST, null);
  };

  // A failed shader build before the first frame, or a worker that crashed after it: either way nothing draws.
  readonly #onError = (error: Error): void => {
    this.#stopDrawing();
    this.#emit(SKYE_ERROR, error);
  };

  #stopDrawing(): void {
    this.#ready = false;
    this.#showCover();
  }

  // Timed against the browser's restore, not the sky's relink, which may take longer on a slow driver.
  readonly #onContextRestored = (): void => {
    clearTimeout(this.#restore);
    this.#restore = undefined;
  };

  readonly #onRestored = (): void => {
    this.#ready = true;
    this.#down = false;
    this.#applyVisibility();
    this.#emit(SKYE_CONTEXTRESTORED, null);
  };

  // A failed worker gets another try with the new value; a sky already on the main thread stays there when the
  // attribute goes away.
  #onWorkerChange(old: string | null, value: string | null): void {
    const inWorker = old !== null && !this.#workerFailed;
    this.#workerFailed = false;
    if (inWorker || value !== null) this.#restartHost();
  }

  // The worker could not render: the main thread takes over, on a fresh canvas since the worker may hold the old one.
  readonly #onUnsupported = (): void => {
    this.#workerFailed = true;
    this.#restartHost();
  };

  // A new host in the current mode, carrying over an outage of the old one. Before the idle start or after a
  // teardown there is no host, and the next start reads the mode itself.
  #restartHost(): void {
    if (this.#host === undefined) return;
    // A sky that went down (lost and not yet replaced) comes back as restored, whichever host brings it back.
    const replacing = this.#replacing || this.#down;
    this.#dropHost();
    if (!this.isConnected) {
      // The pending teardown has nothing left to do.
      clearTimeout(this.#teardown);
      this.#teardown = undefined;
      return;
    }
    this.#replacing = replacing;
    this.#createHost();
  }

  readonly #replace = (): void => {
    this.#restore = undefined;
    // Disconnected: the pending teardown disposes the sky.
    if (!this.isConnected) return;
    this.#dropHost();
    this.#replacing = true;
    this.#createHost();
  };

  override addEventListener<K extends keyof SkyeElementEventMap>(
    type: K,
    listener: (this: SkyeElement, ev: SkyeElementEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }

  override removeEventListener<K extends keyof SkyeElementEventMap>(
    type: K,
    listener: (this: SkyeElement, ev: SkyeElementEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
  }

  #emit<K extends keyof SkyeEventDetailMap>(type: K, detail: SkyeEventDetailMap[K]): void {
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "skye-view": SkyeElement;
  }
}
