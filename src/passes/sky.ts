import type { Gpu, Sampled } from "../gl/context.ts";
import type { Program, Values } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import * as glsl from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

/**
 * Pass 1: gradients, glows, Milky Way, cloud sheets, fog, rainbow and bolt glow into the small HDR sky buffer. The
 * Milky Way, the clouds and the mist read their noise from `noise` on unit 0, which linking sets `uNoise` to.
 */
export class SkyPass {
  readonly program: Program<"SKY">;
  readonly #v: Values<"SKY">;

  constructor(gpu: Gpu) {
    this.program = gpu.program(glsl.FULLSCREEN_VS, glsl.SKY_FS, glsl.SKY_UNIFORMS);
    this.#v = this.program.values;
  }

  draw(gpu: Gpu, f: PassFrame, noise: Sampled, out: Target): void {
    const { state: s, layout: l, tier: q, bolt: b } = f;
    const v = this.#v;
    this.program.use();
    gpu.bindOutput(out, l.skyWidth, l.skyHeight);
    gpu.blend(false);
    gpu.bindTexture(0, noise);
    v[glsl.SKY_uRes] = l.skyWidth;
    v[glsl.SKY_uRes + 1] = l.skyHeight;
    v.set(s.sunPos, glsl.SKY_uSunPos);
    v.set(s.moonPos, glsl.SKY_uMoonPos);
    v.set(s.lightPos, glsl.SKY_uLPos);
    v.set(b.position, glsl.SKY_uFlashPos);
    v.set(s.antiSunPos, glsl.SKY_uASun);
    v.set(b.position, glsl.SKY_uBoltPos);
    v[glsl.SKY_uTime] = f.time;
    v[glsl.SKY_uWindT] = f.windT;
    v[glsl.SKY_uCover] = s.cover;
    v[glsl.SKY_uSeed] = s.seed;
    v[glsl.SKY_uNight] = s.night;
    v[glsl.SKY_uFlash] = f.flash;
    v[glsl.SKY_uCloudDark] = s.cloudDark;
    v[glsl.SKY_uEl] = s.sinElevation;
    v[glsl.SKY_uSunUp] = s.sunUp;
    v[glsl.SKY_uRainy] = s.rain * s.intensity;
    v[glsl.SKY_uSnowy] = s.snow * s.intensity;
    v[glsl.SKY_uEnc] = f.enc;
    v[glsl.SKY_uFog] = s.fog;
    v[glsl.SKY_uHaze] = s.haze;
    v[glsl.SKY_uBolt] = b.bolt;
    v[glsl.SKY_uBoltSeed] = b.seed;
    v[glsl.SKY_uRainbow] = s.rainbow;
    v[glsl.SKY_uMoonPhase] = s.moonPhase;
    v[glsl.SKY_uBelt] = s.belt;
    v[glsl.SKY_uStar] = s.star;
    v[glsl.SKY_uStorm] = s.storm;
    v.set(s.sunColor, glsl.SKY_uSunCol);
    v.set(s.moonColor, glsl.SKY_uMoonCol);
    v.set(s.lightColor, glsl.SKY_uLCol);
    v.set(s.zenith, glsl.SKY_uZenith);
    v.set(s.horizon, glsl.SKY_uHorizon);
    v[glsl.SKY_uStart] = q.start;
    v[glsl.SKY_uEnd] = q.end;
    v[glsl.SKY_uOctCap] = q.oct;
    gpu.drawFullscreen(this.program);
    f.pixels += l.skyWidth * l.skyHeight;
    f.passes++;
  }
}
