import type { Gpu } from "../gl/context.ts";
import type { Program } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import * as glsl from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

function declareUniforms(p: Program) {
  return {
    uRes: p.vec2(glsl.SKY_uRes),
    uSunPos: p.vec2(glsl.SKY_uSunPos),
    uMoonPos: p.vec2(glsl.SKY_uMoonPos),
    uLPos: p.vec2(glsl.SKY_uLPos),
    uFlashPos: p.vec2(glsl.SKY_uFlashPos),
    uASun: p.vec2(glsl.SKY_uASun),
    uBoltPos: p.vec2(glsl.SKY_uBoltPos),
    uTime: p.float(glsl.SKY_uTime),
    uWindT: p.float(glsl.SKY_uWindT),
    uCover: p.float(glsl.SKY_uCover),
    uSeed: p.float(glsl.SKY_uSeed),
    uNight: p.float(glsl.SKY_uNight),
    uFlash: p.float(glsl.SKY_uFlash),
    uCloudDark: p.float(glsl.SKY_uCloudDark),
    uEl: p.float(glsl.SKY_uEl),
    uSunUp: p.float(glsl.SKY_uSunUp),
    uRainy: p.float(glsl.SKY_uRainy),
    uSnowy: p.float(glsl.SKY_uSnowy),
    uEnc: p.float(glsl.SKY_uEnc),
    uFog: p.float(glsl.SKY_uFog),
    uHaze: p.float(glsl.SKY_uHaze),
    uBolt: p.float(glsl.SKY_uBolt),
    uBoltSeed: p.float(glsl.SKY_uBoltSeed),
    uRainbow: p.float(glsl.SKY_uRainbow),
    uMoonPhase: p.float(glsl.SKY_uMoonPhase),
    uBelt: p.float(glsl.SKY_uBelt),
    uStar: p.float(glsl.SKY_uStar),
    uStorm: p.float(glsl.SKY_uStorm),
    uSunCol: p.vec3(glsl.SKY_uSunCol),
    uMoonCol: p.vec3(glsl.SKY_uMoonCol),
    uLCol: p.vec3(glsl.SKY_uLCol),
    uZenith: p.vec3(glsl.SKY_uZenith),
    uHorizon: p.vec3(glsl.SKY_uHorizon),
    uStart: p.int(glsl.SKY_uStart),
    uEnd: p.int(glsl.SKY_uEnd),
    uOctCap: p.int(glsl.SKY_uOctCap),
  };
}

/** Pass 1: gradients, glows, Milky Way, cloud sheets, fog, rainbow and bolt glow into the small HDR sky buffer. */
export class SkyPass {
  readonly program: Program;
  readonly #u: ReturnType<typeof declareUniforms>;

  constructor(gpu: Gpu) {
    this.program = gpu.program(glsl.FULLSCREEN_VS, glsl.SKY_FS);
    this.#u = declareUniforms(this.program);
  }

  draw(gpu: Gpu, f: PassFrame, out: Target): void {
    const { state: s, layout: l, tier: q, bolt: b } = f;
    const u = this.#u;
    this.program.use();
    gpu.bindOutput(out, l.skyWidth, l.skyHeight);
    gpu.blend(false);
    u.uRes.value[0] = l.skyWidth;
    u.uRes.value[1] = l.skyHeight;
    u.uSunPos.value.set(s.sunPos);
    u.uMoonPos.value.set(s.moonPos);
    u.uLPos.value.set(s.lightPos);
    u.uFlashPos.value.set(b.position);
    u.uASun.value.set(s.antiSunPos);
    u.uBoltPos.value.set(b.position);
    u.uTime.value = f.time;
    u.uWindT.value = f.windT;
    u.uCover.value = s.cover;
    u.uSeed.value = s.seed;
    u.uNight.value = s.night;
    u.uFlash.value = f.flash;
    u.uCloudDark.value = s.cloudDark;
    u.uEl.value = s.sinElevation;
    u.uSunUp.value = s.sunUp;
    u.uRainy.value = s.rain * s.intensity;
    u.uSnowy.value = s.snow * s.intensity;
    u.uEnc.value = f.enc;
    u.uFog.value = s.fog;
    u.uHaze.value = s.haze;
    u.uBolt.value = b.bolt;
    u.uBoltSeed.value = b.seed;
    u.uRainbow.value = s.rainbow;
    u.uMoonPhase.value = s.moonPhase;
    u.uBelt.value = s.belt;
    u.uStar.value = s.star;
    u.uStorm.value = s.storm;
    u.uSunCol.value.set(s.sunColor);
    u.uMoonCol.value.set(s.moonColor);
    u.uLCol.value.set(s.lightColor);
    u.uZenith.value.set(s.zenith);
    u.uHorizon.value.set(s.horizon);
    u.uStart.value = q.start;
    u.uEnd.value = q.end;
    u.uOctCap.value = q.oct;
    gpu.drawFullscreen(this.program);
    f.pixels += l.skyWidth * l.skyHeight;
    f.passes++;
  }
}
