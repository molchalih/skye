import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildShaders,
  minifyGlsl,
  readableShaders,
  renameIdentifiers,
  renderModule,
  resolveIncludes,
  shortNames,
  uniforms,
} from "./shaders.ts";

const shaderDir = fileURLToPath(new URL("../src/shaders", import.meta.url));
const v6 = readFileSync(new URL("../test/reference/weather-sky-v6.js", import.meta.url), "utf8");

// v6 holds each program in a `const NAME = \`...\`;` template literal.
function v6Programs(): Map<string, string> {
  const consts = new Map<string, string>();
  for (const m of v6.matchAll(/const (\w+) = `([\s\S]*?)`;/g)) {
    if (m[1] !== undefined && m[2] !== undefined) consts.set(m[1], m[2]);
  }
  const noise = consts.get("NOISE") ?? "";
  const out = new Map<string, string>();
  for (const [name, text] of consts)
    if (name !== "NOISE") out.set(name, text.replace("${NOISE}", noise));
  return out;
}

// Independent of the generator: drops `//` comments and splits into GLSL tokens, so only whitespace and comments are ignored.
function tokens(src: string): string[] {
  return (
    src
      .replace(/\/\/[^\n]*/g, "")
      .match(/[A-Za-z_]\w*|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\w*|\S/g) ?? []
  );
}

const V6_NAMES: Record<string, string> = {
  FULLSCREEN_VS: "VS_FULL",
  SKY_FS: "SKY_FS",
  COMPOSITE_FS: "COMP_FS",
  PARTICLES_VS: "PART_VS",
  PARTICLES_FS: "PART_FS",
  RAYS_FS: "RAYS_FS",
  GLASS_FS: "GLASS_FS",
  BLUR_FS: "BLUR_FS",
};

// Every way a shipped program departs from v6, as (v6 snippet, replacement) pairs: each skips work whose result is
// provably unused, and its source comment says why. The pixel parity gate holds the output to v6's. Whitespace and
// comments do not matter; any edit not listed here fails the comparison below.
const EDITS: Record<string, ReadonlyArray<readonly [string, string]>> = {
  SKY_FS: [
    [
      "vec3 spectrum(",
      `float fbm(vec2 p, int oct, float lo, float hi){ float a = 0.5, s = 0.0, n = 0.0, w = 1.0 - exp2(-float(oct));
        float below = (lo - 1.0)*w - 1e-4, above = hi*w + 1e-4;
        for (int i = 0; i < 6; i++){ if (i >= oct) break; s += a*vnoise(p); n += a; p = ROT*p + 17.3; a *= 0.5;
          if (s - n < below || s > above) break; } return s/n; }
      vec3 spectrum(`,
    ],
    [
      "smoothstep(th, th + soft*2.6, fbm(q, oct)); }",
      "smoothstep(th, th + soft*2.6, fbm(q, oct, th, th + soft*2.6)); }",
    ],
    ["float d = fbm(q, oct);", "float d = fbm(q, oct, th + 0.025*soft, th + soft*2.6);"],
  ],
  GLASS_FS: [
    [
      "step(0.12, ti); float aboveStart",
      "step(0.12, ti); if (trailRegion == 0.0) return vec2(drop, smoothstep(0.0, 0.15, drop)); float aboveStart",
    ],
    ["id.y*3543.6); vec2 p", "id.y*3543.6); if (fract(n.z*7.0) < 0.72) return 0.0; vec2 p"],
    ["*life*step(0.72, fract(n.z*7.0)); }", "*life; }"],
    [
      "vec2 m2 = slideLayer(U + 3.7, t*1.3, 1.85)*smoothstep(0.5, 1.0, uRainG); hgt = max(hgt, m2.x); trailClear = max(trailClear, m2.y);",
      "if (uRainG > 0.5) { vec2 m2 = slideLayer(U + 3.7, t*1.3, 1.85)*smoothstep(0.5, 1.0, uRainG); hgt = max(hgt, m2.x); trailClear = max(trailClear, m2.y); }",
    ],
    ["if (uDetail > 0.5) { fn", "if (uDetail > 0.5 && frostMask > 0.0) { fn"],
  ],
};

// Replaces the one occurrence of each snippet's tokens in v6's tokens.
function edited(v6Tokens: string[], edits: ReadonlyArray<readonly [string, string]>): string[] {
  let out = v6Tokens;
  for (const [from, to] of edits) {
    const f = tokens(from);
    const at = out.flatMap((_, i) => (f.every((t, k) => out[i + k] === t) ? [i] : []));
    expect(at, from).toHaveLength(1);
    out = [...out.slice(0, at[0]), ...tokens(to), ...out.slice((at[0] ?? 0) + f.length)];
  }
  return out;
}

describe("generated shaders", () => {
  const shipped = buildShaders(shaderDir);
  // The programs as written, before names are shortened: what v6 is compared with.
  const readable = buildShaders(shaderDir, true);

  it("cover every v6 program", () => {
    expect([...readable.programs.keys()].sort()).toEqual(Object.keys(V6_NAMES).sort());
    expect([...shipped.programs.keys()]).toEqual([...readable.programs.keys()]);
    expect(Object.values(V6_NAMES).sort()).toEqual([...v6Programs().keys()].sort());
  });

  it("equal v6's text up to whitespace, comments and the listed edits", () => {
    const reference = v6Programs();
    for (const [name, source] of readable.programs) {
      const v6Tokens = tokens(reference.get(V6_NAMES[name] ?? "") ?? "");
      expect(tokens(source), name).toEqual(edited(v6Tokens, EDITS[name] ?? []));
      expect(source.startsWith("#version 300 es\n"), name).toBe(true);
    }
  });

  it("ship that text with only its declared names renamed, one to one across every program", () => {
    const names = new Map<string, string>();
    const owners = new Map<string, string>();
    for (const [name, source] of shipped.programs) {
      const before = tokens(readable.programs.get(name) ?? "");
      const after = tokens(source);
      expect(after, name).toHaveLength(before.length);
      before.forEach((t, i) => {
        const renamed = after[i] ?? "";
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
      const own = [...(readable.uniforms.get(program)?.keys() ?? [])];
      expect([...map], program).toEqual(own.map((u) => [u, names.get(u)]));
    }
    expect([...shipped.uniforms.keys()]).toEqual([
      "BLUR",
      "COMPOSITE",
      "GLASS",
      "PARTICLES",
      "RAYS",
      "SKY",
    ]);
    for (const map of readable.uniforms.values()) for (const [u, as] of map) expect(as).toBe(u);
  });

  it("are current on disk: the test run regenerates them before any test imports them", () => {
    const onDisk = readFileSync(`${shaderDir}/generated.ts`, "utf8");
    expect(onDisk).toBe(renderModule(buildShaders(shaderDir, readableShaders())));
  });

  it("emit a module with one string per program and per program's uniform name", () => {
    const module = renderModule(shipped);
    for (const [name, source] of shipped.programs)
      expect(module).toContain(`export const ${name}: string = ${JSON.stringify(source)};`);
    for (const [program, map] of shipped.uniforms) {
      for (const [name, short] of map)
        expect(module).toContain(`export const ${program}_${name}: string = "${short}";`);
    }
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

  it("find the uniforms with locations and their types, skipping blocks and array sizes", () => {
    const src =
      "uniform highp vec2 uA,uB[N];uniform sampler2D uTex;uniform Light{vec3 uColor;}light;uniform float uC;float x;";
    expect([...uniforms(src)]).toEqual([
      ["uA", "vec2"],
      ["uB", "vec2"],
      ["uTex", "sampler2D"],
      ["uC", "float"],
    ]);
  });
});
