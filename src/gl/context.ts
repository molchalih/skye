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
 */
export class Gpu {
  readonly gl: WebGL2RenderingContext;
  /** Half-float targets are renderable; otherwise HDR targets fall back to RGBA8. */
  readonly float: boolean;
  /** `KHR_parallel_shader_compile`, when present. */
  readonly parallel: KHR_parallel_shader_compile | null;
  private readonly buffers: WebGLBuffer[] = [];
  private readonly fullscreen: WebGLVertexArrayObject;
  private readonly quad: WebGLVertexArrayObject;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.float = gl.getExtension("EXT_color_buffer_float") !== null;
    this.parallel = gl.getExtension("KHR_parallel_shader_compile");
    this.fullscreen = this.vertexArray(FULLSCREEN_TRIANGLE);
    this.quad = this.vertexArray(UNIT_QUAD);
  }

  /** Compiles and links a program; with parallel compile the link status is read later. */
  program(vertex: string, fragment: string): Program {
    return new Program(this.gl, vertex, fragment);
  }

  target(kind: TargetKind, mipmapped = false): Target {
    return new Target(this.gl, kind, this.float, mipmapped);
  }

  /** Draws into `target` (the canvas when null) over a `width` x `height` viewport. */
  bindOutput(target: Target | null, width: number, height: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target === null ? null : target.framebuffer);
    gl.viewport(0, 0, width, height);
  }

  bindTexture(unit: number, target: Target): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
  }

  /** Rebuilds the mip chain of a target bound to texture unit 0. */
  generateMipmaps(target: Target): void {
    this.bindTexture(0, target);
    this.gl.generateMipmap(this.gl.TEXTURE_2D);
  }

  // Vertex arrays are bound on every draw rather than cached: a cache goes stale as soon as anything else
  // binds one on this context, such as page code holding the same canvas's context.
  drawFullscreen(): void {
    this.gl.bindVertexArray(this.fullscreen);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  drawQuads(instances: number): void {
    this.gl.bindVertexArray(this.quad);
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
    gl.deleteVertexArray(this.fullscreen);
    gl.deleteVertexArray(this.quad);
    for (const b of this.buffers) gl.deleteBuffer(b);
  }

  private vertexArray(vertices: readonly number[]): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    this.buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }
}
