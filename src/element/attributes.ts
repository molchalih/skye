import { resolveMotion, resolveQuality, resolveScene, type SkyeParams } from "../core/params.ts";

/** An attribute of `<skye-view>`. */
export type SkyeAttribute =
  | "scene"
  | "cover"
  | "intensity"
  | "wind"
  | "seed"
  | "hour"
  | "latitude"
  | "day-of-year"
  | "solar-noon"
  | "moon-phase"
  | "glass"
  | "focus-depth"
  | "exposure"
  | "blur-radius"
  | "quality"
  | "motion"
  | "worker";

/**
 * Every attribute `<skye-view>` understands: one per param, plus `worker`,
 * which selects worker rendering rather than a param.
 */
export const SKYE_ATTRIBUTES: readonly SkyeAttribute[] = [
  "scene",
  "cover",
  "intensity",
  "wind",
  "seed",
  "hour",
  "latitude",
  "day-of-year",
  "solar-noon",
  "moon-phase",
  "glass",
  "focus-depth",
  "exposure",
  "blur-radius",
  "quality",
  "motion",
  "worker",
];

/** Each param and the attribute that carries it, in param order. */
const PARAM_ATTRIBUTE: readonly (readonly [keyof SkyeParams, SkyeAttribute])[] = [
  ["scene", "scene"],
  ["cover", "cover"],
  ["intensity", "intensity"],
  ["wind", "wind"],
  ["seed", "seed"],
  ["hour", "hour"],
  ["latitude", "latitude"],
  ["dayOfYear", "day-of-year"],
  ["solarNoon", "solar-noon"],
  ["moonPhase", "moon-phase"],
  ["glass", "glass"],
  ["focus", "focus-depth"],
  ["exposure", "exposure"],
  ["blur", "blur-radius"],
  ["quality", "quality"],
  ["motion", "motion"],
];

/** The attributes that carry a param. */
export const PARAM_ATTRIBUTES: readonly SkyeAttribute[] = PARAM_ATTRIBUTE.map(
  ([, attribute]) => attribute,
);

const GLASS_OFF = /^(0|off|false|none)$/i;

// v6's `_num`: parseFloat, and anything not finite counts as absent so the default applies.
function num(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Reads params from attributes, parsing as v6 did: numbers with `parseFloat`
 * (a value that is not a finite number is absent), `glass` off for `0`,
 * `off`, `false` or `none` in any case and on for any other value. Every param
 * key is present in the result, `undefined` where its attribute is absent or
 * unusable, so merging the result into a sky also clears removed attributes.
 *
 * @param get returns an attribute's value, or null when it is absent, like `Element.getAttribute`
 */
export function attributesToParams(get: (name: SkyeAttribute) => string | null): SkyeParams {
  const scene = get("scene");
  const glass = get("glass");
  const quality = get("quality");
  const motion = get("motion");
  return {
    scene: scene === null ? undefined : resolveScene(scene),
    cover: num(get("cover")),
    intensity: num(get("intensity")),
    wind: num(get("wind")),
    seed: num(get("seed")),
    hour: num(get("hour")),
    latitude: num(get("latitude")),
    dayOfYear: num(get("day-of-year")),
    solarNoon: num(get("solar-noon")),
    moonPhase: num(get("moon-phase")),
    glass: glass === null ? undefined : !GLASS_OFF.test(glass),
    focus: num(get("focus-depth")),
    exposure: num(get("exposure")),
    blur: num(get("blur-radius")),
    quality: quality === null ? undefined : resolveQuality(quality),
    motion: motion === null ? undefined : resolveMotion(motion),
  };
}

/**
 * The attributes that set `params` on `<skye-view>`, the inverse of
 * `attributesToParams`: numbers as `String(n)`, booleans as `"1"` / `"0"`,
 * names as given. Params that are `undefined` are left out.
 */
export function toAttributes(params: Partial<SkyeParams>): Partial<Record<SkyeAttribute, string>> {
  const out: Partial<Record<SkyeAttribute, string>> = {};
  for (const [key, attribute] of PARAM_ATTRIBUTE) {
    const value = params[key];
    if (value === undefined) continue;
    out[attribute] = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
  }
  return out;
}
