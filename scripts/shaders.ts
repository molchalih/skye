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
// A decimal float literal with a point, its exponent optional and no suffix: the integer part, the fraction, the rest.
const FLOAT = /^(?=\.?\d)(\d*)\.(\d*)([eE][-+]?\d+)?$/;
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
 * location the API looks up by name, with its type: `vec3[]` for an array of
 * vec3. Blocks are skipped.
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
      else if (brackets === 0 && d?.kind === "name")
        found.set(d.text, tokens[k + 1]?.text === "[" ? `${type}[]` : type);
    }
  }
  return found;
}

/**
 * Each function a minified program defines, by name, with the token range of
 * every definition (overloads included), from its return type through its
 * closing brace. A definition is a top-level declaration whose first `(`
 * follows a declared name with no `=` before it, and whose `)` is followed by
 * a body. Prototypes, structs, blocks, globals and directives are not.
 */
function functionDefinitions(tokens: readonly Token[]): Map<string, [number, number][]> {
  const found = new Map<string, [number, number][]>();
  let depth = 0;
  // The declaration under way at the top level: where it starts, its name once its first `(` shows it is a function,
  // and whether an `=` came first, which makes the `(` part of an initializer.
  let start = 0;
  let name: string | undefined;
  let assigned = false;
  let inDirective = false;
  let previous: Token | undefined;
  let body = false;
  for (const [i, t] of tokens.entries()) {
    if (t.text === "\n") {
      inDirective = false;
      // A directive inside a definition would be cut in two by removing it: such a function is never a candidate.
      if (depth === 0) start = i + 1;
      else name = undefined;
      continue;
    }
    if (inDirective || t.text.startsWith("#")) {
      inDirective = true;
      continue;
    }
    if (isBlank(t.text)) continue;
    if (t.text === "{") {
      if (depth === 0) body = name !== undefined && previous?.text === ")";
      depth++;
    } else if (t.text === "}") {
      depth--;
      if (depth === 0) {
        if (body && name !== undefined)
          found.set(name, [...(found.get(name) ?? []), [start, i + 1]]);
        start = i + 1;
        name = undefined;
        assigned = false;
        body = false;
      }
    } else if (depth === 0 && t.text === ";") {
      start = i + 1;
      name = undefined;
      assigned = false;
    } else if (depth === 0 && t.text === "=") {
      assigned = true;
    } else if (depth === 0 && t.text === "(" && name === undefined && !assigned) {
      if (previous?.kind === "name") name = previous.text;
    }
    previous = t;
  }
  return found;
}

/**
 * Drops every function the program never calls, until none is left: one is
 * called when its name appears anywhere outside its own definitions, in code
 * or in a directive. `main` stays. GLSL compilers drop such functions too, so
 * the program compiles as before; its text just stops shipping them, such as
 * the noise block's `vnoise` in the glass, which calls only `hash12`.
 */
export function dropUnusedFunctions(src: string): string {
  let out = src;
  for (;;) {
    const tokens = [...glslTokens(out)];
    const inside = (ranges: readonly [number, number][], i: number): boolean =>
      ranges.some(([from, to]) => i >= from && i < to);
    const unused = [...functionDefinitions(tokens)].find(
      ([name, ranges]) =>
        name !== "main" && !tokens.some((t, i) => t.text === name && !inside(ranges, i)),
    );
    if (unused === undefined) return out;
    out = tokens
      .filter((_, i) => !inside(unused[1], i))
      .map((t) => t.text)
      .join("");
  }
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

/**
 * Writes each float literal with a point in its shortest form for the same
 * value: no trailing zeros in the fraction and no leading zeros before the
 * point, so `1.0` becomes `1.`, `0.50` becomes `.5` and `0.0` becomes `0.`.
 * Integers, exponent-only and suffixed literals are left as written.
 */
export function shortenFloats(src: string): string {
  let out = "";
  for (const t of glslTokens(src)) {
    const m = t.kind === "fixed" ? FLOAT.exec(t.text) : null;
    if (m === null) {
      out += t.text;
      continue;
    }
    const [, whole = "", fraction = "", exponent = ""] = m;
    const digits = whole.replace(/^0+/, "");
    const rest = fraction.replace(/0+$/, "");
    out += `${digits === "" && rest === "" ? "0" : digits}.${rest}${exponent}`;
  }
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

/** A uniform in the default block: its name in the shipped program and its GLSL type. */
export interface Uniform {
  readonly name: string;
  readonly type: string;
}

/**
 * Every program source keyed by export name, and for each program (`SKY` for
 * `sky.*.glsl`) its uniforms keyed by their names in the sources, in the order
 * the stages declare them.
 */
export interface Shaders {
  readonly programs: ReadonlyMap<string, string>;
  readonly uniforms: ReadonlyMap<string, ReadonlyMap<string, Uniform>>;
}

/**
 * Builds every program source in `dir`, in file-name order, without the
 * functions it never calls, and with the names it declares and its float
 * literals shortened, or both kept with `readable`.
 */
export function buildShaders(dir: string, readable = false): Shaders {
  const read = (file: string): string => readFileSync(`${dir}/${file}`, "utf8");
  const sources = new Map<string, string>();
  for (const file of readdirSync(dir).sort()) {
    const name = exportName(file);
    if (name !== undefined)
      sources.set(name, dropUnusedFunctions(minifyGlsl(resolveIncludes(read(file), read))));
  }
  const names = readable ? new Map<string, string>() : shortNames(sources.values());
  const programs = new Map<string, string>();
  const byProgram = new Map<string, Map<string, Uniform>>();
  for (const [name, src] of sources) {
    programs.set(name, readable ? src : shortenFloats(renameIdentifiers(src, names)));
    const program = name.replace(/_[VF]S$/, "");
    for (const [uniform, type] of uniforms(src)) {
      const map = byProgram.get(program) ?? new Map<string, Uniform>();
      if (!map.has(uniform)) map.set(uniform, { name: names.get(uniform) ?? uniform, type });
      byProgram.set(program, map);
    }
  }
  return { programs, uniforms: byProgram };
}

// The letter `Program` reads for each uniform type it can upload, and how many floats the value takes.
const KINDS: Readonly<Record<string, readonly [kind: string, size: number]>> = {
  float: ["f", 1],
  int: ["i", 1],
  sampler2D: ["i", 1],
  vec2: ["2", 2],
  vec3: ["3", 3],
  vec4: ["4", 4],
};

/** Where a uniform's value starts in its program's `values`, and how many floats it takes. */
export interface Slot {
  readonly offset: number;
  readonly size: number;
}

/**
 * A program's uniform table, which `Program` reads: one entry per uniform,
 * space-separated, each its kind (`f` float, `i` int or sampler unit, `2` to
 * `4` a vector of that many floats) and then its name. With it, each
 * uniform's slot in the program's `values`. An array is refused: the table
 * has one value per uniform, so only its first element would ever upload.
 */
export function uniformTable(program: ReadonlyMap<string, Uniform>): {
  table: string;
  slots: Map<string, Slot>;
} {
  const entries: string[] = [];
  const slots = new Map<string, Slot>();
  let offset = 0;
  for (const [uniform, { name, type }] of program) {
    if (type.endsWith("[]"))
      throw new Error(`shaders: uniform ${uniform} is an array, which a uniform table cannot hold`);
    const kind = KINDS[type];
    if (kind === undefined)
      throw new Error(`shaders: uniform ${uniform} has a type Program cannot upload: ${type}`);
    entries.push(kind[0] + name);
    slots.set(uniform, { offset, size: kind[1] });
    offset += kind[1];
  }
  return { table: entries.join(" "), slots };
}

export function renderModule(shaders: Shaders): string {
  let out =
    "// Generated by scripts/shaders.ts from src/shaders/*.glsl. Do not edit. SKYE_READABLE_SHADERS=1 keeps GLSL names.\n" +
    'import type { Slot, Table } from "../gl/program.ts";\n';
  for (const [name, source] of shaders.programs)
    out += `export const ${name}: string = ${JSON.stringify(source)};\n`;
  // Per program, its uniform table, and one constant per uniform, `SKY_uRes`, for its slot in the program's `values`.
  // Typed by program and width, so a pass sets a whole vector only into a slot of its own program that is as wide;
  // src/passes/uniforms.test.ts checks the rest (single components within the width, and each pass naming only its
  // program's slots). The bundler inlines plain constants, so a pass writes `values[3]` and no uniform name reaches
  // the bundle outside the table: against a declaration and a name-keyed object per pass, that saves about 450 B
  // brotli in every entry.
  out +=
    "// Each program's uniform table (see Program), and each uniform's slot in the program's values.\n";
  for (const [program, map] of shaders.uniforms) {
    const { table, slots } = uniformTable(map);
    const t = `Table<"${program}">`;
    out += `export const ${program}_UNIFORMS: ${t} = ${JSON.stringify(table)} as ${t};\n`;
    for (const [uniform, { offset, size }] of slots) {
      const slot = `Slot<"${program}", ${size}>`;
      out += `export const ${program}_${uniform}: ${slot} = ${offset} as ${slot};\n`;
    }
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
