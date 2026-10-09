import { afterEach, describe, expect, it } from "vitest";
import { disposeSkies, makeSky, next, readPixels, wait } from "../../test/support/sky.ts";
import type { SkyeParams } from "../index.ts";
import { BLUR_FS, GLASS_FS } from "../shaders/generated.ts";

// The blur targets need no particles or rays, and software GL in headless Chromium is slow.
const BLUR_PARAMS: Partial<SkyeParams> = {
  scene: "cloudy",
  hour: 10,
  motion: "full",
  quality: "low",
};
// Every pass but the blur chain: particles, rays and glass.
const PARAMS: Partial<SkyeParams> = { scene: "rainy", hour: 10, motion: "full", quality: "high" };
// Frames 0.1 s apart, the longest interval a frame advances by, so the 0.62 s blur tween takes few frames.
const STEP = 0.1;
const FADE_FRAMES = 8;

/** The storage a texture holds, as its last level-0 `texImage2D` left it, and how often that ran. */
interface Storage {
  width: number;
  height: number;
  allocations: number;
}

/** What a context's textures hold, found by watching the calls a sky makes. */
interface Textures {
  /** Every live texture that holds storage. */
  held(): Storage[];
  /** The live textures the glass and blur passes draw into: the blur targets. */
  blurTargets(): Storage[];
}

// Wraps a context method; `after` sees each call's arguments and result.
function intercept(
  gl: WebGL2RenderingContext,
  name: string,
  after: (args: unknown[], result: unknown) => void,
): void {
  const original: unknown = Reflect.get(gl, name);
  if (typeof original !== "function") throw new Error(`no ${name}`);
  Reflect.set(gl, name, (...args: unknown[]): unknown => {
    const result: unknown = Reflect.apply(original, gl, args);
    after(args, result);
    return result;
  });
}

function trackTextures(gl: WebGL2RenderingContext): Textures {
  const storage = new Map<WebGLTexture, Storage>();
  const blurTargets = new Set<unknown>();
  const attached = new Map<unknown, unknown>();
  const shaders = new Set<unknown>();
  const programs = new Set<unknown>();
  let texture: unknown;
  let framebuffer: unknown;
  let program: unknown;
  intercept(gl, "createTexture", (_, t) => {
    if (t instanceof WebGLTexture) storage.set(t, { width: 0, height: 0, allocations: 0 });
  });
  // A target binds its texture right before allocating it.
  intercept(gl, "bindTexture", ([, t]) => (texture = t));
  intercept(gl, "texImage2D", ([, level, , width, height]) => {
    const s = texture instanceof WebGLTexture ? storage.get(texture) : undefined;
    if (s === undefined || level !== 0) return;
    s.width = Number(width);
    s.height = Number(height);
    s.allocations++;
  });
  intercept(gl, "shaderSource", ([shader, source]) => {
    if (source === GLASS_FS || source === BLUR_FS) shaders.add(shader);
  });
  intercept(gl, "attachShader", ([p, shader]) => {
    if (shaders.has(shader)) programs.add(p);
  });
  intercept(gl, "useProgram", ([p]) => (program = p));
  intercept(gl, "framebufferTexture2D", ([, , , t]) => attached.set(framebuffer, t));
  intercept(gl, "bindFramebuffer", ([, fb]) => {
    framebuffer = fb;
    if (fb !== null && programs.has(program)) blurTargets.add(attached.get(fb));
  });
  // A lost context's textures are no longer textures once it is restored.
  const live = (keep: (t: WebGLTexture, s: Storage) => boolean): Storage[] =>
    [...storage].flatMap(([t, s]) => (gl.isTexture(t) && keep(t, s) ? [s] : []));
  return {
    held: () => live((_, s) => s.width > 0),
    blurTargets: () => live((t) => blurTargets.has(t)),
  };
}

afterEach(() => {
  disposeSkies();
});

describe("blur targets", () => {
  it("hold storage only while the blur chain runs, sized to what it needs", async () => {
    let textures: Textures | undefined;
    const { sky, gl, canvas } = makeSky(BLUR_PARAMS, (ctx) => (textures = trackTextures(ctx)));
    await next(sky, "ready");
    sky.resize(80, 48, 1);
    let t = 0;
    const run = (frames: number): void => {
      for (let i = 0; i < frames; i++) sky.render((t += STEP));
    };
    run(3);
    // Only the sky, scene and rays targets.
    expect(textures?.held()).toHaveLength(3);

    // Fading in: full size, as the glass draws there at full size. The first frame after a change advances only
    // 1/60 s, too little for the chain to start.
    sky.update({ blur: 12 });
    run(1);
    expect(textures?.held()).toHaveLength(3);
    run(1);
    expect(textures?.blurTargets()).toEqual([
      { width: 80, height: 48, allocations: 1 },
      { width: 80, height: 48, allocations: 1 },
    ]);
    run(FADE_FRAMES);
    // Settled: the canvas has shrunk to the chain size, and so have the targets.
    expect(canvas.width).toBeLessThan(80);
    const chain = { width: canvas.width, height: canvas.height, allocations: 2 };
    expect(textures?.blurTargets()).toEqual([chain, chain]);

    // Fading out: full size again until the chain stops, then freed.
    sky.update({ blur: 0 });
    run(2);
    expect(textures?.blurTargets()).toEqual([
      { width: 80, height: 48, allocations: 3 },
      { width: 80, height: 48, allocations: 3 },
    ]);
    run(FADE_FRAMES);
    expect(textures?.blurTargets()).toEqual([
      { width: 0, height: 0, allocations: 4 },
      { width: 0, height: 0, allocations: 4 },
    ]);
    expect(gl.getError()).toBe(gl.NO_ERROR);
  });

  it("hold no storage for a blur that settles below the chain's 0.3 px", async () => {
    let textures: Textures | undefined;
    const { sky } = makeSky(BLUR_PARAMS, (ctx) => (textures = trackTextures(ctx)));
    await next(sky, "ready");
    sky.resize(80, 48, 1);
    let t = 0;
    sky.render(t);
    sky.update({ blur: 0.2 });
    for (let i = 0; i < FADE_FRAMES; i++) sky.render((t += STEP));
    expect(textures?.held()).toHaveLength(3);
  });

  it("follow a resize mid-fade and are rebuilt after a lost context", async () => {
    let textures: Textures | undefined;
    const { sky, gl, canvas } = makeSky(BLUR_PARAMS, (ctx) => (textures = trackTextures(ctx)));
    await next(sky, "ready");
    sky.resize(80, 48, 1);
    let t = 0;
    const run = (frames: number): void => {
      for (let i = 0; i < frames; i++) sky.render((t += STEP));
    };
    run(1);
    sky.update({ blur: 12 });
    run(2);
    sky.resize(120, 60, 1);
    run(1);
    for (const target of textures?.blurTargets() ?? [])
      expect(target).toMatchObject({ width: 120, height: 60 });

    run(FADE_FRAMES);
    const ext = gl.getExtension("WEBGL_lose_context");
    if (ext === null) throw new Error("no WEBGL_lose_context");
    ext.loseContext();
    await next(sky, "contextlost");
    await wait(0);
    ext.restoreContext();
    await next(sky, "contextrestored");
    run(1);
    // The restored context's own targets, sized for the settled blur's shrunk canvas.
    const chain = { width: canvas.width, height: canvas.height, allocations: 1 };
    expect(canvas.width).toBeLessThan(120);
    expect(textures?.blurTargets()).toEqual([chain, chain]);
    expect(gl.getError()).toBe(gl.NO_ERROR);
  });
});

describe("bindings", () => {
  // Methods that set one piece of binding state, and the key of that state given the active texture unit.
  const SETTERS: Readonly<Record<string, (args: unknown[], unit: unknown) => string>> = {
    activeTexture: () => "unit",
    bindTexture: (_, unit) => `texture ${String(unit)}`,
    bindVertexArray: () => "vertex array",
    bindFramebuffer: () => "framebuffer",
    viewport: () => "viewport",
  };

  it.each([
    ["particles, rays and glass", {}],
    ["a blur fading in", { blur: 12 }],
  ] as const)("sets each binding only when it changes, within a frame (%s)", async (_, extra) => {
    const calls: [string, unknown[]][] = [];
    // GL objects all print alike, so each is named by a number.
    const ids = new Map<unknown, number>();
    const name = (x: unknown): string =>
      typeof x === "object" && x !== null
        ? `#${ids.get(x) ?? ids.set(x, ids.size).size - 1}`
        : String(x);
    const { sky } = makeSky({ ...PARAMS, ...extra }, (ctx) => {
      for (const setter of Object.keys(SETTERS))
        intercept(ctx, setter, (args) => calls.push([setter, args]));
    });
    await next(sky, "ready");
    sky.resize(80, 48, 1);
    for (let i = 1; i <= 5; i++) {
      calls.length = 0;
      sky.render(i / 60);
      // Nothing is known at the start of a frame.
      const state = new Map<string, string>();
      for (const [setter, args] of calls) {
        const key = SETTERS[setter]?.(args, state.get("unit")) ?? setter;
        const value = args.map(name).join();
        expect(state.get(key), `${setter}(${value}) in frame ${i}`).not.toBe(value);
        state.set(key, value);
      }
    }
  });

  it("trusts no binding made between frames", async () => {
    const params = { ...BLUR_PARAMS, motion: "static", blur: 4 } as const;
    const plain = makeSky(params);
    const disturbed = makeSky(params);
    await Promise.all([next(plain.sky, "ready"), next(disturbed.sky, "ready")]);
    for (const { sky } of [plain, disturbed]) {
      sky.resize(64, 40, 1);
      sky.render(0);
    }
    // What page code sharing the context might leave bound.
    const gl = disturbed.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
    gl.viewport(0, 0, 1, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.bindVertexArray(gl.createVertexArray());
    for (const { sky } of [plain, disturbed]) sky.render(1);
    expect(readPixels(disturbed.gl)).toEqual(readPixels(plain.gl));
  });
});
