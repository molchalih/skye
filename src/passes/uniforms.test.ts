import { describe, expect, it } from "vitest";
import { uniforms } from "../../scripts/shaders.ts";
import { Gpu } from "../gl/context.ts";
import { Program } from "../gl/program.ts";
import { BlurPass } from "./blur.ts";
import { CompositePass } from "./composite.ts";
import { GlassPass } from "./glass.ts";
import { ParticlesPass } from "./particles.ts";
import { RaysPass } from "./rays.ts";
import { SkyPass } from "./sky.ts";

// The GLSL types each way of declaring a uniform can drive.
const TYPES: Record<string, readonly string[]> = {
  float: ["float"],
  int: ["int", "sampler2D"],
  vec2: ["vec2"],
  vec3: ["vec3"],
  vec4: ["vec4"],
};

interface Declared {
  readonly vertex: string;
  readonly fragment: string;
  readonly uniforms: [method: string, name: string][];
}

/** Builds a pass on a GPU that records the program it asks for and the uniforms it declares on it. */
function declared(build: (gpu: Gpu) => unknown): Declared {
  const out: Declared = { vertex: "", fragment: "", uniforms: [] };
  const program: Program = Object.create(Program.prototype);
  for (const method of Object.keys(TYPES)) {
    Reflect.set(program, method, (name: string) => {
      out.uniforms.push([method, name]);
      return { value: new Float32Array(4) };
    });
  }
  const gpu: Gpu = Object.create(Gpu.prototype);
  Reflect.set(gpu, "program", (vertex: string, fragment: string) => {
    Object.assign(out, { vertex, fragment });
    return program;
  });
  build(gpu);
  return out;
}

describe("pass uniforms", () => {
  const passes: Record<string, (gpu: Gpu) => unknown> = {
    sky: (gpu) => new SkyPass(gpu),
    composite: (gpu) => new CompositePass(gpu),
    particles: (gpu) => new ParticlesPass(gpu),
    rays: (gpu) => new RaysPass(gpu),
    glass: (gpu) => new GlassPass(gpu),
    blur: (gpu) => new BlurPass(gpu),
  };

  it.each(Object.keys(passes))(
    "%s declares only its program's uniforms, each as its GLSL type",
    (pass) => {
      const build = passes[pass];
      if (build === undefined) throw new Error(pass);
      const d = declared(build);
      const types = new Map([...uniforms(d.vertex), ...uniforms(d.fragment)]);
      expect(d.uniforms.length).toBeGreaterThan(0);
      expect(new Set(d.uniforms.map(([, name]) => name)).size).toBe(d.uniforms.length);
      for (const [method, name] of d.uniforms)
        expect(TYPES[method], name).toContain(types.get(name));
    },
  );
});
