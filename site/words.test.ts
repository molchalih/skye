import { describe, expect, it } from "vitest";
import { solarPosition } from "../src/astro/index.ts";
import {
  daypart,
  formatDay,
  formatLatitude,
  formatTime,
  fromNoon,
  moonName,
  pick,
} from "./words.ts";

describe("words", () => {
  it("formats the clock, wrapping past midnight", () => {
    expect(formatTime(21.3)).toBe("21:18");
    expect(formatTime(23.999)).toBe("00:00");
    expect(formatTime(-0.5)).toBe("23:30");
  });

  it("names the date, the latitude and the moon", () => {
    expect(formatDay(172)).toBe("21 June");
    expect(formatLatitude(52.37)).toBe("52° N");
    expect(formatLatitude(-34.6)).toBe("35° S");
    expect(formatLatitude(0.3)).toBe("the equator");
    expect(moonName(0)).toBe("new");
    expect(moonName(0.5)).toBe("full");
    expect(moonName(0.98)).toBe("new");
  });

  it("picks words across the whole range", () => {
    const words = ["a", "b", "c"];
    expect(pick(words, 0)).toBe("a");
    expect(pick(words, 0.5)).toBe("b");
    expect(pick(words, 1)).toBe("c");
  });

  it("follows the light through a June day in Amsterdam", () => {
    const at = (hour: number): string => {
      const sun = solarPosition(52.37, 172, hour, 13.67);
      return daypart(sun.elevationDeg, fromNoon(hour, 13.67), sun.polar);
    };
    expect([5, 6, 9, 13.5, 17, 21.3, 22.3, 23, 0.3].map(at)).toEqual([
      "blue hour",
      "golden hour",
      "morning",
      "midday",
      "afternoon",
      "golden hour",
      "blue hour",
      "dusk",
      "night",
    ]);
  });

  it("knows the midnight sun", () => {
    const sun = solarPosition(66, 172, 1.1, 13.2);
    expect(daypart(sun.elevationDeg, fromNoon(1.1, 13.2), sun.polar)).toBe("midnight sun");
  });
});
