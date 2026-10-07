/** A function returning a uniform number in [0, 1), like `Math.random`. */
export type RandomSource = () => number;

/**
 * Creates a deterministic random source from a seed using mulberry32, a
 * 32-bit generator with a single word of state. Fractional seeds are folded in
 * so that 1 and 1.5 give different sequences; any finite number is accepted.
 */
export function createRandom(seed: number): RandomSource {
  const whole = Math.floor(seed);
  let state = (whole | 0) ^ (Math.floor((seed - whole) * 4294967296) | 0);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
