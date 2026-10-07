import { afterEach, describe, expect, it, vi } from "vitest";
import { Display } from "../../test/support/display.ts";
import { disposeSkies, makeSky, next, readPixels, wait } from "../../test/support/sky.ts";
import type { Sky } from "../index.ts";

const COMPLETION_STATUS_KHR = 0x91b1;
const PARAMS = { motion: "static", scene: "clear", hour: 13, quality: "balanced" } as const;

function loseContextExt(gl: WebGL2RenderingContext): WEBGL_lose_context {
  const ext = gl.getExtension("WEBGL_lose_context");
  if (ext === null) throw new Error("no WEBGL_lose_context");
  return ext;
}

// Resolves after every listener of the event has run, so the event's final state can be read.
function nextCanvasEvent(canvas: HTMLCanvasElement, type: string): Promise<Event> {
  return new Promise((resolve) => {
    canvas.addEventListener(type, (e) => setTimeout(() => resolve(e), 0), { once: true });
  });
}

function record(sky: Sky): string[] {
  const seen: string[] = [];
  for (const name of ["ready", "error", "contextlost", "contextrestored"] as const)
    sky.on(name, () => seen.push(name));
  return seen;
}

function nonBlack(pixels: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) n++;
  return n;
}

function maxDifference(a: Uint8Array, b: Uint8Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return max;
}

// Hides the extension, so link status is read at once (the path where a lost context looks like a failed link).
function serialCompile(gl: WebGL2RenderingContext): void {
  const getExtension = gl.getExtension.bind(gl);
  Reflect.set(gl, "getExtension", (name: string) =>
    name === "KHR_parallel_shader_compile" ? null : getExtension(name),
  );
}

// Reports the extension, with completion read as a driver does: null once the context is lost.
function parallelCompile(gl: WebGL2RenderingContext): void {
  const getExtension = gl.getExtension.bind(gl);
  const getProgramParameter = gl.getProgramParameter.bind(gl);
  Reflect.set(gl, "getExtension", (name: string) =>
    name === "KHR_parallel_shader_compile" ? { COMPLETION_STATUS_KHR } : getExtension(name),
  );
  vi.spyOn(gl, "getProgramParameter").mockImplementation((p, pname) => {
    if (pname !== COMPLETION_STATUS_KHR) return getProgramParameter(p, pname);
    return gl.isContextLost() ? null : true;
  });
}

// A timer extension whose every query finishes at once and measured 3 ms.
function fakeTimer(gl: WebGL2RenderingContext): void {
  const TIME_ELAPSED_EXT = 0x88bf;
  const GPU_DISJOINT_EXT = 0x8fbb;
  const getExtension = gl.getExtension.bind(gl);
  const getParameter = gl.getParameter.bind(gl);
  Reflect.set(gl, "getExtension", (name: string) =>
    name === "EXT_disjoint_timer_query_webgl2"
      ? { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT }
      : getExtension(name),
  );
  vi.spyOn(gl, "beginQuery").mockImplementation(() => undefined);
  vi.spyOn(gl, "endQuery").mockImplementation(() => undefined);
  vi.spyOn(gl, "getQueryParameter").mockImplementation((_q, pname) =>
    pname === gl.QUERY_RESULT_AVAILABLE ? true : 3e6,
  );
  vi.spyOn(gl, "getParameter").mockImplementation((pname: number) =>
    pname === GPU_DISJOINT_EXT ? false : getParameter(pname),
  );
}

afterEach(() => {
  disposeSkies();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("context loss", () => {
  it("stops on loss, rebuilds on restore, and draws again", async () => {
    const display = new Display().install();
    const { sky, gl, canvas, frames } = makeSky(PARAMS);
    const seen = record(sky);
    await next(sky, "ready");
    sky.resize(48, 30, 1);
    sky.start();
    display.tick();
    const before = readPixels(gl);
    expect(nonBlack(before)).toBe(48 * 30);

    const ext = loseContextExt(gl);
    const lostEvent = nextCanvasEvent(canvas, "webglcontextlost");
    ext.loseContext();
    expect((await lostEvent).defaultPrevented).toBe(true);
    expect(seen).toContain("contextlost");
    expect(display.pending).toBe(0);
    expect(() => sky.render(1)).not.toThrow();
    sky.update({ hour: 13 });
    display.tick();
    expect(frames()).toBe(1);

    ext.restoreContext();
    await next(sky, "contextrestored");
    // The static frame the restore owes is already requested.
    expect(display.pending).toBe(1);
    display.tick();
    expect(frames()).toBe(2);
    const after = readPixels(gl);
    expect(nonBlack(after)).toBe(48 * 30);
    // Same params and size; only the wind drift of one more static frame may differ.
    expect(maxDifference(before, after)).toBeLessThanOrEqual(2);
    expect(seen).toEqual(["ready", "contextlost", "contextrestored"]);
    expect(sky.stats().passes).toBeGreaterThan(0);
  });

  it("keeps the detail scale across a restore, as v6 keeps _dsc", async () => {
    // Settled at blur 7 the sky buffers run at 0.75 detail; the first frame toward 64 is still under the
    // 8 px switch, so it keeps whatever scale the sky had.
    const params = { ...PARAMS, motion: "full", blur: 7 } as const;
    const plain = makeSky(params);
    const restored = makeSky(params);
    await Promise.all([next(plain.sky, "ready"), next(restored.sky, "ready")]);
    for (const { sky } of [plain, restored]) {
      sky.resize(200, 100, 1);
      for (let i = 0; i <= 60; i++) sky.render(i / 60);
    }
    const ext = loseContextExt(restored.gl);
    ext.loseContext();
    await next(restored.sky, "contextlost");
    await wait(0);
    ext.restoreContext();
    await next(restored.sky, "contextrestored");
    for (const { sky } of [plain, restored]) {
      sky.update({ blur: 64 });
      sky.render(1.1);
    }
    const a = plain.sky.stats();
    const b = restored.sky.stats();
    expect(b.sky).toEqual(a.sky);
    expect(b.scene).toEqual(a.scene);
    // 200 x 100 at the balanced tier's 0.45 sky scale, times 0.75 detail.
    expect(a.sky).toEqual([68, 34]);
  });

  it("keeps the GPU-time average across a restore, as v6 keeps _gpuMs", async () => {
    const { sky, gl } = makeSky({ ...PARAMS, quality: "auto" }, fakeTimer);
    await next(sky, "ready");
    sky.resize(32, 20, 1);
    sky.render(0);
    expect(sky.stats().gpuMs).toBe(3);
    const ext = loseContextExt(gl);
    ext.loseContext();
    await next(sky, "contextlost");
    await wait(0);
    ext.restoreContext();
    await next(sky, "contextrestored");
    expect(sky.stats()).toMatchObject({ gpuMs: 3, timer: true });
  });

  it("resumes the running loop after a restore", async () => {
    const display = new Display().install();
    const { sky, gl, frames } = makeSky({ ...PARAMS, motion: "full" });
    await next(sky, "ready");
    sky.resize(32, 20, 1);
    sky.start();
    display.tick();
    const ext = loseContextExt(gl);
    ext.loseContext();
    await next(sky, "contextlost");
    await wait(0);
    ext.restoreContext();
    await next(sky, "contextrestored");
    display.tick();
    display.tick();
    expect(frames()).toBe(3);
    expect(display.pending).toBe(1);
  });

  it.each([
    ["serial", serialCompile],
    ["parallel", parallelCompile],
  ] as const)("recovers from a loss during %s compilation", async (_, prepare) => {
    const display = new Display().install();
    const { sky, gl, frames } = makeSky(PARAMS, prepare);
    const seen = record(sky);
    const ext = loseContextExt(gl);
    // Before the first compile poll: the programs never link on this context.
    ext.loseContext();
    await next(sky, "contextlost");
    await wait(50);
    expect(seen).toEqual(["contextlost"]);

    ext.restoreContext();
    await next(sky, "ready");
    expect(seen).toEqual(["contextlost", "contextrestored", "ready"]);
    sky.resize(32, 20, 1);
    sky.start();
    display.tick();
    expect(frames()).toBe(1);
    expect(nonBlack(readPixels(gl))).toBe(32 * 20);
  });
});

describe("dispose", () => {
  const KINDS = [
    ["createTexture", "isTexture"],
    ["createFramebuffer", "isFramebuffer"],
    ["createBuffer", "isBuffer"],
    ["createVertexArray", "isVertexArray"],
    ["createProgram", "isProgram"],
    ["createShader", "isShader"],
    ["createQuery", "isQuery"],
  ] as const;

  it("releases every GPU object, stops the loop and stops listening to the canvas", async () => {
    const display = new Display().install();
    const created = new Map<string, unknown[]>();
    const { sky, gl, canvas, frames } = makeSky({ ...PARAMS, motion: "full" }, (ctx) => {
      for (const [create] of KINDS) {
        const list: unknown[] = [];
        created.set(create, list);
        const original: unknown = Reflect.get(ctx, create);
        if (typeof original !== "function") throw new Error(`no ${create}`);
        Reflect.set(ctx, create, (...args: unknown[]): unknown => {
          const object: unknown = Reflect.apply(original, ctx, args);
          list.push(object);
          return object;
        });
      }
    });
    await next(sky, "ready");
    sky.resize(32, 20, 1);
    sky.probe(true);
    sky.update({ blur: 8 });
    sky.start();
    for (let i = 0; i < 8; i++) display.tick();
    const is = (name: string, object: unknown): boolean => {
      const check: unknown = Reflect.get(gl, name);
      if (typeof check !== "function") throw new Error(`no ${name}`);
      return Reflect.apply(check, gl, [object]) === true;
    };
    // Linked programs have already dropped their shaders.
    for (const [create, check] of KINDS) {
      if (create === "createShader") continue;
      for (const object of created.get(create) ?? []) expect(is(check, object)).toBe(true);
    }

    const drawn = frames();
    sky.dispose();
    for (const [create, check] of KINDS)
      for (const object of created.get(create) ?? []) expect(is(check, object), create).toBe(false);
    expect(display.pending).toBe(0);
    display.tick();
    expect(frames()).toBe(drawn);

    const lostEvent = nextCanvasEvent(canvas, "webglcontextlost");
    loseContextExt(gl).loseContext();
    expect((await lostEvent).defaultPrevented).toBe(false);
  });
});
