// Instruments one WebGL2 context from the outside, so the renderer runs unchanged: the bench takes the canvas's
// context first (or hooks `getContext`), wraps its methods on the instance, and `createSky` then receives that
// same context. Nothing in src/ knows about it.
//
// - Every GL call is counted by name. The probe's own calls go straight to the prototype and are not counted.
// - Passes are told apart by program: each fragment shader's source is matched against the generated shader
//   text, so a `useProgram` names the pass that follows. `generateMipmap` is its own segment ("mipmap").
// - "frame" mode wraps one TIME_ELAPSED query around each frame; "pass" mode ends and begins a query at every
//   pass boundary instead, since queries of one kind cannot nest.
// - `repeat` issues every draw of one pass (or the mipmap build) that many times, for a differential estimate
//   of the pass's marginal cost inside an otherwise unsplit frame. It changes that frame's pixels; it is only
//   ever used while timing, never for reference frames.
// - Texture and buffer allocations are tracked, so render-target and buffer memory is known exactly.
import {
  BLUR_FS,
  COMPOSITE_FS,
  GLASS_FS,
  PARTICLES_FS,
  RAYS_FS,
  SKY_FS,
} from "../src/shaders/generated.ts";
import type { TargetInfo } from "./gpu-protocol.ts";

interface TimerExt {
  readonly TIME_ELAPSED_EXT: GLenum;
  readonly GPU_DISJOINT_EXT: GLenum;
  readonly TIMESTAMP_EXT: GLenum;
  readonly QUERY_COUNTER_BITS_EXT: GLenum;
}

function isTimerExt(ext: unknown): ext is TimerExt {
  return typeof ext === "object" && ext !== null && "TIME_ELAPSED_EXT" in ext;
}

const SHADER_PASS = new Map<string, string>([
  [SKY_FS, "sky"],
  [COMPOSITE_FS, "composite"],
  [PARTICLES_FS, "particles"],
  [RAYS_FS, "rays"],
  [GLASS_FS, "glass"],
  [BLUR_FS, "blur"],
]);

/** In the order the pipeline creates its targets (`Pipeline` constructor). */
const TARGET_NAMES = ["sky", "scene", "rays", "blurA", "blurB"];

const FORMATS = new Map<number, { name: string; bpp: number }>([
  [0x881a, { name: "RGBA16F", bpp: 8 }],
  [0x8229, { name: "R8", bpp: 1 }],
  [0x8058, { name: "RGBA8", bpp: 4 }],
]);

interface Texture {
  name: string;
  format: string;
  bpp: number;
  width: number;
  height: number;
  mipmapped: boolean;
}

/** Counters of one pass within one frame. */
export interface SegmentCount {
  draws: number;
  instances: number;
  pixels: number;
  bytesWritten: number;
  targets: Set<string>;
}

interface Segment {
  name: string;
  query: WebGLQuery | null;
}

/** One finished frame: GPU ms per pass (or for the whole frame), and counters per pass. */
export interface FrameRecord {
  gpu: Map<string, number>;
  counts: Map<string, SegmentCount>;
  disjoint: boolean;
}

interface PendingFrame {
  segments: Segment[];
  counts: Map<string, SegmentCount>;
}

export type ProbeMode = "off" | "frame" | "pass";

function mipBytes(t: Texture): number {
  let w = t.width;
  let h = t.height;
  let bytes = w * h * t.bpp;
  if (!t.mipmapped) return bytes;
  while (w > 1 || h > 1) {
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    bytes += w * h * t.bpp;
  }
  return bytes;
}

type AnyFn = (...args: unknown[]) => unknown;

/** Every method name of the WebGL2 context, up its prototype chain. */
function methodNames(): string[] {
  const names = new Set<string>();
  let p: unknown = WebGL2RenderingContext.prototype;
  while (typeof p === "object" && p !== null && p !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(p)) {
      const d = Object.getOwnPropertyDescriptor(p, name);
      if (name !== "constructor" && typeof d?.value === "function") names.add(name);
    }
    p = Object.getPrototypeOf(p);
  }
  return [...names];
}

export class GlProbe {
  mode: ProbeMode = "off";
  /** Pass whose draws are issued `repeatCount` times; null for none. */
  repeatPass: string | null = null;
  repeatCount = 1;
  readonly timer: boolean;
  readonly timerBits: number;
  readonly timestampBits: number;
  /** Cumulative GL calls by method name. */
  readonly calls: Map<string, number> = new Map();
  /** Frames the renderer drew: uses of the sky program, which opens every frame. */
  framesDrawn = 0;
  /** Bytes passed to texImage2D/texSubImage2D with data, and to bufferData/bufferSubData. */
  uploadBytes = 0;
  readonly #gl: WebGL2RenderingContext;
  readonly #ext: TimerExt | null;
  readonly #shaderPass = new Map<WebGLShader, string>();
  readonly #programPass = new Map<WebGLProgram, string>();
  readonly #textures = new Map<WebGLTexture, Texture>();
  readonly #buffers = new Map<WebGLBuffer, number>();
  readonly #fbTexture = new Map<WebGLFramebuffer, WebGLTexture>();
  readonly #bound: Array<WebGLTexture | null> = [];
  readonly #pool: WebGLQuery[] = [];
  readonly #pending: PendingFrame[] = [];
  #arrayBuffer: WebGLBuffer | null = null;
  #unit = 0;
  #textureCount = 0;
  #framebuffer: WebGLFramebuffer | null = null;
  #viewport: [number, number] = [0, 0];
  #frame: PendingFrame | null = null;
  #segment = "";
  #open = false;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    // Before the wrappers go on, so these calls are not counted.
    const ext: unknown = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    this.#ext = isTimerExt(ext) ? ext : null;
    this.timer = this.#ext !== null;
    const bits = (target: GLenum) =>
      this.#ext === null ? 0 : Number(gl.getQuery(target, this.#ext.QUERY_COUNTER_BITS_EXT));
    this.timerBits = this.#ext === null ? 0 : bits(this.#ext.TIME_ELAPSED_EXT);
    this.timestampBits = this.#ext === null ? 0 : bits(this.#ext.TIMESTAMP_EXT);
    this.#bindings();
    this.#textureBindings();
    this.#counting();
  }

  /** Render targets the renderer allocated, in creation order. */
  targets(): TargetInfo[] {
    return [...this.#textures.values()]
      .filter((t) => t.width > 0)
      .map((t) => ({
        name: t.name,
        format: t.format,
        width: t.width,
        height: t.height,
        mipmapped: t.mipmapped,
        bytes: mipBytes(t),
      }));
  }

  /** Bytes held in vertex buffers. */
  get bufferBytes(): number {
    let n = 0;
    for (const b of this.#buffers.values()) n += b;
    return n;
  }

  /** A copy of the cumulative call counts, to diff against a later one. */
  snapshot(): Map<string, number> {
    return new Map(this.calls);
  }

  /** Call right before the renderer draws a frame. */
  beginFrame(): void {
    this.#frame = { segments: [], counts: new Map() };
    this.#segment = "";
    this.#open = false;
    if (this.mode === "frame") this.#beginQuery("frame");
  }

  /** Call right after it returns. */
  endFrame(): void {
    const frame = this.#frame;
    if (frame === null) return;
    if (this.#open && this.#ext !== null)
      WebGL2RenderingContext.prototype.endQuery.call(this.#gl, this.#ext.TIME_ELAPSED_EXT);
    this.#open = false;
    this.#frame = null;
    this.#pending.push(frame);
  }

  /** Frames whose queries have all landed, oldest first; the rest stay pending. */
  harvest(): FrameRecord[] {
    const gl = this.#gl;
    const P = WebGL2RenderingContext.prototype;
    const ext = this.#ext;
    const done: FrameRecord[] = [];
    while (this.#pending.length > 0) {
      const frame = this.#pending[0];
      if (frame === undefined) break;
      const ready = frame.segments.every(
        (s) =>
          s.query === null ||
          P.getQueryParameter.call(gl, s.query, gl.QUERY_RESULT_AVAILABLE) === true,
      );
      const disjoint = ext !== null && P.getParameter.call(gl, ext.GPU_DISJOINT_EXT) === true;
      if (!ready && !disjoint) break;
      this.#pending.shift();
      const gpu = new Map<string, number>();
      for (const s of frame.segments) {
        if (s.query === null) continue;
        if (ready && !disjoint) {
          const ms = Number(P.getQueryParameter.call(gl, s.query, gl.QUERY_RESULT)) / 1e6;
          gpu.set(s.name, (gpu.get(s.name) ?? 0) + ms);
        }
        this.#pool.push(s.query);
      }
      done.push({ gpu, counts: frame.counts, disjoint });
    }
    return done;
  }

  get pendingFrames(): number {
    return this.#pending.length;
  }

  #beginQuery(name: string): void {
    const ext = this.#ext;
    const frame = this.#frame;
    if (frame === null) return;
    if (ext === null) {
      frame.segments.push({ name, query: null });
      return;
    }
    const gl = this.#gl;
    const P = WebGL2RenderingContext.prototype;
    if (this.#open) P.endQuery.call(gl, ext.TIME_ELAPSED_EXT);
    const query = this.#pool.pop() ?? P.createQuery.call(gl);
    P.beginQuery.call(gl, ext.TIME_ELAPSED_EXT, query);
    this.#open = true;
    frame.segments.push({ name, query });
  }

  #enter(name: string): void {
    if (name === this.#segment) return;
    this.#segment = name;
    if (name === "sky") this.framesDrawn++;
    if (this.mode === "pass") this.#beginQuery(name);
    this.#counts();
  }

  #counts(): SegmentCount | null {
    const frame = this.#frame;
    if (frame === null) return null;
    const name = this.#segment || "other";
    let c = frame.counts.get(name);
    if (c === undefined) {
      c = { draws: 0, instances: 0, pixels: 0, bytesWritten: 0, targets: new Set() };
      frame.counts.set(name, c);
    }
    return c;
  }

  #count(instances: number, fullscreen: boolean): void {
    const c = this.#counts();
    if (c === null) return;
    const tex =
      this.#framebuffer === null
        ? undefined
        : this.#texture(this.#fbTexture.get(this.#framebuffer));
    const [vw, vh] = this.#viewport;
    const bpp = tex?.bpp ?? 4;
    c.draws++;
    c.instances += instances;
    if (fullscreen) {
      c.pixels += vw * vh;
      c.bytesWritten += vw * vh * bpp;
    }
    c.targets.add(
      tex === undefined ? `canvas ${vw}x${vh} RGBA8` : `${tex.name} ${vw}x${vh} ${tex.format}`,
    );
  }

  #times(): number {
    return this.repeatPass !== null && this.repeatPass === this.#segment
      ? Math.max(1, this.repeatCount)
      : 1;
  }

  // A flush between repeats ends the render pass, so a tiler's hidden-surface removal cannot drop an opaque
  // repeat as overdrawn: each repeat is shaded, loaded and stored like the pass itself.
  #repeat(call: () => void): void {
    const n = this.#times();
    for (let i = 0; i < n; i++) {
      if (i > 0) WebGL2RenderingContext.prototype.flush.call(this.#gl);
      call();
    }
  }

  #texture(t: WebGLTexture | null | undefined): Texture | undefined {
    return t === null || t === undefined ? undefined : this.#textures.get(t);
  }

  #bindings(): void {
    const gl = this.#gl;
    // Each wrapper calls the prototype's method on the context, so the renderer's calls are unchanged.
    const P = WebGL2RenderingContext.prototype;
    gl.shaderSource = (shader, source) => {
      const pass = SHADER_PASS.get(source);
      if (pass !== undefined) this.#shaderPass.set(shader, pass);
      P.shaderSource.call(gl, shader, source);
    };
    gl.attachShader = (program, shader) => {
      const pass = this.#shaderPass.get(shader);
      if (pass !== undefined) this.#programPass.set(program, pass);
      P.attachShader.call(gl, program, shader);
    };
    gl.useProgram = (program) => {
      if (program !== null) this.#enter(this.#programPass.get(program) ?? "other");
      P.useProgram.call(gl, program);
    };
    gl.generateMipmap = (target) => {
      this.#enter("mipmap");
      const tex = this.#texture(this.#bound[this.#unit]);
      if (tex !== undefined) tex.mipmapped = true;
      this.#repeat(() => P.generateMipmap.call(gl, target));
    };
    gl.drawArrays = (mode, first, count) => {
      this.#count(1, true);
      this.#repeat(() => P.drawArrays.call(gl, mode, first, count));
    };
    gl.drawArraysInstanced = (mode, first, count, instances) => {
      this.#count(instances, false);
      this.#repeat(() => P.drawArraysInstanced.call(gl, mode, first, count, instances));
    };
    gl.viewport = (x, y, width, height) => {
      this.#viewport = [width, height];
      P.viewport.call(gl, x, y, width, height);
    };
    gl.bindFramebuffer = (target, framebuffer) => {
      this.#framebuffer = framebuffer;
      P.bindFramebuffer.call(gl, target, framebuffer);
    };
    gl.framebufferTexture2D = (target, attachment, textarget, texture, level) => {
      if (this.#framebuffer !== null && texture !== null)
        this.#fbTexture.set(this.#framebuffer, texture);
      P.framebufferTexture2D.call(gl, target, attachment, textarget, texture, level);
    };
    gl.bindBuffer = (target, buffer) => {
      if (target === gl.ARRAY_BUFFER) this.#arrayBuffer = buffer;
      P.bindBuffer.call(gl, target, buffer);
    };
    gl.deleteBuffer = (buffer) => {
      if (buffer !== null) this.#buffers.delete(buffer);
      P.deleteBuffer.call(gl, buffer);
    };
    /* oxlint-disable typescript/unbound-method, typescript/no-unnecessary-type-assertion -- forwards an overloaded GL method's arguments unchanged */
    const bufferData = P.bufferData;
    gl.bufferData = ((...args: unknown[]) => {
      const data = args[1];
      const bytes =
        typeof data === "number" ? data : ArrayBuffer.isView(data) ? data.byteLength : 0;
      if (args[0] === gl.ARRAY_BUFFER && this.#arrayBuffer !== null)
        this.#buffers.set(this.#arrayBuffer, bytes);
      this.uploadBytes += typeof data === "number" ? 0 : bytes;
      Reflect.apply(bufferData, gl, args);
    }) as typeof gl.bufferData;
    /* oxlint-enable typescript/unbound-method, typescript/no-unnecessary-type-assertion */
  }

  #textureBindings(): void {
    const gl = this.#gl;
    const P = WebGL2RenderingContext.prototype;
    gl.createTexture = () => {
      const t = P.createTexture.call(gl);
      const name = TARGET_NAMES[this.#textureCount] ?? `texture${this.#textureCount}`;
      this.#textureCount++;
      this.#textures.set(t, { name, format: "?", bpp: 4, width: 0, height: 0, mipmapped: false });
      return t;
    };
    gl.deleteTexture = (texture) => {
      if (texture !== null) this.#textures.delete(texture);
      P.deleteTexture.call(gl, texture);
    };
    gl.activeTexture = (unit) => {
      this.#unit = unit - gl.TEXTURE0;
      P.activeTexture.call(gl, unit);
    };
    gl.bindTexture = (target, texture) => {
      if (target === gl.TEXTURE_2D) this.#bound[this.#unit] = texture;
      P.bindTexture.call(gl, target, texture);
    };
    /* oxlint-disable typescript/unbound-method, typescript/no-unnecessary-type-assertion -- as for bufferData */
    const texImage2D = P.texImage2D;
    gl.texImage2D = ((...args: unknown[]) => {
      const [, level, internal, width, height] = args;
      const tex = this.#texture(this.#bound[this.#unit]);
      const format = FORMATS.get(Number(internal));
      if (
        tex !== undefined &&
        level === 0 &&
        typeof width === "number" &&
        typeof height === "number"
      ) {
        tex.width = width;
        tex.height = height;
        tex.format = format?.name ?? `0x${Number(internal).toString(16)}`;
        tex.bpp = format?.bpp ?? 4;
      }
      const source = args[args.length - 1];
      if (
        source !== null &&
        source !== undefined &&
        typeof width === "number" &&
        typeof height === "number"
      ) {
        this.uploadBytes += width * height * (format?.bpp ?? 4);
      }
      Reflect.apply(texImage2D, gl, args);
    }) as typeof gl.texImage2D;
    /* oxlint-enable typescript/unbound-method, typescript/no-unnecessary-type-assertion */
  }

  // The outermost layer: counts each call by name, then runs the wrapper above or the prototype's method.
  #counting(): void {
    const gl = this.#gl;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the context seen as its methods, by name
    const target = gl as unknown as Record<string, AnyFn>;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above
    const proto = WebGL2RenderingContext.prototype as unknown as Record<string, AnyFn>;
    for (const name of methodNames()) {
      const inner = target[name] ?? proto[name];
      if (inner === undefined) continue;
      const calls = this.calls;
      target[name] = (...args: unknown[]) => {
        calls.set(name, (calls.get(name) ?? 0) + 1);
        return Reflect.apply(inner, gl, args);
      };
    }
  }
}

/** Groups of GL calls, for per-frame tables. */
export const CALL_GROUPS: Readonly<Record<string, readonly string[]>> = {
  draws: [
    "drawArrays",
    "drawArraysInstanced",
    "drawElements",
    "drawElementsInstanced",
    "drawRangeElements",
    "clear",
    "blitFramebuffer",
    "generateMipmap",
  ],
  programSwitches: ["useProgram"],
  uniforms: [
    "uniform1f",
    "uniform2f",
    "uniform3f",
    "uniform4f",
    "uniform1i",
    "uniform1fv",
    "uniform2fv",
    "uniform3fv",
    "uniform4fv",
    "uniformMatrix4fv",
  ],
  bindings: ["bindFramebuffer", "bindTexture", "activeTexture", "bindVertexArray", "bindBuffer"],
  state: [
    "enable",
    "disable",
    "blendFunc",
    "blendFuncSeparate",
    "blendEquation",
    "viewport",
    "scissor",
    "colorMask",
    "depthMask",
    "pixelStorei",
    "texParameteri",
  ],
  uploads: ["texImage2D", "texSubImage2D", "texStorage2D", "bufferData", "bufferSubData"],
  // Calls that can wait for the GPU process in Chromium (many getters are answered from a client-side cache).
  syncCapable: [
    "getError",
    "readPixels",
    "finish",
    "clientWaitSync",
    "getSyncParameter",
    "getQueryParameter",
    "getProgramParameter",
    "getShaderParameter",
    "getParameter",
    "checkFramebufferStatus",
    "getUniformLocation",
    "getActiveUniform",
  ],
};
