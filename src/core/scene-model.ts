import { solarPosition, type SolarPosition } from "../astro/index.ts";
import { clearSky, daylight, lightMoon, lightSun, placeInSky } from "./celestial.ts";
import { createFrameState, type FrameState, type FrameTime } from "./frame-state.ts";
import {
  clamp,
  copyVec2,
  copyVec3,
  mix,
  mixRange,
  mixVec3,
  scaleVec3,
  smoothstep,
  type Vec3,
} from "./math.ts";
import type { ResolvedParams, SceneName } from "./params.ts";
import { coverFloor, sceneIntensity, SCENES, type SceneDef } from "./scenes.ts";
import { overcast, sceneExposure, showEffects, weatherSky } from "./weather.ts";

/** Seconds that rain, frost and mist take to build up on the glass once their weather begins. */
export const RAIN_BUILD_UP_S = 8;
export const FROST_BUILD_UP_S = 12;
export const MIST_BUILD_UP_S = 10;

function solarRecord(): SolarPosition {
  return { sinElevation: 0, elevationDeg: 0, azimuth: 0, sunrise: 0, sunset: 0, polar: null };
}

/**
 * Turns params into the frame state they call for. Everything but the glass
 * depends only on the params and the canvas's aspect, so it is computed when
 * they change (`configure`); each frame (`target`) only advances how far rain,
 * frost and mist have built up on the glass since the scene began.
 */
export class SceneModel {
  readonly #state = createFrameState();
  readonly #sunAt = solarRecord();
  readonly #moonAt = solarRecord();
  readonly #moonlight: Vec3 = [0, 0, 0];
  readonly #sunlight: Vec3 = [0, 0, 0];
  #scene: SceneName | undefined;
  #sceneChanged = false;
  #sceneStart = 0;
  #rainOnGlass = 0;
  #frostOnGlass = 0;
  #mistOnGlass = 0;

  /** Sets the params and the canvas's width over height. */
  configure(params: ResolvedParams, aspect: number): void {
    if (params.scene !== this.#scene) {
      this.#scene = params.scene;
      this.#sceneChanged = true;
    }
    this.#compute(params, aspect);
  }

  /**
   * The state for a frame at `time`. The returned object is the model's own,
   * rewritten by every call.
   */
  target(time: Readonly<FrameTime>): Readonly<FrameState> {
    // The glass builds up from the first frame of a scene. A static frame shows it built up, and so does the
    // animation after it, unless the scene changes.
    const s = this.#state;
    if (time.isStatic) {
      this.#sceneChanged = false;
      this.#sceneStart = -Infinity;
      s.glassRain = this.#rainOnGlass;
      s.glassFrost = this.#frostOnGlass;
      s.glassMist = this.#mistOnGlass;
      return s;
    }
    if (this.#sceneChanged) {
      this.#sceneChanged = false;
      this.#sceneStart = time.seconds;
    }
    const since = time.seconds - this.#sceneStart;
    s.glassRain = this.#rainOnGlass * smoothstep(0, RAIN_BUILD_UP_S, since);
    s.glassFrost = this.#frostOnGlass * smoothstep(0, FROST_BUILD_UP_S, since);
    s.glassMist = this.#mistOnGlass * smoothstep(0, MIST_BUILD_UP_S, since);
    return s;
  }

  #compute(params: ResolvedParams, aspect: number): void {
    const s = this.#state;
    const scene = SCENES[params.scene];
    const intensity = sceneIntensity(scene, params.intensity);
    const cover = clamp(params.cover, coverFloor(scene, intensity), scene.maxCover);
    s.aspect = aspect;
    s.exposure = params.exposure;
    s.focus = params.focus;
    s.seed = params.seed;
    s.blur = params.blur;
    describeWeather(s, scene, intensity, cover, params.wind);
    this.#placeSunAndMoon(params, aspect, scene.haze * intensity);
    this.#lightClouds(s);
    const day = 1 - s.night;
    clearSky(s.sun.sinElevation, s.zenith, s.horizon);
    overcast(s.zenith, s.horizon, cover);
    weatherSky(scene, intensity, day, s.zenith, s.horizon);
    s.sceneExposure = sceneExposure(scene, intensity, s.night);
    showEffects(s, scene, params.glass);
    // What the glass gathers once it has built up: rain, frost from snow, and mist from fog.
    const onGlass = params.glass ? 1 : 0;
    this.#rainOnGlass = onGlass * mix(0.3, 1, intensity) * scene.rain;
    this.#frostOnGlass = onGlass * mix(0.15, 0.75, intensity) * scene.snow;
    this.#mistOnGlass = onGlass * mix(0.25, 0.7, intensity) * scene.fog;
  }

  // The moon keeps to the sun's path, `moonPhase` days behind it: new beside the sun, full opposite it. Haze reddens
  // the sun by its density (set with the weather) and dims it by `hazeDimming`.
  #placeSunAndMoon(params: ResolvedParams, aspect: number, hazeDimming: number): void {
    const { sun, moon } = this.#state;
    const { latitude, dayOfYear, hour, solarNoon, moonPhase } = params;
    const sunAt = solarPosition(latitude, dayOfYear, hour, solarNoon, this.#sunAt);
    const moonHour = hour - moonPhase * 24;
    const moonAt = solarPosition(latitude, dayOfYear, moonHour, solarNoon, this.#moonAt);
    sun.sinElevation = sunAt.sinElevation;
    placeInSky(sun.position, sunAt.azimuth, sunAt.sinElevation, aspect);
    placeInSky(moon.position, moonAt.azimuth, moonAt.sinElevation, aspect);
    const night = 1 - daylight(sun.sinElevation);
    this.#state.night = night;
    // The disc shows from 3.4° below the horizon, as refraction lifts it, and is whole 2.9° above.
    sun.visibility = smoothstep(-0.06, 0.05, sun.sinElevation);
    lightSun(sun, this.#state.haze, hazeDimming);
    moon.phase = moonPhase;
    lightMoon(moon, moonAt.sinElevation, night);
  }

  // The clouds take the sun's light until it is about 1° below the horizon, then the moon's, when it is up. The light's
  // position switches outright (easing glides it across); its colour cross-fades. Moonlight is raised, as the eye
  // adapts to the dark; sunlight on the clouds is a share of the sun, cut further by cover and dark cloud.
  #lightClouds(s: FrameState): void {
    const { sun, moon, light } = s;
    const sunShare = smoothstep(-0.08, 0.04, sun.sinElevation);
    copyVec2(
      light.position,
      sunShare > 0.5 || moon.visibility < 0.05 ? sun.position : moon.position,
    );
    const moonlight = scaleVec3(copyVec3(this.#moonlight, moon.color), 1.4);
    const sunlight = scaleVec3(
      copyVec3(this.#sunlight, sun.color),
      0.4 * (1 - 0.5 * s.cover) * (1 - 0.6 * s.cloudDarkness),
    );
    mixVec3(light.color, moonlight, sunlight, sunShare);
  }
}

/** The weather the scene shows at `intensity` and `cover`. `wind` is the param's, absent for the scene's own. */
function describeWeather(
  s: FrameState,
  scene: SceneDef,
  intensity: number,
  cover: number,
  wind: number | undefined,
): void {
  s.cover = cover;
  s.intensity = intensity;
  s.rain = scene.rain;
  s.snow = scene.snow;
  s.sleet = scene.sleet;
  s.storm = scene.storm;
  s.fog = scene.fog * mix(0.6, 1, intensity);
  s.haze = scene.haze * mix(0.5, 1, intensity);
  s.dust = scene.dust * mix(0.3, 1, intensity);
  s.wind = wind ?? mixRange(scene.wind, intensity);
  s.gustiness = 0.5 + scene.storm + 0.3 * scene.rain;
  s.cloudDarkness = mixRange(scene.darkness, intensity) + scene.darknessPerCover * cover;
}
