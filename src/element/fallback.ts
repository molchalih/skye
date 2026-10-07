import { DEFAULTS, resolveScene, type SceneName, type SkyeParams } from "../core/params.ts";

type Stops = readonly [top: string, bottom: string];

// v6's `_fallback` table. v6 had no cloudy entry: cloudy and unknown scenes took its default pair.
const GRADIENTS: Readonly<Record<SceneName, { day: Stops; night: Stops }>> = {
  clear: { day: ["#5b8fd6", "#cfe0f2"], night: ["#070b1a", "#1a2440"] },
  cloudy: { day: ["#6f8fbd", "#bcc9dc"], night: ["#101728", "#233050"] },
  fog: { day: ["#aeb4bc", "#d8dbe0"], night: ["#1c2028", "#2c313a"] },
  rainy: { day: ["#5a6470", "#8b95a0"], night: ["#0e131c", "#222b38"] },
  storm: { day: ["#1a1f29", "#3a4250"], night: ["#1a1f29", "#3a4250"] },
  sleet: { day: ["#6e7884", "#a3acb6"], night: ["#121822", "#262e3a"] },
  snowy: { day: ["#8e98a6", "#c7cdd6"], night: ["#141a24", "#2a3240"] },
  haze: { day: ["#b98a5a", "#e7c9a0"], night: ["#2a1e14", "#4a3423"] },
};

/**
 * The CSS background shown while no sky is drawn (before the renderer is
 * ready, or for good without WebGL2): v6's vertical gradient for the scene,
 * with daytime between 6.5 h and 19.5 h. Like v6 it reads the hour as given,
 * without wrapping it.
 */
export function fallbackBackground(params: Pick<SkyeParams, "scene" | "hour">): string {
  const hour =
    typeof params.hour === "number" && Number.isFinite(params.hour) ? params.hour : DEFAULTS.hour;
  const pair = GRADIENTS[resolveScene(params.scene)];
  const [top, bottom] = hour > 6.5 && hour < 19.5 ? pair.day : pair.night;
  return `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`;
}
