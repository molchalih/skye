// The look gate's comparisons (CONTRIBUTING.md, Look preservation). Colours are compared in OKLab, scaled by 100:
// lightness runs from 0 to 100, and a difference a person can just see is about 2 units. Every measure is read from
// means, of the whole frame, of regions or of 2 × 2 blocks, never from a single pixel, so a rounding step in a few
// pixels moves nothing the gate reads. Colour measures catch what changes in colour or place; the detail measure
// catches what keeps every mean but loses or gains fine detail: a blur, a lower resolution, fewer bits.

/** How far skye may be from a reference build of itself, per measure. */
export interface Limits {
  /** The mean colour of the whole frame. */
  readonly frame: number;
  /** The mean colour of each region of a 16 × 16 grid. */
  readonly region: number;
  /** The 99th percentile of the distances between the frames' 2 × 2 blocks. */
  readonly block: number;
  /** The relative change in fine detail, the mean lightness gradient, of each region of an 8 × 8 grid. */
  readonly detail: number;
}

/**
 * Limits against the approved build: the regression check. Numeric noise of
 * 1e-4 on every uniform moves the measures by at most 0.01, 0.28, 0.93 and
 * 0.06; a sky 3 % brighter moves the frame by 0.11 to 0.53, the sun 3 px the
 * worst region by up to 2, glass refraction off the blocks by up to 16, and a
 * 3 × 3 blur or 2 × 2 pixelation the detail by 0.2 and more.
 */
export const APPROVED_LIMITS: Limits = { frame: 0.05, region: 0.5, block: 2, detail: 0.15 };

/**
 * Limits against the frozen baseline: the long-range drift check. Approvals
 * move the approved build; the baseline (2026-10) stays, so the look can drift
 * from it only this far before the owner freezes a new one. About 1.2 to 3 times
 * the approved limits: noise of 1e-4 stays under half of each, while a sky 10 %
 * brighter (frame 1.7), cloud cover + 0.05 (region 11), the rays pass missing
 * (frame 0.34) and stars off (region 0.70, detail 0.24) fail.
 */
export const BASELINE_LIMITS: Limits = { frame: 0.15, region: 0.6, block: 3, detail: 0.2 };

/** sRGB 8-bit to linear light. */
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** An image as three OKLab planes, scaled by 100. */
interface Lab {
  readonly width: number;
  readonly height: number;
  readonly L: Float64Array;
  readonly a: Float64Array;
  readonly b: Float64Array;
}

function toLab(pixels: Uint8Array, width: number, height: number): Lab {
  const n = width * height;
  if (pixels.length !== n * 4)
    throw new Error(`${pixels.length} bytes is not a ${width}x${height} RGBA image`);
  const L = new Float64Array(n);
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = LINEAR[pixels[i * 4] ?? 0] ?? 0;
    const g = LINEAR[pixels[i * 4 + 1] ?? 0] ?? 0;
    const bl = LINEAR[pixels[i * 4 + 2] ?? 0] ?? 0;
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
    L[i] = 100 * (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s);
    a[i] = 100 * (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s);
    b[i] = 100 * (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s);
  }
  return { width, height, L, a, b };
}

/** The mean colour of each cell of a `cols` × `rows` grid laid over the image; edge cells average what they hold. */
function grid(img: Lab, cols: number, rows: number): Lab {
  const L = new Float64Array(cols * rows);
  const a = new Float64Array(cols * rows);
  const b = new Float64Array(cols * rows);
  const count = new Float64Array(cols * rows);
  for (let y = 0; y < img.height; y++) {
    const row = Math.floor((y * rows) / img.height) * cols;
    for (let x = 0; x < img.width; x++) {
      const k = row + Math.floor((x * cols) / img.width);
      const i = y * img.width + x;
      L[k] = (L[k] ?? 0) + (img.L[i] ?? 0);
      a[k] = (a[k] ?? 0) + (img.a[i] ?? 0);
      b[k] = (b[k] ?? 0) + (img.b[i] ?? 0);
      count[k] = (count[k] ?? 0) + 1;
    }
  }
  for (let k = 0; k < count.length; k++) {
    const c = count[k] || 1;
    L[k] = (L[k] ?? 0) / c;
    a[k] = (a[k] ?? 0) / c;
    b[k] = (b[k] ?? 0) / c;
  }
  return { width: cols, height: rows, L, a, b };
}

/** The colour distance between each pair of cells. */
function distances(x: Lab, y: Lab): Float64Array {
  const out = new Float64Array(x.L.length);
  for (let i = 0; i < out.length; i++) {
    const dl = (x.L[i] ?? 0) - (y.L[i] ?? 0);
    const da = (x.a[i] ?? 0) - (y.a[i] ?? 0);
    const db = (x.b[i] ?? 0) - (y.b[i] ?? 0);
    out[i] = Math.hypot(dl, da, db);
  }
  return out;
}

/**
 * The mean lightness gradient, |∂L/∂x| + |∂L/∂y| by forward differences, of
 * each cell of a `cols` × `rows` grid: how much fine detail the cell holds.
 */
function detail(img: Lab, cols: number, rows: number): Float64Array {
  const { width, height, L } = img;
  const sum = new Float64Array(cols * rows);
  const count = new Float64Array(cols * rows);
  for (let y = 0; y < height - 1; y++) {
    const row = Math.floor((y * rows) / height) * cols;
    for (let x = 0; x < width - 1; x++) {
      const i = y * width + x;
      const here = L[i] ?? 0;
      const k = row + Math.floor((x * cols) / width);
      sum[k] =
        (sum[k] ?? 0) + Math.abs((L[i + 1] ?? 0) - here) + Math.abs((L[i + width] ?? 0) - here);
      count[k] = (count[k] ?? 0) + 1;
    }
  }
  return sum.map((s, k) => s / (count[k] || 1));
}

// How much two cells' detail differs, relative to the larger. The 0.25 keeps flat cells (a clear sky's gradient is
// about 0.1 per pixel) from turning a rounding step into a large ratio.
function detailChange(x: Float64Array, y: Float64Array): Float64Array {
  return x.map((a, k) => {
    const b = y[k] ?? 0;
    return Math.abs(b - a) / (Math.max(a, b) + 0.25);
  });
}

/** One measure of a comparison: its value, its limit, and where in the frame the value comes from. */
export interface Measure {
  /** The limit it is held to. */
  readonly key: keyof Limits;
  readonly name: string;
  readonly value: number;
  readonly limit: number;
  /** The part of the frame the value was read from, top-left origin, when it is not the whole frame. */
  readonly at?: string;
}

/** What a comparison found; it passes when no measure exceeds its limit. */
export interface Verdict {
  readonly pass: boolean;
  readonly measures: readonly Measure[];
}

function verdict(measures: Measure[]): Verdict {
  return { pass: measures.every((m) => m.value <= m.limit), measures };
}

// The cell with the largest distance, as `x0–x1, y0–y1` in pixels from the top left (frames are read bottom row first);
// the caller names the measure.
function worstCell(
  d: Float64Array,
  cols: number,
  rows: number,
  width: number,
  height: number,
): Measure {
  let k = 0;
  for (let i = 1; i < d.length; i++) if ((d[i] ?? 0) > (d[k] ?? 0)) k = i;
  const cx = k % cols;
  const cy = rows - 1 - Math.floor(k / cols);
  const span = (c: number, n: number, size: number): string =>
    `${Math.ceil((c * size) / n)}–${Math.ceil(((c + 1) * size) / n) - 1}`;
  return {
    key: "region",
    name: "",
    value: d[k] ?? 0,
    limit: 0,
    at: `x ${span(cx, cols, width)}, y ${span(cy, rows, height)}`,
  };
}

function frameMeasure(x: Lab, y: Lab, limit: number): Measure {
  const one = grid(x, 1, 1);
  const two = grid(y, 1, 1);
  const f = (v: number): string => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
  return {
    key: "frame",
    name: "frame colour",
    value: distances(one, two)[0] ?? 0,
    limit,
    at: `L ${f((two.L[0] ?? 0) - (one.L[0] ?? 0))}, a ${f((two.a[0] ?? 0) - (one.a[0] ?? 0))}, b ${f((two.b[0] ?? 0) - (one.b[0] ?? 0))}`,
  };
}

/**
 * Compares a frame of skye with the same frame of a reference build of
 * itself, both RGBA8 as read back with `readPixels`, under `limits`.
 */
export function compareLook(
  reference: Uint8Array,
  skye: Uint8Array,
  width: number,
  height: number,
  limits: Limits,
): Verdict {
  const x = toLab(reference, width, height);
  const y = toLab(skye, width, height);
  const regions = worstCell(distances(grid(x, 16, 16), grid(y, 16, 16)), 16, 16, width, height);
  const cols = Math.ceil(width / 2);
  const rows = Math.ceil(height / 2);
  const blocks = distances(grid(x, cols, rows), grid(y, cols, rows)).sort();
  const details = worstCell(detailChange(detail(x, 8, 8), detail(y, 8, 8)), 8, 8, width, height);
  return verdict([
    frameMeasure(x, y, limits.frame),
    { ...regions, key: "region", name: "region colour (16 × 16 grid)", limit: limits.region },
    {
      key: "block",
      name: "99th percentile of 2 × 2 blocks",
      value: blocks[Math.floor(0.99 * (blocks.length - 1))] ?? 0,
      limit: limits.block,
    },
    { ...details, key: "detail", name: "detail (8 × 8 grid)", limit: limits.detail },
  ]);
}

/** `compareLook` against the approved build, under `APPROVED_LIMITS`. */
export function compareToApproved(
  approved: Uint8Array,
  skye: Uint8Array,
  width: number,
  height: number,
): Verdict {
  return compareLook(approved, skye, width, height, APPROVED_LIMITS);
}

/** `compareLook` against the frozen baseline, under `BASELINE_LIMITS`. */
export function compareToBaseline(
  baseline: Uint8Array,
  skye: Uint8Array,
  width: number,
  height: number,
): Verdict {
  return compareLook(baseline, skye, width, height, BASELINE_LIMITS);
}

/** The measures of a verdict, those over their limit first, for a failure message. */
export function describeVerdict(v: Verdict): string {
  return [...v.measures]
    .sort((p, q) => Number(q.value > q.limit) - Number(p.value > p.limit))
    .map((m) => {
      const over = m.value > m.limit;
      const where = m.at === undefined ? "" : ` (${m.at})`;
      return `${m.name} ${m.value.toFixed(2)} ${over ? ">" : "≤"} ${m.limit}${over ? " FAILS" : ""}${where}`;
    })
    .join("; ");
}
