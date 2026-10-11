// Deliberate regressions for the look gate's own tests. Each is applied to skye from outside the renderer, through
// its WebGL context, so nothing in src/ changes: a uniform's value is rewritten on its way to the GPU, a shader's
// text before it compiles, a program's draws are dropped, or the params skye sees differ from the reference's.
import type { SkyeParams } from "../../src/index.ts";
import * as glsl from "../../src/shaders/generated.ts";
import { createRandom } from "../../src/core/random.ts";
import { readUniformTable } from "../support/uniforms.ts";

/** skye's programs, by the prefix of their exports in generated.ts. */
export type ProgramName = "SKY" | "COMPOSITE" | "PARTICLES" | "RAYS" | "GLASS" | "BLUR";

const PROGRAMS: readonly ProgramName[] = ["SKY", "COMPOSITE", "PARTICLES", "RAYS", "GLASS", "BLUR"];

/** A uniform as `PROGRAM.uName`, the name it has in the readable GLSL. */
export type UniformKey = `${ProgramName}.u${string}`;

export interface Mutation {
  readonly name: string;
  /** Rewrites a uniform's components, in place, before each upload. */
  readonly uniforms?: Readonly<Partial<Record<UniformKey, (value: Float32Array) => void>>>;
  /** Rewrites a program's shipped fragment shader; must change it. */
  readonly shader?: { readonly program: ProgramName; readonly edit: (source: string) => string };
  /** Drops every draw of a program. */
  readonly skip?: ProgramName;
  /** Multiplies every float uniform's components by 1 + `jitter` × u, u uniform in [-1, 1] from a fixed seed. */
  readonly jitter?: number;
  /** Scales the number of particles each particle draw places. */
  readonly particles?: number;
  /** Params skye sees on top of the case's own; the reference sees the case's. */
  readonly params?: SkyeParams;
  /** Rewrites the frame read back, rows bottom first. */
  readonly image?: (pixels: Uint8Array, width: number, height: number) => void;
}

function scale(factor: number): (v: Float32Array) => void {
  return (v) => {
    for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) * factor;
  };
}

function add(index: number, delta: number): (v: Float32Array) => void {
  return (v) => {
    v[index] = (v[index] ?? 0) + delta;
  };
}

function set(value: number): (v: Float32Array) => void {
  return (v) => {
    v.fill(value);
  };
}

// Rotates an RGB colour about the grey axis by `turns` of a full turn (Rodrigues), which keeps its grey component.
function hue(turns: number): (v: Float32Array) => void {
  const a = turns * 2 * Math.PI;
  const c = Math.cos(a);
  const s = Math.sin(a) / Math.sqrt(3);
  const k = (1 - c) / 3;
  return (v) => {
    const [r = 0, g = 0, b = 0] = v;
    v[0] = r * (c + k) + g * (k - s) + b * (k + s);
    v[1] = r * (k + s) + g * (c + k) + b * (k - s);
    v[2] = r * (k - s) + g * (k + s) + b * (c + k);
  };
}

function replaceOnce(pattern: RegExp, by: string): (source: string) => string {
  return (source) => {
    const found = source.match(new RegExp(pattern.source, "g"))?.length ?? 0;
    if (found !== 1) throw new Error(`mutation pattern ${pattern} found ${found} times`);
    return source.replace(pattern, by);
  };
}

// Replaces each `size` × `size` block of the frame, from row and column `offset`, with its mean: a lower resolution.
function pixelate(
  size: number,
  offset: number,
): (pixels: Uint8Array, width: number, height: number) => void {
  return (pixels, width, height) => {
    const source = pixels.slice();
    for (let y0 = offset; y0 + size <= height; y0 += size)
      for (let x0 = offset; x0 + size <= width; x0 += size)
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let y = y0; y < y0 + size; y++)
            for (let x = x0; x < x0 + size; x++) sum += source[(y * width + x) * 4 + c] ?? 0;
          const mean = Math.round(sum / (size * size));
          for (let y = y0; y < y0 + size; y++)
            for (let x = x0; x < x0 + size; x++) pixels[(y * width + x) * 4 + c] = mean;
        }
  };
}

// A 3 × 3 box blur of every pixel but the frame's edge.
function blur(pixels: Uint8Array, width: number, height: number): void {
  const source = pixels.slice();
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) sum += source[((y + dy) * width + x + dx) * 4 + c] ?? 0;
        pixels[(y * width + x) * 4 + c] = Math.round(sum / 9);
      }
}

/** Three pixels of a 200 px tall frame, in the shaders' units of frame height. */
const SUN_SHIFT = 3 / 200;

export type MutationName =
  | "skyBrighter"
  | "skyMuchBrighter"
  | "skyHue"
  | "exposure"
  | "sun"
  | "cover"
  | "fog"
  | "stars"
  | "frost"
  | "rain"
  | "refraction"
  | "particles"
  | "rays"
  | "tonemap"
  | "tier"
  | "flip"
  | "wind"
  | "frozen"
  | "pixelated"
  | "pixelatedShifted"
  | "blurred"
  | "sixBit";

/** The regressions the gate is shown to catch (gate.browser.test.ts), each a plausible slip in a rewrite. */
export const MUTATIONS: Readonly<Record<MutationName, Mutation>> = {
  skyBrighter: {
    name: "sky colour 3 % brighter",
    uniforms: { "SKY.uZenith": scale(1.03), "SKY.uHorizon": scale(1.03) },
  },
  skyMuchBrighter: {
    name: "sky colour 10 % brighter",
    uniforms: { "SKY.uZenith": scale(1.1), "SKY.uHorizon": scale(1.1) },
  },
  skyHue: {
    name: "sky colour hue turned 3 %",
    uniforms: { "SKY.uZenith": hue(0.03), "SKY.uHorizon": hue(0.03) },
  },
  exposure: { name: "exposure × 1.05", uniforms: { "GLASS.uExposure": scale(1.05) } },
  sun: {
    name: "sun 3 px higher",
    uniforms: {
      "SKY.uSunPos": add(1, SUN_SHIFT),
      "COMPOSITE.uSunPos": add(1, SUN_SHIFT),
      "GLASS.uSunUV": add(1, SUN_SHIFT),
    },
  },
  cover: { name: "cloud cover + 0.05", uniforms: { "SKY.uCover": add(0, 0.05) } },
  fog: { name: "fog off", uniforms: { "SKY.uFog": set(0) } },
  stars: { name: "stars off", uniforms: { "COMPOSITE.uStar": set(0) } },
  frost: { name: "frost off", uniforms: { "GLASS.uFrost": set(0) } },
  rain: { name: "rain density halved", particles: 0.5 },
  refraction: {
    name: "glass refraction off",
    shader: { program: "GLASS", edit: replaceOnce(/\*\(\w+\.y\/900\.\)\*1\.6/, "*0.") },
  },
  particles: { name: "particle pass missing", skip: "PARTICLES" },
  rays: { name: "rays pass missing", skip: "RAYS" },
  tonemap: {
    name: "tonemap Reinhard instead of ACES",
    shader: {
      program: "GLASS",
      edit: replaceOnce(/pow\((\w+)\((\w+)\),vec3\(1\.\/2\.2\)\)/, "pow($2/(1.+$2),vec3(1./2.2))"),
    },
  },
  tier: { name: "low tier's buffers and octaves", params: { quality: "low" } },
  flip: {
    name: "image flipped vertically",
    image: (pixels: Uint8Array, width: number, height: number): void => {
      const row = width * 4;
      const swap = new Uint8Array(row);
      for (let y = 0; y < height >> 1; y++) {
        const a = y * row;
        const b = (height - 1 - y) * row;
        swap.set(pixels.subarray(a, a + row));
        pixels.copyWithin(a, b, b + row);
        pixels.set(swap, b);
      }
    },
  },
  wind: { name: "clouds drift twice as fast", uniforms: { "SKY.uWindT": scale(2) } },
  frozen: { name: "sky clock frozen", uniforms: { "SKY.uTime": set(0), "SKY.uWindT": set(0) } },
  pixelated: { name: "2 × 2 pixelation, on the 2 × 2 blocks", image: pixelate(2, 0) },
  pixelatedShifted: { name: "2 × 2 pixelation, a pixel off the blocks", image: pixelate(2, 1) },
  blurred: { name: "3 × 3 box blur", image: blur },
  sixBit: {
    name: "output quantised to 6 bits",
    shader: {
      program: "GLASS",
      edit: replaceOnce(
        /(\w+)=vec4\(clamp\((\w+),0\.,1\.\),1\.\);\}$/,
        "$1=vec4(floor(clamp($2,0.,1.)*63.+.5)/63.,1.);}",
      ),
    },
  },
};

/**
 * Numeric noise the gate must let through: every float uniform off by up to
 * 1e-5 of its value, far more than any reordering of float32 arithmetic moves
 * it. It moves the gate's measures by at most a third of their limits.
 */
export const NUMERIC_NOISE: Mutation = { name: "every uniform jittered by 1e-5", jitter: 1e-5 };

// Each program's uniforms, from the shipped name generated.ts gives it to the readable one.
function readableNames(): Map<ProgramName, Map<string, string>> {
  const exports: Record<string, unknown> = glsl;
  const out = new Map<ProgramName, Map<string, string>>();
  for (const program of PROGRAMS) {
    const table = exports[`${program}_UNIFORMS`];
    if (typeof table !== "string") throw new Error(`no ${program}_UNIFORMS`);
    const byOffset = new Map<number, string>();
    for (const [key, value] of Object.entries(exports)) {
      const m = /^([A-Z]+)_(u\w+)$/.exec(key);
      if (m?.[1] === program && typeof value === "number") byOffset.set(value, m[2] ?? "");
    }
    out.set(
      program,
      new Map(readUniformTable(table).map((u) => [u.name, byOffset.get(u.offset) ?? ""])),
    );
  }
  return out;
}

function programOf(source: string): ProgramName | undefined {
  const exports: Record<string, unknown> = glsl;
  return PROGRAMS.find((p) => exports[`${p}_FS`] === source);
}

/**
 * Applies `mutation` to every draw skye makes through `gl`, which skye has not
 * yet taken. Patches the context object itself, so other contexts are
 * untouched. Returns how many times it has changed something so far: a shader,
 * an upload or a draw, so a test can tell a mutation that no longer applies.
 */
export function instrument(gl: WebGL2RenderingContext, mutation: Mutation): () => number {
  let applied = 0;
  const names = readableNames();
  const shaders = new WeakMap<WebGLShader, ProgramName>();
  const programs = new WeakMap<WebGLProgram, ProgramName>();
  const uniforms = new WeakMap<WebGLUniformLocation, (value: Float32Array) => void>();
  const rewrites = new Map<string, (value: Float32Array) => void>();
  for (const [key, rewrite] of Object.entries(mutation.uniforms ?? {}))
    if (rewrite !== undefined) rewrites.set(key, rewrite);
  let current: ProgramName | undefined;
  const random = createRandom(7);
  const jitter = (v: Float32Array): void => {
    for (let i = 0; i < v.length; i++)
      v[i] = (v[i] ?? 0) * (1 + (mutation.jitter ?? 0) * (2 * random() - 1));
  };

  const shaderSource = gl.shaderSource.bind(gl);
  gl.shaderSource = (shader, source) => {
    const program = programOf(source);
    if (program !== undefined) shaders.set(shader, program);
    if (program !== undefined && mutation.shader?.program === program) {
      const changed = mutation.shader.edit(source);
      if (changed === source) throw new Error(`${mutation.name} changed no shader text`);
      applied++;
      shaderSource(shader, changed);
    } else {
      shaderSource(shader, source);
    }
  };

  const attachShader = gl.attachShader.bind(gl);
  gl.attachShader = (program, shader) => {
    const name = shaders.get(shader);
    if (name !== undefined) programs.set(program, name);
    attachShader(program, shader);
  };

  const getUniformLocation = gl.getUniformLocation.bind(gl);
  gl.getUniformLocation = (program, name) => {
    const location = getUniformLocation(program, name);
    const owner = programs.get(program);
    const readable = owner === undefined ? undefined : names.get(owner)?.get(name);
    const rewrite =
      owner === undefined || readable === undefined
        ? undefined
        : rewrites.get(`${owner}.${readable}`);
    if (location !== null && rewrite !== undefined) uniforms.set(location, rewrite);
    return location;
  };

  for (const method of ["uniform1fv", "uniform2fv", "uniform3fv", "uniform4fv"] as const) {
    const upload = gl[method].bind(gl);
    gl[method] = (
      location: WebGLUniformLocation | null,
      data: Float32Array,
      offset?: number,
      length?: number,
    ): void => {
      const rewrite =
        location === null
          ? undefined
          : (uniforms.get(location) ?? (mutation.jitter === undefined ? undefined : jitter));
      if (rewrite === undefined) {
        upload(location, data, offset, length);
        return;
      }
      const start = offset ?? 0;
      const value = data.slice(start, start + (length ?? data.length - start));
      rewrite(value);
      applied++;
      upload(location, value);
    };
  }

  const useProgram = gl.useProgram.bind(gl);
  gl.useProgram = (program) => {
    current = program === null ? undefined : programs.get(program);
    useProgram(program);
  };

  const drawArrays = gl.drawArrays.bind(gl);
  gl.drawArrays = (mode, first, count) => {
    if (current === mutation.skip) applied++;
    else drawArrays(mode, first, count);
  };

  const drawArraysInstanced = gl.drawArraysInstanced.bind(gl);
  gl.drawArraysInstanced = (mode, first, count, instances) => {
    if (current === mutation.skip) {
      applied++;
      return;
    }
    const n =
      current === "PARTICLES" && mutation.particles !== undefined
        ? Math.max(1, Math.round(instances * mutation.particles))
        : instances;
    if (n !== instances) applied++;
    drawArraysInstanced(mode, first, count, n);
  };

  return () => applied;
}
