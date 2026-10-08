// How the page says each value. Pure functions: numbers in, words out.
import type { SceneName } from "../src/index.ts";

export const SCENE_ADJECTIVE: Readonly<Record<SceneName, string>> = {
  clear: "clear",
  cloudy: "cloudy",
  fog: "foggy",
  rainy: "rainy",
  storm: "stormy",
  sleet: "sleety",
  snowy: "snowy",
  haze: "hazy",
};

/** How a scene that reads `intensity` says it: a lead-in, then a word from weakest to strongest. */
export interface IntensityWords {
  readonly lead: string;
  readonly words: readonly string[];
}

/** Clear and cloudy skies ignore intensity, so they have no entry and no clause. */
export const INTENSITY: Readonly<Partial<Record<SceneName, IntensityWords>>> = {
  rainy: { lead: "rain falls", words: ["softly", "lightly", "steadily", "hard", "in sheets"] },
  storm: {
    lead: "the storm is",
    words: ["brewing", "building", "rolling in", "raging", "violent"],
  },
  sleet: { lead: "sleet falls", words: ["softly", "lightly", "steadily", "hard", "sideways"] },
  snowy: {
    lead: "snow falls",
    words: ["softly", "lightly", "steadily", "thickly", "in a blizzard"],
  },
  fog: { lead: "the fog is", words: ["thin", "light", "thick", "heavy", "dense"] },
  haze: { lead: "the dust is", words: ["faint", "light", "thick", "heavy", "choking"] },
};

const MOON = [
  "new",
  "a waxing crescent",
  "at first quarter",
  "waxing gibbous",
  "full",
  "waning gibbous",
  "at last quarter",
  "a waning crescent",
];

const pad = (n: number): string => String(n).padStart(2, "0");

/** "21:05" for 21.08; wraps past midnight. */
export function formatTime(hour: number): string {
  const minutes = Math.round((((hour % 24) + 24) % 24) * 60) % 1440;
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/** "21 June" for day 172, counted in a common year. */
export function formatDay(day: number): string {
  return DAY.format(Date.UTC(2025, 0, Math.round(day)));
}

/** "52° N", "34° S", or "the equator". */
export function formatLatitude(latitude: number): string {
  const degrees = Math.round(Math.abs(latitude));
  if (degrees === 0) return "the equator";
  return `${degrees}° ${latitude > 0 ? "N" : "S"}`;
}

export function formatPercent(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** The word for `t` in [0, 1] from a list ordered weakest to strongest. */
export function pick(words: readonly string[], t: number): string {
  return words[Math.min(words.length - 1, Math.floor(t * words.length))] ?? "";
}

/** The moon's phase in words; 0 is new, 0.5 is full. */
export function moonName(phase: number): string {
  return MOON[Math.round(phase * 8) % 8] ?? "";
}

/** Hours from solar noon, in [-12, 12): negative in the morning. */
export function fromNoon(hour: number, solarNoon: number): number {
  return ((((hour - solarNoon) % 24) + 36) % 24) - 12;
}

/**
 * The part of the day the sentence names: the light's own name from golden
 * hour to dusk, the plain part of the day while the sun is well up.
 * @param elevation sun elevation in degrees
 * @param sinceNoon hours from solar noon
 */
export function daypart(
  elevation: number,
  sinceNoon: number,
  polar: "day" | "night" | null,
): string {
  const rising = sinceNoon < 0;
  if (elevation > -0.83 && Math.abs(sinceNoon) > 9) return "midnight sun";
  if (elevation >= 6) {
    if (Math.abs(sinceNoon) < 1) return "midday";
    if (rising) return "morning";
    return elevation < 15 ? "evening" : "afternoon";
  }
  if (elevation >= 0.83) return "golden hour";
  if (elevation >= -0.83) return rising ? "sunrise" : "sunset";
  if (polar === "night" && Math.abs(sinceNoon) < 4) return "polar night";
  if (elevation >= -6) return "blue hour";
  if (elevation >= -12) return rising ? "dawn" : "dusk";
  return "night";
}
