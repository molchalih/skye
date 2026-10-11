import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readUniformTable } from "../test/support/uniforms.ts";
import {
  buildShaders,
  dropUnusedFunctions,
  minifyGlsl,
  readableShaders,
  renameIdentifiers,
  renderModule,
  resolveIncludes,
  shortenFloats,
  shortNames,
  uniforms,
  uniformTable,
} from "./shaders.ts";

const shaderDir = fileURLToPath(new URL("../src/shaders", import.meta.url));
// Independent of the generator: drops `//` comments and splits into GLSL tokens, so only whitespace and comments are ignored.
function tokens(src: string): string[] {
  return (
    src
      .replace(/\/\/[^\n]*/g, "")
      .match(/[A-Za-z_]\w*|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\w*|\S/g) ?? []
  );
}

describe("generated shaders", () => {
  const shipped = buildShaders(shaderDir);
  // The programs as written, before names are shortened.
  const readable = buildShaders(shaderDir, true);

  it("build the same programs in both modes, each a GLSL ES 3.00 program", () => {
    expect([...readable.programs.keys()]).toEqual([
      "BLUR_FS",
      "COMPOSITE_FS",
      "FULLSCREEN_VS",
      "GLASS_FS",
      "PARTICLES_FS",
      "PARTICLES_VS",
      "RAYS_FS",
      "SKY_FS",
    ]);
    expect([...shipped.programs.keys()]).toEqual([...readable.programs.keys()]);
    for (const [name, source] of shipped.programs)
      expect(source.startsWith("#version 300 es\n"), name).toBe(true);
  });

  it("ship the written text with only its declared names renamed, one to one across every program, and floats shortened", () => {
    const names = new Map<string, string>();
    const owners = new Map<string, string>();
    for (const [name, source] of shipped.programs) {
      const before = tokens(readable.programs.get(name) ?? "");
      const after = tokens(source);
      expect(after, name).toHaveLength(before.length);
      before.forEach((t, i) => {
        const renamed = after[i] ?? "";
        if (/^\.?\d/.test(t)) {
          // The same value, and still a float literal when it was one.
          expect(Number(renamed), `${name} token ${i}`).toBe(Number(t));
          expect(/[.eE]/.test(renamed), `${name} token ${i}`).toBe(/[.eE]/.test(t));
          expect(renamed.length, `${name} token ${i}`).toBeLessThanOrEqual(t.length);
          return;
        }
        if (!/^[A-Za-z_]/.test(t) || before[i - 1] === "." || t.startsWith("gl_")) {
          expect(renamed, `${name} token ${i}`).toBe(t);
          return;
        }
        expect(names.get(t) ?? renamed, t).toBe(renamed);
        expect(owners.get(renamed) ?? t, renamed).toBe(t);
        names.set(t, renamed);
        owners.set(renamed, t);
      });
    }
    for (const builtIn of ["main", "texture", "smoothstep", "vec2", "float", "uniform", "location"])
      expect(names.get(builtIn) ?? builtIn).toBe(builtIn);
    for (const [program, map] of shipped.uniforms) {
      const own = [...(readable.uniforms.get(program) ?? [])];
      expect(
        [...map].map(([u, { name, type }]) => [u, name, type]),
        program,
      ).toEqual(own.map(([u, { type }]) => [u, names.get(u), type]));
    }
    expect([...shipped.uniforms.keys()]).toEqual([
      "BLUR",
      "COMPOSITE",
      "GLASS",
      "PARTICLES",
      "RAYS",
      "SKY",
    ]);
    for (const map of readable.uniforms.values())
      for (const [u, as] of map) expect(as.name).toBe(u);
  });

  it("are current on disk: the test run regenerates them before any test imports them", () => {
    const onDisk = readFileSync(`${shaderDir}/generated.ts`, "utf8");
    expect(onDisk).toBe(renderModule(buildShaders(shaderDir, readableShaders())));
  });

  it("emit a module with one string per program, and per program its uniform table and each uniform's slot", () => {
    const module = renderModule(shipped);
    for (const [name, source] of shipped.programs)
      expect(module).toContain(`export const ${name}: string = ${JSON.stringify(source)};`);
    for (const [program, map] of shipped.uniforms) {
      const { table, slots } = uniformTable(map);
      const t = `Table<"${program}">`;
      expect(module).toContain(
        `export const ${program}_UNIFORMS: ${t} = ${JSON.stringify(table)} as ${t};`,
      );
      // The table reads back to the same names, offsets and sizes.
      const entries = readUniformTable(table);
      expect(entries.map((u) => u.name)).toEqual([...map.values()].map((u) => u.name));
      expect(entries.map(({ offset, size }) => ({ offset, size }))).toEqual([...slots.values()]);
      for (const [name, { offset, size }] of slots) {
        const slot = `Slot<"${program}", ${size}>`;
        expect(module).toContain(
          `export const ${program}_${name}: ${slot} = ${offset} as ${slot};`,
        );
      }
    }
  });

  it("drop only functions a program never calls", () => {
    let checked = 0;
    for (const [name, source] of readable.programs) {
      const functions = [...source.matchAll(/(?:^|[;}\n])(?:float|vec[234]|void)\s+(\w+)\(/g)].map(
        (m) => m[1],
      );
      for (const f of functions) {
        if (f === "main") continue;
        expect(
          source.match(new RegExp(`\\b${f}\\(`, "g"))?.length ?? 0,
          `${name} ${f}`,
        ).toBeGreaterThan(1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(readable.programs.get("GLASS_FS")).not.toContain("vnoise");
    expect(readable.programs.get("SKY_FS")).toContain("float vnoise(");
  });
});

describe("minifyGlsl", () => {
  it("drops comments and spaces but keeps tokens and numbers as written", () => {
    expect(minifyGlsl("float a = 1.50 * b; // half\n/* block\n */ vec2 c = vec2(1e-4, .5);")).toBe(
      "float a=1.50*b;vec2 c=vec2(1e-4,.5);",
    );
  });

  it("keeps a space where tokens would fuse", () => {
    expect(minifyGlsl("x = a - -b + +c; y = d / /* c */ e;")).toBe("x=a- -b+ +c;y=d/e;");
    expect(minifyGlsl("else if (a) return b;")).toBe("else if(a)return b;");
  });

  it("keeps preprocessor directives on their own lines", () => {
    expect(minifyGlsl("#version 300 es\nprecision highp float;\n#define K 2\nfloat k = K;")).toBe(
      "#version 300 es\nprecision highp float;\n#define K 2\nfloat k=K;",
    );
  });

  it("keeps the space that separates a macro's name from its body", () => {
    expect(minifyGlsl("#define F (x)\n#define G(x) ( x + 1 )\n#define N -1\n#define E\n")).toBe(
      "#define F (x)\n#define G(x)(x+1)\n#define N -1\n#define E\n",
    );
    expect(minifyGlsl("#  define  K\t2 // two\n")).toBe("#define K 2\n");
  });

  it("strips comments left to right, whichever kind opens first", () => {
    expect(minifyGlsl("// see /* here\nfloat a;\n/* b // c */ float d;")).toBe("float a;float d;");
    expect(minifyGlsl("float a; /* x // y */ float b; // z /* w\nfloat c;")).toBe(
      "float a;float b;float c;",
    );
  });

  it("keeps the newlines a block comment spans, so a directive does not run into code", () => {
    expect(minifyGlsl("#define K 2 /* two\n */ float k = K;")).toBe("#define K 2\nfloat k=K;");
  });

  it("resolves include directives", () => {
    const files: Record<string, string> = { "n.glsl": "float n(){ return 1.0; }" };
    expect(resolveIncludes('a;\n  #include "n.glsl"\nb;', (f) => files[f] ?? "")).toBe(
      "a;\nfloat n(){ return 1.0; }\nb;",
    );
  });
});

describe("dropUnusedFunctions", () => {
  it("drops a function nothing calls, and keeps main and the functions it calls", () => {
    expect(
      dropUnusedFunctions("float a(){return 1.;}float b(){return 2.;}void main(){float x=a();}"),
    ).toBe("float a(){return 1.;}void main(){float x=a();}");
  });

  it("drops a function whose only caller it dropped, until none is left", () => {
    expect(
      dropUnusedFunctions(
        "float a(){return 1.;}float b(){return a();}float c(){return b();}void main(){}",
      ),
    ).toBe("void main(){}");
  });

  it("keeps every overload of a called name, and drops them all when none is called", () => {
    const overloads = "float f(float x){return x;}float f(vec2 x){return f(x.x);}";
    expect(dropUnusedFunctions(`${overloads}void main(){float y=f(1.);}`)).toBe(
      `${overloads}void main(){float y=f(1.);}`,
    );
    expect(dropUnusedFunctions(`${overloads}void main(){}`)).toBe("void main(){}");
  });

  it("counts a call from a global initializer or a macro", () => {
    const global = "float f(){return 1.;}float k=f();void main(){}";
    expect(dropUnusedFunctions(global)).toBe(global);
    const macro = "#define F f(1.)\nfloat f(float x){return x;}void main(){float y=F;}";
    expect(dropUnusedFunctions(macro)).toBe(macro);
  });

  it("leaves structs, blocks, prototypes, globals and directives alone", () => {
    const kept =
      "#version 300 es\nprecision highp float;struct S{float a;};uniform B{float u;};float g(float x);" +
      "const vec2 k=vec2(1.);layout(location=0)out vec4 o;";
    expect(dropUnusedFunctions(`${kept}float h(float x){return x;}void main(){}`)).toBe(
      `${kept}void main(){}`,
    );
  });

  it("keeps a function a directive cuts through", () => {
    const src = "float f(){\n#ifdef X\nreturn 1.;\n#endif\nreturn 0.;}void main(){}";
    expect(dropUnusedFunctions(src)).toBe(src);
  });
});

describe("uniformTable", () => {
  it("lists each uniform's kind and name, and slots that follow one another", () => {
    const map = new Map([
      ["uA", { name: "a", type: "float" }],
      ["uB", { name: "b", type: "vec3" }],
      ["uTex", { name: "c", type: "sampler2D" }],
      ["uN", { name: "d", type: "int" }],
      ["uW", { name: "e", type: "vec4" }],
      ["uP", { name: "f", type: "vec2" }],
    ]);
    const { table, slots } = uniformTable(map);
    expect(table).toBe("fa 3b ic id 4e 2f");
    expect([...slots]).toEqual([
      ["uA", { offset: 0, size: 1 }],
      ["uB", { offset: 1, size: 3 }],
      ["uTex", { offset: 4, size: 1 }],
      ["uN", { offset: 5, size: 1 }],
      ["uW", { offset: 6, size: 4 }],
      ["uP", { offset: 10, size: 2 }],
    ]);
  });

  it("refuses an array, whose elements past the first would never upload", () => {
    const shaders = "uniform vec3 uK[4];uniform float uF;";
    expect([...uniforms(shaders)]).toEqual([
      ["uK", "vec3[]"],
      ["uF", "float"],
    ]);
    const map = new Map([...uniforms(shaders)].map(([u, type]) => [u, { name: u, type }]));
    expect(() => uniformTable(map)).toThrow(/uK is an array/);
  });

  it("refuses a type Program cannot upload", () => {
    expect(() => uniformTable(new Map([["uM", { name: "m", type: "mat4" }]]))).toThrow(/uM.*mat4/);
  });
});

describe("shortenFloats", () => {
  it("drops trailing zeros of the fraction and leading zeros of the whole part", () => {
    expect(shortenFloats("float a=1.0,b=0.50,c=0.0,d=10.0,e=100.25,f=0.05,g=2.;")).toBe(
      "float a=1.,b=.5,c=0.,d=10.,e=100.25,f=.05,g=2.;",
    );
  });

  it("keeps exponents, and leaves exponent-only, integer, unsigned and hex literals as written", () => {
    expect(shortenFloats("float a=2.50E3+1.0e-4+1e-4+.5e1;int i=10;uint u=2u+0x1Fu;")).toBe(
      "float a=2.5E3+1.e-4+1e-4+.5e1;int i=10;uint u=2u+0x1Fu;",
    );
  });

  it("shortens negative numbers and constructor arguments, and leaves swizzles and names alone", () => {
    expect(shortenFloats("vec3 v1=vec3(-1.0,0.50,-0.0);float x=v1.x- -2.0;")).toBe(
      "vec3 v1=vec3(-1.,.5,-0.);float x=v1.x- -2.;",
    );
  });

  it("shortens macro bodies and conditions, but not other directives", () => {
    expect(shortenFloats("#version 300 es\n#define K 1.50\n#if 1\nfloat k=K*0.0;\n#endif\n")).toBe(
      "#version 300 es\n#define K 1.5\n#if 1\nfloat k=K*0.;\n#endif\n",
    );
  });
});

describe("shortNames and renameIdentifiers", () => {
  // Renames a set of programs the way the build does.
  function shorten(...programs: string[]): string[] {
    const names = shortNames(programs);
    return programs.map((src) => renameIdentifiers(src, names));
  }

  it("give declared names short ones in order of first appearance", () => {
    expect(
      shorten("float apple(float pear){return pear*2.0;}void main(){float plum=apple(1.0);}"),
    ).toEqual(["float a(float b){return b*2.0;}void main(){float c=a(1.0);}"]);
  });

  it("leave keywords, built-in functions and variables, and layout qualifiers alone", () => {
    const src =
      "#version 300 es\nprecision highp float;layout(location=0)in vec2 pos;out vec4 color;" +
      "void main(){color=texture(tex,pos)+vec4(sin(pos.x),gl_FragCoord.xy,1.0);gl_Position=vec4(pos,0.0,1.0);}";
    expect(shorten(src)).toEqual([
      "#version 300 es\nprecision highp float;layout(location=0)in vec2 a;out vec4 b;" +
        "void main(){b=texture(c,a)+vec4(sin(a.x),gl_FragCoord.xy,1.0);gl_Position=vec4(a,0.0,1.0);}",
    ]);
  });

  it("leave swizzles and fields alone, and keep a declared name that is also one", () => {
    expect(shorten("vec4 rgb;float x;vec3 tint=rgb.rgb*x+tint.xyz;")).toEqual([
      "vec4 rgb;float a;vec3 b=rgb.rgb*a+b.xyz;",
    ]);
  });

  it("never hand out a name that stays as written", () => {
    expect(shorten("float f(vec4 v){return v.a+v.b+v.c;}")).toEqual([
      "float d(vec4 e){return e.a+e.b+e.c;}",
    ]);
    const many = Array.from({ length: 300 }, (_, i) => `float name${i};`).join("");
    const short = shortNames([many]);
    expect(new Set(short.values()).size).toBe(300);
    for (const keyword of ["do", "if", "in"]) expect([...short.values()]).not.toContain(keyword);
  });

  it("rename alike in every program, so varyings still link across stages", () => {
    const [vs, fs] = shorten(
      "#version 300 es\nin vec2 pos;out vec2 vUv;void main(){vUv=pos;}",
      "#version 300 es\nprecision highp float;in vec2 vUv;out vec4 color;void main(){color=vec4(vUv,0.0,1.0);}",
    );
    expect(vs).toBe("#version 300 es\nin vec2 a;out vec2 b;void main(){b=a;}");
    expect(fs).toBe(
      "#version 300 es\nprecision highp float;in vec2 b;out vec4 c;void main(){c=vec4(b,0.0,1.0);}",
    );
  });

  it("rename inside macros and conditionals, but not other directives or `defined`", () => {
    const src =
      "#version 300 es\n#extension GL_EXT_shader_texture_lod:enable\n#define SQUARE(x)((x)*(x))\n" +
      "#if defined(SQUARE)\nfloat area=SQUARE(side);\n#endif\n";
    expect(shorten(src)).toEqual([
      "#version 300 es\n#extension GL_EXT_shader_texture_lod:enable\n#define a(b)((b)*(b))\n" +
        "#if defined(a)\nfloat c=a(d);\n#endif\n",
    ]);
  });

  it("leave numbers whole, exponents and suffixes included", () => {
    expect(shorten("float e=1e-4+2.5E3+.5e1;uint u=0x1Fu;")).toEqual([
      "float a=1e-4+2.5E3+.5e1;uint b=0x1Fu;",
    ]);
  });

  it("leave layout qualifiers alone by context, and rename a variable that shares a qualifier's name", () => {
    expect(
      shorten("layout(std140,row_major)uniform B{mat4 m;};layout(location=0)in vec2 location;"),
    ).toEqual(["layout(std140,row_major)uniform a{mat4 b;};layout(location=0)in vec2 c;"]);
  });

  it("leave GL_ and gl_ names alone, extension macros included", () => {
    expect(
      shorten("#ifdef GL_OES_standard_derivatives\nfloat d=GL_ES+gl_FragCoord.x;\n#endif\n"),
    ).toEqual(["#ifdef GL_OES_standard_derivatives\nfloat a=GL_ES+gl_FragCoord.x;\n#endif\n"]);
  });

  it("leave struct members alone, accessed or not", () => {
    expect(
      shorten(
        "struct Light{vec3 color;float power,spare[2];};Light light;vec3 lit(){return light.color*light.power;}",
      ),
    ).toEqual(["struct a{vec3 color;float power,spare[2];};a b;vec3 c(){return b.color*b.power;}"]);
  });

  it("keep overloads together under one name", () => {
    expect(
      shorten(
        "float f(float x){return x;}float f(vec2 x){return x.x;}float g=f(1.0)+f(vec2(2.0));",
      ),
    ).toEqual([
      "float a(float x){return x;}float a(vec2 x){return x.x;}float b=a(1.0)+a(vec2(2.0));",
    ]);
  });

  it("rename an anonymous uniform block's members, which the program names directly", () => {
    expect(shorten("uniform Params{float gain;};float k=gain*2.0;")).toEqual([
      "uniform a{float b;};float c=b*2.0;",
    ]);
  });

  it("refuse a macro that stands for a swizzle or member, and token pasting", () => {
    expect(() => shortNames(["#define S z\nvec3 v;float f=v.S;"])).toThrow(/macro S/);
    expect(() => shortNames(["#define CAT(a,b) a##b\nfloat CAT(x,y);"])).toThrow(/token pasting/);
  });

  it("find the uniforms with locations and their types, marking arrays and skipping blocks", () => {
    const src =
      "uniform highp vec2 uA,uB[N];uniform sampler2D uTex;uniform Light{vec3 uColor;}light;uniform float uC;float x;";
    expect([...uniforms(src)]).toEqual([
      ["uA", "vec2"],
      ["uB", "vec2[]"],
      ["uTex", "sampler2D"],
      ["uC", "float"],
    ]);
  });
});
