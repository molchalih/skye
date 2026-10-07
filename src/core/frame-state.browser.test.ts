import { describe, expect, it } from "vitest";
import { Easer } from "./easing.ts";
import { SceneModel, STATIC_TIME_S, type FrameState } from "./frame-state.ts";
import { resolveParams, SCENE_NAMES, type ResolvedParams, type SkyeParams } from "./params.ts";

// The reference file registers the v6 element; _target and _ease need no GL context.
await import("../../test/reference/weather-sky-v6.js");

type Env = Record<string, unknown>;

/** Wraps a v6 element that was never connected; its private members are reached by name through Reflect. */
class V6 {
  readonly el = document.createElement("weather-sky-v6");

  constructor(isStatic: boolean) {
    this.el.setAttribute("motion", isStatic ? "static" : "full");
  }

  size(width: number, height: number): void {
    Reflect.set(this.el, "_cw", width);
    Reflect.set(this.el, "_ch", height);
  }

  /** What attributeChangedCallback does once a context exists. */
  invalidate(): void {
    Reflect.set(this.el, "_envKey", "");
  }

  target(t: number): Env {
    return Reflect.apply(Reflect.get(this.el, "_target"), this.el, [t]);
  }

  ease(env: Env, dt: number): Env {
    return Reflect.apply(Reflect.get(this.el, "_ease"), this.el, [env, dt]);
  }
}

/** FrameState field and the name v6's env uses for it. */
const V6_NAMES: [keyof FrameState, string][] = [
  ["cover", "cov"],
  ["intensity", "inten"],
  ["seed", "seed"],
  ["glass", "glass"],
  ["focus", "focus"],
  ["wind", "wind"],
  ["exposure", "dim"],
  ["blur", "blur"],
  ["aspect", "asp"],
  ["sinElevation", "el"],
  ["night", "night"],
  ["sunPos", "sunPos"],
  ["moonPos", "moonPos"],
  ["zenith", "zen"],
  ["horizon", "hor"],
  ["sunUp", "sunUp"],
  ["moonUp", "moonUp"],
  ["sunColor", "sunCol"],
  ["moonColor", "moonCol"],
  ["lightPos", "LPos"],
  ["lightColor", "LCol"],
  ["weatherExposure", "exposure"],
  ["cloudDark", "cloudDark"],
  ["rain", "rain"],
  ["snow", "snow"],
  ["fog", "fog"],
  ["haze", "haze"],
  ["dust", "dust"],
  ["storm", "storm"],
  ["sleet", "sleet"],
  ["glassRain", "glassRain"],
  ["glassFrost", "glassFrost"],
  ["glassMist", "glassMist"],
  ["rays", "rays"],
  ["flare", "flare"],
  ["rainbow", "rainbow"],
  ["belt", "belt"],
  ["star", "star"],
  ["hide", "hide"],
  ["moonPhase", "moonPhase"],
  ["moonIllumination", "moonIllum"],
  ["antiSunPos", "asun"],
  ["sunUV", "sunUV"],
  ["sunTint", "sunTint"],
  ["sunrise", "sunrise"],
  ["sunset", "sunset"],
  ["elevationDeg", "elDeg"],
  ["gust", "gust"],
];

/** Writes `raw` as v6 attributes, the way a host page would, with no resolving on our side. */
function configureRaw(v6: V6, raw: SkyeParams, aspect: number): void {
  const num = (v: number | undefined): string | undefined =>
    v === undefined ? undefined : String(v);
  const attrs: Record<string, string | undefined> = {
    scene: raw.scene,
    cover: num(raw.cover),
    intensity: num(raw.intensity),
    wind: num(raw.wind),
    seed: num(raw.seed),
    hour: num(raw.hour),
    lat: num(raw.latitude),
    day: num(raw.dayOfYear),
    noon: num(raw.solarNoon),
    moon: num(raw.moonPhase),
    glass: raw.glass === undefined ? undefined : raw.glass ? "1" : "0",
    focus: num(raw.focus),
    dim: num(raw.exposure),
    blur: num(raw.blur),
  };
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined) v6.el.removeAttribute(name);
    else v6.el.setAttribute(name, value);
  }
  v6.size(aspect * 600, 600);
}

function configure(v6: V6, p: ResolvedParams, aspect: number): void {
  configureRaw(v6, p, aspect);
}

// JSON cloning in v6's first-frame copy turns -0 into 0; the sign of zero cannot reach a shader result.
const unsigned = (x: number): number => x + 0;

function numberOf(v: unknown): number {
  if (typeof v !== "number") throw new Error(`expected a number, got ${String(v)}`);
  return v;
}

function numbersOf(v: unknown): number[] {
  if (!Array.isArray(v)) throw new Error(`expected an array, got ${String(v)}`);
  return v.map(numberOf);
}

function expectSame(env: Env, s: Readonly<FrameState>, label: string): void {
  expect(Object.keys(env).sort(), label).toEqual(V6_NAMES.map(([, v6]) => v6).sort());
  expect(V6_NAMES.map(([k]) => k).sort()).toEqual(Object.keys(s).sort());
  for (const [key, name] of V6_NAMES) {
    const got = s[key];
    if (typeof got === "number") {
      expect(unsigned(got), `${label} ${key}`).toBe(unsigned(numberOf(env[name])));
    } else {
      expect(got.map(unsigned), `${label} ${key}`).toEqual(numbersOf(env[name]).map(unsigned));
    }
  }
}

const HOURS = [0.5, 4.3, 5.9, 6.4, 7.2, 12.7, 17.9, 19.1, 20.3, 23.5];
const ASPECTS = [0.56, 1, 1.78, 3.2];

function grid(): {
  hour: number;
  cover: number;
  intensity: number;
  aspect: number;
  glass: boolean;
}[] {
  const out = [];
  for (const hour of HOURS)
    for (const cover of [0, 0.45, 1])
      for (const intensity of [0, 0.5, 1])
        for (const aspect of ASPECTS) out.push({ hour, cover, intensity, aspect, glass: true });
  return out.flatMap((c) => [c, { ...c, glass: false }]);
}

function sceneOf(name: string): ResolvedParams["scene"] {
  const scene = SCENE_NAMES.find((n) => n === name);
  if (scene === undefined) throw new Error(`unknown scene ${name}`);
  return scene;
}

describe("frame state against v6 _target", () => {
  it("matches over scenes x hours x covers x intensities x aspects x glass", () => {
    let n = 0;
    for (const scene of SCENE_NAMES) {
      const v6 = new V6(false);
      const model = new SceneModel();
      let step = 0;
      for (const { aspect, ...rest } of grid()) {
        const p = resolveParams({ scene, ...rest });
        configure(v6, p, aspect);
        // time climbs through the glass fade-in and wraps, hitting cached and recomputed frames
        const t = 5 + (step++ % 90) * 0.37;
        for (const dt of [0, 0.05, 0.3]) {
          expectSame(
            v6.target(t + dt),
            model.target(p, t + dt, aspect, false),
            `${scene} h${rest.hour}`,
          );
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(10_000);
  });

  it("matches with explicit wind, location, date, moon and look params", () => {
    const rng = lcg(7);
    for (const scene of SCENE_NAMES) {
      const v6 = new V6(false);
      const model = new SceneModel();
      for (let i = 0; i < 150; i++) {
        const raw: SkyeParams = {
          scene,
          cover: rng() * 1.4 - 0.2,
          intensity: rng() * 1.4 - 0.2,
          wind: rng() < 0.5 ? rng() * 6 - 1 : undefined,
          seed: Math.floor(rng() * 1000),
          hour: rng() * 60 - 18,
          latitude: rng() * 180 - 90,
          dayOfYear: Math.floor(rng() * 366) + 1,
          solarNoon: 11 + rng() * 3,
          moonPhase: rng() * 2.5 - 0.5,
          glass: rng() < 0.5,
          focus: rng() * 1.3,
          exposure: rng() * 1.6,
          blur: rng() * 80 - 5,
        };
        const p = resolveParams(raw);
        const aspect = 0.4 + rng() * 3;
        // v6 parses and clamps the raw attributes itself; resolveParams must land on the same values
        configureRaw(v6, raw, aspect);
        const t = i * 0.9;
        expectSame(v6.target(t), model.target(p, t, aspect, false), `${scene} #${i}`);
      }
    }
  });

  it("matches in static mode, including the early scene-change clock", () => {
    for (const scene of SCENE_NAMES) {
      const v6 = new V6(true);
      const model = new SceneModel();
      for (const hour of HOURS) {
        for (const glass of [true, false]) {
          const p = resolveParams({ scene, hour, glass, intensity: 0.8, motion: "static" });
          configure(v6, p, 1.6);
          expectSame(v6.target(STATIC_TIME_S), model.target(p, STATIC_TIME_S, 1.6, true), scene);
        }
      }
    }
  });

  it("restarts the glass fade when the scene changes", () => {
    const v6 = new V6(false);
    const model = new SceneModel();
    const seq: [string, number][] = [
      ["rainy", 3],
      ["rainy", 9],
      ["snowy", 12],
      ["snowy", 20],
      ["fog", 21],
      ["fog", 40],
      ["rainy", 41],
      ["rainy", 45],
    ];
    for (const [scene, t] of seq) {
      const p = resolveParams({ scene: sceneOf(scene), intensity: 0.7 });
      configure(v6, p, 1.5);
      expectSame(v6.target(t), model.target(p, t, 1.5, false), `${scene}@${t}`);
    }
  });

  it("reuses the cached state until an input or the quarter-second tick changes", () => {
    const model = new SceneModel();
    const p = resolveParams({ scene: "rainy" });
    const a = model.target(p, 10, 1.5, false);
    const rain = a.glassRain;
    expect(
      model.target(p, 10.2, 1.5, false),
      "same tick returns the model's own state object",
    ).toBe(a);
    expect(model.target(p, 10.2, 1.50003, false).glassRain).toBe(rain);
    expect(model.target(p, 10.3, 1.5, false).glassRain).toBeGreaterThan(rain);
    expect(model.target({ ...p, hour: 3 }, 10.3, 1.5, false).night).toBeGreaterThan(0.9);
  });
});

describe("easer against v6 _ease", () => {
  function run(isStatic: boolean): void {
    const v6 = new V6(isStatic);
    const model = new SceneModel();
    const easer = new Easer();
    const rng = lcg(3);
    let p = resolveParams({ scene: "rainy", hour: 14, cover: 0.3, intensity: 0.4 });
    let t = 2;
    for (let i = 0; i < 160; i++) {
      if (i === 30) p = resolveParams({ scene: "rainy", hour: 21.5, cover: 0.9, intensity: 0.9 });
      if (i === 55) p = { ...p, blur: 12 };
      if (i === 62) p = { ...p, blur: 3 };
      if (i === 90) p = { ...p, blur: 0 };
      if (i === 100) p = resolveParams({ scene: "snowy", hour: 6.3, cover: 0.2, intensity: 0.3 });
      if (i === 120) p = resolveParams({ scene: "clear", hour: 6.3, wind: 2.5, blur: 40 });
      const dt = 0.004 + rng() * 0.1;
      t += dt;
      configure(v6, p, 1.7);
      v6.invalidate();
      model.invalidate();
      const env = v6.target(isStatic ? STATIC_TIME_S : t);
      const cur = v6.ease(env, dt);
      const state = easer.step(
        model.target(p, isStatic ? STATIC_TIME_S : t, 1.7, isStatic),
        dt,
        isStatic,
      );
      expectSame(cur, state, `step ${i}`);
      expect(state).toBe(easer.current);
    }
  }

  it("follows the chase and the blur tween over 160 steps with param changes", () => run(false));
  it("copies the target every step in static mode", () => run(true));

  it("snaps to the target again after reset", () => {
    const model = new SceneModel();
    const easer = new Easer();
    const a = resolveParams({ scene: "clear", hour: 12 });
    const b = resolveParams({ scene: "clear", hour: 2 });
    easer.step(model.target(a, 1, 1.5, false), 0.016, false);
    easer.step(model.target(b, 1.1, 1.5, false), 0.016, false);
    expect(easer.current.night).not.toBe(model.target(b, 1.1, 1.5, false).night);
    easer.reset();
    easer.step(model.target(b, 1.2, 1.5, false), 0.016, false);
    expect(easer.current.night).toBe(model.target(b, 1.2, 1.5, false).night);
  });
});

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
