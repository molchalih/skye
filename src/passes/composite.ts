import type { Gpu } from "../gl/context.ts";
import type { Program } from "../gl/program.ts";
import type { Target } from "../gl/target.ts";
import { COMPOSITE_FS, FULLSCREEN_VS } from "../shaders/generated.ts";
import type { PassFrame } from "./frame.ts";

function declareUniforms(p: Program) {
  return {
    uSky: p.uniform("uSky"),
    uRes: p.uniform("uRes"),
    uSunPos: p.uniform("uSunPos"),
    uMoonPos: p.uniform("uMoonPos"),
    uBoltPos: p.uniform("uBoltPos"),
    uTime: p.uniform("uTime"),
    uSeed: p.uniform("uSeed"),
    uSunUp: p.uniform("uSunUp"),
    uMoonUp: p.uniform("uMoonUp"),
    uMoonPhase: p.uniform("uMoonPhase"),
    uStar: p.uniform("uStar"),
    uEnc: p.uniform("uEnc"),
    uHide: p.uniform("uHide"),
    uBolt: p.uniform("uBolt"),
    uBoltSeed: p.uniform("uBoltSeed"),
    uSunCol: p.uniform("uSunCol"),
    uMoonCol: p.uniform("uMoonCol"),
  };
}

/** Pass 2: upsamples the sky buffer and adds moon, stars, meteors, sun disc and bolt core at scene resolution. */
export class CompositePass {
  readonly program: Program;
  private readonly u: ReturnType<typeof declareUniforms>;

  constructor(gpu: Gpu) {
    this.program = gpu.program(FULLSCREEN_VS, COMPOSITE_FS);
    this.u = declareUniforms(this.program);
  }

  draw(gpu: Gpu, f: PassFrame, sky: Target, out: Target): void {
    const { state: s, layout: l, bolt: b } = f;
    const u = this.u;
    this.program.use();
    gpu.bindOutput(out, l.sceneWidth, l.sceneHeight);
    gpu.bindTexture(0, sky);
    u.uSky.int(0);
    u.uRes.vec2(l.sceneWidth, l.sceneHeight);
    u.uSunPos.vec2(s.sunPos[0], s.sunPos[1]);
    u.uMoonPos.vec2(s.moonPos[0], s.moonPos[1]);
    u.uBoltPos.vec2(b.position[0], b.position[1]);
    u.uTime.float(f.time);
    u.uSeed.float(s.seed);
    u.uSunUp.float(s.sunUp);
    u.uMoonUp.float(s.moonUp);
    u.uMoonPhase.float(s.moonPhase);
    u.uStar.float(s.star);
    u.uEnc.float(f.enc);
    u.uHide.float(s.hide);
    u.uBolt.float(b.bolt);
    u.uBoltSeed.float(b.seed);
    u.uSunCol.vec3(s.sunColor[0], s.sunColor[1], s.sunColor[2]);
    u.uMoonCol.vec3(s.moonColor[0], s.moonColor[1], s.moonColor[2]);
    gpu.drawFullscreen();
    f.pixels += l.sceneWidth * l.sceneHeight;
    f.passes++;
  }
}
