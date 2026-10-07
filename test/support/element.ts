import {
  SKYE_CONTEXTLOST,
  SKYE_CONTEXTRESTORED,
  SKYE_ERROR,
  SKYE_FALLBACK,
  SKYE_READY,
  type SkyeElement,
} from "../../src/element/index.ts";

/** How long a test waits for an event or a condition. */
export const WAIT_MS = 10_000;

const boxes: HTMLElement[] = [];

export interface Mounted {
  el: SkyeElement;
  box: HTMLDivElement;
}

/** A `<skye-view>` filling a positioned box of the given CSS size, appended to the body. */
export function mount(attrs: Record<string, string> = {}, width = 160, height = 100): Mounted {
  const box = document.createElement("div");
  box.style.cssText = `position:relative;width:${width}px;height:${height}px`;
  const el = document.createElement("skye-view");
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  box.append(el);
  document.body.append(box);
  boxes.push(box);
  return { el, box };
}

/** Keeps `box` for `unmountAll`, for boxes a test builds itself. */
export function track(box: HTMLElement): void {
  boxes.push(box);
}

/** Removes every box mounted since the last call. */
export function unmountAll(): void {
  for (const box of boxes.splice(0)) box.remove();
}

export function canvasOf(el: SkyeElement): HTMLCanvasElement | null {
  return el.shadowRoot?.querySelector("canvas") ?? null;
}

export function coverOf(el: SkyeElement): HTMLDivElement {
  const cover = el.shadowRoot?.querySelector("div");
  if (cover === null || cover === undefined) throw new Error("no fallback layer");
  return cover;
}

export function glOf(el: SkyeElement): WebGL2RenderingContext {
  const gl = canvasOf(el)?.getContext("webgl2");
  if (gl === null || gl === undefined) throw new Error("no context");
  return gl;
}

export function nextEvent(target: EventTarget, type: string): Promise<Event> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${type} event`)), WAIT_MS);
    target.addEventListener(
      type,
      (e) => {
        clearTimeout(timer);
        resolve(e);
      },
      { once: true },
    );
  });
}

export function until(done: () => boolean, what: string): Promise<void> {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const check = (): void => {
      if (done()) resolve();
      else if (performance.now() - start > WAIT_MS)
        reject(new Error(`timed out waiting for ${what}`));
      else setTimeout(check, 10);
    };
    check();
  });
}

/** Event types dispatched on `el`, in order. */
export function record(el: SkyeElement): string[] {
  const seen: string[] = [];
  for (const type of [
    SKYE_READY,
    SKYE_ERROR,
    SKYE_CONTEXTLOST,
    SKYE_CONTEXTRESTORED,
    SKYE_FALLBACK,
  ])
    el.addEventListener(type, () => seen.push(type));
  return seen;
}

/** Pixels that are not black. */
export function nonBlack(pixels: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) n++;
  return n;
}

/**
 * Errors reported as uncaught on the page, and promise rejections nobody
 * handled, from now until the returned function stops collecting.
 */
export function collectErrors(): { errors: unknown[]; stop: () => void } {
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent): void => {
    errors.push(e.error ?? e.message);
  };
  const onRejection = (e: PromiseRejectionEvent): void => {
    errors.push(e.reason);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return {
    errors,
    stop: () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    },
  };
}
