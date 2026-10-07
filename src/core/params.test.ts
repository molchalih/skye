import { describe, expect, it } from "vitest";
import { DEFAULTS, resolveParams, type ResolvedParams, type SkyeParams } from "./params.ts";

// Simulates untyped JS callers.
function resolveRaw(json: string): ResolvedParams {
  return resolveParams(JSON.parse(json));
}

describe("DEFAULTS", () => {
  it("matches the spec table", () => {
    // Strict: `wind` must be present and undefined, not merely absent.
    expect(DEFAULTS).toStrictEqual({
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
  });

  it("is what an empty input resolves to", () => {
    expect(resolveParams({})).toStrictEqual(DEFAULTS);
  });

  it("is what null or undefined resolves to, from untyped callers", () => {
    expect(resolveParams(null)).toStrictEqual(DEFAULTS);
    expect(resolveParams(undefined)).toStrictEqual(DEFAULTS);
    expect(resolveRaw("null")).toStrictEqual(DEFAULTS);
  });
});

describe("resolveParams", () => {
  it("clamps ranges as v6", () => {
    const r = resolveParams({
      cover: -3,
      intensity: 7,
      focus: 0,
      exposure: 9,
      blur: 100,
      latitude: -90,
    });
    expect(r).toMatchObject({
      cover: 0,
      intensity: 1,
      focus: 0.12,
      exposure: 1.2,
      blur: 64,
      latitude: -66,
    });
    expect(resolveParams({ exposure: 0, latitude: 90, blur: -1 })).toMatchObject({
      exposure: 0.2,
      latitude: 66,
      blur: 0,
    });
  });

  it("wraps hour and moon phase, including negatives", () => {
    expect(resolveParams({ hour: -1 }).hour).toBe(23);
    expect(resolveParams({ hour: 25.5 }).hour).toBe(1.5);
    expect(resolveParams({ hour: 24 }).hour).toBe(0);
    expect(resolveParams({ moonPhase: -0.25 }).moonPhase).toBe(0.75);
    expect(resolveParams({ moonPhase: 1.25 }).moonPhase).toBe(0.25);
    expect(resolveParams({ moonPhase: 1 }).moonPhase).toBe(0);
  });

  it("does not clamp the day, seed, noon or wind", () => {
    expect(resolveParams({ dayOfYear: 400, seed: -12.5, solarNoon: 30, wind: -2 })).toMatchObject({
      dayOfYear: 400,
      seed: -12.5,
      solarNoon: 30,
      wind: -2,
    });
  });

  it("falls back to defaults for non-finite numbers without throwing", () => {
    const bad = [Number.NaN, Infinity, -Infinity];
    for (const v of bad) {
      const input: SkyeParams = {
        cover: v,
        intensity: v,
        wind: v,
        seed: v,
        hour: v,
        latitude: v,
        dayOfYear: v,
        solarNoon: v,
        moonPhase: v,
        focus: v,
        exposure: v,
        blur: v,
      };
      expect(resolveParams(input)).toEqual(DEFAULTS);
    }
  });

  it("falls back for garbage of the wrong type", () => {
    expect(resolveRaw('{"hour":"abc","cover":"x","scene":4,"glass":"off","wind":null}')).toEqual(
      DEFAULTS,
    );
  });

  it("resolves unknown scenes to cloudy and keeps known ones", () => {
    expect(resolveRaw('{"scene":"tornado"}').scene).toBe("cloudy");
    expect(resolveRaw('{"scene":"constructor"}').scene).toBe("cloudy");
    expect(resolveParams({ scene: "storm" }).scene).toBe("storm");
  });

  it("resolves unknown quality to balanced and keeps valid values", () => {
    expect(resolveRaw('{"quality":"ultra"}').quality).toBe("balanced");
    for (const q of ["auto", "low", "balanced", "high"] as const) {
      expect(resolveParams({ quality: q }).quality).toBe(q);
    }
  });

  it("treats unknown motion as full, as v6 does", () => {
    expect(resolveRaw('{"motion":"wobble"}').motion).toBe("full");
    expect(resolveParams({ motion: "static" }).motion).toBe("static");
    expect(resolveParams({ motion: "full" }).motion).toBe("full");
  });

  it("keeps an explicit glass flag", () => {
    expect(resolveParams({ glass: false }).glass).toBe(false);
  });
});
