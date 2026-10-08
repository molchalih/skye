// The sky's params, kept in skye's own shape and validated by skye's own rules. The URL hash and the snippet are
// written in attributes, so a link, the markup and the element all say the same thing.
import {
  attributesToParams,
  SKYE_ATTRIBUTES,
  toAttributes,
  type SkyeAttribute,
} from "../src/element/attributes.ts";
import { DEFAULTS, resolveParams, type ResolvedParams, type SkyeParams } from "../src/index.ts";

/** Who changed the sky: the person, the day passing, a postcard, the clock after "Now", or the address. */
export type Source = "user" | "play" | "postcard" | "live" | "load";

export type Listener = (state: ResolvedParams, source: Source) => void;

export interface Store {
  get(): ResolvedParams;
  /** Merges `patch`, runs it through `resolveParams`, and tells listeners only when something changed. */
  set(patch: SkyeParams, source?: Source): void;
  subscribe(listener: Listener): () => void;
}

type Rounded =
  | "cover"
  | "intensity"
  | "wind"
  | "seed"
  | "hour"
  | "latitude"
  | "dayOfYear"
  | "solarNoon"
  | "moonPhase"
  | "focus"
  | "exposure"
  | "blur";

/** Decimal places each number keeps once it leaves the page's state. */
const DECIMALS: readonly (readonly [Rounded, number])[] = [
  ["cover", 2],
  ["intensity", 2],
  ["wind", 1],
  ["seed", 2],
  ["hour", 2],
  ["latitude", 2],
  ["dayOfYear", 0],
  ["solarNoon", 2],
  ["moonPhase", 2],
  ["focus", 2],
  ["exposure", 2],
  ["blur", 0],
];

function rounded(p: ResolvedParams): ResolvedParams {
  const out = { ...p };
  for (const [key, places] of DECIMALS) {
    const value = out[key];
    if (value !== undefined) out[key] = Number(value.toFixed(places));
  }
  return out;
}

const DEFAULT_ATTRIBUTES = toAttributes(DEFAULTS);

/** Every attribute for `p`, numbers rounded as the page shows them. */
export function attributesOf(p: ResolvedParams): Partial<Record<SkyeAttribute, string>> {
  return toAttributes(rounded(p));
}

/** The attributes that differ from skye's defaults, in attribute order: all a page has to write. */
export function essentialAttributes(p: ResolvedParams): (readonly [SkyeAttribute, string])[] {
  const attributes = attributesOf(p);
  return SKYE_ATTRIBUTES.flatMap((name) => {
    const value = attributes[name];
    return value === undefined || value === DEFAULT_ATTRIBUTES[name]
      ? []
      : [[name, value] as const];
  });
}

/** The hash that reproduces `p`, such as `#scene=storm&hour=21.5`. */
export function hashOf(p: ResolvedParams): string {
  const query = new URLSearchParams(essentialAttributes(p).map(([name, value]) => [name, value]));
  const text = query.toString();
  return text === "" ? "" : `#${text}`;
}

/** The params a hash sets; anything it leaves out or garbles is left out, so merging it keeps the rest. */
export function paramsFromHash(hash: string): SkyeParams {
  const query = new URLSearchParams(hash.replace(/^#/, ""));
  const out: SkyeParams = {};
  for (const [key, value] of Object.entries(attributesToParams((name) => query.get(name)))) {
    if (value !== undefined) Object.assign(out, { [key]: value });
  }
  return out;
}

function same(a: object, b: object): boolean {
  const x = Object.entries(a);
  const y = Object.entries(b);
  return (
    x.length === y.length &&
    x.every(([key, value], i) => key === y[i]?.[0] && Object.is(value, y[i]?.[1]))
  );
}

export function createStore(initial: ResolvedParams): Store {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch, source = "user") {
      const next = resolveParams({ ...state, ...patch });
      if (same(next, state)) return;
      state = next;
      for (const listener of listeners) listener(state, source);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
