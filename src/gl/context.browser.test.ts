import { describe, expect, it } from "vitest";
import { CONTEXT_ATTRIBUTES, getWebGL2 } from "./context.ts";

describe("getWebGL2", () => {
  it("returns a context with skye's attributes from a DOM canvas and an offscreen one", () => {
    for (const canvas of [document.createElement("canvas"), new OffscreenCanvas(4, 4)]) {
      const gl = getWebGL2(canvas);
      expect(gl).toBeInstanceOf(WebGL2RenderingContext);
      expect(gl?.getContextAttributes()).toMatchObject({
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      });
      // The canvas's own framebuffer has no depth or stencil bits to spend memory on.
      expect(gl?.getParameter(gl.DEPTH_BITS)).toBe(0);
      expect(gl?.getParameter(gl.STENCIL_BITS)).toBe(0);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    }
  });

  it("leaves the choice of GPU to the browser", () => {
    expect("powerPreference" in CONTEXT_ATTRIBUTES).toBe(false);
  });

  it("returns null when the canvas already holds another kind of context", () => {
    const canvas = document.createElement("canvas");
    canvas.getContext("2d");
    expect(getWebGL2(canvas)).toBeNull();
  });
});
