import { vi } from "vitest";
import { CONTEXT_ATTRIBUTES } from "../../src/gl/context.ts";
import { createSky, type Sky, type SkyeParams, type SkyEvents } from "../../src/index.ts";

/** A sky on its own canvas, with the context it draws with. */
export interface TestSky {
  sky: Sky;
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  /** Frames drawn so far: each frame rebuilds the scene's mip chain exactly once. */
  frames: () => number;
}

const made: TestSky[] = [];

/**
 * Creates a sky on a fresh canvas. `prepare` may stub the context before the
 * sky takes it; getContext hands the sky that same instance.
 */
export function makeSky(
  params: Partial<SkyeParams> = {},
  prepare?: (gl: WebGL2RenderingContext) => void,
): TestSky {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
  if (gl === null) throw new Error("no WebGL2");
  prepare?.(gl);
  const mipmaps = vi.spyOn(gl, "generateMipmap");
  const sky = createSky(canvas, params);
  const entry: TestSky = { sky, canvas, gl, frames: () => mipmaps.mock.calls.length };
  made.push(entry);
  return entry;
}

/** Disposes every sky made since the last call and frees its context. */
export function disposeSkies(): void {
  for (const { sky, gl } of made.splice(0)) {
    sky.dispose();
    if (!gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

/** Resolves with the payload of the next `event`. */
export function next<K extends keyof SkyEvents>(sky: Sky, event: K): Promise<SkyEvents[K]> {
  return new Promise((resolve) => {
    const off = sky.on(event, (payload) => {
      off();
      resolve(payload);
    });
  });
}

/** Resolves after `ms` of real time. */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The canvas's drawing buffer, read right after a frame (it is not preserved past the frame). */
export function readPixels(gl: WebGL2RenderingContext): Uint8Array {
  const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(
    0,
    0,
    gl.drawingBufferWidth,
    gl.drawingBufferHeight,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels,
  );
  return pixels;
}
