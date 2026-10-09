import { afterEach, describe, expect, it, vi } from "vitest";
import { Program, ShaderError } from "./program.ts";

const VS = `#version 300 es
layout(location=0) in vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float; uniform float uA; uniform vec3 uB; uniform int uN; uniform float uUnused; out vec4 o;
void main(){ o = vec4(uB*uA, float(uN)); }`;

function context(): WebGL2RenderingContext {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (gl === null) throw new Error("no WebGL2");
  return gl;
}

// Records the values of each upload as it is made: the uniforms reuse their arrays, so a spy's record of the
// arguments would show later values.
function record(gl: WebGL2RenderingContext, method: "uniform1fv" | "uniform3fv"): number[][] {
  const sent: number[][] = [];
  const upload = gl[method].bind(gl);
  vi.spyOn(gl, method).mockImplementation((location, data, offset = 0, length = 0) => {
    sent.push(Array.from(data).slice(offset, length === 0 ? undefined : offset + length));
    upload(location, data, offset, length);
  });
  return sent;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Program", () => {
  it("uploads each value once, until its float32 bits change", () => {
    const gl = context();
    const p = new Program(gl, VS, FS);
    const a = p.float("uA");
    const b = p.vec3("uB");
    const n = p.int("uN");
    p.finish();
    p.use();
    const floats = record(gl, "uniform1fv");
    const vectors = record(gl, "uniform3fv");
    const ints = vi.spyOn(gl, "uniform1i");
    const upload = (x: number, v: readonly number[], i: number): void => {
      a.value = x;
      b.value.set(v);
      n.value = i;
      p.upload();
    };
    // Linking sets every uniform to 0, so nothing goes out while every value is still 0.
    upload(0, [0, 0, 0], 0);
    expect([floats, vectors, ints.mock.calls]).toEqual([[], [], []]);
    upload(0.1, [1, 2, 3], 3);
    // 0.1 + 1e-12 rounds to the same float32 as 0.1.
    upload(0.1 + 1e-12, [1, 2, 3], 3);
    upload(0.2, [1, 2, 4], 4);
    // -0 and 0 have different bits.
    upload(-0, [1, 2, 4], 4);
    upload(0, [1, 2, 4], 4);
    expect(floats).toEqual([[Math.fround(0.1)], [Math.fround(0.2)], [-0], [0]]);
    expect(vectors).toEqual([
      [1, 2, 3],
      [1, 2, 4],
    ]);
    expect(ints.mock.calls.map(([, i]) => i)).toEqual([3, 4]);
    const loc = gl.getUniformLocation(p.program, "uB");
    expect(loc === null ? null : gl.getUniform(p.program, loc)).toEqual(
      new Float32Array([1, 2, 4]),
    );
  });

  it("ignores values of uniforms the compiler removed", () => {
    const gl = context();
    const p = new Program(gl, VS, FS);
    const unused = p.float("uUnused");
    p.finish();
    p.use();
    const f1 = vi.spyOn(gl, "uniform1fv");
    unused.value = 1;
    p.upload();
    expect(f1).not.toHaveBeenCalled();
    expect(gl.getError()).toBe(gl.NO_ERROR);
  });

  it("reports a compile failure with the driver log", () => {
    const gl = context();
    const p = new Program(gl, VS, FS.replace("uniform int uN;", ""));
    expect(p.isSettled(null)).toBe(true);
    expect(() => p.finish()).toThrow(ShaderError);
    expect(() => p.finish()).toThrow(/uN/);
  });

  it("deletes each shader once over finish and dispose", () => {
    const gl = context();
    const deleted = vi.spyOn(gl, "deleteShader");
    const linked = new Program(gl, VS, FS);
    linked.finish();
    linked.dispose();
    expect(deleted).toHaveBeenCalledTimes(2);
    expect(new Set(deleted.mock.calls.map(([sh]) => sh)).size).toBe(2);

    deleted.mockClear();
    const failed = new Program(gl, VS, FS.replace("uniform int uN;", ""));
    expect(() => failed.finish()).toThrow(ShaderError);
    failed.dispose();
    expect(deleted).toHaveBeenCalledTimes(2);
  });
});
