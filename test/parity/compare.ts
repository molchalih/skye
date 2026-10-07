/** Largest per-channel difference allowed anywhere, in 8-bit steps. */
export const MAX_DIFF = 4;
/** Share of channels that must be within one 8-bit step. */
export const MIN_CLOSE = 0.999;

export interface PixelDiff {
  /** Column, from the left. */
  x: number;
  /** Row, from the top. */
  y: number;
  /** 0 red, 1 green, 2 blue, 3 alpha. */
  channel: number;
  v6: number;
  skye: number;
}

export interface Comparison {
  pass: boolean;
  /** Percentage of channels within 1/255. */
  closePercent: number;
  /** The channel with the largest difference, or null when the images are identical. */
  worst: PixelDiff | null;
}

/**
 * Compares two RGBA8 images read back with `readPixels` (bottom row first).
 * Passes when at least 99.9 % of channels are within 1/255 and none differs by more than 4/255.
 */
export function compare(
  v6: Uint8Array,
  skye: Uint8Array,
  width: number,
  height: number,
): Comparison {
  if (v6.length !== skye.length || v6.length !== width * height * 4) {
    throw new Error(`image sizes differ: ${v6.length} vs ${skye.length} for ${width}x${height}`);
  }
  let close = 0;
  let worstIndex = -1;
  let worstDiff = 0;
  for (let i = 0; i < v6.length; i++) {
    const d = Math.abs((v6[i] ?? 0) - (skye[i] ?? 0));
    if (d <= 1) close++;
    if (d > worstDiff) {
      worstDiff = d;
      worstIndex = i;
    }
  }
  const closeShare = close / v6.length;
  let worst: PixelDiff | null = null;
  if (worstIndex >= 0) {
    const pixel = Math.floor(worstIndex / 4);
    worst = {
      x: pixel % width,
      y: height - 1 - Math.floor(pixel / width),
      channel: worstIndex % 4,
      v6: v6[worstIndex] ?? 0,
      skye: skye[worstIndex] ?? 0,
    };
  }
  return {
    pass: closeShare >= MIN_CLOSE && worstDiff <= MAX_DIFF,
    closePercent: closeShare * 100,
    worst,
  };
}

export function describeComparison(c: Comparison): string {
  const close = `${c.closePercent.toFixed(4)} % of channels within 1/255`;
  if (c.worst === null) return `identical (${close})`;
  const w = c.worst;
  return `${close}; worst at (${w.x}, ${w.y}) channel ${"RGBA"[w.channel] ?? "?"}: v6 ${w.v6}, skye ${w.skye}`;
}
