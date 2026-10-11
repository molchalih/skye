export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

// The numeric helpers call nothing but builtins: per-frame code calls them, and V8 inlines a call only so deep before
// it boxes the numbers passed to the next.

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Hermite smoothstep, as GLSL defines it; `edge0 > edge1` gives a falling edge. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** `mix` over a range given as its two ends, as the scene and tier tables store them. */
export function mixRange(range: readonly [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

/** Writes the blend into `out`, which may be `a`, so per-frame callers allocate nothing. */
export function mixVec3(out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>, t: number): Vec3 {
  out[0] = mix(a[0], b[0], t);
  out[1] = mix(a[1], b[1], t);
  out[2] = mix(a[2], b[2], t);
  return out;
}

export function scaleVec3(v: Vec3, k: number): Vec3 {
  v[0] *= k;
  v[1] *= k;
  v[2] *= k;
  return v;
}

export function copyVec2(out: Vec2, v: Readonly<Vec2>): Vec2 {
  out[0] = v[0];
  out[1] = v[1];
  return out;
}

export function copyVec3(out: Vec3, v: Readonly<Vec3>): Vec3 {
  out[0] = v[0];
  out[1] = v[1];
  out[2] = v[2];
  return out;
}

/** Rec. 709 luminance of a linear RGB colour. */
export function luminance(c: Readonly<Vec3>): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
