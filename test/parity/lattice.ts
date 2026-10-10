// The noise lattice the approved sky change reads, written apart from src/gl/noise.ts: the parity harness gives v6
// these values, and src/gl/noise.test.ts holds skye's lattice to them.

// hash12 from noise.glsl with every operation rounded to float32 by a typed array store, where noise.ts rounds with
// Math.fround and shares the per-coordinate terms.
function hash12(x: number, y: number): number {
  const r = new Float32Array(1);
  const f = (v: number): number => {
    r[0] = v;
    return r[0];
  };
  const fract = (v: number): number => f(v - Math.floor(v));
  const k = f(0.1031);
  const c = f(33.33);
  // p3 = fract(vec3(p.xyx)*0.1031)
  const px = fract(f(x * k));
  const py = fract(f(y * k));
  const pz = fract(f(x * k));
  const dot = f(f(f(px * f(py + c)) + f(py * f(pz + c))) + f(pz * f(px + c)));
  return fract(f(f(f(px + dot) + f(py + dot)) * f(pz + dot)));
}

/**
 * hash12 at each lattice point of the 256 x 256 tile, row by row, rounded to
 * the nearest 1/2048: every value a half float holds exactly.
 */
export function referenceLattice(): Float32Array {
  const out = new Float32Array(256 * 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) out[y * 256 + x] = Math.round(hash12(x, y) * 2048) / 2048;
  return out;
}
