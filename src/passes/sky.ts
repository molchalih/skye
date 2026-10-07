import type { Gpu } from "../gl/context.ts";
import type { Program } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import { FULLSCREEN_VS, SKY_FS } from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

function declareUniforms(p: Program) {
  return {
    uRes: p.uniform("uRes"),
    uSunPos: p.uniform("uSunPos"),
    uMoonPos: p.uniform("uMoonPos"),
    uLPos: p.uniform("uLPos"),
    uFlashPos: p.uniform("uFlashPos"),
    uASun: p.uniform("uASun"),
    uBoltPos: p.uniform("uBoltPos"),
    uTime: p.uniform("uTime"),
    uWindT: p.uniform("uWindT"),
    uCover: p.uniform("uCover"),
    uSeed: p.uniform("uSeed"),
    uNight: p.uniform("uNight"),
    uFlash: p.uniform("uFlash"),
    uCloudDark: p.uniform("uCloudDark"),
    uEl: p.uniform("uEl"),
    uSunUp: p.uniform("uSunUp"),
    uRainy: p.uniform("uRainy"),
    uSnowy: p.uniform("uSnowy"),
    uEnc: p.uniform("uEnc"),
    uFog: p.uniform("uFog"),
    uHaze: p.uniform("uHaze"),
    uBolt: p.uniform("uBolt"),
    uBoltSeed: p.uniform("uBoltSeed"),
    uRainbow: p.uniform("uRainbow"),
    uMoonPhase: p.uniform("uMoonPhase"),
    uBelt: p.uniform("uBelt"),
    uStar: p.uniform("uStar"),
    uStorm: p.uniform("uStorm"),
    uSunCol: p.uniform("uSunCol"),
    uMoonCol: p.uniform("uMoonCol"),
    uLCol: p.uniform("uLCol"),
    uZenith: p.uniform("uZenith"),
    uHorizon: p.uniform("uHorizon"),
    uStart: p.uniform("uStart"),
    uEnd: p.uniform("uEnd"),
    uOctCap: p.uniform("uOctCap"),
  };
}

/** Pass 1: gradients, glows, Milky Way, cloud sheets, fog, rainbow and bolt glow into the small HDR sky buffer. */
export class SkyPass {
  readonly program: Program;
  private readonly u: ReturnType<typeof declareUniforms>;

  constructor(gpu: Gpu) {
    this.program = gpu.program(FULLSCREEN_VS, SKY_FS);
    this.u = declareUniforms(this.program);
  }

  draw(gpu: Gpu, f: PassFrame, out: Target): void {
    const { state: s, layout: l, tier: q, bolt: b } = f;
    const u = this.u;
    this.program.use();
    gpu.bindOutput(out, l.skyWidth, l.skyHeight);
    gpu.blend(false);
    u.uRes.vec2(l.skyWidth, l.skyHeight);
    u.uSunPos.vec2(s.sunPos[0], s.sunPos[1]);
    u.uMoonPos.vec2(s.moonPos[0], s.moonPos[1]);
    u.uLPos.vec2(s.lightPos[0], s.lightPos[1]);
    u.uFlashPos.vec2(b.position[0], b.position[1]);
    u.uASun.vec2(s.antiSunPos[0], s.antiSunPos[1]);
    u.uBoltPos.vec2(b.position[0], b.position[1]);
    u.uTime.float(f.time);
    u.uWindT.float(f.windT);
    u.uCover.float(s.cover);
    u.uSeed.float(s.seed);
    u.uNight.float(s.night);
    u.uFlash.float(f.flash);
    u.uCloudDark.float(s.cloudDark);
    u.uEl.float(s.sinElevation);
    u.uSunUp.float(s.sunUp);
    u.uRainy.float(s.rain * s.intensity);
    u.uSnowy.float(s.snow * s.intensity);
    u.uEnc.float(f.enc);
    u.uFog.float(s.fog);
    u.uHaze.float(s.haze);
    u.uBolt.float(b.bolt);
    u.uBoltSeed.float(b.seed);
    u.uRainbow.float(s.rainbow);
    u.uMoonPhase.float(s.moonPhase);
    u.uBelt.float(s.belt);
    u.uStar.float(s.star);
    u.uStorm.float(s.storm);
    u.uSunCol.vec3(s.sunColor[0], s.sunColor[1], s.sunColor[2]);
    u.uMoonCol.vec3(s.moonColor[0], s.moonColor[1], s.moonColor[2]);
    u.uLCol.vec3(s.lightColor[0], s.lightColor[1], s.lightColor[2]);
    u.uZenith.vec3(s.zenith[0], s.zenith[1], s.zenith[2]);
    u.uHorizon.vec3(s.horizon[0], s.horizon[1], s.horizon[2]);
    u.uStart.int(q.start);
    u.uEnd.int(q.end);
    u.uOctCap.int(q.oct);
    gpu.drawFullscreen();
    f.pixels += l.skyWidth * l.skyHeight;
    f.passes++;
  }
}
