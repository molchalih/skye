import { afterEach, describe, expect, it } from "vitest";
import { dayOfYear, moonPhase, solarPosition } from "./index.ts";

describe("solarPosition", () => {
  it("puts the equinox noon sun at the zenith on the equator", () => {
    // Day 80 is near the March equinox (declination ~ 0).
    const s = solarPosition(0, 80.25, 12, 12);
    expect(s.elevationDeg).toBeCloseTo(90, 0);
    expect(s.polar).toBeNull();
    expect(s.sunrise).toBeCloseTo(6, 0);
    expect(s.sunset).toBeCloseTo(18, 0);
  });

  it("reports midnight sun and polar night beyond the polar circle", () => {
    expect(solarPosition(80, 172, 0, 12.7).polar).toBe("day");
    expect(solarPosition(80, 355, 12, 12.7).polar).toBe("night");
    expect(solarPosition(-80, 355, 0, 12.7).polar).toBe("day");
  });

  it("has no polar state at the 66 degree latitude limit", () => {
    expect(solarPosition(66, 172, 0, 12.7).polar).toBeNull();
    expect(solarPosition(-66, 355, 0, 12.7).polar).toBeNull();
  });

  it("is below the horizon at midnight", () => {
    expect(solarPosition(52.37, 80, 0, 12.7).sinElevation).toBeLessThan(0);
  });

  it("keeps sin elevation within [-1, 1]", () => {
    const s = solarPosition(0, 80.25, 12, 12);
    expect(s.sinElevation).toBeLessThanOrEqual(1);
    expect(s.sinElevation).toBeGreaterThanOrEqual(-1);
  });
});

describe("moonPhase", () => {
  it("is zero at the new-moon epoch", () => {
    expect(moonPhase(Date.UTC(2000, 0, 6, 18, 14))).toBe(0);
  });

  it("is about half a month later at full moon", () => {
    const half = Date.UTC(2000, 0, 6, 18, 14) + (29.530588853 / 2) * 86_400_000;
    expect(moonPhase(half)).toBeCloseTo(0.5, 10);
  });

  it("accepts a Date and wraps dates before the epoch into [0, 1)", () => {
    const before = new Date(Date.UTC(1990, 5, 1));
    const p = moonPhase(before);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(1);
    expect(moonPhase(before)).toBe(moonPhase(before.getTime()));
  });
});

describe("dayOfYear", () => {
  it("counts local calendar days from 1", () => {
    expect(dayOfYear(new Date(2025, 0, 1, 12))).toBe(1);
    expect(dayOfYear(new Date(2025, 11, 31, 12))).toBe(365);
    expect(dayOfYear(new Date(2024, 11, 31, 12))).toBe(366);
    expect(dayOfYear(new Date(2025, 5, 21, 12))).toBe(172);
  });
});

// v6's helper subtracted local midnights, so a day after a clock change counted one short. These run in zones with
// daylight saving time, whatever the machine's own zone; dates are built from local fields as callers build them.
describe("dayOfYear across daylight-saving changes", () => {
  const zone = process.env.TZ;

  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it.each([
    // Europe/Amsterdam: clocks go forward on 30 March 2025 and back on 26 October 2025.
    ["Europe/Amsterdam", 2025, 2, 30, 0, 30, 89],
    ["Europe/Amsterdam", 2025, 2, 31, 0, 30, 90],
    ["Europe/Amsterdam", 2025, 2, 31, 0, 0, 90],
    ["Europe/Amsterdam", 2025, 9, 26, 23, 59, 299],
    ["Europe/Amsterdam", 2025, 9, 27, 0, 0, 300],
    // America/New_York: forward on 9 March 2025, back on 2 November 2025.
    ["America/New_York", 2025, 2, 10, 0, 0, 69],
    ["America/New_York", 2025, 10, 3, 0, 0, 307],
    // Australia/Sydney: the southern summer, back on 6 April 2025 and forward on 5 October 2025.
    ["Australia/Sydney", 2025, 3, 7, 0, 0, 97],
    ["Australia/Sydney", 2025, 9, 6, 0, 0, 279],
    // A leap year, past the change.
    ["Europe/Amsterdam", 2024, 11, 31, 0, 0, 366],
  ])("%s %i-%i-%i %i:%i is day %i", (tz, year, month, day, hour, minute, expected) => {
    process.env.TZ = tz;
    const date = new Date(year, month, day, hour, minute);
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([year, month, day]);
    expect(dayOfYear(date)).toBe(expected);
  });
});
