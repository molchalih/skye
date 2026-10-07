export type Vec3 = [number, number, number];

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Hermite smoothstep, v6's `smooth`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Writes the blend into `out` so per-frame callers allocate nothing. */
export function mixVec3(out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>, t: number): Vec3 {
  out[0] = mix(a[0], b[0], t);
  out[1] = mix(a[1], b[1], t);
  out[2] = mix(a[2], b[2], t);
  return out;
}

export function luminance(c: Readonly<Vec3>): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
