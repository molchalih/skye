// The changes to v6's image that the owner approved (CONTRIBUTING.md, Pixel parity). skye's shaders depart from v6's
// text in two ways. Exact edits change no value, though compiler rounding may move a channel by 1/255:
// scripts/shaders.test.ts lists them, and the parity gate holds them to v6. The edits here change the image. The gate
// applies them to v6's own programs before it compares, so it holds what they change to the approved image, and
// everything else still to v6.
import { referenceLattice } from "./lattice.ts";

/** A v6 snippet and its replacement. A snippet matches up to whitespace and must occur exactly once. */
export type Edit = readonly [from: string, to: string];

// Value noise from the lattice texture, which the harness binds to `uNoise`.
const TNOISE = `uniform highp sampler2D uNoise;
  float tnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*f*(f*(f*6.0-15.0)+10.0);
    return textureLod(uNoise, (i + f + 0.5)/256.0, 0.0).r; }`;

/**
 * The sky's clouds, mist and Milky Way read value noise from a texture of
 * hash12's lattice (src/gl/noise.ts) instead of hashing four corners each.
 */
export const SKY_IMAGE_EDITS: readonly Edit[] = [
  [
    `float fbm(vec2 p, int oct){ float a = 0.5, s = 0.0, n = 0.0; for (int i = 0; i < 6; i++){ if (i >= oct) break;
      s += a*vnoise(p); n += a; p = ROT*p + 17.3; a *= 0.5; } return s/n; }`,
    `${TNOISE}
    float octaveNoise(vec2 p, int i){ return i < 2 ? tnoise(p) : textureLod(uNoise, (p + 0.5)/256.0, 0.0).r; }
    float fbm(vec2 p, int oct){ float a = 0.5, s = 0.0, n = 0.0; for (int i = 0; i < 6; i++){ if (i >= oct) break;
      s += a*octaveNoise(p, i); n += a; p = ROT*p + 17.3; a *= 0.5; } return s/n; }`,
  ],
  [
    "vec2(vnoise(q*0.35 + uTime*0.09), vnoise(q*0.35 + 7.7 - uTime*0.07))",
    "vec2(tnoise(q*0.35 + uTime*0.09), tnoise(q*0.35 + 7.7 - uTime*0.07))",
  ],
];

/**
 * The glass's frost reads its value noise from the same texture: its edge,
 * its grain and its normal offset. The drops and the film grain keep hash12.
 */
export const GLASS_IMAGE_EDITS: readonly Edit[] = [
  ["void main(){", `${TNOISE} void main(){`],
  ["(vnoise(U*6.0 + uSeed) - 0.5)", "(tnoise(U*6.0 + uSeed) - 0.5)"],
  [
    "fn = vnoise(U*90.0)*0.5 + vnoise(U*180.0)*0.5; n += (vec2(vnoise(U*40.0 + 3.0), vnoise(U*40.0 + 9.0))",
    "fn = tnoise(U*90.0)*0.5 + tnoise(U*180.0)*0.5; n += (vec2(tnoise(U*40.0 + 3.0), tnoise(U*40.0 + 9.0))",
  ],
];

/** Every program's approved image changes, by skye's export name. */
export const IMAGE_EDITS: Readonly<Record<string, readonly Edit[]>> = {
  SKY_FS: SKY_IMAGE_EDITS,
  GLASS_FS: GLASS_IMAGE_EDITS,
};

/** The same changes by the property v6 keeps each edited program in. */
export const V6_IMAGE_EDITS: Readonly<Record<string, readonly Edit[]>> = {
  _sky: SKY_IMAGE_EDITS,
  _glass: GLASS_IMAGE_EDITS,
};

/** One GLSL token, as scripts/shaders.test.ts splits programs. */
const TOKEN = /[A-Za-z_]\w*|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\w*|\S/g;

/** Applies `edits` to GLSL `source` in order, throwing when a snippet does not occur exactly once. */
export function applyEdits(source: string, edits: readonly Edit[]): string {
  let out = source;
  for (const [from, to] of edits) {
    const tokens = from.match(TOKEN) ?? [];
    // Whitespace may separate any two tokens and must separate two words; a match never starts or ends inside a word.
    const starts = (t = ""): boolean => /^\w/.test(t);
    const ends = (t = ""): boolean => /\w$/.test(t);
    let pattern = starts(tokens[0]) ? "(?<!\\w)" : "";
    tokens.forEach((t, i) => {
      if (i > 0) pattern += ends(tokens[i - 1]) && starts(t) ? "\\s+" : "\\s*";
      pattern += t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    if (ends(tokens.at(-1))) pattern += "(?!\\w)";
    const re = new RegExp(pattern, "g");
    const found = out.match(re)?.length ?? 0;
    if (found !== 1) throw new Error(`edit found ${found} times: ${from}`);
    out = out.replace(re, () => to);
  }
  return out;
}

/**
 * The source of the fragment shader of the v6 program kept in `property`
 * (`_sky`, `_glass`), as v6 compiled it. Self-contained, so a Playwright page
 * can run it.
 */
export function v6FragmentSource(el: HTMLElement, property: string): string {
  const gl: unknown = Reflect.get(el, "_gl");
  const program: unknown = Reflect.get(el, property);
  if (!(gl instanceof WebGL2RenderingContext) || !(program instanceof WebGLProgram))
    throw new Error(`v6 has no ${property} program`);
  for (const shader of gl.getAttachedShaders(program) ?? []) {
    if (gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER)
      return gl.getShaderSource(shader) ?? "";
  }
  throw new Error(`v6's ${property} program has no fragment shader`);
}

/** What `amendV6Programs` gives v6. */
export interface V6Amendment {
  /** For each program it replaces, by v6's property, v6's fragment source with the approved image edits applied. */
  fragments: Readonly<Record<string, string>>;
  /** The noise lattice's values, row by row (`referenceLattice`). */
  lattice: ArrayLike<number>;
}

/**
 * Swaps each v6 program named in `fragments` for one built from its amended
 * fragment source and v6's own vertex shader, and gives them one texture of
 * the lattice, as R16F, filtered bilinearly and repeating, on a texture unit
 * v6 never binds. The values come from float32 data that the implementation
 * converts: each is a multiple of 1/2048, which a half float holds exactly,
 * so this also checks skye's own half-float encoding and texture. Draws
 * nothing. Self-contained, so a Playwright page can run it.
 */
export function amendV6Programs(el: HTMLElement, { fragments, lattice }: V6Amendment): void {
  // v6 binds only units 0 and 1.
  const unit = 2;
  const size = 256;
  const gl: unknown = Reflect.get(el, "_gl");
  if (!(gl instanceof WebGL2RenderingContext)) throw new Error("v6 has no WebGL2 context");
  for (const [property, fragment] of Object.entries(fragments)) {
    const old: unknown = Reflect.get(el, property);
    if (!(old instanceof WebGLProgram)) throw new Error(`v6 has no ${property} program`);
    const vertex = gl
      .getAttachedShaders(old)
      ?.find((s) => gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.VERTEX_SHADER);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (vertex === undefined || fs === null) throw new Error(`cannot rebuild v6's ${property}`);
    gl.shaderSource(fs, fragment);
    gl.compileShader(fs);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true)
      throw new Error(
        `amended v6 ${property}: ${gl.getShaderInfoLog(fs) ?? ""} ${gl.getProgramInfoLog(program) ?? ""}`,
      );
    // v6 caches uniform locations on each program, in `_u`, and sets its program before each pass.
    Reflect.set(program, "_u", {});
    Reflect.set(el, property, program);
    gl.deleteProgram(old);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "uNoise"), unit);
  }

  // v6 binds a target to whichever unit is active when it allocates it, so that unit is put back.
  const active: unknown = gl.getParameter(gl.ACTIVE_TEXTURE);
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  const data = Float32Array.from(lattice);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, size, size, 0, gl.RED, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.activeTexture(typeof active === "number" ? active : gl.TEXTURE0);
}

/** v6's fragment sources for the programs the approved changes edit, amended, by v6's property. */
export function amendedV6Fragments(source: (property: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [property, edits] of Object.entries(V6_IMAGE_EDITS))
    out[property] = applyEdits(source(property), edits);
  return out;
}

/** Gives v6, once its programs are linked, every approved image change. */
export function amendV6(el: HTMLElement): void {
  const fragments = amendedV6Fragments((property) => v6FragmentSource(el, property));
  amendV6Programs(el, { fragments, lattice: referenceLattice() });
}
