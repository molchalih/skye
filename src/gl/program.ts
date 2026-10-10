// A pass writes its uniforms' values into its program's `values`, at the offsets src/shaders/generated.ts gives
// (`SKY_uTime`), and the draw uploads them through `Program.upload`, which skips a value GL already holds. Values
// travel through that typed array rather than as call arguments, so a frame boxes no number. Beside the values to
// upload the program keeps the last ones uploaded, which start at 0 as linking sets every uniform to 0; so a sampler
// that reads unit 0 needs no value at all. Both are float32, as GL stores them, and their bits are compared as
// integers: -0 and 0 stay apart, and unlike Object.is or Math.fround the comparison boxes no number in V8's mid tier.
// Float uploads read the typed array, since a number passed to uniform1f would be boxed.

declare const program: unique symbol;

/** Program `P`'s uniform table (`SKY_UNIFORMS` for `P` = `"SKY"`); see `Program`. */
export type Table<P extends string> = string & { readonly [program]: P };

/**
 * Where a uniform of program `P`, `N` floats wide, starts in that program's
 * `values` (`SKY_uSunPos`). Only types tell slots apart; at run time each is
 * a plain number.
 */
export type Slot<P extends string, N extends number> = number & {
  readonly [program]: readonly [P, N];
};

type Vector<N extends 2 | 3 | 4> = N extends 2
  ? readonly [number, number]
  : N extends 3
    ? readonly [number, number, number]
    : readonly [number, number, number, number];

/**
 * Program `P`'s uniform values. `set` takes a whole vector and a slot of `P`
 * as wide, so a vector cannot spill into the next uniform or land in another
 * program's slot; scalars and single components are written by index.
 */
export interface Values<P extends string> extends Float32Array<ArrayBuffer> {
  set<N extends 2 | 3 | 4>(vector: Vector<N>, slot: Slot<P, N>): void;
}

/** Compile or link failure, with the driver's logs. */
export class ShaderError extends Error {
  override readonly name = "ShaderError";
}

/**
 * A linked program and its uniforms. Compilation starts in the constructor;
 * with `KHR_parallel_shader_compile` the driver links in the background and
 * `isSettled` reports when `finish` will not block.
 */
export class Program<P extends string = string> {
  readonly program: WebGLProgram;
  /** Every uniform's value, at the slot its table gives it; the pass writes them before each draw. */
  readonly values: Values<P>;
  readonly #gl: WebGL2RenderingContext;
  // Emptied once `finish` has deleted them, so `dispose` deletes each shader exactly once.
  readonly #shaders: WebGLShader[];
  // Per uniform, in table order: its name, whether it is an int or a sampler unit (which float32 holds exactly up to
  // 2^24), where its value starts in `values` and how many floats it takes, and its location once linked: null for
  // an unused (optimised-out) uniform, which ignores its value. Parallel arrays, as they bundle smaller than an
  // object per uniform.
  readonly #names: string[] = [];
  readonly #ints: boolean[] = [];
  readonly #offsets: number[] = [];
  readonly #sizes: number[] = [];
  readonly #locations: (WebGLUniformLocation | null)[] = [];
  // The bits of `values`, then of the last values uploaded.
  readonly #bits: Int32Array;

  /**
   * Starts compiling `vertex` and `fragment`. `uniforms` is the program's
   * uniform table, as scripts/shaders.ts generates it (`SKY_UNIFORMS`):
   * space-separated entries, each a kind (`f` float, `i` int or sampler unit,
   * `2` to `4` a vector of that many floats) and then the uniform's name. Their
   * values follow one another in `values`, in table order.
   */
  constructor(gl: WebGL2RenderingContext, vertex: string, fragment: string, uniforms: Table<P>) {
    this.#gl = gl;
    let size = 0;
    for (const entry of uniforms.split(" ")) {
      if (entry === "") continue;
      const kind = entry.charAt(0);
      const n = kind === "f" || kind === "i" ? 1 : Number(kind);
      this.#names.push(entry.slice(1));
      this.#ints.push(kind === "i");
      this.#offsets.push(size);
      this.#sizes.push(n);
      size += n;
    }
    const buffer = new ArrayBuffer(8 * size);
    // Only the type narrows: Values adds no member, it restricts `set`.
    this.values = new Float32Array(buffer, 0, size) as Values<P>;
    this.#bits = new Int32Array(buffer);
    const vs = this.#compile(gl.VERTEX_SHADER, vertex);
    const fs = this.#compile(gl.FRAGMENT_SHADER, fragment);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    this.program = p;
    this.#shaders = [vs, fs];
  }

  /** True when reading the link status will not stall: always without the extension. */
  isSettled(parallel: KHR_parallel_shader_compile | null): boolean {
    if (parallel === null) return true;
    return this.#gl.getProgramParameter(this.program, parallel.COMPLETION_STATUS_KHR) === true;
  }

  /** Checks the link, throwing a ShaderError with the logs on failure, then resolves uniform locations. */
  finish(): void {
    const gl = this.#gl;
    const p = this.program;
    if (gl.getProgramParameter(p, gl.LINK_STATUS) !== true) {
      let log = "";
      for (const sh of this.#shaders) {
        if (gl.getShaderParameter(sh, gl.COMPILE_STATUS) !== true)
          log += `${gl.getShaderInfoLog(sh) ?? ""}\n`;
      }
      log += gl.getProgramInfoLog(p) ?? "";
      throw new ShaderError(`skye: shader program failed to build: ${log.trim()}`);
    }
    for (const [i, name] of this.#names.entries())
      this.#locations[i] = gl.getUniformLocation(p, name);
    for (const sh of this.#shaders) {
      gl.detachShader(p, sh);
      gl.deleteShader(sh);
    }
    this.#shaders.length = 0;
  }

  use(): void {
    this.#gl.useProgram(this.program);
  }

  /** Uploads every uniform whose value changed since its last upload; the program must be in use. */
  upload(): void {
    // Indexed: this runs for every draw, and V8's mid tier keeps a for-of iterator.
    const gl = this.#gl;
    const values = this.values;
    const bits = this.#bits;
    const uploaded = values.length;
    const locations = this.#locations;
    for (let i = 0; i < locations.length; i++) {
      const location = locations[i] ?? null;
      const at = this.#offsets[i] ?? 0;
      const n = this.#sizes[i] ?? 1;
      let same = true;
      for (let k = at; same && k < at + n; k++) same = bits[k] === bits[uploaded + k];
      if (location === null || same) continue;
      for (let k = at; k < at + n; k++) bits[uploaded + k] = bits[k] ?? 0;
      if (this.#ints[i] === true) gl.uniform1i(location, values[at] ?? 0);
      else if (n === 1) gl.uniform1fv(location, values, at, 1);
      else if (n === 2) gl.uniform2fv(location, values, at, 2);
      else if (n === 3) gl.uniform3fv(location, values, at, 3);
      else gl.uniform4fv(location, values, at, 4);
    }
  }

  dispose(): void {
    for (const sh of this.#shaders) this.#gl.deleteShader(sh);
    this.#gl.deleteProgram(this.program);
  }

  #compile(type: GLenum, source: string): WebGLShader {
    const gl = this.#gl;
    const sh = gl.createShader(type);
    // Only a lost context makes createShader return null.
    if (sh === null) throw new ShaderError("skye: could not create a shader; the context is lost");
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    return sh;
  }
}
