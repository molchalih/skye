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
