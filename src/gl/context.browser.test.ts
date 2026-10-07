import { describe, expect, it } from "vitest";
import { getWebGL2 } from "./context.ts";

describe("getWebGL2", () => {
  it("returns a context with skye's attributes from a DOM canvas and an offscreen one", () => {
    for (const canvas of [document.createElement("canvas"), new OffscreenCanvas(4, 4)]) {
      const gl = getWebGL2(canvas);
      expect(gl).toBeInstanceOf(WebGL2RenderingContext);
      expect(gl?.getContextAttributes()).toMatchObject({
        alpha: false,
        antialias: false,
        preserveDrawingBuffer: false,
      });
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    }
  });

  it("returns null when the canvas already holds another kind of context", () => {
    const canvas = document.createElement("canvas");
    canvas.getContext("2d");
    expect(getWebGL2(canvas)).toBeNull();
  });
});
