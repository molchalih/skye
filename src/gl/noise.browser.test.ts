import { describe, expect, it } from "vitest";
import { FULLSCREEN_VS } from "../shaders/generated.ts";
import { Gpu } from "./context.ts";
import type { Table } from "./program.ts";
import { noiseLattice, noiseTexture } from "./noise.ts";

// Four pixels, each sampling the texture at one point, in lattice cells: a lattice point, the midpoint to its right
// neighbour, that midpoint one tile further (the texture repeats), and the midpoint to its neighbour above.
const FS = `#version 300 es
precision highp float; uniform highp sampler2D uNoise; out vec4 o;
void main(){
  float x = gl_FragCoord.x;
  vec2 p = x < 1.0 ? vec2(3.0, 5.0) : x < 2.0 ? vec2(3.5, 5.0) : x < 3.0 ? vec2(259.5, 5.0) : vec2(3.0, 5.5);
  o = vec4(textureLod(uNoise, (p + 0.5)/256.0, 0.0).r, 0.0, 0.0, 1.0);
}`;

const LATTICE = noiseLattice();

function lattice(x: number, y: number): number {
  const h = LATTICE[y * 256 + x] ?? 0;
  const exponent = h >> 10;
  return exponent === 0 ? 0 : 2 ** (exponent - 15) * (1 + (h & 1023) / 1024);
}

describe("noiseTexture", () => {
  it("filters bilinearly and repeats, with no extension enabled", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 1;
    const gl = canvas.getContext("webgl2");
    if (gl === null) throw new Error("no WebGL2");
    // Gpu enables the extensions skye uses; the texture must work without them.
    const extensions: string[] = [];
    const getExtension = gl.getExtension.bind(gl);
    gl.getExtension = ((name: string) => {
      extensions.push(name);
      return getExtension(name);
    }) as typeof gl.getExtension;
    const noise = noiseTexture(gl);
    expect(extensions).toEqual([]);

    const gpu = new Gpu(gl);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- FS's table, branded by hand as generated.ts brands its own
    const program = gpu.program(FULLSCREEN_VS, FS, "iuNoise" as Table<"NOISE">);
    program.finish();
    program.use();
    gpu.beginFrame();
    gpu.bindOutput(null, 4, 1);
    gpu.bindTexture(0, noise);
    gpu.drawFullscreen(program);
    const pixels = new Uint8Array(16);
    gl.readPixels(0, 0, 4, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    expect(gl.getError()).toBe(gl.NO_ERROR);

    const expected = [
      lattice(3, 5),
      (lattice(3, 5) + lattice(4, 5)) / 2,
      (lattice(3, 5) + lattice(4, 5)) / 2,
      (lattice(3, 5) + lattice(3, 6)) / 2,
    ];
    expected.forEach((value, i) => {
      expect(Math.abs((pixels[i * 4] ?? -1) - value * 255), `pixel ${i}`).toBeLessThanOrEqual(1);
    });
    // The lattice values differ, so a sample that read the wrong cells would show.
    expect(new Set(expected.map((v) => Math.round(v * 255))).size).toBeGreaterThan(2);
    gpu.dispose();
    program.dispose();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  });
});
