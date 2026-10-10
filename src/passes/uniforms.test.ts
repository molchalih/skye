import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { uniforms } from "../../scripts/shaders.ts";
import { readUniformTable } from "../../test/support/uniforms.ts";
import type { Values } from "../gl/program.ts";
import * as glsl from "../shaders/generated.ts";

// Each pass, the program it draws with (`SKY` for sky.*.glsl) and its vertex stage.
const PASSES: Record<string, readonly [program: string, vertex: string]> = {
  sky: ["SKY", "FULLSCREEN_VS"],
  composite: ["COMPOSITE", "FULLSCREEN_VS"],
  particles: ["PARTICLES", "PARTICLES_VS"],
  rays: ["RAYS", "FULLSCREEN_VS"],
  glass: ["GLASS", "FULLSCREEN_VS"],
  blur: ["BLUR", "FULLSCREEN_VS"],
};

const generated: Readonly<Record<string, unknown>> = glsl;

function text(name: string): string {
  const value = generated[name];
  if (typeof value !== "string") throw new Error(`generated.ts has no string ${name}`);
  return value;
}

describe("pass uniforms", () => {
  // Every program's slots start at 0, and a slot is a number when it indexes `values`, so another program's slot
  // would write the wrong uniform with no type error; the table a pass builds its program with lays its values out.
  it.each(Object.keys(PASSES))(
    "%s builds its program with that program's table and writes only its uniforms",
    (pass) => {
      const [program, vertex] = PASSES[pass] ?? ["", ""];
      const src = readFileSync(new URL(`./${pass}.ts`, import.meta.url), "utf8");
      const call = /gpu\.program\(\s*glsl\.(\w+),\s*glsl\.(\w+),\s*glsl\.(\w+),?\s*\)/.exec(src);
      expect(call?.slice(1)).toEqual([vertex, `${program}_FS`, `${program}_UNIFORMS`]);
      const written = [...src.matchAll(/glsl\.([A-Z]+)_u[A-Z]\w*/g)].map((m) => m[1]);
      expect(written.length).toBeGreaterThan(0);
      expect(new Set(written)).toEqual(new Set([program]));
    },
  );

  it.each(Object.keys(PASSES))(
    "%s's table lists every uniform of its two stages once, with its type's size",
    (pass) => {
      const [program, vertex] = PASSES[pass] ?? ["", ""];
      const types = new Map([...uniforms(text(vertex)), ...uniforms(text(`${program}_FS`))]);
      const entries = readUniformTable(text(`${program}_UNIFORMS`));
      const sizes: Record<string, number> = {
        float: 1,
        int: 1,
        sampler2D: 1,
        vec2: 2,
        vec3: 3,
        vec4: 4,
      };
      expect(entries.map((u) => u.name).sort()).toEqual([...types.keys()].sort());
      for (const u of entries) {
        const type = types.get(u.name) ?? "";
        expect(u.size, u.name).toBe(sizes[type]);
        expect(u.int, u.name).toBe(type === "int" || type === "sampler2D");
      }
    },
  );

  // `values[glsl.SKY_uRes + 1]` writes one component, whose index must stay inside the uniform, and
  // `fill(0, glsl.BLUR_uDir, glsl.BLUR_uDir + 2)` ends at most at its end; types cannot see either.
  it.each(Object.keys(PASSES))("%s writes each vector's components within its width", (pass) => {
    const [program] = PASSES[pass] ?? [""];
    const src = readFileSync(new URL(`./${pass}.ts`, import.meta.url), "utf8");
    const entries = readUniformTable(text(`${program}_UNIFORMS`));
    const size = (name: string): number =>
      entries.find((u) => u.offset === generated[name])?.size ?? 0;
    const fill = /fill\([^,()]+,\s*glsl\.(\w+),\s*glsl\.(\w+)\s*\+\s*(\d+)\)/g;
    for (const [use, start = "", end = "", k = ""] of src.matchAll(fill)) {
      expect(end, use).toBe(start);
      expect(Number(k), use).toBeLessThanOrEqual(size(start));
    }
    const components = src.replace(fill, "").matchAll(/glsl\.([A-Z]+_u\w+)\s*\+\s*(\d+)/g);
    for (const [use, name = "", k = ""] of components)
      expect(Number(k), use).toBeLessThan(size(name));
  });
});

// Never called: each line below must fail to compile, so `tsc -b` (in `bun run typecheck`) reports any that stops
// failing as an unused directive.
export function slotMistakes(
  sky: Values<"SKY">,
  sunColor: readonly [number, number, number],
  sunPos: readonly [number, number],
): void {
  // @ts-expect-error a vec3 does not fit a vec2's slot
  sky.set(sunColor, glsl.SKY_uSunPos);
  // @ts-expect-error a slot of another program
  sky.set(sunPos, glsl.COMPOSITE_uSunPos);
  // @ts-expect-error a vector into a scalar's slot
  sky.set(sunPos, glsl.SKY_uTime);
  // @ts-expect-error a plain number is no slot
  sky.set(sunPos, 2);
}
