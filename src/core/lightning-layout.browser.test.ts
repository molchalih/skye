import { afterEach, describe, expect, it, vi } from "vitest";
import { expectClose } from "../../test/support/close.ts";
import { createFrameState, type FrameTime } from "./frame-state.ts";
import { computeLayout, createLayout, fpsCap } from "./layout.ts";
import { Lightning } from "./lightning.ts";
import { createRandom } from "./random.ts";
import { TIERS } from "./tiers.ts";

await import("../../test/reference/weather-sky-v6.js");

type Env = Record<string, number>;

afterEach(() => {
  vi.restoreAllMocks();
});

function call(el: HTMLElement, name: string, ...args: unknown[]): unknown {
  return Reflect.apply(Reflect.get(el, name), el, args);
}

function numbers(v: unknown): number[] {
  if (!Array.isArray(v)) throw new Error(`expected an array, got ${String(v)}`);
  return v.map(Number);
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
    const time: FrameTime = { seconds: 0, dt: 0.5, isStatic: false };
    // Strike times exactly; the values in between to float32 precision (test/support/close.ts).
    const v6Strikes: number[] = [];
    const strikes: number[] = [];
    let lastStart = -1;
    let lastPosition = mine.position.join();
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
      time.seconds = t;
      mine.step(time, state, mineRandom);
      const bolt = readRecord(el, "_bolt");
      expectClose(mine.flash, Number(expected), `flash at frame ${f}`);
      expectClose(mine.bolt, Number(bolt.bolt), `bolt at frame ${f}`);
      expectClose(mine.seed, Number(bolt.seed), `bolt seed at frame ${f}`);
      expectClose(mine.position, numbers(bolt.pos), `bolt position at frame ${f}`);
      const start = Number(bolt.start);
      if (start !== lastStart && start >= 0) v6Strikes.push(start);
      lastStart = start;
      // Each strike draws a new bolt position, so a new position marks one.
      const position = mine.position.join();
      if (position !== lastPosition) strikes.push(t);
      lastPosition = position;
    }
    expect(strikes).toEqual(v6Strikes);
    expect(strikes.length).toBeGreaterThan(10);
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
              blur: eased,
              blurTarget: tgt,
            },
            mine,
          );
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
          expectClose(mine.blurScale, Number(s.bq), "blur scale");
          expect(mine.blurring).toBe(s.blurring);
          expect(mine.shrink).toBe(s.shrink);
          expectClose(mine.sigma, Number(s.sigma), "sigma");
          expectClose(mine.particleScale, Number(s.pscale), "particle scale");
          expectClose(mine.detail, Number(s.detail), "detail");
          expect(fpsCap(tier, mine)).toBe(call(el, "_fpsCap"));
        }
        vi.restoreAllMocks();
      }
    }
  });
});
