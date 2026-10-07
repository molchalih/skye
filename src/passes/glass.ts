import type { Gpu } from "../gl/context.ts";
import type { Program } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import { FULLSCREEN_VS, GLASS_FS } from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";
import { raysActive } from "./rays.ts";

function declareUniforms(p: Program) {
  return {
    uScene: p.uniform("uScene"),
    uRaysTex: p.uniform("uRaysTex"),
    uRes: p.uniform("uRes"),
    uSunUV: p.uniform("uSunUV"),
    uTime: p.uniform("uTime"),
    uRainG: p.uniform("uRainG"),
    uFrost: p.uniform("uFrost"),
    uMist: p.uniform("uMist"),
    uFlash: p.uniform("uFlash"),
    uExposure: p.uniform("uExposure"),
    uSeed: p.uniform("uSeed"),
    uEnc: p.uniform("uEnc"),
    uDim: p.uniform("uDim"),
    uWet: p.uniform("uWet"),
    uRays: p.uniform("uRays"),
    uFlare: p.uniform("uFlare"),
    uSunTint: p.uniform("uSunTint"),
    uDetail: p.uniform("uDetail"),
  };
}

/**
 * Pass 4: rain, frost and mist on the glass, rays, lens flare, exposure and
 * tone mapping. Writes to the canvas, or to `out` when the blur chain follows.
 */
export class GlassPass {
  readonly program: Program;
  private readonly u: ReturnType<typeof declareUniforms>;

  constructor(gpu: Gpu) {
    this.program = gpu.program(FULLSCREEN_VS, GLASS_FS);
    this.u = declareUniforms(this.program);
  }

  /**
   * Mid-fade the glass renders at full canvas size so its fine detail survives;
   * once the blur has settled it renders at the small blur-chain size.
   */
  draw(gpu: Gpu, f: PassFrame, scene: Target, rays: Target, out: Target | null): void {
    const { state: s, layout: l } = f;
    const width = l.shrink ? l.blurWidth : l.canvasWidth;
    const height = l.shrink ? l.blurHeight : l.canvasHeight;
    const u = this.u;
    this.program.use();
    gpu.bindOutput(out, width, height);
    gpu.bindTexture(1, rays);
    u.uRaysTex.int(1);
    gpu.bindTexture(0, scene);
    u.uScene.int(0);
    u.uRes.vec2(width, height);
    u.uSunUV.vec2(s.sunUV[0], s.sunUV[1]);
    u.uTime.float(f.time);
    u.uRainG.float(s.glassRain);
    u.uFrost.float(s.glassFrost);
    u.uMist.float(s.glassMist);
    u.uFlash.float(f.flash);
    u.uExposure.float(s.weatherExposure);
    u.uSeed.float(s.seed);
    u.uEnc.float(f.enc);
    u.uDim.float(s.exposure);
    u.uWet.float(0.32 * s.glassRain);
    u.uRays.float(raysActive(f) ? s.rays : 0);
    u.uFlare.float(s.flare);
    u.uSunTint.vec3(s.sunTint[0], s.sunTint[1], s.sunTint[2]);
    u.uDetail.float(l.detail);
    gpu.drawFullscreen();
    f.pixels += width * height;
    f.passes++;
  }
}
