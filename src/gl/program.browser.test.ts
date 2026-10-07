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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Program", () => {
  it("skips uploads whose float32 value is unchanged", () => {
    const gl = context();
    const p = new Program(gl, VS, FS);
    const a = p.uniform("uA");
    const b = p.uniform("uB");
    const n = p.uniform("uN");
    p.finish();
    p.use();
    const f1 = vi.spyOn(gl, "uniform1f");
    const f3 = vi.spyOn(gl, "uniform3f");
    const i1 = vi.spyOn(gl, "uniform1i");
    a.float(0.1);
    a.float(0.1);
    // Rounds to the same float32 as 0.1.
    a.float(0.1 + 1e-12);
    a.float(0.2);
    a.float(-0);
    a.float(0);
    b.vec3(1, 2, 3);
    b.vec3(1, 2, 3);
    b.vec3(1, 2, 4);
    n.int(3);
    n.int(3);
    n.int(4);
    expect(f1.mock.calls).toEqual([
      [expect.anything(), 0.1],
      [expect.anything(), 0.2],
      [expect.anything(), -0],
      [expect.anything(), 0],
    ]);
    expect(f3).toHaveBeenCalledTimes(2);
    expect(i1).toHaveBeenCalledTimes(2);
    const loc = gl.getUniformLocation(p.program, "uA");
    expect(loc === null ? null : gl.getUniform(p.program, loc)).toBe(0);
  });

  it("ignores writes to uniforms the compiler removed", () => {
    const gl = context();
    const p = new Program(gl, VS, FS);
    const unused = p.uniform("uUnused");
    p.finish();
    p.use();
    const f1 = vi.spyOn(gl, "uniform1f");
    unused.float(1);
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
