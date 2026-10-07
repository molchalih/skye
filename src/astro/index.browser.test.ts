import { describe, expect, it } from "vitest";
import { moonPhase, solarPosition } from "./index.ts";

interface V6Math {
  solar(
    lat: number,
    day: number,
    hour: number,
    noon: number,
  ): { sinEl: number; el: number; az: number; sunrise: number; sunset: number; polar: string };
  moonPhase(date: Date | number): number;
}

// The reference file registers the v6 element and publishes its math on window.
await import("../../test/reference/weather-sky-v6.js");
const v6: V6Math = Reflect.get(window, "WeatherSkyMath");

describe("astro against v6", () => {
  it("matches solar over a dense grid", () => {
    let n = 0;
    for (let lat = -66; lat <= 66; lat += 11) {
      for (let day = 1; day <= 366; day += 15) {
        for (let hour = 0; hour < 24; hour += 1.5) {
          for (const noon of [11.5, 12.7]) {
            const a = v6.solar(lat, day, hour, noon);
            const b = solarPosition(lat, day, hour, noon);
            expect(b.sinElevation).toBe(a.sinEl);
            expect(b.elevationDeg).toBe(a.el);
            expect(b.azimuth).toBe(a.az);
            expect(b.sunrise).toBe(a.sunrise);
            expect(b.sunset).toBe(a.sunset);
            expect(b.polar ?? "").toBe(a.polar);
            n++;
          }
        }
      }
    }
    expect(n).toBeGreaterThan(5000);
  });

  it("matches moonPhase over many dates", () => {
    for (
      let ms = Date.UTC(1970, 0, 1);
      ms < Date.UTC(2050, 0, 1);
      ms += 86_400_000 * 13 + 1234567
    ) {
      expect(moonPhase(ms)).toBe(v6.moonPhase(ms));
      expect(moonPhase(new Date(ms))).toBe(v6.moonPhase(new Date(ms)));
    }
  });
});
