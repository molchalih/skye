import type { Gpu, Sampled } from "../gl/context.ts";
import type { Program, Values } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import * as glsl from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";
import { raysActive } from "./rays.ts";

/** How much rain on the glass blurs the view behind it, where no drop or trail has cleared it. */
const WET_SHEEN = 0.32;

/**
 * The glass: rain, frost and mist on the glass, rays, lens flare, exposure and
 * tone mapping. Writes to the canvas, or to `out` when the blur chain follows.
 * Samples the scene on unit 0, the rays on unit 1 and, for the frost's value
 * noise, the sky's noise texture on unit 2.
 */
export class GlassPass {
  readonly program: Program<"GLASS">;
  readonly #v: Values<"GLASS">;

  constructor(gpu: Gpu) {
    this.program = gpu.program(glsl.FULLSCREEN_VS, glsl.GLASS_FS, glsl.GLASS_UNIFORMS);
    this.#v = this.program.values;
    this.#v[glsl.GLASS_uNoise] = 2;
    this.#v[glsl.GLASS_uRaysTex] = 1;
  }

  /**
   * Mid-fade the glass renders at full canvas size so its fine detail survives;
   * once the blur has settled it renders at the small blur-chain size.
   */
  draw(
    gpu: Gpu,
    f: PassFrame,
    scene: Target,
    rays: Target,
    out: Target | null,
    noise: Sampled,
  ): void {
    const { state: s, layout: l } = f;
    const width = l.shrink ? l.blurWidth : l.canvasWidth;
    const height = l.shrink ? l.blurHeight : l.canvasHeight;
    const v = this.#v;
    this.program.use();
    gpu.bindOutput(out, width, height);
    gpu.bindTexture(2, noise);
    gpu.bindTexture(1, rays);
    gpu.bindTexture(0, scene);
    v[glsl.GLASS_uRes] = width;
    v[glsl.GLASS_uRes + 1] = height;
    v.set(f.sunUV, glsl.GLASS_uSunUV);
    v[glsl.GLASS_uTime] = f.seconds;
    v[glsl.GLASS_uRainG] = s.glassRain;
    v[glsl.GLASS_uFrost] = s.glassFrost;
    v[glsl.GLASS_uMist] = s.glassMist;
    v[glsl.GLASS_uFlash] = f.lightning.flash;
    v[glsl.GLASS_uExposure] = s.sceneExposure;
    v[glsl.GLASS_uSeed] = s.seed;
    v[glsl.GLASS_uEnc] = f.encoding;
    v[glsl.GLASS_uDim] = s.exposure;
    v[glsl.GLASS_uWet] = WET_SHEEN * s.glassRain;
    v[glsl.GLASS_uRays] = raysActive(f) ? s.rays : 0;
    v[glsl.GLASS_uFlare] = s.flare;
    v.set(s.sun.tint, glsl.GLASS_uSunTint);
    v[glsl.GLASS_uDetail] = l.detail;
    gpu.drawFullscreen(this.program);
    f.pixels += width * height;
    f.passes++;
  }
}
