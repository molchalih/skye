import { afterEach, describe, expect, it, vi } from "vitest";
import { compare, describeComparison } from "../../test/parity/compare.ts";
import { whenReady } from "../../test/parity/harness.ts";
import { Display } from "../../test/support/display.ts";
import {
  canvasOf,
  collectErrors as collectPageErrors,
  coverOf,
  glOf,
  mount,
  nextEvent,
  nonBlack,
  record,
  track,
  unmountAll,
  until,
} from "../../test/support/element.ts";
import { readPixels, wait } from "../../test/support/sky.ts";
import { createSky, ShaderError, type SkyeParams } from "../index.ts";
import { fallbackBackground } from "./fallback.ts";
import {
  SKYE_ATTRIBUTES,
  SKYE_CONTEXTLOST,
  SKYE_CONTEXTRESTORED,
  SKYE_ERROR,
  SKYE_FALLBACK,
  SKYE_READY,
  SkyeElement,
  defineSkye,
  toAttributes,
} from "./index.ts";

defineSkye();

const LINK_STATUS = 0x8b82;
/** Undo steps a test registers, run after it whatever its outcome. */
const cleanups: (() => void)[] = [];

/** The unpatched method of the WebGL2 context prototype, for a spy to call through to. */
function contextMethod(name: string): Function {
  const original: unknown = Object.getOwnPropertyDescriptor(
    WebGL2RenderingContext.prototype,
    name,
  )?.value;
  if (typeof original !== "function") throw new Error(`no ${name}`);
  return original;
}

/** The style engine's spelling of a CSS background, for comparing against what the element set. */
function cssBackground(value: string): string {
  const probe = document.createElement("div");
  probe.style.background = value;
  return probe.style.background;
}

/** WebGL2 contexts handed out through a spied `getContext`. */
function webgl2Contexts(spy: { mock: { results: { value: unknown }[] } }): number {
  const contexts = new Set<unknown>();
  for (const { value } of spy.mock.results)
    if (value instanceof WebGL2RenderingContext) contexts.add(value);
  return contexts.size;
}

afterEach(async () => {
  for (const undo of cleanups.splice(0)) undo();
  unmountAll();
  // Let the deferred teardowns run, so every context is freed before the next test.
  await wait(20);
  SkyeElement.restoreTimeoutMs = 3000;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("attributes", () => {
  it("observes every attribute of its contract and nothing else", () => {
    expect([...SkyeElement.observedAttributes]).toEqual(SKYE_ATTRIBUTES);
  });

  it("names no HTMLElement member", () => {
    const camel = (s: string): string => s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    for (const name of SKYE_ATTRIBUTES) {
      expect(name in HTMLElement.prototype, name).toBe(false);
      expect(camel(name) in HTMLElement.prototype, name).toBe(false);
    }
  });

  it("draws exactly what createSky draws for the same params", async () => {
    const display = new Display().install();
    const params: SkyeParams = {
      scene: "snowy",
      cover: 0.7,
      intensity: 0.8,
      wind: 2.1,
      seed: 3,
      hour: 9.25,
      latitude: 40,
      dayOfYear: 300,
      solarNoon: 12.2,
      moonPhase: 0.3,
      glass: true,
      focus: 0.8,
      exposure: 0.9,
      blur: 4,
      quality: "high",
      motion: "static",
    };
    const { el } = mount(toAttributes(params));
    await nextEvent(el, SKYE_READY);
    await wait(50);
    display.tick();
    const fromElement = readPixels(glOf(el));

    const canvas = document.createElement("canvas");
    const sky = createSky(canvas, params);
    await whenReady(sky);
    sky.resize(160, 100, devicePixelRatio);
    sky.render(0);
    const gl = canvas.getContext("webgl2");
    if (gl === null) throw new Error("no context");
    const fromSky = readPixels(gl);
    sky.dispose();
    gl.getExtension("WEBGL_lose_context")?.loseContext();

    expect(fromElement.length).toBe(fromSky.length);
    expect(describeComparison(compare(fromSky, fromElement, 1, fromSky.length / 4))).toMatch(
      /^identical/,
    );
  });

  it("forwards changes, and a removed attribute returns its param to the default", async () => {
    const { el } = mount({ quality: "low", motion: "static" });
    await nextEvent(el, SKYE_READY);
    expect(el.stats()).toMatchObject({ quality: "low", auto: false, static: true });
    el.setAttribute("quality", "high");
    expect(el.stats()).toMatchObject({ quality: "high", auto: false });
    el.removeAttribute("quality");
    expect(el.stats()).toMatchObject({ quality: "balanced", auto: true });
  });

  it("draws nothing for attributes it does not know", async () => {
    const display = new Display().install();
    const { el } = mount({ motion: "static" });
    await nextEvent(el, SKYE_READY);
    await wait(50);
    display.tick();
    const mipmaps = vi.spyOn(glOf(el), "generateMipmap");
    el.setAttribute("dim", "0.3");
    el.setAttribute("lat", "10");
    display.tick();
    expect(mipmaps).not.toHaveBeenCalled();
    el.setAttribute("hour", "3");
    display.tick();
    expect(mipmaps).toHaveBeenCalledTimes(1);
  });
});

describe("parity with the v6 element", () => {
  it("matches v6 for a static scene given only the time inputs v6 reads from the clock", async () => {
    await import("../../test/reference/weather-sky-v6.js");
    const display = new Display().install();

    const v6Box = document.createElement("div");
    v6Box.style.cssText = "position:relative;width:160px;height:100px";
    const v6 = document.createElement("weather-sky-v6");
    // Frames are drawn by hand below; v6's own loop would add more.
    Reflect.set(v6, "_loop", () => undefined);
    for (const [name, value] of Object.entries({
      scene: "rainy",
      hour: "7.5",
      day: "200",
      moon: "0.3",
      motion: "static",
    }))
      v6.setAttribute(name, value);
    v6Box.append(v6);
    document.body.append(v6Box);
    track(v6Box);

    const { el } = mount({
      scene: "rainy",
      hour: "7.5",
      "day-of-year": "200",
      "moon-phase": "0.3",
      motion: "static",
    });
    await nextEvent(el, SKYE_READY);
    await until(() => Reflect.get(v6, "_glass") && Reflect.get(v6, "_blur"), "v6 programs");
    await wait(50);

    display.tick();
    const skye = readPixels(glOf(el));
    Reflect.set(v6, "_cur", null);
    Reflect.apply(Reflect.get(v6, "renderFrame"), v6, [1 / 60]);
    const v6Gl: unknown = Reflect.get(v6, "_gl");
    if (!(v6Gl instanceof WebGL2RenderingContext)) throw new Error("no v6 context");
    const reference = readPixels(v6Gl);
    v6Box.remove();
    v6Gl.getExtension("WEBGL_lose_context")?.loseContext();

    expect(skye.length).toBe(160 * 100 * devicePixelRatio ** 2 * 4);
    const result = compare(reference, skye, 160, skye.length / 4 / 160);
    expect(result.pass, describeComparison(result)).toBe(true);
  });
});

describe("zero-size and hidden containers", () => {
  function recordTextures(): number[][] {
    const sizes: number[][] = [];
    const original = contextMethod("texImage2D");
    vi.spyOn(WebGL2RenderingContext.prototype, "texImage2D").mockImplementation(function (
      this: WebGL2RenderingContext,
      ...args: unknown[]
    ) {
      sizes.push([Number(args[3]), Number(args[4])]);
      Reflect.apply(original, this, args);
    });
    return sizes;
  }

  function collectErrors(): unknown[] {
    const { errors, stop } = collectPageErrors();
    cleanups.push(stop);
    return errors;
  }

  it("waits in a 0x0 box without drawing, then draws once sized", async () => {
    const textures = recordTextures();
    const errors = collectErrors();
    const { el, box } = mount({ motion: "static", quality: "balanced" }, 0, 0);
    await nextEvent(el, SKYE_READY);
    await wait(100);
    expect(el.stats()).toMatchObject({ sky: [0, 0], passes: 0 });
    expect(textures).toEqual([]);

    box.style.width = "120px";
    box.style.height = "80px";
    await until(() => el.stats()?.passes !== 0, "a frame");
    // The balanced tier caps the ratio at 1.
    expect(el.stats()?.out).toEqual([120, 80]);
    expect(textures.length).toBeGreaterThan(0);
    expect(textures.every(([w, h]) => (w ?? 0) > 0 && (h ?? 0) > 0)).toBe(true);
    expect(errors).toEqual([]);
  });

  it("waits under display:none, then draws once shown", async () => {
    const textures = recordTextures();
    const errors = collectErrors();
    const { el, box } = mount({ motion: "static", quality: "balanced" });
    box.style.display = "none";
    await nextEvent(el, SKYE_READY);
    await wait(100);
    expect(el.stats()).toMatchObject({ sky: [0, 0], passes: 0 });
    expect(textures).toEqual([]);

    box.style.display = "block";
    await until(() => el.stats()?.passes !== 0, "a frame");
    expect(el.stats()?.out).toEqual([160, 100]);
    expect(textures.every(([w, h]) => (w ?? 0) > 0 && (h ?? 0) > 0)).toBe(true);

    // Hidden again: drawing pauses at the last size instead of shrinking to nothing.
    box.style.display = "none";
    await wait(50);
    el.setAttribute("hour", "3");
    await wait(50);
    expect(textures.every(([w, h]) => (w ?? 0) > 0 && (h ?? 0) > 0)).toBe(true);
    expect(errors).toEqual([]);
  });
});

describe("remount churn", () => {
  it("creates no context when removed before the idle start", async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const { el, box } = mount();
    const seen = record(el);
    box.remove();
    await wait(400);
    expect(webgl2Contexts(getContext)).toBe(0);
    expect(el.stats()).toBeNull();
    expect(seen).toEqual([]);
  });

  it("starts one sky through a synchronous disconnect and reconnect at mount", async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const { el, box } = mount({ motion: "static" });
    const seen = record(el);
    box.remove();
    document.body.append(box);
    await nextEvent(el, SKYE_READY);
    await wait(100);
    expect(webgl2Contexts(getContext)).toBe(1);
    expect(seen).toEqual([SKYE_READY]);
    await until(() => el.stats()?.passes !== 0, "a frame");
  });

  it("stops drawing on removal and keeps the same sky and loop when reinserted in the same task", async () => {
    const display = new Display().install();
    const { el, box } = mount({ motion: "full", quality: "balanced" });
    await nextEvent(el, SKYE_READY);
    await wait(50);
    const canvas = canvasOf(el);
    const gl = glOf(el);
    const mipmaps = vi.spyOn(gl, "generateMipmap");
    display.tick();
    expect(mipmaps).toHaveBeenCalledTimes(1);

    box.remove();
    display.tick();
    expect(mipmaps).toHaveBeenCalledTimes(1);

    document.body.append(box);
    await wait(50);
    expect(canvasOf(el)).toBe(canvas);
    expect(gl.isContextLost()).toBe(false);
    display.tick();
    display.tick();
    display.tick();
    expect(mipmaps).toHaveBeenCalledTimes(4);
  });

  it("frees the context after a removal and starts a new sky on reinsertion", async () => {
    const { el, box } = mount({ motion: "static" });
    const seen = record(el);
    await nextEvent(el, SKYE_READY);
    const canvas = canvasOf(el);
    const gl = glOf(el);
    box.remove();
    // Removal stops drawing at once; the teardown waits for the next task.
    expect(gl.isContextLost()).toBe(false);
    await wait(20);
    expect(gl.isContextLost()).toBe(true);
    expect(el.stats()).toBeNull();
    expect(canvasOf(el)).not.toBe(canvas);
    expect(coverOf(el).hidden).toBe(false);

    document.body.append(box);
    await nextEvent(el, SKYE_READY);
    await until(() => el.stats()?.passes !== 0, "a frame");
    expect(seen).toEqual([SKYE_READY, SKYE_READY]);
  });
});

describe("fallback", () => {
  it("shows the gradient until the sky is ready, then hides it", async () => {
    const { el } = mount({ scene: "clear", hour: "13" });
    const cover = coverOf(el);
    expect(cover.hidden).toBe(false);
    expect(cover.style.background).toBe(
      cssBackground(fallbackBackground({ scene: "clear", hour: 13 })),
    );
    el.setAttribute("hour", "2");
    expect(cover.style.background).toBe(
      cssBackground(fallbackBackground({ scene: "clear", hour: 2 })),
    );
    await nextEvent(el, SKYE_READY);
    await until(() => cover.hidden === true, "the gradient to hide");
    expect(el.getAttribute("style")).toBeNull();
  });

  it("keeps the gradient and emits skye-fallback without WebGL2", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    const { el } = mount({ scene: "storm", hour: "22" });
    const seen = record(el);
    await nextEvent(el, SKYE_FALLBACK);
    const cover = coverOf(el);
    expect(cover.hidden).toBe(false);
    expect(cover.style.background).toBe(cssBackground(fallbackBackground({ scene: "storm" })));
    expect(canvasOf(el)).toBeNull();
    expect(el.stats()).toBeNull();
    expect(el.getAttribute("style")).toBeNull();

    el.setAttribute("scene", "snowy");
    expect(cover.style.background).toBe(
      cssBackground(fallbackBackground({ scene: "snowy", hour: 22 })),
    );
    await wait(50);
    expect(seen).toEqual([SKYE_FALLBACK]);
  });

  it("reports a failed shader build as skye-error and keeps the gradient", async () => {
    const original = contextMethod("getProgramParameter");
    vi.spyOn(WebGL2RenderingContext.prototype, "getProgramParameter").mockImplementation(function (
      this: WebGL2RenderingContext,
      program: WebGLProgram,
      pname: number,
    ): unknown {
      return pname === LINK_STATUS ? false : Reflect.apply(original, this, [program, pname]);
    });
    const { el } = mount();
    const seen = record(el);
    const event = await nextEvent(el, SKYE_ERROR);
    expect(event instanceof CustomEvent && event.detail instanceof ShaderError).toBe(true);
    await wait(50);
    expect(coverOf(el).hidden).toBe(false);
    expect(seen).toEqual([SKYE_ERROR]);
  });
});

describe("context loss", () => {
  it("replaces the canvas when the browser does not restore the context in time", async () => {
    SkyeElement.restoreTimeoutMs = 50;
    const { el } = mount({ motion: "static" });
    const seen = record(el);
    await nextEvent(el, SKYE_READY);
    const canvas = canvasOf(el);
    const gl = glOf(el);
    const lost = nextEvent(el, SKYE_CONTEXTLOST);
    const restored = nextEvent(el, SKYE_CONTEXTRESTORED);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    await lost;
    // The gradient covers the blank canvas until drawing resumes.
    expect(coverOf(el).hidden).toBe(false);
    await restored;
    expect(seen).toEqual([SKYE_READY, SKYE_CONTEXTLOST, SKYE_CONTEXTRESTORED]);
    expect(canvasOf(el)).not.toBe(canvas);
    expect(glOf(el).isContextLost()).toBe(false);

    const display = new Display().install();
    // Past any frame already requested from the real display.
    await wait(100);
    el.setAttribute("hour", "13");
    display.tick();
    expect(nonBlack(readPixels(glOf(el)))).toBeGreaterThan(0);
    expect(el.stats()?.passes).toBeGreaterThan(0);
    display.tick();
    expect(coverOf(el).hidden).toBe(true);
  });

  it("times a second loss that comes before the relink and replaces the canvas", async () => {
    SkyeElement.restoreTimeoutMs = 300;
    const { el } = mount({ motion: "static" });
    const seen = record(el);
    await nextEvent(el, SKYE_READY);
    const canvas = canvasOf(el);
    if (canvas === null) throw new Error("no canvas");
    const ext = glOf(el).getExtension("WEBGL_lose_context");
    if (ext === null) throw new Error("no WEBGL_lose_context");
    // Lost again the moment it comes back, before the programs relink; never restored after that.
    canvas.addEventListener("webglcontextrestored", () => ext.loseContext(), { once: true });
    const lost = nextEvent(el, SKYE_CONTEXTLOST);
    ext.loseContext();
    await lost;
    await wait(0);
    const restored = nextEvent(el, SKYE_CONTEXTRESTORED);
    ext.restoreContext();
    await restored;
    expect(canvasOf(el)).not.toBe(canvas);
    expect(seen).toEqual([SKYE_READY, SKYE_CONTEXTLOST, SKYE_CONTEXTRESTORED]);
    await until(() => el.stats()?.passes !== 0, "a frame");
    await until(() => coverOf(el).hidden === true, "the gradient to hide");
  });

  it("drops the restore timer when the element is removed", async () => {
    SkyeElement.restoreTimeoutMs = 100;
    const { el, box } = mount({ motion: "static" });
    const seen = record(el);
    await nextEvent(el, SKYE_READY);
    const ext = glOf(el).getExtension("WEBGL_lose_context");
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const lost = nextEvent(el, SKYE_CONTEXTLOST);
    ext?.loseContext();
    await lost;
    box.remove();
    await wait(300);
    expect(webgl2Contexts(getContext)).toBe(0);
    expect(el.stats()).toBeNull();
    expect(seen).toEqual([SKYE_READY, SKYE_CONTEXTLOST]);

    document.body.append(box);
    await nextEvent(el, SKYE_READY);
    expect(seen).toEqual([SKYE_READY, SKYE_CONTEXTLOST, SKYE_READY]);
  });

  it("replaces the canvas while hidden, and draws once shown", async () => {
    SkyeElement.restoreTimeoutMs = 50;
    const { el, box } = mount({ motion: "static" });
    await nextEvent(el, SKYE_READY);
    const canvas = canvasOf(el);
    box.style.display = "none";
    await wait(100);
    const restored = nextEvent(el, SKYE_CONTEXTRESTORED);
    glOf(el).getExtension("WEBGL_lose_context")?.loseContext();
    await restored;
    expect(canvasOf(el)).not.toBe(canvas);
    await wait(100);
    expect(el.stats()?.passes).toBe(0);
    expect(coverOf(el).hidden).toBe(false);

    box.style.display = "block";
    await until(() => el.stats()?.passes !== 0, "a frame");
    await until(() => coverOf(el).hidden === true, "the gradient to hide");
  });

  it("frees the context when the sky cannot be built on it", async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    // createShader returns null only on a lost context; the sky's constructor then throws.
    vi.spyOn(WebGL2RenderingContext.prototype, "createShader").mockImplementation(() => null);
    const { el } = mount();
    const seen = record(el);
    const event = await nextEvent(el, SKYE_ERROR);
    expect(event instanceof CustomEvent && event.detail instanceof Error).toBe(true);
    const contexts = getContext.mock.results
      .map(({ value }: { value: unknown }) => value)
      .filter((v) => v instanceof WebGL2RenderingContext);
    expect(contexts.length).toBeGreaterThan(0);
    expect(contexts.every((gl) => gl.isContextLost())).toBe(true);
    expect(coverOf(el).hidden).toBe(false);
    expect(seen).toEqual([SKYE_ERROR]);
  });

  it("keeps the canvas when the browser restores the context promptly", async () => {
    SkyeElement.restoreTimeoutMs = 400;
    const { el } = mount({ motion: "static" });
    const seen = record(el);
    await nextEvent(el, SKYE_READY);
    const canvas = canvasOf(el);
    const ext = glOf(el).getExtension("WEBGL_lose_context");
    if (ext === null) throw new Error("no WEBGL_lose_context");
    const lost = nextEvent(el, SKYE_CONTEXTLOST);
    ext.loseContext();
    await lost;
    expect(coverOf(el).hidden).toBe(false);
    await wait(0);
    ext.restoreContext();
    await nextEvent(el, SKYE_CONTEXTRESTORED);
    await until(() => coverOf(el).hidden === true, "the gradient to hide");
    await wait(600);
    expect(canvasOf(el)).toBe(canvas);
    expect(seen).toEqual([SKYE_READY, SKYE_CONTEXTLOST, SKYE_CONTEXTRESTORED]);
    await until(() => el.stats()?.passes !== 0, "a frame");
  });
});

describe("events", () => {
  it("bubble and cross shadow roots", async () => {
    const outer = document.createElement("div");
    const root = outer.attachShadow({ mode: "open" });
    const box = document.createElement("div");
    box.style.cssText = "position:relative;width:80px;height:50px";
    const el = document.createElement("skye-view");
    box.append(el);
    root.append(box);
    document.body.append(outer);
    track(outer);
    const path = new Promise<EventTarget[]>((resolve) => {
      document.addEventListener(SKYE_READY, (e) => resolve(e.composedPath()), { once: true });
    });
    const event = await nextEvent(document, SKYE_READY);
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
    expect((await path)[0]).toBe(el);
  });
});

describe("environment", () => {
  class FakeQuery extends EventTarget implements MediaQueryList {
    matches = false;
    readonly media: string;
    onchange = null;
    constructor(media: string) {
      super();
      this.media = media;
    }
    addListener(): void {}
    removeListener(): void {}
    fire(): void {
      this.dispatchEvent(new Event("change"));
    }
  }

  /** Replaces matchMedia; each query string maps to one controllable list. */
  function fakeQueries(): Map<string, FakeQuery> {
    const queries = new Map<string, FakeQuery>();
    vi.stubGlobal("matchMedia", (media: string): MediaQueryList => {
      const query = queries.get(media) ?? new FakeQuery(media);
      queries.set(media, query);
      return query;
    });
    return queries;
  }

  it("pauses while the document is hidden", async () => {
    const display = new Display().install();
    const { el } = mount({ motion: "full" });
    await nextEvent(el, SKYE_READY);
    await wait(50);
    const mipmaps = vi.spyOn(glOf(el), "generateMipmap");
    display.tick();
    expect(mipmaps).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    cleanups.push(() => Reflect.deleteProperty(document, "hidden"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(display.pending).toBe(0);
    display.tick();
    expect(mipmaps).toHaveBeenCalledTimes(1);

    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    display.tick();
    display.tick();
    expect(mipmaps).toHaveBeenCalledTimes(3);
  });

  it("forwards reduced-motion changes", async () => {
    const queries = fakeQueries();
    const { el } = mount({ motion: "auto" });
    await nextEvent(el, SKYE_READY);
    expect(el.stats()?.static).toBe(false);
    const reduced = queries.get("(prefers-reduced-motion: reduce)");
    if (reduced === undefined) throw new Error("reduced motion not watched");
    reduced.matches = true;
    reduced.fire();
    expect(el.stats()?.static).toBe(true);
  });

  it("follows device pixel ratio changes", async () => {
    const queries = fakeQueries();
    vi.stubGlobal("devicePixelRatio", 1);
    const { el } = mount({ motion: "static", quality: "high" });
    await nextEvent(el, SKYE_READY);
    await until(() => el.stats()?.out[0] === 160, "a frame at ratio 1");
    const query = queries.get("(resolution: 1dppx)");
    if (query === undefined) throw new Error("ratio not watched");
    vi.stubGlobal("devicePixelRatio", 2);
    query.fire();
    // The high tier caps the ratio at 1.5.
    await until(() => el.stats()?.out[0] === 240, "a frame at ratio 1.5");
    expect(queries.has("(resolution: 2dppx)")).toBe(true);
  });
});

describe("styles", () => {
  it("adopts one shared stylesheet with v6's host styles and no inline <style>", () => {
    const a = mount().el;
    const b = mount().el;
    expect(a.shadowRoot?.querySelector("style")).toBeNull();
    const sheets = a.shadowRoot?.adoptedStyleSheets ?? [];
    expect(sheets).toHaveLength(1);
    expect(b.shadowRoot?.adoptedStyleSheets[0]).toBe(sheets[0]);
    const host = getComputedStyle(a);
    expect([host.display, host.position, host.overflow, host.backgroundColor]).toEqual([
      "block",
      "absolute",
      "hidden",
      "rgb(26, 36, 64)",
    ]);
    expect(host.width).toBe("160px");
  });
});

describe("defineSkye", () => {
  it("is idempotent and gives other tags their own subclass", () => {
    expect(defineSkye()).toBe(SkyeElement);
    expect(customElements.get("skye-view")).toBe(SkyeElement);
    const other = defineSkye("other-sky");
    expect(other).not.toBe(SkyeElement);
    expect(other.prototype).toBeInstanceOf(SkyeElement);
    expect(defineSkye("other-sky")).toBe(other);
    expect(document.createElement("other-sky")).toBeInstanceOf(SkyeElement);
    // Typed as the element class, so its statics are reachable without a cast.
    expect(other.restoreTimeoutMs).toBe(SkyeElement.restoreTimeoutMs);
  });

  it("refuses a tag another element already holds", () => {
    customElements.define("not-a-sky", class extends HTMLElement {});
    expect(() => defineSkye("not-a-sky")).toThrow(/already defined/);
  });
});
