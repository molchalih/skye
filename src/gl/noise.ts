// The lattice the sky's clouds, mist and Milky Way and the glass's frost read their noise from (`tnoise` in
// lattice.glsl): v6's hash12 at the lattice points of a tile 256 cells wide, which the texture repeats and the
// hardware filters bilinearly.
import type { Sampled } from "./context.ts";

/**
 * hash12 (noise.glsl) at every lattice point of the 256 x 256 tile, row by
 * row, evaluated in float32 step by step as GLSL does. Each value is rounded
 * to the nearest 1/2048 and stored as the half float that holds it exactly.
 */
export function noiseLattice(): Uint16Array {
  const f32 = Math.fround;
  const fract = (x: number): number => f32(x - Math.floor(x));
  const k1 = f32(0.1031);
  const k2 = f32(33.33);
  const out = new Uint16Array(65536);
  for (let i = 0; i < 65536; i++) {
    // p3 = fract(vec3(p.xyx)*0.1031) = (a, b, a); then p3 += dot(p3, p3.yzx + 33.33) and fract((p3.x + p3.y)*p3.z).
    const a = fract(f32((i & 255) * k1));
    const b = fract(f32((i >> 8) * k1));
    const ak = f32(a + k2);
    const d = f32(f32(f32(a * f32(b + k2)) + f32(b * ak)) + f32(a * ak));
    const z = f32(a + d);
    const k = Math.round(fract(f32(f32(z + f32(b + d)) * z)) * 2048);
    // k/2048 as a half float, and 0 for k = 0: k's top bit sets the exponent, the 10 bits below it the mantissa.
    const e = 31 - Math.clz32(k);
    out[i] = k && ((e + 4) << 10) | (((k << 10) >> e) & 1023);
  }
  return out;
}

// The lattice, computed for the first texture in this realm (the page or a worker) and reused by every later one. It
// lives as long as the realm (128 KiB) and is never written after it is built; a typed array cannot be frozen.
let shared: Uint16Array | undefined;

/**
 * The lattice as an R16F texture, which WebGL2 filters without an
 * extension. Built once per context; a restored context builds its own,
 * from the same lattice.
 */
export function noiseTexture(gl: WebGL2RenderingContext): Sampled {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // Uploaded as the half floats it stores: 128 KiB, with no conversion for the implementation to do.
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R16F,
    256,
    256,
    0,
    gl.RED,
    gl.HALF_FLOAT,
    (shared ??= noiseLattice()),
  );
  // Magnification is bilinear and wrapping repeats by default; minification must not ask for mipmaps it lacks.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  return { texture };
}
