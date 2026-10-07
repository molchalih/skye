import { describe, expect, it } from "vitest";
import { DEFAULTS, resolveParams, type SkyeParams } from "../core/params.ts";
import {
  PARAM_ATTRIBUTES,
  SKYE_ATTRIBUTES,
  attributesToParams,
  toAttributes,
  type SkyeAttribute,
} from "./attributes.ts";

function read(attrs: Record<string, string>): SkyeParams {
  return attributesToParams((name: SkyeAttribute) => attrs[name] ?? null);
}

describe("SKYE_ATTRIBUTES", () => {
  it("is the spec's attribute list", () => {
    expect(SKYE_ATTRIBUTES).toEqual([
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
    ]);
  });

  it("carries a param in every attribute except worker", () => {
    expect(PARAM_ATTRIBUTES).toEqual(SKYE_ATTRIBUTES.filter((a) => a !== "worker"));
  });
});

describe("attributesToParams", () => {
  it("maps every attribute to its param", () => {
    expect(
      read({
        scene: "storm",
        cover: "0.7",
        intensity: "0.8",
        wind: "2.5",
        seed: "3",
        hour: "9.25",
        latitude: "40",
        "day-of-year": "300",
        "solar-noon": "12.2",
        "moon-phase": "0.3",
        glass: "1",
        "focus-depth": "0.8",
        exposure: "0.9",
        "blur-radius": "6",
        quality: "high",
        motion: "static",
      }),
    ).toStrictEqual({
      scene: "storm",
      cover: 0.7,
      intensity: 0.8,
      wind: 2.5,
      seed: 3,
      hour: 9.25,
      latitude: 40,
      dayOfYear: 300,
      solarNoon: 12.2,
      moonPhase: 0.3,
      glass: true,
      focus: 0.8,
      exposure: 0.9,
      blur: 6,
      quality: "high",
      motion: "static",
    });
  });

  it("returns every param key, undefined for absent attributes", () => {
    const params = read({});
    expect(Object.keys(params).sort()).toEqual(Object.keys(DEFAULTS).sort());
    expect(Object.values(params).every((v) => v === undefined)).toBe(true);
    expect(resolveParams(params)).toStrictEqual(resolveParams({}));
  });

  it("parses numbers like v6's parseFloat, treating non-finite values as absent", () => {
    expect(read({ hour: "7.5h", cover: " 0.25", seed: "1e2" })).toMatchObject({
      hour: 7.5,
      cover: 0.25,
      seed: 100,
    });
    for (const bad of ["abc", "", "NaN", "Infinity", "-Infinity"]) {
      expect(read({ hour: bad, wind: bad }).hour).toBeUndefined();
      expect(read({ hour: bad, wind: bad }).wind).toBeUndefined();
    }
    // Out-of-range values pass through; resolveParams clamps them as v6 did.
    expect(read({ cover: "-3" }).cover).toBe(-3);
  });

  it.each(["0", "off", "false", "none", "OFF", "False", "NONE"])("reads glass=%s as off", (v) => {
    expect(read({ glass: v }).glass).toBe(false);
  });

  it.each(["", "1", "on", "true", "yes", "0.0", " off"])("reads glass=%j as on", (v) => {
    expect(read({ glass: v }).glass).toBe(true);
  });

  it("resolves names exactly as resolveParams does", () => {
    expect(read({ scene: "tornado", quality: "ultra", motion: "wild" })).toMatchObject({
      scene: "cloudy",
      quality: "balanced",
      motion: "full",
    });
    expect(read({ scene: "", quality: "", motion: "" })).toMatchObject({
      scene: "cloudy",
      quality: "auto",
      motion: "auto",
    });
  });

  it("ignores attributes it does not know, v6's names included", () => {
    const asked: string[] = [];
    const params = attributesToParams((name) => {
      asked.push(name);
      return null;
    });
    expect(asked.sort()).toEqual([...PARAM_ATTRIBUTES].sort());
    expect(
      resolveParams(read({ dim: "0.3", lat: "10", day: "5", moon: "0.1", noon: "11", blur: "9" })),
    ).toStrictEqual(resolveParams(params));
  });
});

describe("toAttributes", () => {
  it("writes typed params as attributes, leaving out undefined ones", () => {
    expect(
      toAttributes({
        scene: "fog",
        dayOfYear: 12,
        moonPhase: 0.25,
        glass: false,
        focus: 0.3,
        blur: 4,
        wind: undefined,
      }),
    ).toStrictEqual({
      scene: "fog",
      "day-of-year": "12",
      "moon-phase": "0.25",
      glass: "0",
      "focus-depth": "0.3",
      "blur-radius": "4",
    });
    expect(toAttributes({ glass: true })).toStrictEqual({ glass: "1" });
  });

  it("round-trips through attributesToParams", () => {
    const params: SkyeParams = {
      scene: "haze",
      cover: 0.2,
      intensity: 0.1,
      wind: 0.5,
      seed: 42,
      hour: 23.75,
      latitude: -33.9,
      dayOfYear: 1,
      solarNoon: 13,
      moonPhase: 0.9,
      glass: false,
      focus: 0.12,
      exposure: 1.2,
      blur: 64,
      quality: "low",
      motion: "full",
    };
    expect(read(toAttributes(params))).toStrictEqual(params);
  });
});
