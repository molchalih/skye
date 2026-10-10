import { describe, expect, it } from "vitest";
import { expectClose } from "../../test/support/close.ts";
import { antisolarPoint, sunInTexture } from "./celestial.ts";
import { STATIC_TIME_S, type FrameState } from "./frame-state.ts";
import type { Vec2 } from "./math.ts";
import { resolveParams, SCENE_NAMES, type ResolvedParams, type SkyeParams } from "./params.ts";
import { SceneModel } from "./scene-model.ts";

// The reference file registers the v6 element; _target needs no GL context.
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

  /**
   * v6's target at exactly `t`. v6 caches its target for a quarter second
   * and computes it at the first call in each; dropping the cache before
   * every call makes it compute at `t`, as skye does every frame.
   */
  target(t: number): Env {
    Reflect.set(this.el, "_envKey", "");
    return Reflect.apply(Reflect.get(this.el, "_target"), this.el, [t]);
  }
}

/** The model's state for `params` at time `t`. */
function target(
  model: SceneModel,
  params: ResolvedParams,
  aspect: number,
  t: number,
  isStatic = false,
): Readonly<FrameState> {
  model.configure(params, aspect);
  return model.target({ seconds: t, dt: 1 / 60, isStatic });
}

type Read = (s: Readonly<FrameState>) => number | readonly number[];

const scratch: Vec2 = [0, 0];

/**
 * Each value v6's target holds that skye draws, under v6's name. v6 also
 * keeps sunrise, sunset, the elevation in degrees, the moon's lit fraction
 * and the glass flag, which no pass reads; skye derives the antisolar point
 * and the sun's texture position from the sun's position as it draws.
 */
const V6_NAMES: readonly [string, Read][] = [
  ["asp", (s) => s.aspect],
  ["dim", (s) => s.exposure],
  ["focus", (s) => s.focus],
  ["seed", (s) => s.seed],
  ["blur", (s) => s.blur],
  ["sunPos", (s) => s.sun.position],
  ["sunCol", (s) => s.sun.color],
  ["sunUp", (s) => s.sun.visibility],
  ["el", (s) => s.sun.sinElevation],
  ["sunTint", (s) => s.sun.tint],
  ["moonPos", (s) => s.moon.position],
  ["moonCol", (s) => s.moon.color],
  ["moonUp", (s) => s.moon.visibility],
  ["moonPhase", (s) => s.moon.phase],
  ["LPos", (s) => s.light.position],
  ["LCol", (s) => s.light.color],
  ["night", (s) => s.night],
  ["zen", (s) => s.zenith],
  ["hor", (s) => s.horizon],
  ["exposure", (s) => s.sceneExposure],
  ["cov", (s) => s.cover],
  ["inten", (s) => s.intensity],
  ["cloudDark", (s) => s.cloudDarkness],
  ["wind", (s) => s.wind],
  ["gust", (s) => s.gustiness],
  ["rain", (s) => s.rain],
  ["snow", (s) => s.snow],
  ["sleet", (s) => s.sleet],
  ["storm", (s) => s.storm],
  ["fog", (s) => s.fog],
  ["haze", (s) => s.haze],
  ["dust", (s) => s.dust],
  ["rays", (s) => s.rays],
  ["flare", (s) => s.flare],
  ["rainbow", (s) => s.rainbow],
  ["belt", (s) => s.twilightBelt],
  ["star", (s) => s.stars],
  ["hide", (s) => s.sunHidden],
  ["glassRain", (s) => s.glassRain],
  ["glassFrost", (s) => s.glassFrost],
  ["glassMist", (s) => s.glassMist],
  ["asun", (s) => [...antisolarPoint(scratch, s.sun.position)]],
  ["sunUV", (s) => [...sunInTexture(scratch, s)]],
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

function numberOf(v: unknown): number {
  if (typeof v !== "number") throw new Error(`expected a number, got ${String(v)}`);
  return v;
}

function numbersOf(v: unknown): number[] {
  if (!Array.isArray(v)) throw new Error(`expected an array, got ${String(v)}`);
  return v.map(numberOf);
}

// Every drawn value equal to v6's up to the rounding of another order of operations (test/support/close.ts).
function expectSame(env: Env, s: Readonly<FrameState>, label: string): void {
  for (const [name, read] of V6_NAMES) {
    const got = read(s);
    const want = env[name];
    expectClose(
      got,
      typeof got === "number" ? numberOf(want) : numbersOf(want),
      `${label} ${name}`,
    );
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

describe("scene model against v6 _target", () => {
  it("matches over scenes x hours x covers x intensities x aspects x glass", () => {
    let n = 0;
    for (const scene of SCENE_NAMES) {
      const v6 = new V6(false);
      const model = new SceneModel();
      let step = 0;
      for (const { aspect, ...rest } of grid()) {
        const p = resolveParams({ scene, ...rest });
        configureRaw(v6, p, aspect);
        // time climbs through the glass's build-up and wraps
        const t = 5 + (step++ % 90) * 0.37;
        for (const dt of [0, 0.05, 0.3]) {
          expectSame(v6.target(t + dt), target(model, p, aspect, t + dt), `${scene} h${rest.hour}`);
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
        const aspect = 0.4 + rng() * 3;
        // v6 parses and clamps the raw attributes itself; resolveParams must land on the same values
        configureRaw(v6, raw, aspect);
        const t = i * 0.9;
        expectSame(v6.target(t), target(model, resolveParams(raw), aspect, t), `${scene} #${i}`);
      }
    }
  });

  it("matches in static mode, with the glass built up", () => {
    for (const scene of SCENE_NAMES) {
      const v6 = new V6(true);
      const model = new SceneModel();
      for (const hour of HOURS) {
        for (const glass of [true, false]) {
          const p = resolveParams({ scene, hour, glass, intensity: 0.8, motion: "static" });
          configureRaw(v6, p, 1.6);
          expectSame(
            v6.target(STATIC_TIME_S),
            target(model, p, 1.6, STATIC_TIME_S, true),
            `${scene} h${hour}`,
          );
        }
      }
    }
  });

  it("builds the glass up again when the scene changes", () => {
    const v6 = new V6(false);
    const model = new SceneModel();
    const seq: [ResolvedParams["scene"], number][] = [
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
      const p = resolveParams({ scene, intensity: 0.7 });
      configureRaw(v6, p, 1.5);
      expectSame(v6.target(t), target(model, p, 1.5, t), `${scene}@${t}`);
    }
  });
});

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
