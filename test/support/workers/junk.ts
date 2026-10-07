/** Messages that are not the protocol's, which neither side may act on or throw on. */
export const JUNK: readonly unknown[] = [
  null,
  42,
  "ready",
  [],
  {},
  { type: 7 },
  { type: "nonsense" },
];
