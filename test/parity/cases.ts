import { SCENE_NAMES, type SceneName, type SkyeParams } from "../../src/index.ts";

const HOURS = [
  { name: "night", hour: 2 },
  { name: "dawn", hour: 6.5 },
  { name: "noon", hour: 13 },
  { name: "dusk", hour: 19.5 },
] as const;

/** The static matrix's sizes: a small landscape box and a portrait one with odd sizes, so rounding in the buffer sizes is exercised. */
export const SIZES = [
  [320, 200],
  [283, 419],
] as const;

/** Params every static case starts from. */
export const BASE: SkyeParams = { motion: "static", glass: true, quality: "balanced" };

/** The static matrix: every scene at night, dawn, noon and dusk. */
export const CASES: readonly { scene: SceneName; name: string; hour: number }[] =
  SCENE_NAMES.flatMap((scene) => HOURS.map(({ name, hour }) => ({ scene, name, hour })));
