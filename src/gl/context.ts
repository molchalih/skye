import { Program } from "./program.ts";
import { Target, type TargetKind } from "./target.ts";

/** A canvas skye can draw into: on the main thread or in a worker. */
export type SkyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** v6's context attributes, except that the drawing buffer is not preserved between frames. */
export const CONTEXT_ATTRIBUTES: Readonly<WebGLContextAttributes> = Object.freeze({
  antialias: false,
  alpha: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  powerPreference: "high-performance",
});

/** Returns a WebGL2 context with skye's attributes, or null when the canvas cannot provide one. */
export function getWebGL2(canvas: SkyCanvas): WebGL2RenderingContext | null {
  return canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
}

const FULLSCREEN_TRIANGLE: readonly number[] = [-1, -1, 3, -1, -1, 3];
const UNIT_QUAD: readonly number[] = [-1, -1, 1, -1, -1, 1, 1, 1];

/**
 * The GL context plus the few draw helpers the passes share: the full-screen
 * triangle, the instanced quad, render-target binding and blending.
 *
 * Within a frame it skips binds that would change nothing. It trusts what it
 * bound only until the frame ends: between frames anything else may bind on
 * this context, such as page code holding the same canvas's context.
 */
export class Gpu {
  readonly gl: WebGL2RenderingContext;
  /** Half-float targets are renderable; otherwise HDR targets fall back to RGBA8. */
  readonly float: boolean;
  /** `KHR_parallel_shader_compile`, when present. */
  readonly parallel: KHR_parallel_shader_compile | null;
  readonly #buffers: WebGLBuffer[] = [];
  readonly #fullscreen: WebGLVertexArrayObject;
  readonly #quad: WebGLVertexArrayObject;
  // What this frame has bound so far; undefined (or -1) is unknown.
  #output: Target | null | undefined;
  #viewportWidth = -1;
  #viewportHeight = -1;
  #unit = -1;
  readonly #textures: (Target | undefined)[] = [undefined, undefined];
  #vertexArray: WebGLVertexArrayObject | undefined;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.float = gl.getExtension("EXT_color_buffer_float") !== null;
    this.parallel = gl.getExtension("KHR_parallel_shader_compile");
    this.#fullscreen = this.#createVertexArray(FULLSCREEN_TRIANGLE);
    this.#quad = this.#createVertexArray(UNIT_QUAD);
  }

  /** Compiles and links a program; with parallel compile the link status is read later. */
  program(vertex: string, fragment: string): Program {
    return new Program(this.gl, vertex, fragment);
  }

  target(kind: TargetKind, mipmapped = false): Target {
    return new Target(this.gl, kind, this.float, mipmapped);
  }

  /** Starts a frame: forgets every binding, so each is set again before its first use. */
  beginFrame(): void {
    this.#output = undefined;
    this.#viewportWidth = -1;
    this.#viewportHeight = -1;
    this.#unit = -1;
    this.#textures.fill(undefined);
    this.#vertexArray = undefined;
  }

  /** Draws into `target` (the canvas when null) over a `width` x `height` viewport. */
  bindOutput(target: Target | null, width: number, height: number): void {
    const gl = this.gl;
    if (target !== this.#output) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target === null ? null : target.framebuffer);
      this.#output = target;
    }
    if (width !== this.#viewportWidth || height !== this.#viewportHeight) {
      gl.viewport(0, 0, width, height);
      this.#viewportWidth = width;
      this.#viewportHeight = height;
    }
  }

  /** Binds `target` to texture unit 0 or 1. */
  bindTexture(unit: 0 | 1, target: Target): void {
    if (this.#textures[unit] === target) return;
    this.#activate(unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, target.texture);
    this.#textures[unit] = target;
  }

  /** Rebuilds the mip chain of a target, leaving it bound to texture unit 0. */
  generateMipmaps(target: Target): void {
    this.bindTexture(0, target);
    // The bind above is skipped when the target is already on unit 0, even while unit 1 is the active one.
    this.#activate(0);
    this.gl.generateMipmap(this.gl.TEXTURE_2D);
  }

  /** Draws the full-screen triangle with `program`, which is in use, and its current uniform values. */
  drawFullscreen(program: Program): void {
    program.upload();
    this.#bindVertexArray(this.#fullscreen);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  /** Draws `instances` unit quads with `program`, which is in use, and its current uniform values. */
  drawQuads(program: Program, instances: number): void {
    program.upload();
    this.#bindVertexArray(this.#quad);
    this.gl.drawArraysInstanced(this.gl.TRIANGLE_STRIP, 0, 4, instances);
  }

  /** Premultiplied-alpha "over" blending, or none. */
  blend(on: boolean): void {
    const gl = this.gl;
    if (on) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.deleteVertexArray(this.#fullscreen);
    gl.deleteVertexArray(this.#quad);
    for (const b of this.#buffers) gl.deleteBuffer(b);
  }

  #activate(unit: 0 | 1): void {
    if (unit === this.#unit) return;
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.#unit = unit;
  }

  #bindVertexArray(vao: WebGLVertexArrayObject): void {
    if (vao === this.#vertexArray) return;
    this.gl.bindVertexArray(vao);
    this.#vertexArray = vao;
  }

  #createVertexArray(vertices: readonly number[]): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    this.#buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }
}
