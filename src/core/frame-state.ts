import { solarPosition, type SolarPosition } from "../astro/index.ts";
import { clamp, luminance, mix, mixVec3, smoothstep, type Vec3 } from "./math.ts";
import type { ResolvedParams, SceneName } from "./params.ts";
import { SCENES, SKY_STOPS, type SceneDef } from "./tables.ts";

export type Vec2 = [number, number];

/** Animation time v6 uses for every frame in static mode. */
export const STATIC_TIME_S = 40;

// v6 starts the glass fade-in this long before a scene change settles in static mode, so the single frame is already faded in.
const STATIC_SCENE_LEAD_S = 30;

/**
 * Every value v6's `_target` produces for one frame, under readable names. Each
 * field's TSDoc gives the v6 `env` name it replaces. Vectors are allocated once
 * and mutated, so the object keeps its identity for the life of a sky.
 */
export interface FrameState {
  /** Cloud cover after scene rules, 0-1 (v6 `cov`). */
  cover: number;
  /** Precipitation / fog / haze strength after scene rules (v6 `inten`). */
  intensity: number;
  /** Cloud pattern seed (v6 `seed`). */
  seed: number;
  /** Glass layer switch as 0 or 1; v6 multiplies by it (v6 `glass`). */
  glass: number;
  /** Glass focus depth (v6 `focus`). */
  focus: number;
  /** Cloud wind speed (v6 `wind`). */
  wind: number;
  /** User brightness multiplier (v6 `dim`). */
  exposure: number;
  /** Background blur radius in px (v6 `blur`). */
  blur: number;
  /** Canvas width over height (v6 `asp`). */
  aspect: number;
  /** Sine of the sun elevation (v6 `el`). */
  sinElevation: number;
  /** 1 minus the daylight factor (v6 `night`). */
  night: number;
  /** Sun position in sky space (v6 `sunPos`). */
  sunPos: Vec2;
  /** Moon position in sky space (v6 `moonPos`). */
  moonPos: Vec2;
  /** Zenith colour (v6 `zen`). */
  zenith: Vec3;
  /** Horizon colour (v6 `hor`). */
  horizon: Vec3;
  /** Sun visibility, 0-1 (v6 `sunUp`). */
  sunUp: number;
  /** Moon visibility, 0-1 (v6 `moonUp`). */
  moonUp: number;
  /** Sun colour, premultiplied by its intensity (v6 `sunCol`). */
  sunColor: Vec3;
  /** Moon colour, premultiplied by its intensity (v6 `moonCol`). */
  moonColor: Vec3;
  /** Position of the dominant light, sun or moon (v6 `LPos`). */
  lightPos: Vec2;
  /** Colour of the dominant light (v6 `LCol`). */
  lightColor: Vec3;
  /** Night and weather exposure of the composite, not the user's `exposure` param (v6 `exposure`). */
  weatherExposure: number;
  /** How much the weather darkens clouds (v6 `cloudDark`). */
  cloudDark: number;
  /** Scene rain weight (v6 `rain`). */
  rain: number;
  /** Scene snow weight (v6 `snow`). */
  snow: number;
  /** Fog density (v6 `fog`). */
  fog: number;
  /** Haze density (v6 `haze`). */
  haze: number;
  /** Dust amount (v6 `dust`). */
  dust: number;
  /** Scene storm weight (v6 `storm`). */
  storm: number;
  /** Scene sleet weight (v6 `sleet`). */
  sleet: number;
  /** Rain-on-glass amount, faded in since the scene change (v6 `glassRain`). */
  glassRain: number;
  /** Frost-on-glass amount (v6 `glassFrost`). */
  glassFrost: number;
  /** Mist-on-glass amount (v6 `glassMist`). */
  glassMist: number;
  /** God-ray strength (v6 `rays`). */
  rays: number;
  /** Lens flare strength (v6 `flare`). */
  flare: number;
  /** Rainbow strength (v6 `rainbow`). */
  rainbow: number;
  /** Belt-of-Venus strength (v6 `belt`). */
  belt: number;
  /** Star brightness (v6 `star`). */
  star: number;
  /** How much the weather hides the sun disc (v6 `hide`). */
  hide: number;
  /** Moon phase in [0, 1) (v6 `moonPhase`). */
  moonPhase: number;
  /** Lit fraction of the moon (v6 `moonIllum`). */
  moonIllumination: number;
  /** Mirror of the sun position used by the glass pass (v6 `asun`). */
  antiSunPos: Vec2;
  /** Sun position in texture coordinates (v6 `sunUV`). */
  sunUV: Vec2;
  /** Sun colour normalised to its brightest channel (v6 `sunTint`). */
  sunTint: Vec3;
  /** Local hour of sunrise (v6 `sunrise`). */
  sunrise: number;
  /** Local hour of sunset (v6 `sunset`). */
  sunset: number;
  /** Sun elevation in degrees (v6 `elDeg`). */
  elevationDeg: number;
  /** Gust strength for particles (v6 `gust`). */
  gust: number;
}

type KeysOf<V> = { [K in keyof FrameState]: FrameState[K] extends V ? K : never }[keyof FrameState];
export type NumberKey = Exclude<KeysOf<number>, "blur">;
export type Vec2Key = KeysOf<Vec2>;
export type Vec3Key = KeysOf<Vec3>;

/** Scalar fields eased exponentially; `blur` is excluded because it has its own tween. */
export const NUMBER_KEYS: readonly NumberKey[] = [
  "cover",
  "intensity",
  "seed",
  "glass",
  "focus",
  "wind",
  "exposure",
  "aspect",
  "sinElevation",
  "night",
  "sunUp",
  "moonUp",
  "weatherExposure",
  "cloudDark",
  "rain",
  "snow",
  "fog",
  "haze",
  "dust",
  "storm",
  "sleet",
  "glassRain",
  "glassFrost",
  "glassMist",
  "rays",
  "flare",
  "rainbow",
  "belt",
  "star",
  "hide",
  "moonPhase",
  "moonIllumination",
  "sunrise",
  "sunset",
  "elevationDeg",
  "gust",
];
export const VEC2_KEYS: readonly Vec2Key[] = [
  "sunPos",
  "moonPos",
  "lightPos",
  "antiSunPos",
  "sunUV",
];
export const VEC3_KEYS: readonly Vec3Key[] = [
  "zenith",
  "horizon",
  "sunColor",
  "moonColor",
  "lightColor",
  "sunTint",
];

export function createFrameState(): FrameState {
  return {
    cover: 0,
    intensity: 0,
    seed: 0,
    glass: 0,
    focus: 0,
    wind: 0,
    exposure: 0,
    blur: 0,
    aspect: 0,
    sinElevation: 0,
    night: 0,
    sunPos: [0, 0],
    moonPos: [0, 0],
    zenith: [0, 0, 0],
    horizon: [0, 0, 0],
    sunUp: 0,
    moonUp: 0,
    sunColor: [0, 0, 0],
    moonColor: [0, 0, 0],
    lightPos: [0, 0],
    lightColor: [0, 0, 0],
    weatherExposure: 0,
    cloudDark: 0,
    rain: 0,
    snow: 0,
    fog: 0,
    haze: 0,
    dust: 0,
    storm: 0,
    sleet: 0,
    glassRain: 0,
    glassFrost: 0,
    glassMist: 0,
    rays: 0,
    flare: 0,
    rainbow: 0,
    belt: 0,
    star: 0,
    hide: 0,
    moonPhase: 0,
    moonIllumination: 0,
    antiSunPos: [0, 0],
    sunUV: [0, 0],
    sunTint: [0, 0, 0],
    sunrise: 0,
    sunset: 0,
    elevationDeg: 0,
    gust: 0,
  };
}

/** Copies every value of `src` into `dst` without allocating. */
export function copyFrameState(dst: FrameState, src: Readonly<FrameState>): void {
  dst.blur = src.blur;
  for (const k of NUMBER_KEYS) dst[k] = src[k];
  for (const k of VEC2_KEYS) {
    dst[k][0] = src[k][0];
    dst[k][1] = src[k][1];
  }
  for (const k of VEC3_KEYS) {
    dst[k][0] = src[k][0];
    dst[k][1] = src[k][1];
    dst[k][2] = src[k][2];
  }
}

// Writes the zenith and horizon colours for a sun elevation by interpolating the stop table.
function skyColors(el: number, zenith: Vec3, horizon: Vec3): void {
  let i = 0;
  while (i < SKY_STOPS.length - 2 && el > (SKY_STOPS[i + 1]?.[0] ?? Infinity)) i++;
  const a = SKY_STOPS[i];
  const b = SKY_STOPS[i + 1];
  // Unreachable: the loop keeps i inside the table.
  if (a === undefined || b === undefined) return;
  const t = smoothstep(a[0], b[0], el);
  mixVec3(zenith, a[1], b[1], t);
  mixVec3(horizon, a[2], b[2], t);
}

const SUN_LOW: Readonly<Vec3> = [1.0, 0.45, 0.2];
const SUN_HIGH: Readonly<Vec3> = [1.0, 0.95, 0.88];
const SUN_HAZE: Readonly<Vec3> = [1.0, 0.38, 0.18];

function newSolarPosition(): SolarPosition {
  return { sinElevation: 0, elevationDeg: 0, azimuth: 0, sunrise: 0, sunset: 0, polar: null };
}

/**
 * Turns params and animation time into the per-frame scene values, exactly as
 * v6's `_target`. Like v6 it recomputes only when an input changes, with time
 * quantised to quarter seconds, so the glass fade steps at that rate too.
 */
export class SceneModel {
  private readonly state = createFrameState();
  private readonly scratchA: Vec3 = [0, 0, 0];
  private readonly scratchB: Vec3 = [0, 0, 0];
  private readonly sunPosition = newSolarPosition();
  private readonly moonPosition = newSolarPosition();
  private valid = false;
  private sceneName: SceneName | "" = "";
  private sceneT = 0;
  // The cache key, field by field (v6 joins these into a string).
  private kScene: SceneName = "cloudy";
  private kHour = 0;
  private kCover = 0;
  private kIntensity = 0;
  private kSeed = 0;
  private kGlass = false;
  private kFocus = 0;
  private kWind: number | undefined = undefined;
  private kExposure = 0;
  private kBlur = 0;
  private kLatitude = 0;
  private kDay = 0;
  private kNoon = 0;
  private kMoon = 0;
  private kAspect = 0;
  private kSceneT = 0;
  private kTick = 0;

  /** Forces the next `target` call to recompute (v6 `_envKey = ''`). */
  invalidate(): void {
    this.valid = false;
  }

  /**
   * Returns the frame state for `params` at animation time `t`. The returned
   * object is owned by the model and mutated in place on the next recompute.
   * @param aspect canvas width over height, already guarded against a zero height
   * @param isStatic whether motion is off; the scene-change clock then starts early so the glass is already faded in
   */
  target(params: ResolvedParams, t: number, aspect: number, isStatic: boolean): FrameState {
    const scene = params.scene;
    if (scene !== this.sceneName) {
      this.sceneName = scene;
      this.sceneT = isStatic ? t - STATIC_SCENE_LEAD_S : t;
    }
    // v6 keys on the aspect rounded to four decimals. A NaN aspect never equals the stored key, so it recomputes every call (uncached but correct).
    const asp = Math.round(aspect * 1e4) / 1e4;
    const tick = Math.floor(t * 4);
    if (
      !this.valid ||
      scene !== this.kScene ||
      params.hour !== this.kHour ||
      params.cover !== this.kCover ||
      params.intensity !== this.kIntensity ||
      params.seed !== this.kSeed ||
      params.glass !== this.kGlass ||
      params.focus !== this.kFocus ||
      params.wind !== this.kWind ||
      params.exposure !== this.kExposure ||
      params.blur !== this.kBlur ||
      params.latitude !== this.kLatitude ||
      params.dayOfYear !== this.kDay ||
      params.solarNoon !== this.kNoon ||
      params.moonPhase !== this.kMoon ||
      asp !== this.kAspect ||
      this.sceneT !== this.kSceneT ||
      tick !== this.kTick
    ) {
      this.kScene = scene;
      this.kHour = params.hour;
      this.kCover = params.cover;
      this.kIntensity = params.intensity;
      this.kSeed = params.seed;
      this.kGlass = params.glass;
      this.kFocus = params.focus;
      this.kWind = params.wind;
      this.kExposure = params.exposure;
      this.kBlur = params.blur;
      this.kLatitude = params.latitude;
      this.kDay = params.dayOfYear;
      this.kNoon = params.solarNoon;
      this.kMoon = params.moonPhase;
      this.kAspect = asp;
      this.kSceneT = this.sceneT;
      this.kTick = tick;
      this.compute(params, t, aspect);
      this.valid = true;
    }
    return this.state;
  }

  private compute(params: ResolvedParams, t: number, aspect: number): void {
    const s = this.state;
    const sc = SCENES[params.scene];
    const rainW = sc.rain ?? 0;
    const snowW = sc.snow ?? 0;
    const fogW = sc.fog ?? 0;
    const hz = sc.haze ?? 0;
    const storm = sc.storm ?? 0;
    const sleet = sc.sleet ?? 0;
    const dust = sc.dust ?? 0;
    const usesIntensity = rainW || snowW || fogW || hz;
    let inten = usesIntensity ? params.intensity : 0;
    if (sc.intMin) inten = Math.max(inten, sc.intMin);
    let cov = params.cover;
    if (rainW) cov = Math.max(cov, (0.4 + 0.45 * inten) * rainW);
    if (snowW) cov = Math.max(cov, (0.35 + 0.4 * inten) * snowW);
    if (sc.covMin !== undefined) cov = Math.max(cov, sc.covMin);
    if (sc.covMax !== undefined) cov = Math.min(cov, sc.covMax);
    const glass = params.glass ? 1 : 0;
    const wind = params.wind ?? mix(sc.wind[0], sc.wind[1], inten);
    const moonPh = params.moonPhase;
    const asp = aspect;

    const sun = solarPosition(
      params.latitude,
      params.dayOfYear,
      params.hour,
      params.solarNoon,
      this.sunPosition,
    );
    const moon = solarPosition(
      params.latitude,
      params.dayOfYear,
      params.hour - moonPh * 24,
      params.solarNoon,
      this.moonPosition,
    );
    const el = sun.sinElevation;
    const dl = smoothstep(-0.12, 0.25, el);
    const night = 1 - dl;
    const sunPos = s.sunPos;
    sunPos[0] = Math.sin(sun.azimuth) * 0.42 * asp;
    sunPos[1] = -0.42 + 0.95 * Math.max(el, -0.2);
    const moonPos = s.moonPos;
    moonPos[0] = Math.sin(moon.azimuth) * 0.42 * asp;
    moonPos[1] = -0.42 + 0.95 * Math.max(moon.sinElevation, -0.2);
    const zen = s.zenith;
    const hor = s.horizon;
    skyColors(el, zen, hor);
    const sunUp = smoothstep(-0.06, 0.05, el);
    const moonIllum = 0.5 - 0.5 * Math.cos(moonPh * 2 * Math.PI);
    const moonUp =
      smoothstep(-0.05, 0.1, moon.sinElevation) * night * smoothstep(0.02, 0.12, moonIllum);

    const a = this.scratchA;
    const b = this.scratchB;
    const sunCol = s.sunColor;
    const elSun = smoothstep(0, 0.35, el);
    mixVec3(sunCol, SUN_LOW, SUN_HIGH, elSun);
    mixVec3(sunCol, sunCol, SUN_HAZE, 0.9 * hz * mix(0.5, 1, inten));
    const sunGain = 1.3 + 1.7 * elSun;
    const sunAtten = 1 - 0.78 * hz * inten;
    sunCol[0] = sunCol[0] * sunGain * sunUp * sunAtten;
    sunCol[1] = sunCol[1] * sunGain * sunUp * sunAtten;
    sunCol[2] = sunCol[2] * sunGain * sunUp * sunAtten;
    const moonCol = s.moonColor;
    moonCol[0] = 0.45 * 0.5 * moonUp;
    moonCol[1] = 0.55 * 0.5 * moonUp;
    moonCol[2] = 0.8 * 0.5 * moonUp;

    const gz = luminance(zen);
    const gh = luminance(hor);
    b[0] = gz * 0.92;
    b[1] = gz * 0.96;
    b[2] = gz * 1.06;
    mixVec3(zen, zen, b, 0.25 * cov);
    scale(zen, 1 - 0.25 * cov);
    b[0] = gh * 0.95;
    b[1] = gh * 0.97;
    b[2] = gh * 1.02;
    mixVec3(hor, hor, b, 0.3 * cov);
    scale(hor, 1 - 0.2 * cov);
    tintSky(sc, inten, dl, zen, hor, b);

    const w = smoothstep(-0.08, 0.04, el);
    const lightPos = s.lightPos;
    const lp = w > 0.5 || moonUp < 0.05 ? sunPos : moonPos;
    lightPos[0] = lp[0];
    lightPos[1] = lp[1];
    const cloudDark = mix(sc.dark[0], sc.dark[1], inten) + sc.darkCov * cov;
    const sunDim = 1 - 0.6 * cloudDark;
    a[0] = moonCol[0] * 1.4;
    a[1] = moonCol[1] * 1.4;
    a[2] = moonCol[2] * 1.4;
    b[0] = sunCol[0] * 0.4 * (1 - 0.5 * cov) * sunDim;
    b[1] = sunCol[1] * 0.4 * (1 - 0.5 * cov) * sunDim;
    b[2] = sunCol[2] * 0.4 * (1 - 0.5 * cov) * sunDim;
    mixVec3(s.lightColor, a, b, w);

    const exposure = weatherExposure(night, inten, rainW, snowW, fogW, hz, storm);
    const since = t - this.sceneT;
    const glassRain = rainW && glass ? smoothstep(0, 8, since) * mix(0.3, 1, inten) * rainW : 0;
    const glassFrost =
      snowW && glass ? smoothstep(0, 12, since) * mix(0.15, 0.75, inten) * snowW : 0;
    const glassMist = fogW && glass ? smoothstep(0, 10, since) * mix(0.25, 0.7, inten) : 0;
    const rays =
      sunUp *
      smoothstep(0.12, 0.4, cov) *
      (1 - smoothstep(0.85, 1, cov)) *
      (1 - fogW) *
      (1 - 0.7 * rainW) *
      (1 - 0.6 * hz) *
      (0.45 + 0.55 * (1 - clamp(el, 0, 1))) *
      (1 - 0.4 * storm);
    const flare = glass
      ? sunUp *
        (1 - smoothstep(0.2, 0.6, cov)) *
        (1 - fogW) *
        (1 - rainW) *
        (1 - snowW) *
        (1 - 0.5 * hz)
      : 0;
    const rainbow =
      rainW *
      (1 - smoothstep(0.3, 0.6, inten)) *
      sunUp *
      smoothstep(0.72, 0.4, el) *
      (1 - smoothstep(0.6, 0.9, cov)) *
      (1 - storm);
    const belt =
      smoothstep(-0.16, -0.03, el) *
      smoothstep(0.09, -0.02, el) *
      (1 - cov) *
      (1 - fogW) *
      (1 - hz);
    const star =
      night *
      Math.pow(1 - cov, 1.5) *
      (1 - fogW) *
      (1 - 0.85 * hz) *
      (1 - 0.9 * rainW) *
      (1 - 0.9 * snowW);
    const smax = Math.max(sunCol[0], sunCol[1], sunCol[2], 1e-3);
    const sunTint = s.sunTint;
    if (sunUp > 0.001) {
      sunTint[0] = sunCol[0] / smax;
      sunTint[1] = sunCol[1] / smax;
      sunTint[2] = sunCol[2] / smax;
    } else {
      sunTint[0] = 1;
      sunTint[1] = 0.9;
      sunTint[2] = 0.8;
    }
    const fog = fogW * mix(0.6, 1, inten);
    const haze = hz * mix(0.5, 1, inten);
    const hide = Math.max(storm * 0.97, fog * 0.95, rainW * inten * 0.5, haze * 0.75);

    s.cover = cov;
    s.intensity = inten;
    s.seed = params.seed;
    s.glass = glass;
    s.focus = params.focus;
    s.wind = wind;
    s.exposure = params.exposure;
    s.blur = params.blur;
    s.aspect = asp;
    s.sinElevation = el;
    s.night = night;
    s.sunUp = sunUp;
    s.moonUp = moonUp;
    s.weatherExposure = exposure;
    s.cloudDark = cloudDark;
    s.rain = rainW;
    s.snow = snowW;
    s.fog = fog;
    s.haze = haze;
    s.dust = dust * mix(0.3, 1, inten);
    s.storm = storm;
    s.sleet = sleet;
    s.glassRain = glassRain;
    s.glassFrost = glassFrost;
    s.glassMist = glassMist;
    s.rays = rays;
    s.flare = flare;
    s.rainbow = rainbow;
    s.belt = belt;
    s.star = star;
    s.hide = hide;
    s.moonPhase = moonPh;
    s.moonIllumination = moonIllum;
    s.antiSunPos[0] = -sunPos[0];
    s.antiSunPos[1] = -0.84 - sunPos[1];
    s.sunUV[0] = sunPos[0] / asp + 0.5;
    s.sunUV[1] = sunPos[1] + 0.5;
    s.sunrise = sun.sunrise;
    s.sunset = sun.sunset;
    s.elevationDeg = sun.elevationDeg;
    s.gust = 0.5 + storm + 0.3 * rainW;
  }
}

// Weather pulls the clear-sky gradient toward grey, white, brown or black; order matters because each step reads the previous result.
function tintSky(sc: SceneDef, inten: number, dl: number, zen: Vec3, hor: Vec3, b: Vec3): void {
  const rainW = sc.rain ?? 0;
  const snowW = sc.snow ?? 0;
  const fogW = sc.fog ?? 0;
  const hz = sc.haze ?? 0;
  const storm = sc.storm ?? 0;
  if (rainW) {
    const gr = luminance(hor);
    scale(zen, mix(0.8, 0.35, inten * rainW));
    b[0] = gr;
    b[1] = gr;
    b[2] = gr * 1.05;
    mixVec3(hor, hor, b, 0.6 * inten * rainW);
    scale(hor, mix(0.85, 0.45, inten * rainW));
  }
  if (snowW) {
    const k = mix(0.15, 0.6, inten) * snowW;
    b[0] = 0.12 * dl + 0.02;
    b[1] = 0.15 * dl + 0.03;
    b[2] = 0.23 * dl + 0.05;
    mixVec3(zen, zen, b, k);
    b[0] = 0.21 * dl + 0.03;
    b[1] = 0.24 * dl + 0.04;
    b[2] = 0.3 * dl + 0.06;
    mixVec3(hor, hor, b, k);
  }
  if (fogW) {
    const k = 0.55 + 0.4 * inten;
    const g = 0.16 * dl + 0.012;
    b[0] = g * 1.3;
    b[1] = g * 1.36;
    b[2] = g * 1.5;
    mixVec3(zen, zen, b, k);
    b[0] = g * 2.0;
    b[1] = g * 2.05;
    b[2] = g * 2.15;
    mixVec3(hor, hor, b, k);
  }
  if (hz) {
    const k = mix(0.5, 0.85, inten);
    const bright = 0.12 + 0.88 * dl;
    b[0] = 0.55 * bright;
    b[1] = 0.42 * bright;
    b[2] = 0.26 * bright;
    mixVec3(zen, zen, b, k * 0.8);
    b[0] = 0.9 * bright;
    b[1] = 0.64 * bright;
    b[2] = 0.36 * bright;
    mixVec3(hor, hor, b, k);
  }
  if (storm) {
    scale(zen, mix(0.7, 0.4, inten));
    scale(hor, mix(0.75, 0.45, inten));
  }
}

function weatherExposure(
  night: number,
  inten: number,
  rainW: number,
  snowW: number,
  fogW: number,
  hz: number,
  storm: number,
): number {
  return (
    (0.8 + 1.2 * night) *
    (snowW ? mix(0.95, 0.78, inten) : 1) *
    (rainW ? mix(1, 0.82, inten) : 1) *
    (fogW ? 0.95 : 1) *
    (hz ? mix(0.95, 0.8, inten) : 1) *
    (storm ? 0.85 : 1)
  );
}

function scale(v: Vec3, k: number): void {
  v[0] = v[0] * k;
  v[1] = v[1] * k;
  v[2] = v[2] * k;
}
