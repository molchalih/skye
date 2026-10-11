import { clamp } from "./math.ts";

/** A weather scene: what the sky shows besides the time of day. */
export type SceneName = "clear" | "cloudy" | "fog" | "rainy" | "storm" | "sleet" | "snowy" | "haze";
/**
 * A fixed quality tier, or `"auto"`, which picks low, balanced or high from
 * the measured frame time. `"eco"` is opt-in only: `"auto"` never picks it.
 */
export type Quality = "auto" | "eco" | "low" | "balanced" | "high";
/** A fixed quality tier: what `quality` resolves to at any moment. */
export type Tier = Exclude<Quality, "auto">;
/** A tier `"auto"` can pick: every tier but `"eco"`. */
export type AutoTier = Exclude<Tier, "eco">;
/** `"full"` animates, `"static"` draws one frame per change, `"auto"` follows prefers-reduced-motion. */
export type Motion = "auto" | "full" | "static";

/** Every scene name. */
export const SCENE_NAMES: readonly SceneName[] = [
  "clear",
  "cloudy",
  "fog",
  "rainy",
  "storm",
  "sleet",
  "snowy",
  "haze",
];
/** Every `quality` value, `"auto"` first, then the tiers from cheapest to finest. */
export const QUALITIES: readonly Quality[] = ["auto", "eco", "low", "balanced", "high"];
/** Every `motion` value. */
export const MOTIONS: readonly Motion[] = ["auto", "full", "static"];

/**
 * Sky parameters; every field is optional. Numbers that are not finite fall
 * back to the default, and out-of-range numbers are clamped or wrapped.
 */
export interface SkyeParams {
  /** Weather scene. Unknown names resolve to `"cloudy"`. */
  scene?: SceneName | undefined;
  /** Cloud cover, clamped to 0-1. */
  cover?: number | undefined;
  /** Precipitation / fog / haze strength, clamped to 0-1. */
  intensity?: number | undefined;
  /** Cloud wind speed. Absent means the scene's own wind, scaled by intensity. */
  wind?: number | undefined;
  /** Cloud pattern seed; any finite number. */
  seed?: number | undefined;
  /**
   * Local clock hour; wraps into [0, 24). The sun's position comes from its
   * distance to `solarNoon`, so this is clock time, not true solar time.
   */
  hour?: number | undefined;
  /** Degrees, clamped to -66..66. */
  latitude?: number | undefined;
  /** Day of the year. Nominally 1-366; the value is used as given, without wrapping. */
  dayOfYear?: number | undefined;
  /** Local hour of solar noon. */
  solarNoon?: number | undefined;
  /** Moon phase; wraps into [0, 1). 0 is new, 0.5 is full. */
  moonPhase?: number | undefined;
  /** Rain-on-glass layer. */
  glass?: boolean | undefined;
  /** Glass focus depth, clamped to 0.12-1. */
  focus?: number | undefined;
  /** Overall brightness, clamped to 0.2-1.2. */
  exposure?: number | undefined;
  /** Background blur in px, clamped to 0-64. */
  blur?: number | undefined;
  /**
   * Quality tier, or `"auto"` to adapt to frame time among low, balanced and
   * high. `"eco"` is a fixed tier below low, softer and at a lower frame rate;
   * `"auto"` never picks it. Unknown values resolve to `"balanced"`.
   */
  quality?: Quality | undefined;
  /** `"static"` renders a single frame; `"auto"` follows prefers-reduced-motion. */
  motion?: Motion | undefined;
}

/**
 * Params with every field resolved: defaults applied, numbers clamped or
 * wrapped, names validated. `wind` stays undefined for the scene's own wind.
 */
export interface ResolvedParams {
  scene: SceneName;
  cover: number;
  intensity: number;
  wind: number | undefined;
  seed: number;
  hour: number;
  latitude: number;
  dayOfYear: number;
  solarNoon: number;
  moonPhase: number;
  glass: boolean;
  focus: number;
  exposure: number;
  blur: number;
  quality: Quality;
  motion: Motion;
}

/** What every absent or invalid field resolves to. None depends on the clock or the calendar. */
export const DEFAULTS: Readonly<ResolvedParams> = Object.freeze({
  scene: "cloudy",
  cover: 0.4,
  intensity: 0.6,
  wind: undefined,
  seed: 0,
  hour: 17.5,
  latitude: 52.37,
  dayOfYear: 172,
  solarNoon: 12.7,
  moonPhase: 0.5,
  glass: true,
  focus: 0.45,
  exposure: 1,
  blur: 0,
  quality: "auto",
  motion: "auto",
});

/**
 * Latitudes beyond this are clamped to it: just inside the polar circles
 * (66.56°), so every day of the year has a sunrise and a sunset.
 */
const MAX_LATITUDE_DEG = 66;

function num(v: number | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function wrap(x: number, period: number): number {
  return ((x % period) + period) % period;
}

/** A scene name, or `"cloudy"` for anything unknown. */
export function resolveScene(v: unknown): SceneName {
  return SCENE_NAMES.find((name) => name === v) ?? DEFAULTS.scene;
}

/** Empty or absent is `"auto"`; anything that is not a quality is `"balanced"`. */
export function resolveQuality(v: unknown): Quality {
  if (v === undefined || v === null || v === "") return "auto";
  return QUALITIES.find((q) => q === v) ?? "balanced";
}

/** Empty or absent is `"auto"`; any value other than `"static"` or `"auto"` means full motion. */
export function resolveMotion(v: unknown): Motion {
  if (v === undefined || v === null || v === "" || v === "auto") return "auto";
  return v === "static" ? "static" : "full";
}

/** Applies defaults, clamping and wrapping. Never throws; `null` or `undefined` resolves to `DEFAULTS`. */
export function resolveParams(params: Partial<SkyeParams> | null | undefined): ResolvedParams {
  const d = DEFAULTS;
  const input = params ?? {};
  return {
    scene: resolveScene(input.scene),
    cover: clamp(num(input.cover, d.cover), 0, 1),
    intensity: clamp(num(input.intensity, d.intensity), 0, 1),
    wind: typeof input.wind === "number" && Number.isFinite(input.wind) ? input.wind : undefined,
    seed: num(input.seed, d.seed),
    hour: wrap(num(input.hour, d.hour), 24),
    latitude: clamp(num(input.latitude, d.latitude), -MAX_LATITUDE_DEG, MAX_LATITUDE_DEG),
    dayOfYear: num(input.dayOfYear, d.dayOfYear),
    solarNoon: num(input.solarNoon, d.solarNoon),
    moonPhase: wrap(num(input.moonPhase, d.moonPhase), 1),
    glass: typeof input.glass === "boolean" ? input.glass : d.glass,
    focus: clamp(num(input.focus, d.focus), 0.12, 1),
    exposure: clamp(num(input.exposure, d.exposure), 0.2, 1.2),
    blur: clamp(num(input.blur, d.blur), 0, 64),
    quality: resolveQuality(input.quality),
    motion: resolveMotion(input.motion),
  };
}
