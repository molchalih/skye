import { describe, expect, it } from "vitest";
import { SCENE_NAMES, type SceneName } from "../core/params.ts";
import { fallbackBackground } from "./fallback.ts";

const gradient = (top: string, bottom: string): string =>
  `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`;

// v6's _fallback table, transcribed; cloudy has no entry there and takes the default pair.
const V6: Record<SceneName, readonly [day: string, night: string]> = {
  clear: [gradient("#5b8fd6", "#cfe0f2"), gradient("#070b1a", "#1a2440")],
  fog: [gradient("#aeb4bc", "#d8dbe0"), gradient("#1c2028", "#2c313a")],
  haze: [gradient("#b98a5a", "#e7c9a0"), gradient("#2a1e14", "#4a3423")],
  rainy: [gradient("#5a6470", "#8b95a0"), gradient("#0e131c", "#222b38")],
  storm: [gradient("#1a1f29", "#3a4250"), gradient("#1a1f29", "#3a4250")],
  snowy: [gradient("#8e98a6", "#c7cdd6"), gradient("#141a24", "#2a3240")],
  sleet: [gradient("#6e7884", "#a3acb6"), gradient("#121822", "#262e3a")],
  cloudy: [gradient("#6f8fbd", "#bcc9dc"), gradient("#101728", "#233050")],
};

describe("fallbackBackground", () => {
  it.each(SCENE_NAMES)("matches v6 for %s by day and by night", (scene) => {
    expect(fallbackBackground({ scene, hour: 12 })).toBe(V6[scene][0]);
    expect(fallbackBackground({ scene, hour: 2 })).toBe(V6[scene][1]);
  });

  it("treats 6.5 h and 19.5 h as night, like v6", () => {
    expect(fallbackBackground({ scene: "clear", hour: 6.5 })).toBe(V6.clear[1]);
    expect(fallbackBackground({ scene: "clear", hour: 6.51 })).toBe(V6.clear[0]);
    expect(fallbackBackground({ scene: "clear", hour: 19.5 })).toBe(V6.clear[1]);
  });

  it("defaults to hour 17.5 and the cloudy pair", () => {
    expect(fallbackBackground({})).toBe(V6.cloudy[0]);
    expect(fallbackBackground({ hour: Number.NaN })).toBe(V6.cloudy[0]);
  });

  it("reads the hour as given, without wrapping it", () => {
    expect(fallbackBackground({ scene: "clear", hour: 36 })).toBe(V6.clear[1]);
  });
});
