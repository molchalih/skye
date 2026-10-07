import { afterEach, describe, expect, it, vi } from "vitest";
import { createFrameState } from "./frame-state.ts";
import { computeLayout, createLayout, fpsCap } from "./layout.ts";
import { Lightning } from "./lightning.ts";
import { createRandom } from "./random.ts";
import { TIERS } from "./tables.ts";

await import("../../test/reference/weather-sky-v6.js");

type Env = Record<string, number>;

afterEach(() => {
  vi.restoreAllMocks();
});

function call(el: HTMLElement, name: string, ...args: unknown[]): unknown {
  return Reflect.apply(Reflect.get(el, name), el, args);
}

function readRecord(el: HTMLElement, name: string): Record<string, unknown> {
  const value: unknown = Reflect.get(el, name);
  if (typeof value !== "object" || value === null) throw new Error(`${name} is not an object`);
  return Object.fromEntries(Object.entries(value));
}

describe("Lightning against v6", () => {
  it("matches _lightning over 2000 frames with strikes", () => {
    const el = document.createElement("weather-sky-v6");
    const v6Random = createRandom(11);
    const mineRandom = createRandom(11);
    const mine = new Lightning();
    const state = createFrameState();
    let strikes = 0;
    let lastStart = -1;
    for (let f = 0; f < 2000; f++) {
      const t = f * 0.5;
      const phase = Math.floor(f / 250) % 4;
      const env: Env =
        phase === 0
          ? { storm: 1, inten: 0.9, rain: 1, asp: 1.6 }
          : phase === 1
            ? { storm: 0, inten: 0.8, rain: 1, asp: 1.6 }
            : phase === 2
              ? { storm: 0.5, inten: 0.4, rain: 0.7, asp: 2.2 }
              : { storm: 0, inten: 0.2, rain: 0.1, asp: 1.6 };
      state.storm = env.storm ?? 0;
      state.intensity = env.inten ?? 0;
      state.rain = env.rain ?? 0;
      state.aspect = env.asp ?? 0;
      vi.spyOn(Math, "random").mockImplementation(v6Random);
      const expected = call(el, "_lightning", t, env);
      vi.restoreAllMocks();
      const got = mine.step(t, state, mineRandom);
      const bolt = readRecord(el, "_bolt");
      expect(got).toBe(expected);
      expect(mine.bolt).toBe(bolt.bolt);
      expect(mine.seed).toBe(bolt.seed);
      expect(mine.position).toEqual(bolt.pos);
      const start = Number(bolt.start);
      if (start !== lastStart) {
        lastStart = start;
        strikes++;
      }
    }
    expect(strikes).toBeGreaterThan(10);
  });
});

describe("computeLayout against v6", () => {
  it("matches _layout sizes over a blur fade at DPR 1, 2 and 3", () => {
    for (const dpr of [1, 2, 3]) {
      for (const tierIndex of [0, 1, 2]) {
        const tier = TIERS[tierIndex] ?? TIERS[1];
        vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(dpr);
        const el = document.createElement("weather-sky-v6");
        el.setAttribute("quality", tier.name);
        const cv = { width: 0, height: 0 };
        Reflect.set(el, "_cv", cv);
        Reflect.set(el, "_alloc", () => undefined);
        Reflect.set(el, "_cw", 731);
        Reflect.set(el, "_ch", 417);
        const mine = createLayout();
        let dsc = 1;
        // Fade 0 -> 48 (eased up to target), hold, then fade back down to 0 and up to a new target.
        const targets: [number, number][] = [];
        for (const [from, to, tgt] of [
          [0, 48, 48],
          [48, 48, 48],
          [48, 0, 0],
          [0, 5, 5],
          [5, 12, 12],
          [12, 0, 0],
        ] as const) {
          for (let i = 0; i <= 40; i++) targets.push([from + ((to - from) * i) / 40, tgt]);
        }
        for (const [eased, tgt] of targets) {
          el.setAttribute("blur", String(tgt));
          call(el, "_layout", { blur: eased });
          const s = readRecord(el, "_sizes");
          computeLayout(
            {
              cssWidth: 731,
              cssHeight: 417,
              devicePixelRatio: dpr,
              tier,
              blurEased: eased,
              blurTarget: tgt,
            },
            dsc,
            mine,
          );
          dsc = mine.detailScale;
          expect(mine.width).toBe(s.W);
          expect(mine.height).toBe(s.H);
          expect(mine.canvasWidth).toBe(s.cw);
          expect(mine.canvasHeight).toBe(s.ch);
          expect(cv.width).toBe(s.cw);
          expect(cv.height).toBe(s.ch);
          expect(mine.blurWidth).toBe(s.bw);
          expect(mine.blurHeight).toBe(s.bh);
          expect(mine.skyWidth).toBe(s.skyW);
          expect(mine.skyHeight).toBe(s.skyH);
          expect(mine.sceneWidth).toBe(s.sceneW);
          expect(mine.sceneHeight).toBe(s.sceneH);
          expect(mine.blurScale).toBe(s.bq);
          expect(mine.blurring).toBe(s.blurring);
          expect(mine.shrink).toBe(s.shrink);
          expect(mine.sigma).toBe(s.sigma);
          expect(mine.particleScale).toBe(s.pscale);
          expect(mine.detail).toBe(s.detail);
          expect(fpsCap(tier.fps, mine)).toBe(call(el, "_fpsCap"));
        }
        vi.restoreAllMocks();
      }
    }
  });
});
