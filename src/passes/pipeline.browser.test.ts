import { afterEach, describe, expect, it } from "vitest";
import { disposeSkies, makeSky, next, readPixels, wait } from "../../test/support/sky.ts";
import { readUniformTable } from "../../test/support/uniforms.ts";
import type { SkyeParams } from "../index.ts";
import { BLUR_FS, GLASS_FS, GLASS_UNIFORMS, GLASS_uNoise } from "../shaders/generated.ts";

// The blur targets need no particles or rays, and software GL in headless Chromium is slow.
const BLUR_PARAMS: Partial<SkyeParams> = {
  scene: "cloudy",
  hour: 10,
  motion: "full",
  quality: "low",
};
// Every pass but the blur chain: particles, rays and glass.
const PARAMS: Partial<SkyeParams> = { scene: "rainy", hour: 10, motion: "full", quality: "high" };
// Snow frosts the glass at its edges, already faded in for a static frame; high keeps the frost's fine detail.
const FROST: Partial<SkyeParams> = {
  scene: "snowy",
  hour: 12,
  motion: "static",
  quality: "high",
};
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
    // Only the sky, scene and rays targets, and the noise texture.
    expect(textures?.held()).toHaveLength(4);

    // Fading in: full size, as the glass draws there at full size. The first frame after a change advances only
    // 1/60 s, too little for the chain to start.
    sky.update({ blur: 12 });
    run(1);
    expect(textures?.held()).toHaveLength(4);
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
    expect(textures?.held()).toHaveLength(4);
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

  it.each([
    ["a blur", { ...BLUR_PARAMS, motion: "static", blur: 4 }],
    ["frost", FROST],
  ] as const)("trusts no binding made between frames (%s)", async (_, params) => {
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
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.bindVertexArray(gl.createVertexArray());
    for (const { sky } of [plain, disturbed]) sky.render(1);
    expect(readPixels(disturbed.gl)).toEqual(readPixels(plain.gl));
  });
});

/** What unit 2 held, and which unit the glass program's `uNoise` named, at one glass draw. */
interface GlassDraw {
  unit2: unknown;
  uNoise: unknown;
}

/** The glass draws a context makes, and the noise texture it holds now. */
interface GlassWatch {
  draws: GlassDraw[];
  /** The texture last uploaded as R16F: the noise lattice of the current context. */
  lattice(): WebGLTexture | undefined;
}

/**
 * Records each glass draw. With `swap`, unit 2 holds that texture for the
 * draw instead, and its own texture again right after.
 */
function watchGlass(gl: WebGL2RenderingContext, swap?: () => WebGLTexture): GlassWatch {
  const uNoise =
    readUniformTable(GLASS_UNIFORMS).find((u) => u.offset === GLASS_uNoise)?.name ?? "";
  const draws: GlassDraw[] = [];
  const shaders = new Set<unknown>();
  const programs = new Set<unknown>();
  let texture: unknown;
  let lattice: WebGLTexture | undefined;
  let program: unknown;
  intercept(gl, "bindTexture", ([, t]) => (texture = t));
  intercept(gl, "texImage2D", ([, , format]) => {
    if (format === gl.R16F && texture instanceof WebGLTexture) lattice = texture;
  });
  intercept(gl, "shaderSource", ([shader, source]) => {
    if (source === GLASS_FS) shaders.add(shader);
  });
  intercept(gl, "attachShader", ([p, shader]) => {
    if (shaders.has(shader)) programs.add(p);
  });
  intercept(gl, "useProgram", ([p]) => (program = p));
  const drawArrays = gl.drawArrays.bind(gl);
  gl.drawArrays = (mode, first, count) => {
    if (!(program instanceof WebGLProgram) || !programs.has(program)) {
      drawArrays(mode, first, count);
      return;
    }
    const active: unknown = gl.getParameter(gl.ACTIVE_TEXTURE);
    const restore = (): void => gl.activeTexture(typeof active === "number" ? active : 0);
    gl.activeTexture(gl.TEXTURE2);
    const unit2: unknown = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const location = gl.getUniformLocation(program, uNoise);
    if (location === null) throw new Error("the glass program has no uNoise");
    draws.push({ unit2, uNoise: gl.getUniform(program, location) });
    if (swap !== undefined) gl.bindTexture(gl.TEXTURE_2D, swap());
    restore();
    drawArrays(mode, first, count);
    if (swap === undefined || !(unit2 instanceof WebGLTexture)) return;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, unit2);
    restore();
  };
  return { draws, lattice: () => lattice };
}

/** A 1 x 1 texture of grey 128/255: value noise that is 128/255 everywhere. */
function flatTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture();
  const active: unknown = gl.getParameter(gl.ACTIVE_TEXTURE);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, t);
  const grey = new Uint8Array([128, 128, 128, 255]);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, grey);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.activeTexture(typeof active === "number" ? active : gl.TEXTURE0);
  return t;
}

/** The RGBA bytes of the pixel at (x, y), counted from the bottom left. */
function pixelAt(pixels: Uint8Array, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.subarray(i, i + 4));
}

describe("the glass's frost", () => {
  it("reads its value noise from the noise texture on unit 2, and only the frost does", async () => {
    const width = 80;
    const height = 48;
    const frame = async (params: Partial<SkyeParams>, swapped: boolean) => {
      let watch: GlassWatch | undefined;
      const { sky, gl } = makeSky(params, (ctx) => {
        let flat: WebGLTexture | undefined;
        watch = watchGlass(ctx, swapped ? () => (flat ??= flatTexture(ctx)) : undefined);
      });
      await next(sky, "ready");
      sky.resize(width, height, 1);
      sky.render(0);
      expect(gl.getError()).toBe(gl.NO_ERROR);
      return { pixels: readPixels(gl), watch };
    };

    const frost = await frame(FROST, false);
    const flat = await frame(FROST, true);
    expect(frost.watch?.draws).toEqual([{ unit2: frost.watch?.lattice(), uNoise: 2 }]);
    expect(frost.watch?.lattice()).toBeInstanceOf(WebGLTexture);
    // The frost covers the edges and leaves the centre clear: given flat noise in place of the lattice, the edges
    // change and the centre does not.
    expect(flat.pixels).not.toEqual(frost.pixels);
    for (const [x, y] of [
      [0, 0],
      [width - 1, height - 1],
    ] as const)
      expect(pixelAt(flat.pixels, width, x, y), `(${x}, ${y})`).not.toEqual(
        pixelAt(frost.pixels, width, x, y),
      );
    expect(pixelAt(flat.pixels, width, width / 2, height / 2)).toEqual(
      pixelAt(frost.pixels, width, width / 2, height / 2),
    );

    // Rain without frost reads nothing from unit 2.
    const rain = { ...PARAMS, motion: "static" } as const;
    const rainy = await frame(rain, false);
    expect((await frame(rain, true)).pixels).toEqual(rainy.pixels);
  });

  it("reads the restored context's own noise texture after a lost context", async () => {
    let watch: GlassWatch | undefined;
    const plain = makeSky(FROST);
    const restored = makeSky(FROST, (ctx) => (watch = watchGlass(ctx)));
    await Promise.all([next(plain.sky, "ready"), next(restored.sky, "ready")]);
    for (const { sky } of [plain, restored]) {
      sky.resize(80, 48, 1);
      sky.render(0);
    }
    const lost = watch?.lattice();

    const gl = restored.gl;
    const ext = gl.getExtension("WEBGL_lose_context");
    if (ext === null) throw new Error("no WEBGL_lose_context");
    ext.loseContext();
    await next(restored.sky, "contextlost");
    await wait(0);
    ext.restoreContext();
    await next(restored.sky, "contextrestored");
    if (watch !== undefined) watch.draws.length = 0;
    for (const { sky } of [plain, restored]) sky.render(0);

    const lattice = watch?.lattice();
    expect(lattice).not.toBe(lost);
    expect(gl.isTexture(lattice ?? null)).toBe(true);
    expect(watch?.draws).toEqual([{ unit2: lattice, uNoise: 2 }]);
    expect(readPixels(gl)).toEqual(readPixels(plain.gl));
    expect(gl.getError()).toBe(gl.NO_ERROR);
  });
});
