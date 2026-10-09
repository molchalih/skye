import type { Gpu } from "../gl/context.ts";
import type { Program } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import * as glsl from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";
import { raysActive } from "./rays.ts";

function declareUniforms(p: Program) {
  return {
    uRaysTex: p.int(glsl.GLASS_uRaysTex),
    uRes: p.vec2(glsl.GLASS_uRes),
    uSunUV: p.vec2(glsl.GLASS_uSunUV),
    uTime: p.float(glsl.GLASS_uTime),
    uRainG: p.float(glsl.GLASS_uRainG),
    uFrost: p.float(glsl.GLASS_uFrost),
    uMist: p.float(glsl.GLASS_uMist),
    uFlash: p.float(glsl.GLASS_uFlash),
    uExposure: p.float(glsl.GLASS_uExposure),
    uSeed: p.float(glsl.GLASS_uSeed),
    uEnc: p.float(glsl.GLASS_uEnc),
    uDim: p.float(glsl.GLASS_uDim),
    uWet: p.float(glsl.GLASS_uWet),
    uRays: p.float(glsl.GLASS_uRays),
    uFlare: p.float(glsl.GLASS_uFlare),
    uSunTint: p.vec3(glsl.GLASS_uSunTint),
    uDetail: p.float(glsl.GLASS_uDetail),
  };
}

/**
 * Pass 4: rain, frost and mist on the glass, rays, lens flare, exposure and
 * tone mapping. Writes to the canvas, or to `out` when the blur chain follows.
 */
export class GlassPass {
  readonly program: Program;
  readonly #u: ReturnType<typeof declareUniforms>;

  constructor(gpu: Gpu) {
    this.program = gpu.program(glsl.FULLSCREEN_VS, glsl.GLASS_FS);
    this.#u = declareUniforms(this.program);
    this.#u.uRaysTex.value = 1;
  }

  /**
   * Mid-fade the glass renders at full canvas size so its fine detail survives;
   * once the blur has settled it renders at the small blur-chain size.
   */
  draw(gpu: Gpu, f: PassFrame, scene: Target, rays: Target, out: Target | null): void {
    const { state: s, layout: l } = f;
    const width = l.shrink ? l.blurWidth : l.canvasWidth;
    const height = l.shrink ? l.blurHeight : l.canvasHeight;
    const u = this.#u;
    this.program.use();
    gpu.bindOutput(out, width, height);
    gpu.bindTexture(1, rays);
    gpu.bindTexture(0, scene);
    u.uRes.value[0] = width;
    u.uRes.value[1] = height;
    u.uSunUV.value.set(s.sunUV);
    u.uTime.value = f.time;
    u.uRainG.value = s.glassRain;
    u.uFrost.value = s.glassFrost;
    u.uMist.value = s.glassMist;
    u.uFlash.value = f.flash;
    u.uExposure.value = s.weatherExposure;
    u.uSeed.value = s.seed;
    u.uEnc.value = f.enc;
    u.uDim.value = s.exposure;
    u.uWet.value = 0.32 * s.glassRain;
    u.uRays.value = raysActive(f) ? s.rays : 0;
    u.uFlare.value = s.flare;
    u.uSunTint.value.set(s.sunTint);
    u.uDetail.value = l.detail;
    gpu.drawFullscreen(this.program);
    f.pixels += width * height;
    f.passes++;
  }
}
