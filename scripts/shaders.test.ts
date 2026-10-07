import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildShaders, minifyGlsl, renderModule, resolveIncludes } from "./shaders.ts";

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
      .match(/[A-Za-z_]\w*|\d*\.\d+(?:[eE][-+]?\d+)?|\d+\.?(?:[eE][-+]?\d+)?|\S/g) ?? []
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

describe("generated shaders", () => {
  const generated = buildShaders(shaderDir);

  it("cover every v6 program", () => {
    expect([...generated.keys()].sort()).toEqual(Object.keys(V6_NAMES).sort());
    expect(Object.values(V6_NAMES).sort()).toEqual([...v6Programs().keys()].sort());
  });

  it("equal v6's text up to whitespace and comments", () => {
    const reference = v6Programs();
    for (const [name, source] of generated) {
      const v6Name = V6_NAMES[name] ?? "";
      expect(tokens(source), name).toEqual(tokens(reference.get(v6Name) ?? ""));
      expect(source.startsWith("#version 300 es\n"), name).toBe(true);
    }
  });

  it("are current on disk: the test run regenerates them before any test imports them", () => {
    const onDisk = readFileSync(`${shaderDir}/generated.ts`, "utf8");
    expect(onDisk).toBe(renderModule(generated));
  });

  it("emit a module with one string per program", () => {
    const module = renderModule(generated);
    for (const [name, source] of generated) {
      expect(module).toContain(`export const ${name}: string = ${JSON.stringify(source)};`);
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
