import { describe, expect, it } from "vitest";
import { PLACE_LATITUDES, PLACES, placeAt } from "./places.ts";
import { POSTCARDS } from "./postcards.ts";

describe("places", () => {
  it("stand at distinct latitudes the latitude control can reach", () => {
    expect(new Set(PLACE_LATITUDES).size).toBe(PLACES.length);
    for (const latitude of PLACE_LATITUDES) {
      expect(latitude).toBeGreaterThanOrEqual(-66);
      expect(latitude).toBeLessThanOrEqual(66);
    }
    expect(PLACE_LATITUDES).toEqual([...PLACE_LATITUDES].sort((a, b) => a - b));
  });

  it("name every postcard's latitude", () => {
    for (const postcard of POSTCARDS) {
      expect(placeAt(postcard.latitude ?? Number.NaN), `latitude ${postcard.latitude}`).not.toBe(
        "",
      );
    }
  });
});
