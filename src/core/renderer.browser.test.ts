import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTEXT_ATTRIBUTES } from "../gl/context.ts";
import { createSky, ShaderError, type Sky } from "../index.ts";

const skies: Sky[] = [];
const canvases: HTMLCanvasElement[] = [];

type Fake = (gl: WebGL2RenderingContext) => void;

/** `fake` may stub the context before the sky takes it; getContext hands the sky the same instance. */
function make(
  params: Parameters<typeof createSky>[1] = {},
  fake?: Fake,
): { sky: Sky; canvas: HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  if (fake !== undefined) {
    const gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
    if (gl === null) throw new Error("no WebGL2");
    fake(gl);
  }
  const sky = createSky(canvas, { quality: "balanced", ...params });
  skies.push(sky);
  canvases.push(canvas);
  return { sky, canvas };
}

function nextEvent(sky: Sky, event: "ready" | "error"): Promise<unknown> {
  return new Promise((resolve) => sky.on(event, resolve));
}

const COMPLETION_STATUS_KHR = 0x91b1;

// Every link fails; programs report settled at once so the failure is seen on the first check.
const failLinks: Fake = (gl) => {
  const getProgramParameter = gl.getProgramParameter.bind(gl);
  vi.spyOn(gl, "getProgramParameter").mockImplementation((p, pname) => {
    if (pname === gl.LINK_STATUS) return false;
    if (pname === COMPLETION_STATUS_KHR) return true;
    return getProgramParameter(p, pname);
  });
};

/** What a stubbed driver was asked while the sky compiled. */
interface Driver {
  /** Whether a parallel-compiling driver reports the programs done. */
  done: boolean;
  /** Whether links succeed. */
  links: boolean;
  completionReads: number;
  linkReads: number;
}

function driver(links = true): Driver {
  return { done: false, links, completionReads: 0, linkReads: 0 };
}

/**
 * A driver that compiles in the background until `d.done`, with the extension (`parallel`), or one without it,
 * whose link status is final as soon as it is read. Counts the reads of either status.
 */
function compiling(d: Driver, parallel: boolean): Fake {
  return (gl) => {
    const getExtension = gl.getExtension.bind(gl);
    const getProgramParameter = gl.getProgramParameter.bind(gl);
    Reflect.set(gl, "getExtension", (name: string) => {
      if (name !== "KHR_parallel_shader_compile") return getExtension(name);
      return parallel ? { COMPLETION_STATUS_KHR } : null;
    });
    vi.spyOn(gl, "getProgramParameter").mockImplementation((p, pname) => {
      if (pname === COMPLETION_STATUS_KHR) {
        d.completionReads++;
        return d.done;
      }
      if (pname === gl.LINK_STATUS) {
        d.linkReads++;
        if (!d.links) return false;
      }
      return getProgramParameter(p, pname);
    });
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const s of skies.splice(0)) s.dispose();
  for (const c of canvases.splice(0))
    c.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
});

describe("createSky", () => {
  it("emits ready once, after createSky returns", async () => {
    const { sky } = make();
    let count = 0;
    sky.on("ready", () => count++);
    expect(count).toBe(0);
    await nextEvent(sky, "ready");
    sky.render(0);
    sky.render(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(count).toBe(1);
  });

  it("draws nothing until a parallel-compiling driver reports the programs done", async () => {
    let done = false;
    const { sky } = make({}, (gl) => {
      const getExtension = gl.getExtension.bind(gl);
      const getProgramParameter = gl.getProgramParameter.bind(gl);
      // An own property shadows the prototype method on this one context.
      Reflect.set(gl, "getExtension", (name: string) =>
        name === "KHR_parallel_shader_compile" ? { COMPLETION_STATUS_KHR } : getExtension(name),
      );
      vi.spyOn(gl, "getProgramParameter").mockImplementation((p, pname) =>
        pname === COMPLETION_STATUS_KHR ? done : getProgramParameter(p, pname),
      );
    });
    const ready = vi.fn();
    sky.on("ready", ready);
    sky.resize(64, 40, 1);
    sky.render(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(ready).not.toHaveBeenCalled();
    expect(sky.stats().passes).toBe(0);
    expect(sky.stats().sky).toEqual([0, 0]);
    done = true;
    sky.render(0.1);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(sky.stats().passes).toBeGreaterThan(0);
  });

  it("reports a failed shader build through the error event and stays blank", async () => {
    const { sky } = make({}, failLinks);
    const ready = vi.fn();
    sky.on("ready", ready);
    const error = await nextEvent(sky, "error");
    expect(error).toBeInstanceOf(ShaderError);
    expect(String(error)).toMatch(/shader program failed/);
    sky.render(0);
    expect(ready).not.toHaveBeenCalled();
    expect(sky.stats().passes).toBe(0);
  });

  it("throws a failed shader build from render when nobody listens for errors", () => {
    const { sky } = make({}, failLinks);
    expect(() => sky.render(0)).toThrow(ShaderError);
    expect(() => sky.render(1)).not.toThrow();
  });

  it("keeps a failure found in the background for the next render, without throwing from a timer", async () => {
    const { sky } = make({}, failLinks);
    sky.start();
    // A throw from the compile poll would surface here as an unhandled error and fail the run.
    await new Promise((r) => setTimeout(r, 50));
    expect(() => sky.render(0)).toThrow(ShaderError);
    expect(() => sky.render(1)).not.toThrow();
    expect(sky.stats().passes).toBe(0);
  });

  it("replays a kept failure to a listener added later, on a microtask, and then render stays quiet", async () => {
    const { sky } = make({}, failLinks);
    await new Promise((r) => setTimeout(r, 50));
    const seen: Error[] = [];
    sky.on("error", (e) => seen.push(e));
    expect(seen).toEqual([]);
    await Promise.resolve();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(ShaderError);
    expect(() => sky.render(0)).not.toThrow();
    // Every later listener gets it too.
    const late = await nextEvent(sky, "error");
    expect(late).toBe(seen[0]);
  });

  it("throws from render when the only listener left before its replay", async () => {
    const { sky } = make({}, failLinks);
    await new Promise((r) => setTimeout(r, 50));
    const off = sky.on("error", () => undefined);
    off();
    await Promise.resolve();
    expect(() => sky.render(0)).toThrow(ShaderError);
  });

  it("does not throw from render while a listener awaits its replay", async () => {
    const { sky } = make({}, failLinks);
    await new Promise((r) => setTimeout(r, 50));
    const listener = vi.fn();
    sky.on("error", listener);
    expect(() => sky.render(0)).not.toThrow();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not replay to a listener removed before the microtask", async () => {
    const { sky } = make({}, failLinks);
    await nextEvent(sky, "error");
    const listener = vi.fn();
    const off = sky.on("error", listener);
    off();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
  });

  it("sizes the canvas from resize, capped by the tier's pixel ratio", async () => {
    const { sky, canvas } = make({ quality: "high" });
    await nextEvent(sky, "ready");
    sky.resize(100, 50, 3);
    sky.render(0);
    expect([canvas.width, canvas.height]).toEqual([150, 75]);
    sky.update({ quality: "low" });
    sky.render(0.016);
    expect([canvas.width, canvas.height]).toEqual([100, 50]);
    expect(sky.stats()).toMatchObject({
      renderer: "skye",
      worker: false,
      quality: "low",
      auto: false,
      tier: 1,
      out: [100, 50],
      sky: [30, 15],
      scene: [50, 25],
      fpsCap: 30,
    });
  });

  it("sizes eco below one canvas pixel per CSS px, and follows the tier in and out of it", async () => {
    const { sky, canvas } = make({ quality: "eco" });
    await nextEvent(sky, "ready");
    sky.resize(160, 80, 2);
    sky.render(0);
    const eco = { out: [120, 60], sky: [36, 18], scene: [60, 30] };
    expect([canvas.width, canvas.height]).toEqual(eco.out);
    expect(sky.stats()).toMatchObject({ quality: "eco", auto: false, tier: 1, fpsCap: 20, ...eco });
    sky.update({ quality: "balanced" });
    sky.render(0.016);
    expect(sky.stats()).toMatchObject({ quality: "balanced", out: [160, 80], sky: [72, 36] });
    sky.update({ quality: "eco" });
    sky.render(0.032);
    expect(sky.stats()).toMatchObject({ quality: "eco", ...eco });
    sky.update({ quality: "auto" });
    sky.render(0.048);
    expect(sky.stats()).toMatchObject({ quality: "balanced", auto: true, tier: 1, out: [160, 80] });
  });

  it("does nothing after dispose, however often it is called", async () => {
    const { sky } = make();
    await nextEvent(sky, "ready");
    sky.dispose();
    sky.dispose();
    expect(() => {
      sky.update({ scene: "storm" });
      sky.resize(10, 10, 1);
      sky.render(0);
    }).not.toThrow();
    expect(sky.stats().passes).toBe(0);
    expect(typeof sky.on("ready", () => undefined)).toBe("function");
  });

  it("ignores a non-finite time", async () => {
    const { sky } = make();
    await nextEvent(sky, "ready");
    sky.resize(32, 20, 1);
    sky.render(Number.NaN);
    expect(sky.stats().passes).toBe(0);
  });
});

describe("compiling", () => {
  const MODES = [
    ["with", true],
    ["without", false],
  ] as const;

  it("reads no link status until the driver reports the programs done, then gets ready by itself", async () => {
    const d = driver();
    const { sky } = make({}, compiling(d, true));
    const ready = vi.fn();
    sky.on("ready", ready);
    await new Promise((r) => setTimeout(r, 50));
    expect(d.completionReads).toBeGreaterThan(0);
    expect(d.linkReads).toBe(0);
    expect(ready).not.toHaveBeenCalled();
    d.done = true;
    // No render: the sky's own poll finds the programs done.
    await nextEvent(sky, "ready");
    expect(ready).toHaveBeenCalledTimes(1);
    expect(d.linkReads).toBeGreaterThan(0);
    // Polling stops once ready.
    const reads = d.completionReads;
    await new Promise((r) => setTimeout(r, 30));
    expect(d.completionReads).toBe(reads);
  });

  it("polls every millisecond at first, then once a frame while the driver is still compiling", () => {
    // Fake timers run each poll at exactly its delay, without the browser's 4 ms stretch.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const d = driver();
      make({}, compiling(d, true));
      // Each poll reads the first program's completion and stops there.
      vi.advanceTimersByTime(25);
      expect(d.completionReads).toBe(25);
      vi.advanceTimersByTime(15);
      expect(d.completionReads).toBe(25);
      vi.advanceTimersByTime(1);
      expect(d.completionReads).toBe(26);
      vi.advanceTimersByTime(160);
      expect(d.completionReads).toBe(36);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(MODES)(
    "emits ready after createSky returns, %s parallel compile",
    async (_, parallel) => {
      const d = driver();
      d.done = true;
      const seen: string[] = [];
      const { sky } = make({}, compiling(d, parallel));
      sky.on("ready", () => seen.push("ready"));
      sky.on("error", () => seen.push("error"));
      expect(seen).toEqual([]);
      await nextEvent(sky, "ready");
      expect(seen).toEqual(["ready"]);
      sky.resize(32, 20, 1);
      sky.render(0);
      expect(sky.stats().passes).toBeGreaterThan(0);
    },
  );

  it.each(MODES)(
    "reports a failed link as error, never ready, %s parallel compile",
    async (_, parallel) => {
      const d = driver(false);
      const seen: string[] = [];
      const { sky } = make({}, compiling(d, parallel));
      sky.on("ready", () => seen.push("ready"));
      sky.on("error", () => seen.push("error"));
      await new Promise((r) => setTimeout(r, 30));
      // A parallel-compiling driver has not finished, so the failure is not known yet.
      expect(seen).toEqual(parallel ? [] : ["error"]);
      expect(d.linkReads > 0).toBe(!parallel);
      d.done = true;
      const error = parallel ? await nextEvent(sky, "error") : undefined;
      if (parallel) expect(error).toBeInstanceOf(ShaderError);
      // Polling stops once the failure is known.
      const reads = d.completionReads;
      await new Promise((r) => setTimeout(r, 30));
      expect(d.completionReads).toBe(reads);
      expect(seen).toEqual(["error"]);
      sky.render(0);
      expect(sky.stats().passes).toBe(0);
    },
  );

  it.each(MODES)(
    "stops compiling when disposed mid-compile, %s parallel compile",
    async (_, parallel) => {
      const d = driver();
      const { sky } = make({}, compiling(d, parallel));
      const events = vi.fn();
      sky.on("ready", events);
      sky.on("error", events);
      // With the extension, after a few polls; without it, before the first, which would read the link status.
      if (parallel) await new Promise((r) => setTimeout(r, 20));
      sky.dispose();
      const reads = d.completionReads + d.linkReads;
      d.done = true;
      await new Promise((r) => setTimeout(r, 50));
      expect(d.completionReads + d.linkReads).toBe(reads);
      expect(d.linkReads).toBe(0);
      expect(events).not.toHaveBeenCalled();
    },
  );
});
