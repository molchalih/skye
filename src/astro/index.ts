import { clamp } from "../core/math.ts";

const DEG = Math.PI / 180;
const MS_PER_DAY = 86_400_000;
const SYNODIC_MONTH_DAYS = 29.530588853;
// Reference new moon: 2000-01-06 18:14 UTC.
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14);

/** Where the sun is, and when it rises and sets, as `solarPosition` computes it. */
export interface SolarPosition {
  /** Sine of the sun's elevation, in [-1, 1]. */
  sinElevation: number;
  /** Elevation above the horizon, in degrees. */
  elevationDeg: number;
  /** Azimuth in radians, as atan2 returns it (0 is south, positive towards west). */
  azimuth: number;
  /** Local hour of sunrise. Meaningless when `polar` is set. */
  sunrise: number;
  /** Local hour of sunset. Meaningless when `polar` is set. */
  sunset: number;
  /** `"day"` for midnight sun, `"night"` for polar night, otherwise `null`. */
  polar: "day" | "night" | null;
}

/**
 * Sun position from a declination approximation.
 * @param latitude degrees, north positive
 * @param day 1 is 1 January
 * @param hour local clock hour, read against `solarNoon` (not true solar time)
 * @param solarNoon local hour at which the sun is highest
 * @param out record to fill; pass one per-frame callers keep to avoid allocating
 */
export function solarPosition(
  latitude: number,
  day: number,
  hour: number,
  solarNoon: number,
  out: SolarPosition = {
    sinElevation: 0,
    elevationDeg: 0,
    azimuth: 0,
    sunrise: 0,
    sunset: 0,
    polar: null,
  },
): SolarPosition {
  const phi = latitude * DEG;
  const dec = 23.44 * DEG * Math.sin((2 * Math.PI * (284 + day)) / 365);
  const h = (hour - solarNoon) * 15 * DEG;
  const sinElevation = clamp(
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h),
    -1,
    1,
  );
  const azimuth = Math.atan2(
    Math.sin(h),
    Math.cos(h) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi),
  );
  const cosH0 = -Math.tan(phi) * Math.tan(dec);
  const halfDay = Math.acos(clamp(cosH0, -1, 1)) / (15 * DEG);
  out.sinElevation = sinElevation;
  out.elevationDeg = Math.asin(sinElevation) / DEG;
  out.azimuth = azimuth;
  out.sunrise = solarNoon - halfDay;
  out.sunset = solarNoon + halfDay;
  out.polar = cosH0 < -1 ? "day" : cosH0 > 1 ? "night" : null;
  return out;
}

/** Moon phase in [0, 1): 0 is new, 0.5 is full. Accepts a Date or epoch milliseconds. */
export function moonPhase(date: Date | number): number {
  const days = (Number(date) - NEW_MOON_EPOCH_MS) / MS_PER_DAY;
  return (
    (((days % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS) / SYNODIC_MONTH_DAYS
  );
}

/**
 * Day of the year of the date's local calendar date; 1 is 1 January. Counted
 * from the calendar fields, so a daylight-saving change between 1 January and
 * the date cannot shift it by one.
 */
export function dayOfYear(date: Date): number {
  const year = date.getFullYear();
  return (Date.UTC(year, date.getMonth(), date.getDate()) - Date.UTC(year, 0, 0)) / MS_PER_DAY;
}
