/**
 * One uniform of one program. Uploads are skipped when the value, rounded to
 * float32 as GL stores it, equals the last upload. Calls must happen while the
 * owning program is in use.
 */
export class Uniform {
  readonly name: string;
  readonly #gl: WebGL2RenderingContext;
  #location: WebGLUniformLocation | null = null;
  readonly #last = new Float32Array(4);
  #lastInt = 0;
  #uploaded = false;

  constructor(gl: WebGL2RenderingContext, name: string) {
    this.#gl = gl;
    this.name = name;
  }

  /** Looks the location up after a successful link; unused (optimised-out) uniforms stay null and ignore writes. */
  locate(program: WebGLProgram): void {
    this.#location = this.#gl.getUniformLocation(program, this.name);
    this.#uploaded = false;
  }

  float(x: number): void {
    if (this.#location === null || !this.#changed(x, 0, 0, 0, 1)) return;
    this.#gl.uniform1f(this.#location, x);
  }

  vec2(x: number, y: number): void {
    if (this.#location === null || !this.#changed(x, y, 0, 0, 2)) return;
    this.#gl.uniform2f(this.#location, x, y);
  }

  vec3(x: number, y: number, z: number): void {
    if (this.#location === null || !this.#changed(x, y, z, 0, 3)) return;
    this.#gl.uniform3f(this.#location, x, y, z);
  }

  vec4(x: number, y: number, z: number, w: number): void {
    if (this.#location === null || !this.#changed(x, y, z, w, 4)) return;
    this.#gl.uniform4f(this.#location, x, y, z, w);
  }

  /** Integers and sampler units. */
  int(n: number): void {
    if (this.#location === null || (this.#uploaded && this.#lastInt === n)) return;
    this.#lastInt = n;
    this.#uploaded = true;
    this.#gl.uniform1i(this.#location, n);
  }

  // Object.is keeps -0 and 0 apart and treats NaN as equal to itself, so equality means GL already holds these exact bits.
  #changed(x: number, y: number, z: number, w: number, n: number): boolean {
    const last = this.#last;
    const fx = Math.fround(x);
    const fy = Math.fround(y);
    const fz = Math.fround(z);
    const fw = Math.fround(w);
    if (
      this.#uploaded &&
      Object.is(last[0], fx) &&
      (n < 2 || Object.is(last[1], fy)) &&
      (n < 3 || Object.is(last[2], fz)) &&
      (n < 4 || Object.is(last[3], fw))
    ) {
      return false;
    }
    last[0] = fx;
    last[1] = fy;
    last[2] = fz;
    last[3] = fw;
    this.#uploaded = true;
    return true;
  }
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
export class Program {
  readonly program: WebGLProgram;
  readonly #gl: WebGL2RenderingContext;
  // Emptied once `finish` has deleted them, so `dispose` deletes each shader exactly once.
  readonly #shaders: WebGLShader[];
  readonly #uniformList: Uniform[] = [];

  constructor(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
    this.#gl = gl;
    const vs = this.#compile(gl.VERTEX_SHADER, vertex);
    const fs = this.#compile(gl.FRAGMENT_SHADER, fragment);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    this.program = p;
    this.#shaders = [vs, fs];
  }

  /** Declares a uniform the pass uses; its location is filled in by `finish`. */
  uniform(name: string): Uniform {
    const u = new Uniform(this.#gl, name);
    this.#uniformList.push(u);
    return u;
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
    for (const u of this.#uniformList) u.locate(p);
    for (const sh of this.#shaders) {
      gl.detachShader(p, sh);
      gl.deleteShader(sh);
    }
    this.#shaders.length = 0;
  }

  use(): void {
    this.#gl.useProgram(this.program);
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
