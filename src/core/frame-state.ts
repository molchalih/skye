import type { Vec2, Vec3 } from "./math.ts";

/**
 * The animation time every static frame shows. Static frames show the clouds
 * as they are this far into the animation, with the glass already wet.
 */
export const STATIC_TIME_S = 40;

/** Where a frame sits in animation time. One object per clock, rewritten every frame. */
export interface FrameTime {
  /** Animation time, in seconds. */
  seconds: number;
  /** Seconds the animation advances by in this frame. */
  dt: number;
  /** Motion is off: the frame shows every value already at its target. */
  isStatic: boolean;
}

/**
 * A light in the sky. Positions are in sky space: the origin at the centre
 * of the frame, y up, one unit the frame's height, so x spans ±aspect / 2.
 */
export interface Light {
  readonly position: Vec2;
  /** Colour times brightness. */
  readonly color: Vec3;
}

/** The sun or the moon. */
export interface Body extends Light {
  /** 0 when set, 1 once risen. */
  visibility: number;
}

export interface Sun extends Body {
  /** Sine of the sun's elevation; negative below the horizon. */
  sinElevation: number;
  /** The sun's hue: its colour over its brightest channel, which tints the lens flare. */
  readonly tint: Vec3;
}

export interface Moon extends Body {
  /** 0 new, 0.5 full; in [0, 1). */
  phase: number;
}

/**
 * Everything the passes read of the sky, weather and glass in one frame:
 * what the params call for (`SceneModel`), or that eased toward it
 * (`Easer`). The objects and vectors are created once and mutated, so a
 * state keeps its identity for the life of a sky.
 */
export interface FrameState {
  /** Canvas width over height. */
  aspect: number;
  /** The `exposure` param. */
  exposure: number;
  /** The `focus` param: the depth the glass is focused at. */
  focus: number;
  /** The `seed` param, which picks the cloud pattern. */
  seed: number;
  /** Background blur radius in CSS px; it eases over a fixed time (`Easer`), not by the chase. */
  blur: number;

  sun: Sun;
  moon: Moon;
  /** The light the clouds are lit by: the sun's by day, the moon's at night. */
  light: Light;
  /** 0 in daylight, 1 at night. */
  night: number;
  zenith: Vec3;
  horizon: Vec3;
  /** The exposure the scene calls for: raised at night, lowered in bright weather. `exposure` scales it. */
  sceneExposure: number;

  /** Cloud cover, 0 to 1, as the scene allows it. */
  cover: number;
  /** Weather intensity, 0 to 1, as the scene allows it; 0 for skies without weather. */
  intensity: number;
  cloudDarkness: number;
  /** Cloud drift speed. */
  wind: number;
  /** How hard the wind gusts, 0.5 for calm weather. */
  gustiness: number;
  /** How much of each weather the scene holds (`SceneDef`). */
  rain: number;
  snow: number;
  sleet: number;
  storm: number;
  /** Fog, haze and dust densities: the scene's share of each, thickened by intensity. */
  fog: number;
  haze: number;
  dust: number;

  /** Strength of crepuscular rays through gaps in the cloud. */
  rays: number;
  /** Strength of the lens flare on the glass. */
  flare: number;
  rainbow: number;
  /** Strength of the Belt of Venus, the pink band above the twilight horizon. */
  twilightBelt: number;
  /** Star brightness. */
  stars: number;
  /** How much the weather hides the sun's disc. */
  sunHidden: number;

  /** Rain, frost and mist on the glass, built up since the scene began. */
  glassRain: number;
  glassFrost: number;
  glassMist: number;
}

export function createFrameState(): FrameState {
  return {
    aspect: 0,
    exposure: 0,
    focus: 0,
    seed: 0,
    blur: 0,
    sun: { position: [0, 0], color: [0, 0, 0], visibility: 0, sinElevation: 0, tint: [0, 0, 0] },
    moon: { position: [0, 0], color: [0, 0, 0], visibility: 0, phase: 0 },
    light: { position: [0, 0], color: [0, 0, 0] },
    night: 0,
    zenith: [0, 0, 0],
    horizon: [0, 0, 0],
    sceneExposure: 0,
    cover: 0,
    intensity: 0,
    cloudDarkness: 0,
    wind: 0,
    gustiness: 0,
    rain: 0,
    snow: 0,
    sleet: 0,
    storm: 0,
    fog: 0,
    haze: 0,
    dust: 0,
    rays: 0,
    flare: 0,
    rainbow: 0,
    twilightBelt: 0,
    stars: 0,
    sunHidden: 0,
    glassRain: 0,
    glassFrost: 0,
    glassMist: 0,
  };
}
