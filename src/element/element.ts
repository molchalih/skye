import type { SkyeStats, TierChange } from "../core/api.ts";
import type { SkyeParams } from "../core/params.ts";
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
 * The `worker` attribute belongs to the attribute contract, but this element
 * always renders on the main thread; worker rendering arrives with the worker
 * entry.
 *
 * Removing the element stops drawing at once. Unless it is inserted again
 * within the same task (a move, or a framework's disconnect/reconnect), the
 * sky is then disposed and its WebGL context freed; a later insertion starts
 * a new one.
 */
export class SkyeElement extends ElementBase {
  /**
   * How long, in ms, to wait after a context loss for the browser to restore
   * the context before replacing the canvas with a new one. Applies to every
   * `<skye-view>`.
   */
  static restoreTimeoutMs: number = 3000;

  static get observedAttributes(): readonly string[] {
    return PARAM_ATTRIBUTES;
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
  #reveal: number | undefined;
  /** The host's sky has linked its programs and its context is not lost. */
  #ready = false;
  /** The host replaces one lost to a context loss; its ready means restored. */
  #replacing = false;
  /** No WebGL2: the gradient stays. */
  #unsupported = false;
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

  /** Current cost metrics, or null while no sky is running (before the idle start, or without WebGL2). */
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

  attributeChangedCallback(): void {
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
    let host: SkyHost | null;
    try {
      host = createMainThreadHost(this.#canvas, this.#params());
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
      host.on("error", (error) => this.#emit(SKYE_ERROR, error)),
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
    if (this.#reveal !== undefined) cancelAnimationFrame(this.#reveal);
    this.#reveal = undefined;
    this.#cover.style.background = fallbackBackground(this.#params());
    this.#cover.hidden = false;
  }

  readonly #tearDown = (): void => {
    this.#teardown = undefined;
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
    if (visible && this.#ready && !this.#cover.hidden) this.#scheduleReveal();
  }

  // The sky requests its frame before announcing a change, so a frame callback requested after it runs in the
  // same frame: the gradient goes away in the frame the sky first draws, never over a blank canvas.
  #scheduleReveal(): void {
    if (this.#reveal !== undefined) return;
    this.#reveal = requestAnimationFrame(() => {
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
    this.#emit(SKYE_CONTEXTLOST, null);
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
    this.#applyVisibility();
    this.#emit(SKYE_CONTEXTRESTORED, null);
  };

  readonly #onUnsupported = (): void => {
    this.#dropHost();
    this.#fallBack();
  };

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
