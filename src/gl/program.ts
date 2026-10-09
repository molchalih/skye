// A pass writes a uniform's `value`, and the draw uploads it through `Program.upload`, which skips a value GL already
// holds. Values travel through fields and typed arrays rather than as call arguments, so a frame boxes no number.
// Each uniform keeps the value to upload beside the last one uploaded, which starts at 0 as linking sets every
// uniform to 0; so a sampler that reads unit 0 needs no value at all. Both are float32, as GL stores them, and
// their bits are compared as integers: -0 and 0 stay apart, and unlike Object.is or Math.fround the comparison boxes
// no number in V8's mid tier. Float uploads read the typed array, since a number passed to uniform1f would be boxed.

/** A float, or an integer or sampler unit, which float32 holds exactly up to 2^24. */
export class ScalarUniform {
  readonly name: string;
  value = 0;
  readonly #gl: WebGL2RenderingContext;
  readonly #int: boolean;
  // Null for an unused (optimised-out) uniform, which ignores its value.
  #location: WebGLUniformLocation | null = null;
  // The value to upload, then the last upload.
  readonly #floats = new Float32Array(2);
  readonly #bits = new Int32Array(this.#floats.buffer);

  constructor(gl: WebGL2RenderingContext, name: string, int: boolean) {
    this.#gl = gl;
    this.name = name;
    this.#int = int;
  }

  /** Looks the location up after a successful link. */
  locate(program: WebGLProgram): void {
    this.#location = this.#gl.getUniformLocation(program, this.name);
  }

  /** Sends `value` unless GL already holds it. The owning program must be in use. */
  upload(): void {
    const location = this.#location;
    const floats = this.#floats;
    const bits = this.#bits;
    floats[0] = this.value;
    if (location === null || bits[0] === bits[1]) return;
    floats[1] = this.value;
    if (this.#int) this.#gl.uniform1i(location, this.value);
    else this.#gl.uniform1fv(location, floats, 0, 1);
  }
}

/** A vec2, vec3 or vec4: `value` holds its components, written in place. */
export class VectorUniform {
  readonly name: string;
  readonly value: Float32Array;
  readonly #gl: WebGL2RenderingContext;
  #location: WebGLUniformLocation | null = null;
  readonly #last: Float32Array;
  // The bits of `value`, then of `#last`.
  readonly #bits: Int32Array;

  constructor(gl: WebGL2RenderingContext, name: string, size: 2 | 3 | 4) {
    this.#gl = gl;
    this.name = name;
    const buffer = new ArrayBuffer(8 * size);
    this.value = new Float32Array(buffer, 0, size);
    this.#last = new Float32Array(buffer, 4 * size, size);
    this.#bits = new Int32Array(buffer);
  }

  /** Looks the location up after a successful link. */
  locate(program: WebGLProgram): void {
    this.#location = this.#gl.getUniformLocation(program, this.name);
  }

  /** Sends `value` unless GL already holds it. The owning program must be in use. */
  upload(): void {
    const location = this.#location;
    const value = this.value;
    const bits = this.#bits;
    const n = value.length;
    let same = true;
    for (let i = 0; same && i < n; i++) same = bits[i] === bits[n + i];
    if (location === null || same) return;
    this.#last.set(value);
    const gl = this.#gl;
    if (n === 2) gl.uniform2fv(location, value);
    else if (n === 3) gl.uniform3fv(location, value);
    else gl.uniform4fv(location, value);
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
  readonly #uniformList: (ScalarUniform | VectorUniform)[] = [];

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

  // Declare the uniforms a pass uses; `finish` fills in their locations.

  float(name: string): ScalarUniform {
    return this.#declare(new ScalarUniform(this.#gl, name, false));
  }

  vec2(name: string): VectorUniform {
    return this.#declare(new VectorUniform(this.#gl, name, 2));
  }

  vec3(name: string): VectorUniform {
    return this.#declare(new VectorUniform(this.#gl, name, 3));
  }

  vec4(name: string): VectorUniform {
    return this.#declare(new VectorUniform(this.#gl, name, 4));
  }

  /** An integer or a sampler unit. */
  int(name: string): ScalarUniform {
    return this.#declare(new ScalarUniform(this.#gl, name, true));
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

  /** Uploads every uniform whose value changed since its last upload; the program must be in use. */
  upload(): void {
    // Indexed: this runs for every draw, and V8's mid tier keeps a for-of iterator.
    const list = this.#uniformList;
    for (let i = 0; i < list.length; i++) list[i]?.upload();
  }

  dispose(): void {
    for (const sh of this.#shaders) this.#gl.deleteShader(sh);
    this.#gl.deleteProgram(this.program);
  }

  #declare<U extends ScalarUniform | VectorUniform>(u: U): U {
    this.#uniformList.push(u);
    return u;
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
