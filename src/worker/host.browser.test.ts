import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Display } from "../../test/support/display.ts";
import {
  canvasOf,
  collectErrors,
  coverOf,
  glOf,
  mount,
  nextEvent,
  nonBlack,
  record,
  unmountAll,
  until,
  WAIT_MS,
} from "../../test/support/element.ts";
import { readPixels, wait } from "../../test/support/sky.ts";
import type { TestRequest } from "../../test/support/workers/instrumented.ts";
import { JUNK } from "../../test/support/workers/junk.ts";
import { ShaderError } from "../index.ts";
import {
  SKYE_CONTEXTLOST,
  SKYE_CONTEXTRESTORED,
  SKYE_ERROR,
  SKYE_FALLBACK,
  SKYE_READY,
  SkyeElement,
  defineSkye,
} from "../element/index.ts";

defineSkye();

const INSTRUMENTED = new URL("../../test/support/workers/instrumented.ts", import.meta.url).href;
const SILENT = new URL("../../test/support/workers/silent.ts", import.meta.url).href;
const THROWS = new URL("../../test/support/workers/throws.ts", import.meta.url).href;
const NO_WEBGL2 = new URL("../../test/support/workers/no-webgl2.ts", import.meta.url).href;
const FAILS_AFTER_TRANSFER = new URL(
  "../../test/support/workers/fails-after-transfer.ts",
  import.meta.url,
).href;
const FAILS_LINKS = new URL("../../test/support/workers/fails-links.ts", import.meta.url).href;
const THROWS_AFTER_TRANSFER = new URL(
  "../../test/support/workers/throws-after-transfer.ts",
  import.meta.url,
).href;

const NativeWorker = Worker;

/** Every worker the page constructs, and whether it was terminated. */
class TrackedWorker extends NativeWorker {
  static made: TrackedWorker[] = [];
  terminated = false;

  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    TrackedWorker.made.push(this);
  }

  override terminate(): void {
    this.terminated = true;
    super.terminate();
  }

  static live(): TrackedWorker[] {
    return TrackedWorker.made.filter((w) => !w.terminated);
  }

  /** The one live worker. */
  static only(): TrackedWorker {
    const live = TrackedWorker.live();
    const [worker] = live;
    if (live.length !== 1 || worker === undefined) throw new Error(`${live.length} live workers`);
    return worker;
  }

  /** Sends a request only the instrumented worker understands. */
  test(request: TestRequest): void {
    this.postMessage(request);
  }

  /** Resolves once the instrumented worker has drawn more than `count` frames. */
  async drawsPast(count: number, since = performance.now()): Promise<void> {
    if ((await this.frames()) > count) return;
    if (performance.now() - since > WAIT_MS) throw new Error(`no frame past ${count}`);
    await wait(20);
    await this.drawsPast(count, since);
  }

  /** Frames the instrumented worker has drawn so far. */
  frames(): Promise<number> {
    return new Promise((resolve) => {
      const onMessage = (event: MessageEvent<unknown>): void => {
        const data = event.data;
        if (typeof data !== "object" || data === null || Reflect.get(data, "test") !== "frames")
          return;
        this.removeEventListener("message", onMessage);
        resolve(Number(Reflect.get(data, "count")));
      };
      this.addEventListener("message", onMessage);
      this.test({ test: "frames" });
    });
  }
}

/** Pixels of a downscaled copy of what `canvas` currently shows that are not transparent; an empty canvas has none. */
function paintedPixels(canvas: HTMLCanvasElement | null): number {
  if (canvas === null) throw new Error("no canvas");
  const copy = document.createElement("canvas");
  copy.width = 32;
  copy.height = 20;
  const context = copy.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  context.drawImage(canvas, 0, 0, copy.width, copy.height);
  const { data } = context.getImageData(0, 0, copy.width, copy.height);
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n++;
  return n;
}

/** Undo steps a test registers, run after it whatever its outcome. */
const cleanups: (() => void)[] = [];

function pageErrors(): unknown[] {
  const { errors, stop } = collectErrors();
  cleanups.push(stop);
  return errors;
}

beforeEach(() => {
  TrackedWorker.made = [];
  vi.stubGlobal("Worker", TrackedWorker);
});

afterEach(async () => {
  for (const undo of cleanups.splice(0)) undo();
  unmountAll();
  // Let the deferred teardowns run, so every worker and context is gone before the next test.
  await wait(20);
  SkyeElement.restoreTimeoutMs = 3000;
  SkyeElement.workerProbeTimeoutMs = 5000;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("worker mode", () => {
  it("renders in a worker loaded from skye's own module", async () => {
    const errors = pageErrors();
    const { el } = mount({ worker: "", motion: "static", quality: "balanced" });
    const seen = record(el);
    await nextEvent(el, SKYE_READY);
    expect(TrackedWorker.made).toHaveLength(1);
    // The canvas now belongs to the worker.
    expect(() => canvasOf(el)?.getContext("webgl2")).toThrow();
    expect(el.stats()).toMatchObject({ worker: true, renderer: "skye", out: [160, 100] });
    expect(el.stats()?.passes).toBeGreaterThan(0);
    await until(() => coverOf(el).hidden === true, "the gradient to hide");
    expect(seen).toEqual([SKYE_READY]);
    expect(errors).toEqual([]);
  });

  // A worker's frame reaches the page only once the GPU has drawn it, which can be well after the worker's frame
  // callback; the gradient must not go before it, or the page shows an empty canvas in between.
  it("hides the gradient only when the canvas already shows the sky", async () => {
    const { el } = mount({ worker: "", motion: "static", quality: "balanced" });
    const cover = coverOf(el);
    const shownAtReveal = new Promise<number>((resolve) => {
      // Runs in the frame that hides the gradient, before it is painted: what the page shows from then on.
      const observer = new MutationObserver(() => {
        if (!cover.hidden) return;
        observer.disconnect();
        resolve(paintedPixels(canvasOf(el)));
      });
      observer.observe(cover, { attributes: true, attributeFilter: ["hidden"] });
    });
    await nextEvent(el, SKYE_READY);
    expect(await shownAtReveal).toBeGreaterThan(0);
  });

  // Off screen at ready the worker draws nothing; once shown, the gradient must stay until its first frame is on the
  // page, which in a worker comes later than the page's own next frame.
  it("hides the gradient only over a drawn sky when shown after ready", async () => {
    const { el, box } = mount({ worker: "", motion: "static", quality: "balanced" });
    box.style.position = "fixed";
    box.style.left = "-10000px";
    const cover = coverOf(el);
    await nextEvent(el, SKYE_READY);
    await wait(200);
    expect(cover.hidden).toBe(false);
    const shownAtReveal = new Promise<number>((resolve) => {
      const observer = new MutationObserver(() => {
        if (!cover.hidden) return;
        observer.disconnect();
        resolve(paintedPixels(canvasOf(el)));
      });
      observer.observe(cover, { attributes: true, attributeFilter: ["hidden"] });
    });
    box.style.left = "0";
    expect(await shownAtReveal).toBeGreaterThan(0);
  });

  it("returns a new stats snapshot on each call, and null before the first", async () => {
    const { el } = mount({ worker: "" });
    await until(() => TrackedWorker.made.length === 1, "the worker");
    expect(el.stats()).toBeNull();
    await nextEvent(el, SKYE_READY);
    const a = el.stats();
    const b = el.stats();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("forwards attribute changes to the worker", async () => {
    const { el } = mount({ worker: "", quality: "low", motion: "static" });
    await nextEvent(el, SKYE_READY);
    expect(el.stats()).toMatchObject({ quality: "low", auto: false, static: true });
    el.setAttribute("quality", "high");
    await until(() => el.stats()?.quality === "high", "the high tier");
    el.removeAttribute("quality");
    await until(() => el.stats()?.auto === true, "the auto tier");
    expect(el.stats()?.quality).toBe("balanced");
  });

  it("forwards size changes to the worker", async () => {
    const { el, box } = mount({ worker: "", quality: "balanced", motion: "static" });
    await nextEvent(el, SKYE_READY);
    expect(el.stats()?.out).toEqual([160, 100]);
    box.style.width = "240px";
    box.style.height = "90px";
    // The balanced tier caps the ratio at 1.
    await until(() => String(el.stats()?.out) === "240,90", "the new size");
  });

  it("forwards reduced-motion changes to the worker", async () => {
    class Query extends EventTarget implements MediaQueryList {
      matches = false;
      readonly media: string;
      onchange = null;
      constructor(media: string) {
        super();
        this.media = media;
      }
      addListener(): void {}
      removeListener(): void {}
    }
    const reduced = new Query("(prefers-reduced-motion: reduce)");
    vi.stubGlobal("matchMedia", (media: string): MediaQueryList =>
      media === reduced.media ? reduced : new Query(media),
    );
    const { el } = mount({ worker: "", motion: "auto" });
    await nextEvent(el, SKYE_READY);
    expect(el.stats()?.static).toBe(false);
    reduced.matches = true;
    reduced.dispatchEvent(new Event("change"));
    await until(() => el.stats()?.static === true, "static frames");
  });

  it("pauses the worker's frames while hidden and resumes when shown", async () => {
    const { el, box } = mount({ worker: INSTRUMENTED, motion: "full" });
    await nextEvent(el, SKYE_READY);
    const worker = TrackedWorker.only();
    await worker.drawsPast(await worker.frames());

    box.style.display = "none";
    await wait(100);
    const paused = await worker.frames();
    await wait(300);
    expect(await worker.frames()).toBe(paused);

    box.style.display = "block";
    await worker.drawsPast(paused);
  });

  it("terminates the worker when the element is removed", async () => {
    const { el, box } = mount({ worker: "" });
    await nextEvent(el, SKYE_READY);
    const worker = TrackedWorker.only();
    box.remove();
    await wait(20);
    expect(worker.terminated).toBe(true);
    expect(el.stats()).toBeNull();
  });

  it("keeps one worker through remount churn", async () => {
    const { el, box } = mount({ worker: "", motion: "static" });
    const seen = record(el);
    // A synchronous disconnect and reconnect, as a framework's double mount does.
    box.remove();
    document.body.append(box);
    await nextEvent(el, SKYE_READY);
    expect(TrackedWorker.made).toHaveLength(1);

    // A move within the task keeps the worker.
    box.remove();
    document.body.append(box);
    await wait(50);
    expect(TrackedWorker.live()).toHaveLength(1);
    expect(TrackedWorker.made).toHaveLength(1);

    // A removal that outlives the task ends it; reinsertion starts one new worker.
    box.remove();
    await wait(20);
    expect(TrackedWorker.live()).toHaveLength(0);
    document.body.append(box);
    await nextEvent(el, SKYE_READY);
    expect(TrackedWorker.made).toHaveLength(2);
    expect(TrackedWorker.live()).toHaveLength(1);
    expect(seen).toEqual([SKYE_READY, SKYE_READY]);
  });

  it("creates no worker when removed before the idle start", async () => {
    const { el, box } = mount({ worker: "" });
    box.remove();
    await wait(400);
    expect(TrackedWorker.made).toHaveLength(0);
    expect(el.stats()).toBeNull();
  });

  it("ignores messages that are not the protocol's, on both sides", async () => {
    const errors = pageErrors();
    const { el } = mount({ worker: INSTRUMENTED, motion: "full", quality: "balanced" });
    const seen = record(el);
    await nextEvent(el, SKYE_READY);
    const worker = TrackedWorker.only();
    for (const message of JUNK) worker.postMessage(message);
    worker.test({ test: "junk" });
    await worker.drawsPast(await worker.frames());
    el.setAttribute("quality", "low");
    await until(() => el.stats()?.quality === "low", "the low tier");
    await wait(100);
    expect(seen).toEqual([SKYE_READY]);
    expect(errors).toEqual([]);
  });

  it("reports a worker that crashes after its first frame as skye-error and shows the gradient", async () => {
    // The crash is left to surface on the page as uncaught where the engine forwards worker errors to the page
    // (Chromium does). This test keeps that expected one from the test runner, which would report it as unhandled.
    const onError = (e: ErrorEvent): void => {
      if (!e.message.includes("crashed")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("error", onError, { capture: true });
    cleanups.push(() => window.removeEventListener("error", onError, { capture: true }));
    const { el } = mount({ worker: INSTRUMENTED, motion: "static" });
    const seen = record(el);
    await nextEvent(el, SKYE_READY);
    await until(() => coverOf(el).hidden === true, "the gradient to hide");
    const failed = nextEvent(el, SKYE_ERROR);
    TrackedWorker.only().test({ test: "crash" });
    const event = await failed;
    expect(event instanceof CustomEvent && event.detail instanceof Error).toBe(true);
    expect(event instanceof CustomEvent ? String(event.detail.message) : "").toMatch(/crashed/);
    expect(coverOf(el).hidden).toBe(false);
    // Past the page's own report of the crash, which comes after the worker's error event.
    await wait(100);
    expect(seen).toEqual([SKYE_READY, SKYE_ERROR]);
  });

  it("reports a failed shader build as a ShaderError, as on the main thread", async () => {
    const { el } = mount({ worker: FAILS_LINKS, motion: "static" });
    const seen = record(el);
    const event = await nextEvent(el, SKYE_ERROR);
    const detail: unknown = event instanceof CustomEvent ? event.detail : null;
    expect(detail).toBeInstanceOf(ShaderError);
    expect(detail instanceof Error ? detail.name : "").toBe("ShaderError");
    expect(String(detail)).toMatch(/shader program failed/);
    expect(TrackedWorker.live()).toHaveLength(1);
    await wait(50);
    expect(coverOf(el).hidden).toBe(false);
    expect(seen).toEqual([SKYE_ERROR]);
  });

  it("switches between the worker and the main thread when the attribute changes", async () => {
    const { el } = mount({ motion: "static" });
    const seen = record(el);
    await nextEvent(el, SKYE_READY);
    expect(el.stats()?.worker).toBe(false);

    el.setAttribute("worker", "");
    await nextEvent(el, SKYE_READY);
    expect(el.stats()?.worker).toBe(true);
    const worker = TrackedWorker.only();

    // The same value again changes nothing.
    el.setAttribute("worker", "");
    await wait(50);
    expect(TrackedWorker.made).toHaveLength(1);

    el.removeAttribute("worker");
    await nextEvent(el, SKYE_READY);
    expect(worker.terminated).toBe(true);
    expect(el.stats()?.worker).toBe(false);
    expect(seen).toEqual([SKYE_READY, SKYE_READY, SKYE_READY]);
  });
});

describe("falling back to the main thread", () => {
  /**
   * Mounts a worker-mode element, expects it to end up drawing on the main
   * thread with no error surfacing on the page, and returns it.
   */
  async function expectMainThread(worker: string): Promise<SkyeElement> {
    const errors = pageErrors();
    const display = new Display().install();
    const { el } = mount({ worker, motion: "static" });
    const seen = record(el);
    await nextEvent(el, SKYE_READY);
    expect(el.stats()?.worker).toBe(false);
    expect(TrackedWorker.live()).toHaveLength(0);
    // Past any frame already requested from the real display.
    await wait(100);
    el.setAttribute("hour", "13");
    display.tick();
    expect(nonBlack(readPixels(glOf(el)))).toBeGreaterThan(0);
    display.tick();
    expect(coverOf(el).hidden).toBe(true);
    await wait(100);
    expect(seen).toEqual([SKYE_READY]);
    expect(errors).toEqual([]);
    return el;
  }

  it("when the worker URL is not found", async () => {
    await expectMainThread("/no-such-skye-worker.js");
    expect(TrackedWorker.made).toHaveLength(1);
  });

  it("when the worker loads but never answers", async () => {
    SkyeElement.workerProbeTimeoutMs = 200;
    await expectMainThread(SILENT);
    expect(TrackedWorker.made).toHaveLength(1);
    expect(TrackedWorker.made[0]?.terminated).toBe(true);
  });

  it("when the worker module throws while loading", async () => {
    await expectMainThread(THROWS);
    expect(TrackedWorker.made).toHaveLength(1);
  });

  it("when the worker has no WebGL2 for an OffscreenCanvas", async () => {
    await expectMainThread(NO_WEBGL2);
    expect(TrackedWorker.made).toHaveLength(1);
  });

  it("on a fresh canvas when the worker cannot render on the transferred one", async () => {
    await expectMainThread(FAILS_AFTER_TRANSFER);
  });

  it("on a fresh canvas when the worker crashes after the transfer", async () => {
    await expectMainThread(THROWS_AFTER_TRANSFER);
  });

  it("without transferControlToOffscreen, creating no worker", async () => {
    const proto = HTMLCanvasElement.prototype;
    const own = Object.getOwnPropertyDescriptor(proto, "transferControlToOffscreen");
    Reflect.deleteProperty(proto, "transferControlToOffscreen");
    if (own !== undefined)
      cleanups.push(() => Object.defineProperty(proto, "transferControlToOffscreen", own));
    await expectMainThread("");
    expect(TrackedWorker.made).toHaveLength(0);
  });

  it("when the page may not construct the worker", async () => {
    vi.stubGlobal("Worker", function Worker(): never {
      throw new DOMException("blocked by the content security policy", "SecurityError");
    });
    await expectMainThread("");
  });

  it("and to the gradient when the main thread has no WebGL2 either", async () => {
    const errors = pageErrors();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    const { el } = mount({ worker: NO_WEBGL2 });
    const seen = record(el);
    await nextEvent(el, SKYE_FALLBACK);
    expect(canvasOf(el)).toBeNull();
    expect(coverOf(el).hidden).toBe(false);
    expect(el.stats()).toBeNull();
    expect(TrackedWorker.made).toHaveLength(1);
    expect(TrackedWorker.live()).toHaveLength(0);
    await wait(50);
    expect(seen).toEqual([SKYE_FALLBACK]);
    expect(errors).toEqual([]);
  });

  it("and stays there until the worker attribute changes", async () => {
    const el = await expectMainThread(NO_WEBGL2);
    const seen = record(el);
    // Already on the main thread: removing the attribute keeps the sky.
    el.removeAttribute("worker");
    await wait(100);
    expect(seen).toEqual([]);
    el.setAttribute("worker", "");
    await nextEvent(el, SKYE_READY);
    expect(el.stats()?.worker).toBe(true);
    expect(TrackedWorker.made).toHaveLength(2);
    expect(TrackedWorker.live()).toHaveLength(1);
  });

  it("and stays there through a context-loss replacement", async () => {
    SkyeElement.restoreTimeoutMs = 50;
    const el = await expectMainThread(NO_WEBGL2);
    const restored = nextEvent(el, SKYE_CONTEXTRESTORED);
    glOf(el).getExtension("WEBGL_lose_context")?.loseContext();
    await restored;
    expect(TrackedWorker.made).toHaveLength(1);
    expect(el.stats()?.worker).toBe(false);
  });
});

describe("context loss in worker mode", () => {
  it("reports a switch of mode during an outage as the restore", async () => {
    SkyeElement.restoreTimeoutMs = 5000;
    const { el } = mount({ motion: "static" });
    const seen = record(el);
    await nextEvent(el, SKYE_READY);
    const lost = nextEvent(el, SKYE_CONTEXTLOST);
    glOf(el).getExtension("WEBGL_lose_context")?.loseContext();
    await lost;
    const restored = nextEvent(el, SKYE_CONTEXTRESTORED);
    el.setAttribute("worker", "");
    await restored;
    expect(el.stats()?.worker).toBe(true);
    await wait(100);
    expect(seen).toEqual([SKYE_READY, SKYE_CONTEXTLOST, SKYE_CONTEXTRESTORED]);
  });

  it("forwards the worker's loss and a prompt restore, keeping the worker", async () => {
    SkyeElement.restoreTimeoutMs = 400;
    const { el } = mount({ worker: INSTRUMENTED, motion: "static" });
    const seen = record(el);
    await nextEvent(el, SKYE_READY);
    const worker = TrackedWorker.only();
    const canvas = canvasOf(el);
    const lost = nextEvent(el, SKYE_CONTEXTLOST);
    worker.test({ test: "lose" });
    await lost;
    expect(coverOf(el).hidden).toBe(false);
    const restored = nextEvent(el, SKYE_CONTEXTRESTORED);
    worker.test({ test: "restore" });
    await restored;
    await until(() => coverOf(el).hidden === true, "the gradient to hide");
    // Well past the timeout: the browser's restore, forwarded from the worker, cancelled it.
    await wait(600);
    expect(TrackedWorker.made).toHaveLength(1);
    expect(worker.terminated).toBe(false);
    expect(canvasOf(el)).toBe(canvas);
    expect(seen).toEqual([SKYE_READY, SKYE_CONTEXTLOST, SKYE_CONTEXTRESTORED]);
  });

  it("replaces the canvas and the worker when the context is not restored in time", async () => {
    SkyeElement.restoreTimeoutMs = 100;
    const { el } = mount({ worker: INSTRUMENTED, motion: "static" });
    const seen = record(el);
    await nextEvent(el, SKYE_READY);
    const worker = TrackedWorker.only();
    const canvas = canvasOf(el);
    const restored = nextEvent(el, SKYE_CONTEXTRESTORED);
    worker.test({ test: "lose" });
    await restored;
    expect(worker.terminated).toBe(true);
    expect(TrackedWorker.made).toHaveLength(2);
    expect(TrackedWorker.live()).toHaveLength(1);
    expect(canvasOf(el)).not.toBe(canvas);
    expect(el.stats()?.worker).toBe(true);
    expect(seen).toEqual([SKYE_READY, SKYE_CONTEXTLOST, SKYE_CONTEXTRESTORED]);
    expect(await TrackedWorker.only().frames()).toBeGreaterThan(0);
    await until(() => coverOf(el).hidden === true, "the gradient to hide");
  });
});
