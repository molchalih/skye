import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const INCLUDE = /^#include "([\w.-]+)"$/;
// Character pairs that would fuse into a different token if the space between them were dropped.
const FUSING = new Set([
  "++",
  "--",
  "//",
  "/*",
  "&&",
  "||",
  "<<",
  ">>",
  "==",
  "!=",
  "<=",
  ">=",
  "^^",
]);
const WORD = /[\w.]/;

const DEFINE = /^#\s*define\s+(\w+)(\s*)(.*)$/;
const COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

// Names a program uses without declaring them, which renaming leaves as written along with every `gl_` and `GL_`
// name: GLSL ES 3.00's keywords and reserved words (section 3.8), built-in functions (chapter 8) and predefined
// macros, and `main`.
const BUILT_IN = new Set(
  `const uniform layout centroid flat smooth break continue do for while switch case default if else in out inout
  float int void bool true false invariant discard return mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4
  mat4x2 mat4x3 mat4x4 vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uint uvec2 uvec3 uvec4 lowp mediump highp
  precision sampler2D sampler3D samplerCube sampler2DShadow samplerCubeShadow sampler2DArray sampler2DArrayShadow
  isampler2D isampler3D isamplerCube isampler2DArray usampler2D usampler3D usamplerCube usampler2DArray struct
  attribute varying coherent volatile restrict readonly writeonly resource atomic_uint noperspective patch sample
  subroutine common partition active asm class union enum typedef template this goto inline noinline public static
  extern external interface long short double half fixed unsigned superp input output hvec2 hvec3 hvec4 dvec2 dvec3
  dvec4 fvec2 fvec3 fvec4 sampler3DRect filter image1D image2D image3D imageCube iimage1D iimage2D iimage3D iimageCube
  uimage1D uimage2D uimage3D uimageCube image1DArray image2DArray iimage1DArray iimage2DArray uimage1DArray
  uimage2DArray imageBuffer iimageBuffer uimageBuffer sampler1D sampler1DShadow sampler1DArray sampler1DArrayShadow
  isampler1D isampler1DArray usampler1D usampler1DArray sampler2DRect sampler2DRectShadow isampler2DRect
  usampler2DRect samplerBuffer isamplerBuffer usamplerBuffer sampler2DMS isampler2DMS usampler2DMS sampler2DMSArray
  isampler2DMSArray usampler2DMSArray sizeof cast namespace using
  radians degrees sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh pow exp log exp2 log2 sqrt inversesqrt
  abs sign floor trunc round roundEven ceil fract mod modf min max clamp mix step smoothstep isnan isinf
  floatBitsToInt floatBitsToUint intBitsToFloat uintBitsToFloat packSnorm2x16 unpackSnorm2x16 packUnorm2x16
  unpackUnorm2x16 packHalf2x16 unpackHalf2x16 length distance dot cross normalize faceforward reflect refract
  matrixCompMult outerProduct transpose determinant inverse lessThan lessThanEqual greaterThan greaterThanEqual equal
  notEqual any all not textureSize texture textureProj textureLod textureOffset texelFetch texelFetchOffset
  textureProjOffset textureLodOffset textureProjLod textureProjLodOffset textureGrad textureGradOffset textureProjGrad
  textureProjGradOffset dFdx dFdy fwidth
  defined __LINE__ __FILE__ __VERSION__ GL_ES GL_FRAGMENT_PRECISION_HIGH main`.split(/\s+/),
);
// One GLSL token: an identifier, a number with its exponent and suffix, a run of whitespace, or any other character.
const TOKEN = /[A-Za-z_]\w*|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\w*|\s+|[^]/g;
const IDENTIFIER = /^[A-Za-z_]/;
const RESERVED_PREFIX = /^(?:gl|GL)_/;
const DIRECTIVE = /^#\s*\w*/;
const MACRO = /^#\s*define\s+(\w+)/;
const PRECISION = new Set(["lowp", "mediump", "highp"]);
// Directives that name program identifiers; the others (#version, #extension, #pragma, #line, #error) stay whole.
const NAMING_DIRECTIVES = new Set(["#define", "#undef", "#if", "#ifdef", "#ifndef", "#elif"]);
const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DIGITS = "0123456789".split("");

/**
 * Removes `//` and `/* *\/` comments in one left-to-right pass, so whichever
 * opens first wins, as in the GLSL lexer. A block comment becomes a space, or
 * the newlines it spanned, since GLSL keeps those. GLSL has no string literals,
 * so there is no quoting to respect.
 */
export function stripComments(src: string): string {
  return src.replace(COMMENT, (c) => (c.startsWith("//") ? "" : c.replace(/[^\n]/g, "") || " "));
}

// Drops whitespace between tokens except where two word characters (or a fusing pair) meet, which keep one space.
function squeeze(line: string): string {
  let out = "";
  let pendingSpace = false;
  for (const ch of line) {
    if (/\s/.test(ch)) {
      pendingSpace = out !== "";
      continue;
    }
    if (pendingSpace) {
      const prev = out.slice(-1);
      if ((WORD.test(prev) && WORD.test(ch)) || FUSING.has(prev + ch)) out += " ";
      pendingSpace = false;
    }
    out += ch;
  }
  return out;
}

// Whitespace right after a macro's name is meaningful: `#define F (x)` is object-like and `#define N -1` must not become `N-1`.
function directive(line: string): string {
  const m = DEFINE.exec(line);
  if (m === null) return squeeze(line);
  const [, name = "", space = "", body = ""] = m;
  return `#define ${name}${body !== "" && space !== "" ? " " : ""}${squeeze(body)}`;
}

/**
 * Strips comments and redundant whitespace, nothing else: identifiers and
 * numeric literals are left exactly as written. Preprocessor directives keep
 * their own lines, as GLSL requires.
 */
export function minifyGlsl(src: string): string {
  let out = "";
  let body = "";
  const flush = (): void => {
    const s = squeeze(body);
    if (s !== "") out += s;
    body = "";
  };
  for (const raw of stripComments(src).split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#")) {
      flush();
      if (out !== "" && !out.endsWith("\n")) out += "\n";
      out += `${directive(line)}\n`;
    } else if (line !== "") {
      body += ` ${line}`;
    }
  }
  flush();
  return out;
}

/** One token of a minified program. */
interface Token {
  readonly text: string;
  /**
   * `name` for a name the program declares, `member` for a name that selects a
   * swizzle or struct member (after a `.`, or declared in a struct), `fixed`
   * for the rest: built-in names, layout qualifiers, directives that name
   * nothing (#version, #extension and the like), numbers and punctuation.
   */
  readonly kind: "name" | "member" | "fixed";
}

const isBlank = (t: string): boolean => /^\s/.test(t);

/** How many of `open` are open after `t`, from `depth` before it: -1 right after `keyword`, before the first. */
function nesting(depth: number, t: string, keyword: string, open: string, close: string): number {
  if (t === keyword) return -1;
  if (t === open && depth !== 0) return depth < 0 ? 1 : depth + 1;
  if (t === close && depth > 0) return depth - 1;
  return depth;
}

/** Splits a minified program into tokens that join back into it. Token pasting (`##`) is refused. */
function* glslTokens(src: string): Generator<Token> {
  let previous = "";
  // Parentheses open in a layout qualifier and braces open in a struct body; -1 right after the keyword.
  let layout = 0;
  let struct = 0;
  for (const [i, line] of src.split("\n").entries()) {
    if (i > 0) yield { text: "\n", kind: "fixed" };
    const head = DIRECTIVE.exec(line)?.[0] ?? "";
    if (head !== "" && !NAMING_DIRECTIVES.has(head.replace(/\s/g, ""))) {
      yield { text: line, kind: "fixed" };
      continue;
    }
    if (head !== "") yield { text: head, kind: "fixed" };
    if (head !== "" && line.includes("##"))
      throw new Error(`shaders: token pasting would hide names from renaming: ${line}`);
    const tokens = line.slice(head.length).match(TOKEN) ?? [];
    for (const [k, t] of tokens.entries()) {
      let kind: Token["kind"] = "fixed";
      layout = nesting(layout, t, "layout", "(", ")");
      struct = nesting(struct, t, "struct", "{", "}");
      if (layout === 0 && IDENTIFIER.test(t) && !BUILT_IN.has(t) && !RESERVED_PREFIX.test(t)) {
        const next = struct === 1 ? tokens.slice(k + 1).find((n) => !isBlank(n)) : undefined;
        const declaresMember = next === ";" || next === "," || next === "[";
        kind = previous === "." || declaresMember ? "member" : "name";
      }
      if (!isBlank(t)) previous = t;
      yield { text: t, kind };
    }
  }
}

/**
 * Each uniform in the default block of a minified program, the ones with a
 * location the API looks up by name, with its type. Blocks are skipped.
 */
export function uniforms(src: string): Map<string, string> {
  const tokens = [...glslTokens(src)].filter((t) => !isBlank(t.text));
  const found = new Map<string, string>();
  for (const [i, t] of tokens.entries()) {
    if (t.text !== "uniform") continue;
    let k = i + 1;
    if (PRECISION.has(tokens[k]?.text ?? "")) k++;
    const type = tokens[k]?.text ?? "";
    if (tokens[k + 1]?.text === "{") continue;
    let brackets = 0;
    for (k++; k < tokens.length && tokens[k]?.text !== ";"; k++) {
      const d = tokens[k];
      if (d?.text === "[") brackets++;
      else if (d?.text === "]") brackets--;
      else if (brackets === 0 && d?.kind === "name") found.set(d.text, type);
    }
  }
  return found;
}

/**
 * Gives every name the programs declare a short one: one letter, then a letter
 * and a letter or digit, in order of first appearance, which brotli packs
 * tighter than ordering by use. A name maps alike in every program, so a
 * varying still links across stages and the text programs share (the noise
 * functions) stays shared. Swizzles and struct members are left alone, and the
 * map is one to one and avoids every name left as written, so each program
 * compiles to what it did. A macro that stands for a member is refused, since
 * its uses and its expansion would part.
 */
export function shortNames(programs: Iterable<string>): Map<string, string> {
  const members = new Set<string>();
  const declared = new Set<string>();
  const macros = new Set<string>();
  for (const src of programs) {
    for (const t of glslTokens(src)) {
      if (t.kind === "member") members.add(t.text);
      else if (t.kind === "name") declared.add(t.text);
    }
    for (const line of src.split("\n")) {
      const macro = MACRO.exec(line)?.[1];
      if (macro !== undefined) macros.add(macro);
    }
  }
  for (const macro of macros) {
    if (members.has(macro))
      throw new Error(`shaders: macro ${macro} is used as a swizzle or member`);
  }
  const free = [...LETTERS, ...LETTERS.flatMap((a) => [...LETTERS, ...DIGITS].map((b) => a + b))];
  const short = free.filter((name) => !members.has(name) && !BUILT_IN.has(name)).values();
  const names = new Map<string, string>();
  for (const name of declared) {
    if (members.has(name)) continue;
    const next = short.next();
    if (next.done === true) throw new Error("shaders: out of short names");
    names.set(name, next.value);
  }
  return names;
}

/** Replaces each declared name in `names` with its short name. */
export function renameIdentifiers(src: string, names: ReadonlyMap<string, string>): string {
  let out = "";
  for (const t of glslTokens(src))
    out += t.kind === "name" ? (names.get(t.text) ?? t.text) : t.text;
  return out;
}

/** Replaces each `#include "file"` line with that file's text, read through `read`. Includes do not nest. */
export function resolveIncludes(src: string, read: (file: string) => string): string {
  return src
    .split("\n")
    .map((line) => {
      const m = INCLUDE.exec(line.trim());
      return m?.[1] === undefined ? line : read(m[1]);
    })
    .join("\n");
}

/** `sky.frag.glsl` becomes `SKY_FS`; files without a stage (shared includes) are skipped. */
export function exportName(file: string): string | undefined {
  const m = /^([\w-]+)\.(vert|frag)\.glsl$/.exec(file);
  if (m?.[1] === undefined) return undefined;
  return `${m[1].toUpperCase().replace(/-/g, "_")}_${m[2] === "vert" ? "VS" : "FS"}`;
}

/**
 * Every program source keyed by export name, and for each program (`SKY` for
 * `sky.*.glsl`) the name each of its uniforms has in the sources.
 */
export interface Shaders {
  readonly programs: ReadonlyMap<string, string>;
  readonly uniforms: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/**
 * Builds every program source in `dir`, in file-name order, with the names it
 * declares shortened, or kept with `readable`.
 */
export function buildShaders(dir: string, readable = false): Shaders {
  const read = (file: string): string => readFileSync(`${dir}/${file}`, "utf8");
  const sources = new Map<string, string>();
  for (const file of readdirSync(dir).sort()) {
    const name = exportName(file);
    if (name !== undefined) sources.set(name, minifyGlsl(resolveIncludes(read(file), read)));
  }
  const names = readable ? new Map<string, string>() : shortNames(sources.values());
  const programs = new Map<string, string>();
  const byProgram = new Map<string, Map<string, string>>();
  for (const [name, src] of sources) {
    programs.set(name, renameIdentifiers(src, names));
    const program = name.replace(/_[VF]S$/, "");
    for (const uniform of uniforms(src).keys()) {
      const map = byProgram.get(program) ?? new Map<string, string>();
      byProgram.set(program, map.set(uniform, names.get(uniform) ?? uniform));
    }
  }
  return { programs, uniforms: byProgram };
}

export function renderModule(shaders: Shaders): string {
  let out =
    "// Generated by scripts/shaders.ts from src/shaders/*.glsl. Do not edit. SKYE_READABLE_SHADERS=1 keeps GLSL names.\n";
  for (const [name, source] of shaders.programs)
    out += `export const ${name}: string = ${JSON.stringify(source)};\n`;
  // One constant per program and uniform, `SKY_uRes`, so a pass can only name its own program's uniforms. The bundler
  // inlines plain string constants; an object per program would stay in the bundle (about 490 B brotli).
  out += "// Each uniform's name in its program.\n";
  for (const [program, names] of shaders.uniforms) {
    for (const [uniform, short] of names)
      out += `export const ${program}_${uniform}: string = ${JSON.stringify(short)};\n`;
  }
  return out;
}

/**
 * True when `SKYE_READABLE_SHADERS=1` asks for the programs' own names, so a
 * driver's info log names what the .glsl files do. The token stream is
 * otherwise the same.
 */
export function readableShaders(): boolean {
  return process.env["SKYE_READABLE_SHADERS"] === "1";
}

/**
 * Regenerates `src/shaders/generated.ts`, writing only when the text changed
 * so that a watching test runner does not see a spurious edit.
 */
export function writeShaders(): void {
  const dir = fileURLToPath(new URL("../src/shaders", import.meta.url));
  const file = `${dir}/generated.ts`;
  const text = renderModule(buildShaders(dir, readableShaders()));
  if (!existsSync(file) || readFileSync(file, "utf8") !== text) writeFileSync(file, text);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeShaders();
